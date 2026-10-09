"""
VINCULAR UMA CONTA EXISTENTE, COMPARAR SALDOS, ACERTAR, DESVINCULAR
======================================================================

Vocabulário: uma AUTORIZAÇÃO é o consentimento dado no banco para a
aplicação ler as contas partilhadas, durante um prazo; cada conta
partilhada é uma CONTA BANCÁRIA; o VÍNCULO é o facto de uma conta bancária
alimentar uma CONTA da aplicação. Uma RECONCILIAÇÃO afirma «no fim do dia
D, o saldo era S»; o ACERTO é o movimento que a aplicação cria pela
diferença entre S e o saldo que ela calcula.

Este serviço trata do que liga o histórico de uma Conta ao banco:

1. VINCULAR UMA CONTA QUE JÁ EXISTE (regra A4) — só numa Conta manual,
   com uma conta bancária livre de uma autorização ativa, na mesma moeda.
   Dois modos:
   - CONTINUAR (por omissão): os movimentos da Conta ficam. A DATA DE CORTE
     (o último dia cujos movimentos não vêm do banco) é o dia do último
     movimento ou reconciliação da Conta; os movimentos do banco entram a
     partir do dia seguinte, e uma reconciliação do banco no dia de corte
     acerta a diferença entre o saldo da aplicação e o do banco.
     EMPARELHAR: uma compra registada à mão nos últimos dias antes do corte
     pode chegar do banco nos dias a seguir — e contaria duas vezes. A
     pré-visualização propõe pares (o mesmo valor, até 3 dias de cada lado
     do corte); em cada par aceite, o movimento do banco fica (com a
     categoria do manual) e o manual é apagado;
   - SUBSTITUIR: os movimentos e as reconciliações da Conta são apagados, e
     a data e o saldo iniciais passam a vir do banco, como numa Conta nova.
   Antes de confirmar, a PRÉ-VISUALIZAÇÃO ("antes → depois") mostra o saldo
   da aplicação, o do banco, o acerto que entraria, os pares propostos, ou
   quantos movimentos se perderiam.

2. COMPARAR SALDOS (regra R8): o saldo contabilístico do banco contra o
   saldo da aplicação no fim de hoje, ao cêntimo.

3. ACERTAR (regra R8): só se o utilizador pedir — a aplicação nunca cria
   acertos em silêncio. Cria uma reconciliação do banco no dia do
   movimento do banco mais recente (não hoje, para não ficar à frente de
   movimentos de hoje que ainda não chegaram).

4. DESVINCULAR (regras A5, R9), em dois modos:
   - MANTER TUDO (por omissão): os movimentos do banco ficam (com origem
     "banco"), e as reconciliações do banco passam a ser do utilizador;
   - TIRAR O QUE VEIO DO BANCO: saem os movimentos e as reconciliações
     criados pelo VÍNCULO ATUAL (os de vínculos anteriores ficam). Uma
     reconciliação que era do utilizador e passou a ser do banco (no dia
     de corte de "continuar") não sai: volta a ser do utilizador, com o
     saldo que ele tinha afirmado. Os movimentos manuais trocados por
     PARES ao vincular já não existem (o do banco ficou no lugar deles),
     por isso saem com os do banco: a confirmação de "tirar" tem de o
     avisar.

AS RECONCILIAÇÕES DO BANCO têm o saldo DERIVADO do saldo lido no banco num
instante T, e não fixo:
    S = saldo do banco em T
        − movimentos do banco com data depois de D, importados até T
        + movimentos do banco com data até D, importados depois de T
        − transações de data futura que o banco já contava em T
Por isso criam-se sempre na mesma transação que uma importação completa
até T (em "acertar", uma sincronização feita logo antes), e T é o "agora"
da própria transação na base de dados (o mesmo que fica no created_at dos
movimentos importados nela). As transações de data futura ainda não se
podem importar (um movimento nunca fica no futuro): a sua soma guarda-se
com a reconciliação (futuros_no_banco), para não contarem duas vezes.

Todas as operações que mudam a Conta a bloqueiam até ao fim da transação
(uma operação de cada vez por Conta). Nenhuma faz commit: quem chama (a
rota) torna tudo definitivo, uma vez, no fim — e, se algo falhar a meio
(por exemplo, o banco não responder), nada fica gravado.
"""

import uuid
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from decimal import Decimal

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.erros import Conflito, RegraViolada
from app.models.autorizacao import Autorizacao
from app.models.conta import Conta
from app.models.conta_bancaria import ContaBancaria
from app.models.movimento import Movimento
from app.models.reconciliacao import Reconciliacao
from app.models.user import User
from app.models.vinculo import Vinculo
from app.services.bloqueios import bloquear_conta
from app.services.contas import obter_conta_do_utilizador
from app.services.contas_bancarias import (
    garantir_que_se_pode_vincular,
    identificacao_bancaria,
    vincular,
    vinculo_da_conta,
    vinculo_da_conta_bancaria,
)
from app.services.estados import estado_conta_bancaria
from app.services.importacao_movimentos import (
    _categoria_refugio,
    _descricao,
    _esta_confirmada,
    _identificadores,
    _obter_todas_transacoes,
    _pode_ser_gravada,
    _valor_com_sinal,
    ancora_do_banco,
    saldo_contabilistico,
    sincronizar_movimentos,
    soma_dos_futuros,
)
from app.services.reconciliacoes import recalcular_acertos

_DUAS_CASAS = Decimal("0.01")

# Quantos dias de cada lado do corte se procuram pares para emparelhar.
DIAS_DE_EMPARELHAMENTO = 3


@dataclass
class Par:
    """Um movimento manual (antes do corte) e a transação do banco (depois do corte) que parece ser a mesma."""

    manual: Movimento
    transacao: dict


@dataclass
class PlanoContinuar:
    """Tudo o que "continuar" faria, calculado sem gravar nada (para a pré-visualização e para executar)."""

    data_corte: date
    saldo_banco: Decimal
    transacoes: list[dict]  # as confirmadas, com data depois do corte
    a_importar: list[dict]  # as que viram movimentos agora (sem valor 0 nem datas futuras)
    pares: list[Par] = field(default_factory=list)
    saldo_aplicacao_no_corte: Decimal = Decimal("0")
    sem_movimentos: bool = False


# --- Validações comuns ---


async def _garantir_conta_manual(db: AsyncSession, conta: Conta) -> None:
    """Só uma Conta MANUAL (sem vínculo) se pode vincular a uma conta bancária."""
    if await vinculo_da_conta(db, conta.id) is not None:
        raise Conflito("Esta conta já está vinculada a uma conta bancária.")


async def _validar_vinculacao(
    db: AsyncSession, utilizador: User, conta: Conta, conta_bancaria: ContaBancaria
) -> None:
    """A Conta manual, a conta bancária livre e vinculável, e a mesma moeda (regra I3)."""
    await _garantir_conta_manual(db, conta)
    await garantir_que_se_pode_vincular(db, utilizador.id, conta_bancaria)
    if conta.moeda != conta_bancaria.moeda:
        raise RegraViolada(
            f"A conta está em {conta.moeda} e a conta bancária em {conta_bancaria.moeda}: "
            "só se vinculam contas na mesma moeda."
        )


async def _agora_na_base_de_dados(db: AsyncSession) -> datetime:
    """
    O "agora" da transação em curso, tal como a base de dados o vê — o mesmo
    valor que o PostgreSQL põe no created_at das linhas criadas nesta
    transação (now() fica fixo no início da transação). É o instante T de
    uma reconciliação do banco.
    """
    return await db.scalar(select(func.now()))


# --- Continuar: o plano ---


async def _data_de_corte(db: AsyncSession, conta: Conta) -> tuple[date, bool]:
    """
    O dia de corte de "continuar": o do último movimento ou reconciliação
    da Conta (o que for mais tarde). Sem nenhum dos dois, a data inicial.
    Devolve também se a Conta não tinha movimentos (sugere-se "substituir").
    """
    ultimo_movimento = await db.scalar(
        select(func.max(Movimento.data)).where(Movimento.conta_id == conta.id)
    )
    ultima_reconciliacao = await db.scalar(
        select(func.max(Reconciliacao.data)).where(Reconciliacao.conta_id == conta.id)
    )
    datas = [d for d in (ultimo_movimento, ultima_reconciliacao) if d is not None]
    return (max(datas) if datas else conta.data_ancora), ultimo_movimento is None


def _propor_pares(manuais: list[Movimento], a_importar: list[dict], corte: date) -> list[Par]:
    """
    Os pares propostos: cada movimento manual dos últimos dias até ao corte
    com a primeira transação do banco ainda livre, dos dias a seguir ao
    corte, com o MESMO valor. Cada transação entra no máximo num par.
    """
    limite = corte + timedelta(days=DIAS_DE_EMPARELHAMENTO)
    livres = [
        t for t in a_importar if date.fromisoformat(t["booking_date"]) <= limite
    ]
    pares = []
    for manual in sorted(manuais, key=lambda m: (m.data, m.created_at)):
        for transacao in livres:
            if _valor_com_sinal(transacao) == manual.valor:
                pares.append(Par(manual=manual, transacao=transacao))
                livres.remove(transacao)
                break
    return pares


async def _plano_continuar(db: AsyncSession, conta: Conta, conta_bancaria: ContaBancaria) -> PlanoContinuar:
    """Lê o banco e calcula o que "continuar" faria, sem gravar nada."""
    corte, sem_movimentos = await _data_de_corte(db, conta)
    saldo_banco = await saldo_contabilistico(conta_bancaria.uid)
    transacoes = [
        t
        for t in await _obter_todas_transacoes(conta_bancaria.uid, corte + timedelta(days=1))
        if _esta_confirmada(t) and date.fromisoformat(t["booking_date"]) > corte
    ]
    a_importar = [t for t in transacoes if _pode_ser_gravada(t)]
    manuais = (
        await db.scalars(
            select(Movimento).where(
                Movimento.conta_id == conta.id,
                Movimento.origem == "manual",
                Movimento.data > corte - timedelta(days=DIAS_DE_EMPARELHAMENTO),
                Movimento.data <= corte,
            )
        )
    ).all()
    # O saldo da aplicação no fim do dia de corte, SEM o acerto de uma
    # reconciliação que já exista nesse dia: essa reconciliação passa a ser
    # do banco, e o seu acerto antigo é substituído pelo novo. Contá-lo
    # aqui faria a pré-visualização diferir do resultado exatamente nesse
    # valor. Os acertos de dias anteriores contam (fazem parte do saldo).
    saldo_no_corte = conta.saldo_ancora + Decimal(
        await db.scalar(
            select(func.coalesce(func.sum(Movimento.valor), 0)).where(
                Movimento.conta_id == conta.id,
                Movimento.data <= corte,
                ~((Movimento.origem == "acerto") & (Movimento.data == corte)),
            )
        )
    )
    return PlanoContinuar(
        data_corte=corte,
        saldo_banco=saldo_banco,
        transacoes=transacoes,
        a_importar=a_importar,
        pares=_propor_pares(list(manuais), a_importar, corte),
        saldo_aplicacao_no_corte=saldo_no_corte,
        sem_movimentos=sem_movimentos,
    )


def _acerto_previsto(plano: PlanoContinuar, pares_aceites: list[Par]) -> Decimal:
    """
    O acerto da reconciliação do banco no dia de corte: o saldo do banco
    menos todas as transações confirmadas depois do corte (o saldo do banco
    no fim do dia de corte), menos o saldo da aplicação nesse dia — sem os
    movimentos manuais dos pares aceites, que vão ser apagados.
    """
    saldo_banco_no_corte = plano.saldo_banco - sum(
        (_valor_com_sinal(t) for t in plano.transacoes), Decimal("0")
    )
    saldo_aplicacao = plano.saldo_aplicacao_no_corte - sum(
        (par.manual.valor for par in pares_aceites), Decimal("0")
    )
    return (saldo_banco_no_corte - saldo_aplicacao).quantize(_DUAS_CASAS)


# --- Pré-visualizar ---


async def simular_vinculacao(
    db: AsyncSession, utilizador: User, conta: Conta, conta_bancaria: ContaBancaria, modo: str
) -> dict:
    """
    O "antes → depois" de vincular uma Conta existente, sem gravar nada:
      - "continuar": a data de corte, o saldo da aplicação e o do banco, o
        acerto que entraria (com e sem os pares), os pares propostos,
        quantos movimentos do banco entram, e se se sugere "substituir"
        (a Conta não tem movimentos);
      - "substituir": quantos movimentos e reconciliações se perderiam, e
        de que datas.
    """
    await _validar_vinculacao(db, utilizador, conta, conta_bancaria)
    saldo_aplicacao = conta.saldo_ancora + Decimal(
        await db.scalar(
            select(func.coalesce(func.sum(Movimento.valor), 0)).where(Movimento.conta_id == conta.id)
        )
    )
    if modo == "substituir":
        perdidos = (
            await db.execute(
                select(func.count(), func.min(Movimento.data), func.max(Movimento.data)).where(
                    Movimento.conta_id == conta.id
                )
            )
        ).one()
        reconciliacoes = await db.scalar(
            select(func.count()).select_from(Reconciliacao).where(Reconciliacao.conta_id == conta.id)
        )
        return {
            "modo": "substituir",
            "saldo_aplicacao": saldo_aplicacao,
            "saldo_banco": await saldo_contabilistico(conta_bancaria.uid),
            "movimentos_a_perder": perdidos[0],
            "primeira_data_a_perder": perdidos[1],
            "ultima_data_a_perder": perdidos[2],
            "reconciliacoes_a_perder": reconciliacoes,
        }
    plano = await _plano_continuar(db, conta, conta_bancaria)
    return {
        "modo": "continuar",
        "saldo_aplicacao": saldo_aplicacao,
        "saldo_banco": plano.saldo_banco,
        "data_corte": plano.data_corte,
        "movimentos_a_importar": len(plano.a_importar),
        "acerto_sem_pares": _acerto_previsto(plano, []),
        "acerto_com_pares": _acerto_previsto(plano, plano.pares),
        "pares": [
            {
                "manual_id": par.manual.id,
                "data_manual": par.manual.data,
                "descricao_manual": par.manual.descricao,
                "valor": par.manual.valor,
                "data_banco": date.fromisoformat(par.transacao["booking_date"]),
                "descricao_banco": _descricao(par.transacao),
            }
            for par in plano.pares
        ],
        "sugerir_substituir": plano.sem_movimentos,
    }


# --- Vincular ---


async def _atualizar_memoria(db: AsyncSession, conta: Conta, conta_bancaria: ContaBancaria) -> None:
    """
    A MEMÓRIA (a identificação da conta real que a Conta teve por último)
    passa a ser esta conta bancária. É de um para um: outra Conta que se
    lembrasse dela deixa de se lembrar (regra A9).
    """
    identificacao = identificacao_bancaria(
        conta_bancaria.identification_hash, conta_bancaria.iban, conta_bancaria.moeda
    )
    if identificacao is not None:
        await db.execute(
            update(Conta)
            .where(
                Conta.user_id == conta.user_id,
                Conta.identificacao_bancaria == identificacao,
                Conta.id != conta.id,
            )
            .values(identificacao_bancaria=None)
        )
        await db.flush()
    conta.identificacao_bancaria = identificacao


async def _importar(
    db: AsyncSession,
    conta: Conta,
    vinculo: Vinculo,
    transacoes: list[dict],
    categoria_por_identificador: dict[str, uuid.UUID],
) -> int:
    """Grava as transações como movimentos do banco deste vínculo (com a categoria-refúgio, salvo indicação)."""
    entrada = await _categoria_refugio(db, conta.user_id, "entrada")
    saida = await _categoria_refugio(db, conta.user_id, "saida")
    for transacao, identificador in zip(transacoes, _identificadores(transacoes)):
        omissao = entrada if transacao["credit_debit_indicator"] == "CRDT" else saida
        db.add(
            Movimento(
                conta_id=conta.id,
                data=date.fromisoformat(transacao["booking_date"]),
                descricao=_descricao(transacao),
                valor=_valor_com_sinal(transacao),
                categoria_id=categoria_por_identificador.get(identificador, omissao.id),
                id_transacao_externa=identificador,
                origem="banco",
                vinculo_id=vinculo.id,
            )
        )
    await db.flush()
    return len(transacoes)


async def vincular_conta_existente(
    db: AsyncSession,
    utilizador: User,
    conta: Conta,
    conta_bancaria: ContaBancaria,
    modo: str,
    pares_aceites: list[uuid.UUID],
) -> dict:
    """
    Vincula uma Conta manual que já existe a uma conta bancária (regra A4),
    em "continuar" ou "substituir" (ver o topo do ficheiro). Em "continuar",
    "pares_aceites" são os ids dos movimentos manuais cujo par o utilizador
    aceitou. Devolve um resumo (movimentos importados, e o acerto em
    "continuar").
    """
    # Primeiro o bloqueio, depois as verificações (nenhuma outra operação
    # pode mudar a Conta entre uma e outra).
    await bloquear_conta(db, conta.id)
    await _validar_vinculacao(db, utilizador, conta, conta_bancaria)
    autorizacao = await db.get(Autorizacao, conta_bancaria.autorizacao_id)

    if modo == "substituir":
        saldo = await saldo_contabilistico(conta_bancaria.uid)
        todas = await _obter_todas_transacoes(conta_bancaria.uid, None, estrategia="longest")
        confirmadas = [t for t in todas if _esta_confirmada(t)]
        data_ancora, saldo_ancora = ancora_do_banco(saldo, confirmadas)
        await db.execute(delete(Reconciliacao).where(Reconciliacao.conta_id == conta.id))
        await db.execute(delete(Movimento).where(Movimento.conta_id == conta.id))
        conta.data_ancora = data_ancora
        conta.saldo_ancora = saldo_ancora
        conta.banco = autorizacao.banco
        await _atualizar_memoria(db, conta, conta_bancaria)
        vinculo = await vincular(db, utilizador.id, conta, conta_bancaria, data_ancora - timedelta(days=1))
        importados = await _importar(
            db, conta, vinculo, [t for t in confirmadas if _pode_ser_gravada(t)], {}
        )
        return {"modo": "substituir", "movimentos_importados": importados, "acerto": None}

    plano = await _plano_continuar(db, conta, conta_bancaria)
    aceites = [par for par in plano.pares if par.manual.id in set(pares_aceites)]
    # Em cada par aceite, a transação do banco fica com a categoria do
    # movimento manual, que é apagado.
    identificadores = dict(zip(map(id, plano.a_importar), _identificadores(plano.a_importar)))
    categoria_por_identificador = {
        identificadores[id(par.transacao)]: par.manual.categoria_id for par in aceites
    }
    for par in aceites:
        await db.delete(par.manual)
    await db.flush()

    lido_em = await _agora_na_base_de_dados(db)
    conta.banco = autorizacao.banco
    await _atualizar_memoria(db, conta, conta_bancaria)
    vinculo = await vincular(db, utilizador.id, conta, conta_bancaria, plano.data_corte)
    importados = await _importar(db, conta, vinculo, plano.a_importar, categoria_por_identificador)
    reconciliacao = await _reconciliacao_do_banco(
        db,
        conta,
        vinculo,
        plano.data_corte,
        plano.saldo_banco,
        lido_em,
        soma_dos_futuros(plano.transacoes),
    )
    await recalcular_acertos(db, conta.id)
    acerto = await _acerto_de(db, reconciliacao)
    return {"modo": "continuar", "movimentos_importados": importados, "acerto": acerto}


async def _reconciliacao_do_banco(
    db: AsyncSession,
    conta: Conta,
    vinculo: Vinculo,
    dia: date,
    saldo_banco: Decimal,
    lido_em: datetime,
    futuros: Decimal,
) -> Reconciliacao:
    """
    Cria a reconciliação do banco do dia "dia" — ou, se já houver uma nesse
    dia (só pode haver uma por dia), passa-a a ser do banco, com a leitura
    nova. Se a que já havia era do UTILIZADOR, o saldo que ele afirmou
    guarda-se (saldo_do_utilizador), para voltar a ser dele ao "tirar o
    que veio do banco". O saldo afirmado é derivado no recálculo dos
    acertos; "futuros" é a soma das transações de data futura que o banco
    já contava em "saldo_banco".
    """
    reconciliacao = await db.scalar(
        select(Reconciliacao).where(Reconciliacao.conta_id == conta.id, Reconciliacao.data == dia)
    )
    if reconciliacao is None:
        reconciliacao = Reconciliacao(conta_id=conta.id, data=dia, saldo=saldo_banco)
        db.add(reconciliacao)
    elif reconciliacao.origem == "utilizador":
        reconciliacao.saldo_do_utilizador = reconciliacao.saldo
    reconciliacao.origem = "banco"
    reconciliacao.saldo_banco = saldo_banco
    reconciliacao.lido_em = lido_em
    reconciliacao.futuros_no_banco = futuros
    reconciliacao.vinculo_id = vinculo.id
    await db.flush()
    return reconciliacao


async def _acerto_de(db: AsyncSession, reconciliacao: Reconciliacao) -> Decimal:
    """O valor do acerto de uma reconciliação (0 se não houver)."""
    valor = await db.scalar(
        select(func.coalesce(func.sum(Movimento.valor), 0)).where(
            Movimento.reconciliacao_id == reconciliacao.id
        )
    )
    return Decimal(valor).quantize(_DUAS_CASAS)


# --- Comparar e acertar ---


async def _vinculada_e_a_funcionar(
    db: AsyncSession, utilizador: User, conta_bancaria: ContaBancaria
) -> tuple[Conta, Vinculo]:
    """A Conta e o vínculo de uma conta bancária VINCULADA (não suspensa); Conflito caso contrário."""
    vinculo = await vinculo_da_conta_bancaria(db, conta_bancaria.id)
    if vinculo is None:
        raise Conflito("Esta conta bancária ainda não está vinculada a nenhuma conta.")
    autorizacao = await db.get(Autorizacao, conta_bancaria.autorizacao_id)
    if estado_conta_bancaria(conta_bancaria, autorizacao, tem_vinculo=True) == "suspensa":
        raise Conflito("A autorização deste banco já terminou. É preciso autorizá-lo outra vez.")
    return await obter_conta_do_utilizador(db, utilizador, vinculo.conta_id), vinculo


async def saldo_da_aplicacao(db: AsyncSession, conta: Conta) -> Decimal:
    """O saldo atual da Conta na aplicação: o saldo inicial mais todos os movimentos."""
    soma = await db.scalar(
        select(func.coalesce(func.sum(Movimento.valor), 0)).where(Movimento.conta_id == conta.id)
    )
    return (conta.saldo_ancora + Decimal(soma)).quantize(_DUAS_CASAS)


async def comparar_saldos(
    db: AsyncSession, utilizador: User, conta_bancaria: ContaBancaria
) -> dict:
    """
    O saldo contabilístico do banco contra o saldo da aplicação, e a
    diferença (banco − aplicação), ao cêntimo (regra R8). Se não for zero, o
    utilizador pode "Acertar".
    """
    conta, _ = await _vinculada_e_a_funcionar(db, utilizador, conta_bancaria)
    banco = await saldo_contabilistico(conta_bancaria.uid)
    aplicacao = await saldo_da_aplicacao(db, conta)
    return {"saldo_banco": banco, "saldo_aplicacao": aplicacao, "diferenca": banco - aplicacao}


async def acertar(db: AsyncSession, utilizador: User, conta_bancaria: ContaBancaria) -> dict:
    """
    Cria (ou atualiza) uma reconciliação do banco com o saldo lido agora,
    no dia do movimento do banco mais recente (ou no dia de corte, se ainda
    não houver nenhum), para o saldo da aplicação bater com o do banco
    (regra R8). Só acontece quando o utilizador pede.

    SINCRONIZA PRIMEIRO, na mesma transação: o saldo do banco já inclui
    tudo o que o banco lançou até agora. Sem importar esses movimentos
    antes, um movimento lançado depois da última sincronização ficaria
    dentro do saldo afirmado e, quando entrasse mais tarde, contaria uma
    segunda vez. O saldo lê-se antes de sincronizar, tal como em
    "continuar".
    """
    conta, _ = await _vinculada_e_a_funcionar(db, utilizador, conta_bancaria)
    # O bloqueio vem antes de tudo o resto, e a verificação repete-se
    # depois dele: outra operação (desvincular, por exemplo) pode ter mudado
    # o vínculo entretanto.
    await bloquear_conta(db, conta.id)
    conta, vinculo = await _vinculada_e_a_funcionar(db, utilizador, conta_bancaria)
    saldo_banco = await saldo_contabilistico(conta_bancaria.uid)
    lido_em = await _agora_na_base_de_dados(db)
    sincronizacao = await sincronizar_movimentos(db, conta, conta_bancaria, vinculo)
    ultimo_do_banco = await db.scalar(
        select(func.max(Movimento.data)).where(
            Movimento.conta_id == conta.id, Movimento.origem == "banco"
        )
    )
    dia = max(d for d in (ultimo_do_banco, vinculo.data_corte) if d is not None)
    reconciliacao = await _reconciliacao_do_banco(
        db, conta, vinculo, dia, saldo_banco, lido_em, sincronizacao.futuros
    )
    await recalcular_acertos(db, conta.id)
    return {"data": dia, "acerto": await _acerto_de(db, reconciliacao)}


# --- Desvincular ---


async def desvincular_conta_bancaria(
    db: AsyncSession, conta_bancaria: ContaBancaria, modo: str = "manter"
) -> None:
    """
    Desfaz o vínculo de uma conta bancária (regras A5, R9). A conta bancária
    fica livre; a Conta passa a manual e guarda a memória.
      - "manter" (por omissão): os movimentos do banco ficam; as
        reconciliações do banco deste vínculo passam a ser do utilizador
        (com o saldo que tinham), e já se podem editar;
      - "tirar": saem os movimentos e as reconciliações criados por ESTE
        vínculo; os de vínculos anteriores ficam.
    Os acertos recalculam-se no fim.
    """
    vinculo = await vinculo_da_conta_bancaria(db, conta_bancaria.id)
    if vinculo is None:
        raise Conflito("Esta conta bancária não está vinculada.")
    conta_id = vinculo.conta_id
    # O bloqueio, e depois o vínculo lido outra vez: dois "desvincular" ao
    # mesmo tempo leriam os dois o vínculo antes de o primeiro o apagar.
    await bloquear_conta(db, conta_id)
    vinculo = await vinculo_da_conta_bancaria(db, conta_bancaria.id)
    if vinculo is None or vinculo.conta_id != conta_id:
        raise Conflito("Esta conta bancária não está vinculada.")
    if modo == "tirar":
        # As que eram do utilizador antes de passarem a ser do banco voltam
        # a ser dele, com o saldo que tinha afirmado; as outras saem.
        await db.execute(
            update(Reconciliacao)
            .where(
                Reconciliacao.vinculo_id == vinculo.id,
                Reconciliacao.saldo_do_utilizador.is_not(None),
            )
            .values(
                origem="utilizador",
                saldo=Reconciliacao.saldo_do_utilizador,
                saldo_do_utilizador=None,
                saldo_banco=None,
                lido_em=None,
                futuros_no_banco=None,
                vinculo_id=None,
            )
        )
        await db.execute(delete(Reconciliacao).where(Reconciliacao.vinculo_id == vinculo.id))
        await db.execute(
            delete(Movimento).where(Movimento.vinculo_id == vinculo.id, Movimento.origem == "banco")
        )
    else:
        await passar_reconciliacoes_a_do_utilizador(db, [vinculo.id])
    await db.delete(vinculo)
    await db.flush()
    await recalcular_acertos(db, conta_id)


async def passar_reconciliacoes_a_do_utilizador(db: AsyncSession, vinculos: list[uuid.UUID]) -> None:
    """
    As reconciliações do banco destes vínculos passam a ser do utilizador,
    com o saldo derivado que tinham (que deixa de mudar). Usada ao
    desvincular com "manter tudo" e ao esquecer uma autorização.
    """
    if not vinculos:
        return
    await db.execute(
        update(Reconciliacao)
        .where(Reconciliacao.vinculo_id.in_(vinculos), Reconciliacao.origem == "banco")
        # O saldo do utilizador de antes (se havia) deixa de interessar: a
        # reconciliação fica com o saldo derivado que tinha.
        .values(origem="utilizador", saldo_do_utilizador=None)
    )
    await db.flush()
