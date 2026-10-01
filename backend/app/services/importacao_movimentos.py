"""
IMPORTAÇÃO DE MOVIMENTOS VIA OPEN BANKING
=============================================

Este ficheiro trata da parte que falta para a integração de Open Banking
ser útil a sério: transformar o que a Enable Banking devolve (saldos e
transacções — ver app/services/enable_banking.py) em `Conta` e
`Movimento` reais desta aplicação (app/models/conta.py,
app/models/movimento.py), sem alterar esses dois modelos além do campo
`id_transacao_externa` já acrescentado a Movimento.

DUAS FUNÇÕES PRINCIPAIS:
- criar_conta_a_partir_de_ligacao: a PRIMEIRA importação, quando uma
  conta NASCE já ligada ao Open Banking, sem histórico manual anterior —
  calcula a âncora a partir do saldo actual e das transacções trazidas
  nesse momento.
- sincronizar_movimentos: importa os movimentos NOVOS de uma conta JÁ
  ligada e já associada — chamada manualmente (botão "Sincronizar
  agora", app/routers/open_banking.py) ou, se activada em Perfil,
  periodicamente.

POR AGORA DELIBERADAMENTE NÃO IMPLEMENTADO (adiado para uma fatia
própria — ver o caderno): associar uma `ContaLigada` a uma `Conta` já
existente com movimentos MANUAIS anteriores (precisa de um passo de
reconciliação de saldo próprio, o "Cenário 1"), e reconhecer
automaticamente a MESMA conta real numa religação futura (via
identification_hash, já guardado em ContaLigada, mas ainda não usado
para nada) — isto é um problema DIFERENTE de sincronizar: só entra em
jogo quando o consentimento de 90 dias expira e é preciso autenticar de
novo junto do banco, criando uma ContaLigada nova, com um "uid" novo,
para a mesma conta real.

SALDO-ÂNCORA CALCULADO PARA BATER CERTO, NÃO ADIVINHADO (só na primeira
importação): em vez de tentar obter o saldo exacto num dia qualquer do
passado (que a Enable Banking não oferece directamente), parte-se do
saldo ACTUAL confirmado (tipo "CLBD", "Accounting balance" — ver a nota
sobre tipos de saldo no caderno) e subtrai-se a soma de todas as
transacções trazidas nesta primeira importação. O resultado é a âncora
na data da transacção mais antiga trazida — por construção, saldo_ancora
+ soma dos movimentos importados é sempre EXACTAMENTE igual ao saldo
actual confirmado pelo banco, sem margem para erro de arredondamento ou
suposição. Uma sincronização (movimentos NOVOS, sobre uma âncora já
fixada) nunca mexe em saldo_ancora — só acrescenta Movimento.

PAGINAÇÃO COMPLETA: a Enable Banking pode dividir a resposta de
/transactions por várias páginas, através de um "continuation_key" — a
primeira versão desta integração só lia a primeira página; agora,
_obter_todas_transacoes segue esse "continuation_key" até a Enable
Banking deixar de o devolver, juntando as páginas todas antes de
qualquer filtro ou soma. Um limite de segurança (_LIMITE_PAGINAS) evita
um ciclo sem fim se a API alguma vez devolver um "continuation_key" que
nunca se esgota — situação nunca observada, mas esta integração já
surpreendeu vezes suficientes (ver o caderno) para não confiar cegamente
nisso.
"""

import uuid
from datetime import date, timedelta
from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.categoria import Categoria
from app.models.conta import Conta
from app.models.conta_ligada import ContaLigada
from app.models.ligacao_bancaria import LigacaoBancaria
from app.models.movimento import Movimento
from app.services.enable_banking import obter_movimentos, obter_saldos

# Número máximo de páginas seguidas antes de desistir com um erro claro
# (ver a nota PAGINAÇÃO COMPLETA, no topo do ficheiro) — generoso para
# qualquer conta pessoal real (cada página traz normalmente dezenas a
# centenas de transacções), mas finito, para nunca ficar preso num ciclo
# sem fim por causa de um "continuation_key" que a Enable Banking
# devolvesse sempre igual.
_LIMITE_PAGINAS = 50

# Margem de segurança, em dias, para trás da última data já importada,
# ao sincronizar uma conta já ligada (ver sincronizar_movimentos, abaixo)
# — booking_date pode aparecer alguns dias depois de a transacção ter
# realmente acontecido (confirmado em testes reais, ver o caderno), por
# isso cortar exactamente "no dia seguinte ao último movimento" arriscava
# nunca voltar a ver uma transacção atrasada. A deduplicação por
# id_transacao_externa garante que reimportar estes últimos dias nunca
# duplica o que já lá estava.
_MARGEM_SEGURANCA_DIAS = 5


async def _obter_todas_transacoes(
    uid: str, data_de: date | None = None, estrategia: str | None = None
) -> list[dict]:
    """
    Junta TODAS as páginas de transacções que a Enable Banking devolver
    para esta conta (ver a nota PAGINAÇÃO COMPLETA, no topo do ficheiro),
    seguindo "continuation_key" enquanto a resposta o continuar a trazer.

    "data_de" e "estrategia" (ver obter_movimentos, em
    app/services/enable_banking.py) vão em TODOS os pedidos, com o
    "continuation_key" nos seguintes — o mesmo pedido, página a página.
    """
    transacoes: list[dict] = []
    continuation_key: str | None = None

    for _ in range(_LIMITE_PAGINAS):
        resposta = await obter_movimentos(uid, data_de, continuation_key, estrategia)
        transacoes.extend(resposta["transactions"])
        continuation_key = resposta.get("continuation_key")
        if not continuation_key:
            return transacoes

    raise HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail=(
            f"O banco continua a devolver mais páginas de movimentos para lá de "
            f"{_LIMITE_PAGINAS} pedidos seguidos — a importar foi interrompida por segurança."
        ),
    )


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
    db: AsyncSession,
    user_id: uuid.UUID,
    conta_ligada: ContaLigada,
    nome: str,
    data_de: date | None = None,
    tipo: str | None = None,
) -> Conta:
    """
    Cria uma Conta nova a partir de uma ContaLigada ainda por associar,
    associa-a (conta_ligada.conta_id), e importa de imediato as
    transacções disponíveis como Movimento — ver as notas SALDO-ÂNCORA e
    PAGINAÇÃO COMPLETA, no topo do ficheiro, para o desenho exacto desse
    cálculo.

    "nome" é escolhido por quem chama esta função (o utilizador, através
    do endpoint em app/routers/open_banking.py) — banco e moeda vêm
    automaticamente da ligação e da conta externa, mas o nome da Conta é
    sempre uma escolha do utilizador, tal como ao criar uma conta manual.

    "data_de", quando indicada, limita a importação a partir dessa data —
    a escolha ("todo o histórico" vs. "desde uma data") é feita pelo
    utilizador no passo "confirmar" de ContaNova.tsx, precisamente porque
    trazer TODO o histórico disponível de uma vez significa também trazer
    um backlog grande de movimentos por categorizar à mão (esta aplicação
    ainda não tem categorização automática por modelo de linguagem) — não
    é uma escolha só técnica, tem um custo real para quem a usa.

    "tipo" (ex.: "Conta corrente") é escolhido pelo utilizador, tal como
    no formulário manual — a Enable Banking não o dá de forma utilizável.
    Um texto vazio ou só com espaços fica como "sem tipo" (None), a mesma
    regra do formulário manual.
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

    # "longest": a primeira importação acontece logo a seguir à autenticação
    # no banco — o único período (cerca de uma hora, pelo PSD2) em que o
    # histórico com mais de ~90 dias está disponível. Sem esta estratégia, a
    # Enable Banking devolvia só o intervalo por omissão do banco, e "Todo o
    # histórico" trazia na prática só os últimos meses (confirmado ao vivo).
    # Ver a nota em obter_movimentos, em app/services/enable_banking.py.
    #
    # Só transacções já confirmadas ("BOOK") entram no cálculo do saldo e
    # são gravadas — ver a nota em _esta_confirmada, acima.
    todas = await _obter_todas_transacoes(conta_ligada.uid, data_de, estrategia="longest")
    transacoes = [t for t in todas if _esta_confirmada(t)]

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
        tipo=(tipo or "").strip() or None,
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


async def sincronizar_movimentos(db: AsyncSession, conta: Conta, conta_ligada: ContaLigada) -> int:
    """
    Importa os movimentos NOVOS de uma conta JÁ ligada e já associada
    (ao contrário de criar_conta_a_partir_de_ligacao, que trata da
    PRIMEIRA importação) — chamada pelo botão "Sincronizar agora"
    (POST /open-banking/contas-ligadas/{id}/sincronizar,
    app/routers/open_banking.py) ou, quando activada em Perfil,
    periodicamente. Devolve quantos movimentos novos foram gravados.

    NUNCA MEXE EM saldo_ancora: a âncora já foi fixada na primeira
    importação (ver a nota SALDO-ÂNCORA, no topo do ficheiro) — uma
    sincronização só acrescenta Movimento por cima dela; o "saldo actual"
    de uma conta é sempre calculado dinamicamente (saldo_ancora + soma dos
    movimentos, ver app/routers/contas.py:_para_saida), por isso não há
    nada a recalcular aqui.

    DESDE QUANDO IMPORTAR (nunca uma escolha do utilizador, ao contrário
    da primeira importação — ver a nota em criar_conta_a_partir_de_ligacao):
    a data do movimento mais recente já gravado para esta conta, recuada
    _MARGEM_SEGURANCA_DIAS dias (ver a nota no topo do ficheiro) — ou
    conta.data_ancora, se a conta ainda não tiver nenhum movimento (nunca
    deveria acontecer na prática, uma conta nascida por Open Banking já
    traz sempre a sua importação inicial, mas serve de rede de segurança).

    DEDUPLICAÇÃO: antes de gravar, consulta-se os id_transacao_externa já
    existentes NESTA conta, e ignora-se qualquer transacção trazida cujo
    identificador já lá esteja — mais simples e mais barato (uma única
    consulta) do que confiar só na restrição UNIQUE da base de dados
    (ux_movimentos_conta_id_id_transacao_externa, em app/models/
    movimento.py) e apanhar o erro de integridade depois, transacção a
    transacção.

    VALIDAÇÃO DA DATA-ÂNCORA (achado de uma revisão anterior desta fatia,
    ver o caderno): qualquer transacção com booking_date anterior a
    conta.data_ancora é ignorada — mesmo com a margem de segurança acima,
    uma transacção assim tão antiga já devia estar reflectida no
    saldo_ancora calculado na importação inicial; gravá-la agora somaria
    o mesmo valor uma segunda vez, por cima de um saldo que já a contava
    implicitamente.
    """
    resultado = await db.execute(
        select(Movimento.data).where(Movimento.conta_id == conta.id).order_by(Movimento.data.desc()).limit(1)
    )
    ultima_data = resultado.scalar_one_or_none()
    data_de = (ultima_data or conta.data_ancora) - timedelta(days=_MARGEM_SEGURANCA_DIAS)

    transacoes = [
        # Estratégia por omissão, de propósito (não "longest"): aqui só
        # interessam os dias mais recentes, desde a última importação — e
        # fora da hora a seguir à autenticação, o banco nem teria histórico
        # antigo para dar.
        t for t in await _obter_todas_transacoes(conta_ligada.uid, data_de) if _esta_confirmada(t)
    ]
    transacoes = [t for t in transacoes if date.fromisoformat(t["booking_date"]) >= conta.data_ancora]

    ids_existentes = set(
        (
            await db.execute(
                select(Movimento.id_transacao_externa).where(
                    Movimento.conta_id == conta.id,
                    Movimento.id_transacao_externa.is_not(None),
                )
            )
        ).scalars()
    )
    transacoes_novas = [t for t in transacoes if _id_externo(t) not in ids_existentes]

    if not transacoes_novas:
        return 0

    categoria_entrada = await _categoria_refugio(db, conta.user_id, "entrada")
    categoria_saida = await _categoria_refugio(db, conta.user_id, "saida")

    for transacao in transacoes_novas:
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
    return len(transacoes_novas)
