"""
IMPORTAÇÃO DE MOVIMENTOS VIA OPEN BANKING
=============================================

Este ficheiro trata da parte que falta para a integração de Open Banking
ser útil a sério: transformar o que a Enable Banking devolve (saldos e
transacções — ver app/services/enable_banking.py) em `Conta` e
`Movimento` reais desta aplicação (app/models/conta.py,
app/models/movimento.py), sem alterar esses dois modelos além do campo
`id_transacao_externa` já acrescentado a Movimento.

DUAS FUNÇÕES, DOIS MOMENTOS: criar_conta_a_partir_de_ligacao trata da
PRIMEIRA importação, quando uma conta NASCE já ligada ao Open Banking, sem
histórico manual anterior — calcula a âncora a partir do saldo actual e
das transacções trazidas nessa primeira vez. sincronizar_movimentos trata
de QUALQUER importação seguinte, para uma conta já associada — nunca mexe
na âncora, só acrescenta movimentos novos a partir de uma data de corte
com margem de segurança (ver a constante _MARGEM_SEGURANCA_DIAS, e a nota
sobre booking_date vs. value_date no caderno).

POR AGORA NÃO IMPLEMENTADO: o cenário de associar uma `ContaLigada` a uma
`Conta` já existente, com movimentos MANUAIS anteriores (ao contrário de
já ter sido alimentada por uma importação anterior) — precisa de um passo
de reconciliação de saldo próprio (ver o caderno), discutido mas ainda
por desenhar tecnicamente.

SALDO-ÂNCORA CALCULADO PARA BATER CERTO, NÃO ADIVINHADO: em vez de tentar
obter o saldo exacto num dia qualquer do passado (que a Enable Banking não
oferece directamente), parte-se do saldo ACTUAL confirmado (tipo "CLBD",
"Accounting balance" — ver a nota sobre tipos de saldo no caderno) e
subtrai-se a soma de todas as transacções trazidas nesta primeira
importação. O resultado é a âncora na data da transacção mais antiga
trazida — por construção, saldo_ancora + soma dos movimentos importados
é sempre EXACTAMENTE igual ao saldo actual confirmado pelo banco, sem
margem para erro de arredondamento ou suposição.

LIMITAÇÃO CONHECIDA E DELIBERADA: só se lê a PRIMEIRA página de
transacções que a Enable Banking devolver (sem seguir um eventual
"continuation_key" para páginas seguintes) — evita, nesta primeira
versão, lidar com paginação, à custa de poder não trazer TODO o histórico
disponível se a conta tiver muitas transacções. O saldo continua exacto
na mesma (a fórmula acima usa sempre as transacções realmente trazidas,
nunca assume "trouxemos tudo").
"""

import uuid
from datetime import date, timedelta
from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.categoria import Categoria
from app.models.conta import Conta
from app.models.conta_ligada import ContaLigada
from app.models.ligacao_bancaria import LigacaoBancaria
from app.models.movimento import Movimento
from app.services.enable_banking import obter_movimentos, obter_saldos

# Quantos dias para trás, além do último movimento já importado, uma
# sincronização volta a pedir — ver a nota sobre booking_date vs.
# value_date no caderno: uma transacção pode demorar alguns dias a
# aparecer na lista do banco, com uma data anterior à de hoje. Sem esta
# margem, uma sincronização que só pedisse "desde o dia seguinte ao
# último movimento" arriscava nunca voltar a ver essa transacção. Repetir
# um intervalo já sincronizado não duplica nada — a deduplicação por
# id_transacao_externa, mais abaixo, garante isso.
_MARGEM_SEGURANCA_DIAS = 5


def _valor_com_sinal(transacao: dict) -> Decimal:
    """
    Converte o valor de uma transacção (sempre positivo na resposta da
    Enable Banking, como texto) para o valor COM SINAL que Movimento usa
    (ver a nota no topo de app/models/movimento.py): positivo para uma
    entrada ("CRDT", credit), negativo para uma saída ("DBIT", debit).
    """
    quantia = Decimal(transacao["transaction_amount"]["amount"])
    return quantia if transacao["credit_debit_indicator"] == "CRDT" else -quantia


def _descricao(transacao: dict) -> str:
    """
    "remittance_information" é uma lista de linhas de texto livre (ex.:
    ["COMPRAS C.DEB SANTOS"]) — junta-se numa só descrição. Quando vem
    vazia (confirmado que pode acontecer nalgumas transacções), usa-se um
    texto genérico em vez de deixar a descrição vazia — Movimento.descricao
    é obrigatória. Cortada a 200 caracteres, o limite da coluna.
    """
    linhas = transacao.get("remittance_information") or []
    texto = " ".join(linhas).strip()
    return (texto or "Movimento importado (Open Banking)")[:200]


def _esta_confirmada(transacao: dict) -> bool:
    """
    True só para uma transacção já CONFIRMADA pelo banco ("status":
    "BOOK", confirmado em testes reais com a CGD) — nunca uma pendente ou
    ainda por autorizar. Filtro aplicado ANTES de somar ou gravar
    qualquer transacção (ver criar_conta_a_partir_de_ligacao e
    sincronizar_movimentos, abaixo).

    PORQUÊ ISTO IMPORTA: uma transacção pendente pode desaparecer,
    mudar de valor, ou ser confirmada mais tarde com um identificador
    diferente do que tinha enquanto pendente. O saldo "CLBD" usado como
    referência (ver a nota SALDO-ÂNCORA, no topo do ficheiro) já não a
    inclui — se ela fosse somada aqui na mesma, saldo_ancora ficaria
    errado de forma permanente (a âncora nunca é recalculada depois de
    criada), e uma sincronização futura arriscava gravá-la outra vez,
    com um identificador diferente, como um segundo movimento duplicado.
    """
    return transacao.get("status") == "BOOK"


def _id_externo(transacao: dict) -> str | None:
    """
    A chave de deduplicação (ver id_transacao_externa, em
    app/models/movimento.py): "transaction_id" quando presente (a
    documentação da Enable Banking promete-o como estável e único, mas
    confirmámos, em testes reais com a CGD, que vem sempre None), senão
    "entry_reference" (confirmado, nesses mesmos testes, que vem
    preenchido e aparentemente sequencial).
    """
    return transacao.get("transaction_id") or transacao.get("entry_reference")


async def _categoria_refugio(db: AsyncSession, user_id: uuid.UUID, direcao: str) -> Categoria:
    """
    Devolve a categoria-refúgio protegida da direcção indicada ("entrada"
    ou "saida") — ver a nota CATEGORIA OBRIGATÓRIA em
    app/models/movimento.py: um movimento importado, tal como um
    movimento manual sem escolha explícita, fica sempre com esta
    categoria por omissão, nunca sem nenhuma. scalar_one() falha alto e
    claro se, por algum motivo, não existir exactamente uma — nunca
    deveria acontecer, porque semear_categorias (app/services/
    categorias_seed.py) garante sempre as duas, uma por direcção.
    """
    resultado = await db.execute(
        select(Categoria).where(
            Categoria.user_id == user_id,
            Categoria.protegida.is_(True),
            Categoria.direcao == direcao,
        )
    )
    return resultado.scalar_one()


async def criar_conta_a_partir_de_ligacao(
    db: AsyncSession, user_id: uuid.UUID, conta_ligada: ContaLigada, nome: str
) -> Conta:
    """
    Cria uma Conta nova a partir de uma ContaLigada ainda por associar
    (ver a nota CENÁRIO MAIS SIMPLES no topo do ficheiro), associa-a
    (conta_ligada.conta_id), e importa de imediato a primeira página de
    transacções disponível como Movimento — ver as notas SALDO-ÂNCORA e
    LIMITAÇÃO CONHECIDA, no topo do ficheiro, para o desenho exacto desse
    cálculo.

    "nome" é escolhido por quem chama esta função (o utilizador, através
    do endpoint em app/routers/open_banking.py) — banco e moeda vêm
    automaticamente da ligação e da conta externa, mas o nome da Conta é
    sempre uma escolha do utilizador, tal como ao criar uma conta manual.
    """
    ligacao = await db.get(LigacaoBancaria, conta_ligada.ligacao_id)

    saldos = await obter_saldos(conta_ligada.uid)
    saldo_actual = next(
        (
            Decimal(saldo["balance_amount"]["amount"])
            for saldo in saldos["balances"]
            if saldo["balance_type"] == "CLBD"
        ),
        None,
    )
    if saldo_actual is None:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="O banco não devolveu um saldo contabilístico (CLBD) para esta conta.",
        )

    resposta = await obter_movimentos(conta_ligada.uid)
    # Só transacções já confirmadas ("BOOK") entram no cálculo do saldo e
    # são gravadas — ver a nota em _esta_confirmada, acima.
    transacoes = [t for t in resposta["transactions"] if _esta_confirmada(t)]

    if transacoes:
        data_ancora = min(date.fromisoformat(t["booking_date"]) for t in transacoes)
        soma_transacoes = sum((_valor_com_sinal(t) for t in transacoes), Decimal("0"))
        saldo_ancora = saldo_actual - soma_transacoes
    else:
        # Sem transacções disponíveis: a âncora é hoje, com o saldo actual
        # — não há histórico nenhum para trazer.
        data_ancora = date.today()
        saldo_ancora = saldo_actual

    conta = Conta(
        user_id=user_id,
        nome=nome,
        banco=ligacao.aspsp_nome,
        moeda=conta_ligada.moeda,
        data_ancora=data_ancora,
        saldo_ancora=saldo_ancora,
    )
    db.add(conta)
    await db.flush()

    conta_ligada.conta_id = conta.id

    # Uma categoria-refúgio por direcção, obtida uma única vez antes do
    # ciclo — não há razão para repetir a mesma consulta por transacção.
    categoria_entrada = await _categoria_refugio(db, user_id, "entrada")
    categoria_saida = await _categoria_refugio(db, user_id, "saida")

    for transacao in transacoes:
        categoria = (
            categoria_entrada if transacao["credit_debit_indicator"] == "CRDT" else categoria_saida
        )
        db.add(
            Movimento(
                conta_id=conta.id,
                data=date.fromisoformat(transacao["booking_date"]),
                descricao=_descricao(transacao),
                valor=_valor_com_sinal(transacao),
                categoria_id=categoria.id,
                id_transacao_externa=_id_externo(transacao),
            )
        )

    await db.commit()
    await db.refresh(conta)
    return conta


async def sincronizar_movimentos(db: AsyncSession, conta_ligada: ContaLigada) -> int:
    """
    Importa as transacções NOVAS de uma ContaLigada JÁ associada a uma
    Conta (ao contrário de criar_conta_a_partir_de_ligacao, que faz a
    associação inicial) — o mecanismo para uma sincronização repetida,
    manual ou futuramente periódica. Devolve quantos movimentos novos
    foram criados.

    A PARTIR DE QUANDO PEDIR a Enable Banking: da data do último
    movimento já existente nesta conta, menos _MARGEM_SEGURANCA_DIAS (ver
    a constante, acima). Sem nenhum movimento ainda (não deveria
    acontecer para uma conta associada por criar_conta_a_partir_de_ligacao,
    mas pode acontecer no cenário — ainda por construir — de associar a
    uma conta já existente sem histórico nenhum importado ainda), pede-se
    tudo o que a Enable Banking disponibilizar, sem filtro de data.

    DEDUPLICAÇÃO: antes de gravar, lê-se o conjunto de
    id_transacao_externa já presentes nesta conta, e ignora-se qualquer
    transacção cujo identificador (ver _id_externo) já lá esteja — sem
    isto, pedir com uma margem de segurança para trás (acima)
    reintroduziria sempre as mesmas transacções da vez anterior.

    NUNCA ANTES DA ÂNCORA: mesmo sem nenhum movimento existente ainda (o
    caso "pede-se tudo", acima), qualquer transacção com data anterior à
    data_ancora da conta é ignorada. Cenário que isto evita: uma conta
    criada sem nenhuma transacção disponível na primeira importação (ver
    criar_conta_a_partir_de_ligacao) fica com data_ancora=hoje e
    saldo_ancora=saldo actual — esse saldo JÁ CONTA tudo o que aconteceu
    até então. Se uma transacção antiga aparecesse tarde no extracto do
    banco (booking_date atrasado, ver a nota da constante acima) e fosse
    gravada aqui, estaria a ser somada uma SEGUNDA vez por cima de um
    saldo que já a incluía implicitamente.
    """
    conta = await db.get(Conta, conta_ligada.conta_id)

    resultado = await db.execute(
        select(func.max(Movimento.data)).where(Movimento.conta_id == conta_ligada.conta_id)
    )
    ultima_data = resultado.scalar_one_or_none()
    data_de = (ultima_data - timedelta(days=_MARGEM_SEGURANCA_DIAS)) if ultima_data else None

    resposta = await obter_movimentos(conta_ligada.uid, data_de)
    # Só transacções confirmadas (ver _esta_confirmada) e não anteriores à
    # âncora da conta (ver a nota NUNCA ANTES DA ÂNCORA, acima).
    transacoes = [
        t
        for t in resposta["transactions"]
        if _esta_confirmada(t) and date.fromisoformat(t["booking_date"]) >= conta.data_ancora
    ]
    if not transacoes:
        return 0

    resultado = await db.execute(
        select(Movimento.id_transacao_externa).where(
            Movimento.conta_id == conta_ligada.conta_id,
            Movimento.id_transacao_externa.is_not(None),
        )
    )
    ids_existentes = {linha[0] for linha in resultado.all()}

    ligacao = await db.get(LigacaoBancaria, conta_ligada.ligacao_id)
    categoria_entrada = await _categoria_refugio(db, ligacao.user_id, "entrada")
    categoria_saida = await _categoria_refugio(db, ligacao.user_id, "saida")

    novos = 0
    for transacao in transacoes:
        id_externo = _id_externo(transacao)
        # Transacções sem NENHUM identificador (nem transaction_id, nem
        # entry_reference) não podem ser reconhecidas como já importadas
        # — ficam de fora deste "if" e são sempre gravadas de novo. Não
        # observado em nenhum teste real até agora, mas seria a única
        # forma de uma transacção acabar duplicada por esta função.
        if id_externo is not None and id_externo in ids_existentes:
            continue

        categoria = (
            categoria_entrada if transacao["credit_debit_indicator"] == "CRDT" else categoria_saida
        )
        db.add(
            Movimento(
                conta_id=conta_ligada.conta_id,
                data=date.fromisoformat(transacao["booking_date"]),
                descricao=_descricao(transacao),
                valor=_valor_com_sinal(transacao),
                categoria_id=categoria.id,
                id_transacao_externa=id_externo,
            )
        )
        novos += 1

    await db.commit()
    return novos
