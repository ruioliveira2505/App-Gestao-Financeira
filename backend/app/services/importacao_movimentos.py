"""
IMPORTAÇÃO DE MOVIMENTOS VIA OPEN BANKING
=============================================

Este ficheiro trata da parte que falta para a integração de Open Banking
ser útil a sério: transformar o que a Enable Banking devolve (saldos e
transacções — ver app/services/enable_banking.py) em `Conta` e
`Movimento` reais desta aplicação (app/models/conta.py,
app/models/movimento.py), sem alterar esses dois modelos além do campo
`id_transacao_externa` já acrescentado a Movimento.

AS FUNÇÕES PRINCIPAIS:
- criar_conta_a_partir_de_conta_bancaria: a PRIMEIRA importação, quando uma
  Conta NASCE já vinculada a uma conta bancária, sem histórico manual —
  calcula a âncora a partir do saldo actual e das transacções trazidas
  nesse momento.
- sincronizar_conta_bancaria: o ponto de entrada da sincronização —
  confirma que há vínculo e que a Conta é do utilizador, e chama
  sincronizar_movimentos, que importa os movimentos NOVOS. Chamada só
  quando o utilizador pede (o botão "Sincronizar" na página de uma conta,
  ou no menu da lista de contas, para todas de uma vez). Não há
  sincronização periódica automática.

AINDA NÃO IMPLEMENTADO: vincular uma conta bancária a uma Conta que já
existe, seja desvinculada ou manual (com movimentos registados à mão).
Precisa de uma reconciliação de saldo para o período sem movimentos (o
saldo calculado pela aplicação e o do banco podem não bater certo), que
a aplicação ainda não tem.

O reconhecimento da mesma conta real numa autorização nova já existe: a
identificação estável da conta bancária fica guardada na própria Conta
(Conta.identificacao_bancaria, a memória). Uma Conta ainda vinculada
renova o vínculo sozinha; uma desvinculada é só indicada ao utilizador
(«Já foi a "X"»).
Ao criar uma Conta nova a partir de uma conta bancária, recusa-se (409)
se essa conta bancária ainda alimenta outra Conta, e a identificação
passa para a nova se a anterior estava desvinculada.

TRANSAÇÕES: QUEM GRAVA É QUEM CHAMA. Uma transação é um conjunto de
alterações à base de dados que ficam todas definitivas juntas (commit) ou
são todas desfeitas (rollback). As funções deste ficheiro nunca fazem
commit: enviam as alterações com flush() (ficam visíveis dentro da
transação, mas ainda não são definitivas) e deixam o commit para a rota
que as chamou, uma vez, no fim do pedido. Assim, uma operação composta
(por exemplo, criar a Conta, o vínculo e os movimentos importados) grava tudo ou
nada: se um passo falhar a meio, nenhum dos anteriores fica gravado.

SALDO-ÂNCORA CALCULADO PARA BATER CERTO, NÃO ADIVINHADO (só na primeira
importação): em vez de tentar obter o saldo exacto num dia qualquer do
passado (que a Enable Banking não oferece directamente), parte-se do
saldo ACTUAL confirmado (tipo "CLBD", "Accounting balance": o saldo
contabilístico, só com movimentos já lançados, sem os pendentes) e
subtrai-se a soma de todas as
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
surpreendeu vezes suficientes para não confiar cegamente nisso.
"""

import hashlib
import logging
import uuid
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.erros import BancoIndisponivel, Conflito, DadosInvalidos, ErroDeDominio
from app.core.tempo import hoje
from app.models.autorizacao import Autorizacao
from app.models.categoria import Categoria
from app.models.conta import Conta
from app.models.conta_bancaria import ContaBancaria
from app.models.movimento import Movimento
from app.models.user import User
from app.models.vinculo import Vinculo
from app.services.bloqueios import bloquear_conta
from app.services.contas import garantir_nome_livre, gravar_conta, obter_conta_do_utilizador
from app.services.contas_bancarias import (
    conta_com_identificacao,
    garantir_que_se_pode_vincular,
    identificacao_bancaria,
    vincular,
    vinculo_da_conta,
    vinculo_da_conta_bancaria,
)
from app.services.estados import estado_conta_bancaria
from app.services.reconciliacoes import recalcular_acertos
from app.services.enable_banking import obter_movimentos, obter_saldos

# Número máximo de páginas seguidas antes de desistir com um erro claro
# (ver a nota PAGINAÇÃO COMPLETA, no topo do ficheiro) — generoso para
# qualquer conta pessoal real (cada página traz normalmente dezenas a
# centenas de transacções), mas finito, para nunca ficar preso num ciclo
# sem fim por causa de um "continuation_key" que a Enable Banking
# devolvesse sempre igual.
_LIMITE_PAGINAS = 50

# Margem de segurança, em dias, para trás da última data já importada,
# ao sincronizar uma Conta já vinculada (ver sincronizar_movimentos, abaixo)
# — booking_date pode aparecer alguns dias depois de a transacção ter
# realmente acontecido (confirmado em testes reais com um banco), por
# isso cortar exactamente "no dia seguinte ao último movimento" arriscava
# nunca voltar a ver uma transacção atrasada. A deduplicação por
# id_transacao_externa garante que reimportar estes últimos dias nunca
# duplica o que já lá estava.
_MARGEM_SEGURANCA_DIAS = 5

# O registo (log) deste ficheiro: mensagens para quem opera o servidor.
_registo = logging.getLogger(__name__)


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

    raise BancoIndisponivel(
        f"O banco continua a devolver mais páginas de movimentos depois de "
        f"{_LIMITE_PAGINAS} pedidos seguidos. A importação foi interrompida por segurança."
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
    qualquer transacção (ver criar_conta_a_partir_de_conta_bancaria e
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


def _identificadores(transacoes: list[dict]) -> list[str]:
    """
    O identificador de cada transacção da lista, pela mesma ordem — a
    chave que impede uma sincronização de gravar a mesma transacção duas
    vezes (a coluna id_transacao_externa, única em cada conta).

    É o identificador do banco (ver _id_externo, acima) quando existe.
    Quando o banco não dá nenhum, calcula-se uma IMPRESSÃO DIGITAL: um
    resumo, com o prefixo "fp:", da data, do valor, da descrição e da
    ORDEM dessa transacção entre as que, no mesmo pedido, têm a mesma data,
    o mesmo valor e a mesma descrição. A ordem distingue, por exemplo,
    dois cafés iguais no mesmo dia: o primeiro e o segundo dão impressões
    diferentes, e cada um só entra uma vez. O resumo é o SHA-256 (uma
    função que transforma um texto num código de tamanho fixo, sempre o
    mesmo para o mesmo texto), cortado a 32 caracteres.

    LIMITAÇÃO: a ordem conta-se dentro do que o banco devolveu. Como cada
    sincronização volta a pedir os últimos dias inteiros, um mesmo dia vem
    sempre completo, e a ordem repete-se.
    """
    ocorrencias: dict[tuple[str, str, str], int] = {}
    resultado = []
    for transacao in transacoes:
        externo = _id_externo(transacao)
        if externo:
            resultado.append(externo)
            continue
        chave = (transacao["booking_date"], str(_valor_com_sinal(transacao)), _descricao(transacao))
        ordem = ocorrencias.get(chave, 0)
        ocorrencias[chave] = ordem + 1
        texto = "|".join([*chave, str(ordem)])
        resultado.append("fp:" + hashlib.sha256(texto.encode()).hexdigest()[:32])
    return resultado


def _pode_ser_gravada(transacao: dict) -> bool:
    """
    True se uma transacção já confirmada pode virar um Movimento AGORA:
      - o valor não é 0 (um movimento de valor 0 não seria nem entrada nem
        saída; a base de dados recusa-o);
      - a data não é depois de hoje (em Lisboa): um movimento nunca está
        no futuro. Uma transacção com data futura não se perde: a
        sincronização seguinte volta a pedir os últimos dias ao banco, e
        ela entra quando a data chegar.

    Só decide o que se GRAVA. O cálculo da âncora de uma conta nova (ver
    a nota SALDO-ÂNCORA, no topo do ficheiro) continua a somar todas as
    transacções confirmadas, mesmo as de data futura: já estão contadas no
    saldo do banco, e tirá-las da soma faria-as contar duas vezes quando
    entrassem mais tarde.
    """
    return _valor_com_sinal(transacao) != 0 and date.fromisoformat(transacao["booking_date"]) <= hoje()


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
    Devolve a categoria com o papel "refugio" da direcção indicada ("entrada"
    ou "saida") — ver a nota CATEGORIA OBRIGATÓRIA em
    app/models/movimento.py: um movimento importado, tal como um
    movimento manual sem escolha explícita, fica sempre com esta
    categoria por omissão, nunca sem nenhuma. scalar_one() falha alto e
    claro se, por algum motivo, não existir exactamente uma. Mais do que
    uma é impossível (um índice único na base de dados garante no máximo
    uma categoria de cada papel por direção); nenhuma também não deveria
    acontecer, porque semear_categorias (app/services/categorias_seed.py)
    cria sempre as duas, uma por direcção.
    """
    resultado = await db.execute(
        select(Categoria).where(
            Categoria.user_id == user_id,
            Categoria.papel == "refugio",
            Categoria.direcao == direcao,
        )
    )
    return resultado.scalar_one()


async def saldo_contabilistico(uid: str) -> Decimal:
    """
    O saldo CONTABILÍSTICO atual de uma conta bancária (o tipo "CLBD" que o
    banco devolve: só com movimentos já lançados, sem os pendentes) — ver a
    nota SALDO-ÂNCORA, no topo do ficheiro. BancoIndisponivel (502) se o
    banco não o devolver.
    """
    saldos = await obter_saldos(uid)
    saldo = next(
        (
            Decimal(item["balance_amount"]["amount"])
            for item in saldos["balances"]
            if item["balance_type"] == "CLBD"
        ),
        None,
    )
    if saldo is None:
        raise BancoIndisponivel("O banco não devolveu o saldo contabilístico desta conta.")
    return saldo


def ancora_do_banco(saldo_actual: Decimal, transacoes: list[dict]) -> tuple[date, Decimal]:
    """
    A âncora (data e saldo iniciais) de uma conta cujo histórico vem todo do
    banco: a data da transacção confirmada mais antiga, e o saldo atual
    menos a soma de todas as transacções confirmadas (ver a nota
    SALDO-ÂNCORA, no topo do ficheiro). Assim, saldo inicial + transacções
    dá exatamente o saldo do banco.

    min(…, hoje()): a data inicial nunca fica no futuro, mesmo que o banco
    só devolva transacções com data futura. Sem transacções, a âncora é
    hoje, com o saldo atual — não há histórico nenhum para trazer.
    """
    if not transacoes:
        return hoje(), saldo_actual
    data_ancora = min(min(date.fromisoformat(t["booking_date"]) for t in transacoes), hoje())
    soma = sum((_valor_com_sinal(t) for t in transacoes), Decimal("0"))
    return data_ancora, saldo_actual - soma


async def criar_conta_a_partir_de_conta_bancaria(
    db: AsyncSession,
    user_id: uuid.UUID,
    conta_bancaria: ContaBancaria,
    nome: str,
    data_de: date | None = None,
    tipo: str | None = None,
) -> Conta:
    """
    Cria uma Conta nova a partir de uma ContaBancaria ainda sem vínculo,
    vincula-as (cria o vínculo, com a data de corte), e importa de imediato as
    transacções disponíveis como Movimento — ver as notas SALDO-ÂNCORA e
    PAGINAÇÃO COMPLETA, no topo do ficheiro, para o desenho exacto desse
    cálculo.

    "nome" é escolhido por quem chama esta função (o utilizador, através
    do endpoint em app/routers/open_banking.py) — banco e moeda vêm
    automaticamente da autorização e da conta bancária, mas o nome da Conta é
    sempre uma escolha do utilizador, tal como ao criar uma conta manual.

    "data_de", quando indicada, limita a importação a partir dessa data —
    a escolha ("todo o histórico" vs. "desde uma data") é feita pelo
    utilizador no passo "confirmar" de ContaNova.tsx, precisamente porque
    trazer TODO o histórico disponível de uma vez significa também trazer
    um backlog grande de movimentos por categorizar à mão (esta aplicação
    ainda não tem categorização automática por modelo de linguagem) — não
    é uma escolha só técnica, tem um custo real para quem a usa.

    "tipo" (ex.: "Conta à ordem") é escolhido pelo utilizador, tal como
    no formulário manual — o frontend já o propõe a partir do código de
    tipo de conta que o banco envia (ver tipo_sugerido, em
    app/services/contas_bancarias.py), mas a escolha final é dele. Um
    texto vazio ou só com espaços fica como "sem tipo" (None), a mesma
    regra do formulário manual.

    REGRAS, todas verificadas ANTES de qualquer pedido ao banco (um pedido
    que vai falhar não deve gastar acessos à conta, que a PSD2 limita, nem
    esperar pela importação para falhar):
      - o nome conta sem os espaços nas pontas, e não pode ficar vazio
        (DadosInvalidos, 422);
      - a conta bancária tem de estar livre: sem vínculo, numa autorização
        ativa, disponível no banco, e a sua conta real não pode alimentar
        já outra Conta (Conflito, 409, com a razão);
      - o nome não pode repetir o de outra conta do utilizador (Conflito,
        409 — ver garantir_nome_livre, em app/services/contas.py).

    Devolve a Conta criada; quem chama faz o commit.
    """
    # Os espaços nas pontas não contam (como no formulário manual): um nome
    # só com espaços é um nome vazio.
    nome = nome.strip()
    if not nome:
        raise DadosInvalidos("O nome não pode ser vazio.")
    # Só uma conta bancária livre (sem vínculo, numa autorização ativa,
    # disponível, e cuja conta real não alimente já outra Conta) se pode
    # vincular — ver garantir_que_se_pode_vincular, em
    # app/services/contas_bancarias.py.
    await garantir_que_se_pode_vincular(db, user_id, conta_bancaria)
    await garantir_nome_livre(db, user_id, nome)

    # A identificação estável da conta bancária (ver identificacao_bancaria,
    # em app/services/contas_bancarias.py) fica guardada na Conta nova: é
    # por ela que a próxima autorização no mesmo banco reconhece esta conta
    # (renova o vínculo, ou diz «Já foi a "X"»).
    identificacao = identificacao_bancaria(
        conta_bancaria.identification_hash, conta_bancaria.iban, conta_bancaria.moeda
    )

    # Uma conta bancária alimenta no máximo UMA Conta. Se a identificação
    # pertence a uma Conta ainda VINCULADA (por outra autorização), criar uma
    # Conta nova a partir desta poria a mesma conta bancária a alimentar
    # duas Contas, com os movimentos duplicados. Acontece, por exemplo, ao
    # voltar (pelo histórico do browser) a uma autorização antiga,
    # abandonada antes de a mesma conta ter sido vinculada noutra
    # autorização. Recusa-se ANTES de qualquer pedido ao banco, que a PSD2
    # limita.
    dona = await conta_com_identificacao(db, user_id, identificacao)
    if dona is not None and await vinculo_da_conta(db, dona.id) is not None:
        raise Conflito(f"Esta conta bancária já está vinculada à conta «{dona.nome}».")
    # (A mesma conta real com vínculo noutra linha já foi recusada acima;
    # esta verificação, pela memória das Contas, apanha também uma Conta
    # cuja memória coincide mas cujo vínculo ainda guardava outra
    # identificação.)

    autorizacao = await db.get(Autorizacao, conta_bancaria.autorizacao_id)

    saldo_actual = await saldo_contabilistico(conta_bancaria.uid)

    # "longest": a primeira importação acontece logo a seguir à autenticação
    # no banco — o único período (cerca de uma hora, pela PSD2) em que o
    # histórico com mais de ~90 dias está disponível. Sem esta estratégia, a
    # Enable Banking devolvia só o intervalo por omissão do banco, e "Todo o
    # histórico" trazia na prática só os últimos meses (confirmado ao vivo).
    # Ver a nota em obter_movimentos, em app/services/enable_banking.py.
    #
    # Só transacções já confirmadas ("BOOK") entram no cálculo do saldo e
    # são gravadas — ver a nota em _esta_confirmada, acima.
    todas = await _obter_todas_transacoes(conta_bancaria.uid, data_de, estrategia="longest")
    transacoes = [t for t in todas if _esta_confirmada(t)]

    data_ancora, saldo_ancora = ancora_do_banco(saldo_actual, transacoes)

    # Se esta conta bancária já alimentou uma Conta antiga, entretanto
    # desvinculada, e o utilizador escolheu criar uma conta nova em vez de
    # vincular a antiga, a identificação passa para a conta nova: duas
    # Contas com a mesma identificação tornariam o reconhecimento ambíguo.
    # A conta antiga fica como conta manual, com todo o seu histórico.
    if identificacao is not None:
        await db.execute(
            update(Conta)
            .where(Conta.user_id == user_id, Conta.identificacao_bancaria == identificacao)
            .values(identificacao_bancaria=None)
        )

    conta = Conta(
        user_id=user_id,
        nome=nome,
        banco=autorizacao.banco,
        tipo=(tipo or "").strip() or None,
        moeda=conta_bancaria.moeda,
        data_ancora=data_ancora,
        saldo_ancora=saldo_ancora,
        identificacao_bancaria=identificacao,
    )
    db.add(conta)
    # gravar_conta faz o flush e traduz um nome repetido, apanhado pelo
    # índice único da base de dados, num Conflito (409).
    await gravar_conta(db)

    # O vínculo, com a data de corte na véspera da data inicial: tudo o que
    # esta Conta tem vem do banco.
    vinculo = await vincular(
        db, user_id, conta, conta_bancaria, data_corte=data_ancora - timedelta(days=1)
    )

    # Uma categoria-refúgio por direcção, obtida uma única vez antes do
    # ciclo — não há razão para repetir a mesma consulta por transacção.
    categoria_entrada = await _categoria_refugio(db, user_id, "entrada")
    categoria_saida = await _categoria_refugio(db, user_id, "saida")

    # Grava-se só o que pode virar um movimento agora (ver
    # _pode_ser_gravada: sem valor 0 nem datas futuras).
    a_gravar = [t for t in transacoes if _pode_ser_gravada(t)]
    for transacao, identificador in zip(a_gravar, _identificadores(a_gravar)):
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
                id_transacao_externa=identificador,
                origem="banco",
                vinculo_id=vinculo.id,
            )
        )

    # flush() envia as alterações à base de dados, dentro da transação em
    # curso, mas NÃO as torna definitivas: isso é o commit(), que só a rota
    # (ou o script) que chamou este serviço faz, uma vez, no fim. Assim,
    # várias operações chamadas pelo mesmo pedido gravam-se todas juntas
    # ou nenhuma (ver a nota no topo do ficheiro).
    await db.flush()
    await db.refresh(conta)
    return conta


@dataclass
class Sincronizacao:
    """
    O resultado de uma sincronização: quantos movimentos novos entraram, e
    a soma das transações confirmadas com data FUTURA que ficaram por
    importar (um movimento nunca fica no futuro; entram quando a data
    chegar). Essa soma já está no saldo que o banco informa, e uma
    reconciliação do banco criada a seguir precisa de a descontar (ver
    futuros_no_banco, no modelo das reconciliações).
    """

    novos: int
    futuros: Decimal


def soma_dos_futuros(transacoes: list[dict]) -> Decimal:
    """
    A soma das transações (já confirmadas) com data depois de hoje: as que
    o banco já conta no saldo, mas que ainda não se podem importar.
    """
    return sum(
        (
            _valor_com_sinal(t)
            for t in transacoes
            if date.fromisoformat(t["booking_date"]) > hoje()
        ),
        Decimal("0"),
    )


async def sincronizar_movimentos(
    db: AsyncSession, conta: Conta, conta_bancaria: ContaBancaria, vinculo: Vinculo
) -> Sincronizacao:
    """
    Importa os movimentos NOVOS de uma Conta JÁ vinculada (ao contrário de
    criar_conta_a_partir_de_conta_bancaria, que trata da PRIMEIRA
    importação) — chamada através de sincronizar_conta_bancaria, abaixo,
    quando o utilizador pede para sincronizar. Devolve quantos movimentos novos foram gravados e a soma das
    transações de data futura que ficaram por importar.

    NUNCA MEXE EM saldo_ancora: a âncora já foi fixada na primeira
    importação (ver a nota SALDO-ÂNCORA, no topo do ficheiro); uma
    sincronização só acrescenta movimentos. O saldo actual é sempre
    calculado (saldo_ancora + soma dos movimentos), por isso não há nada a
    recalcular aqui.

    DESDE QUANDO IMPORTAR (nunca uma escolha do utilizador): o mais recente
    de dois dias —
      - o dia seguinte à DATA DE CORTE do vínculo (o último dia cujos
        movimentos não vêm do banco): nada até ao corte entra, para o
        histórico do banco nunca cair por cima de movimentos que já estão
        na Conta;
      - a data do último movimento de ORIGEM BANCO, recuada
        _MARGEM_SEGURANCA_DIAS dias (ver a nota no topo do ficheiro): o
        banco pode lançar uma transacção dias depois.
    Conta só o último movimento do banco, e não o último de qualquer
    origem: um movimento manual antigo (de antes do vínculo) não pode puxar
    a importação para trás.

    O QUE ENTRA: só transacções confirmadas, de data posterior ao corte e
    não anterior à data inicial da conta, e que possam virar movimentos
    agora (sem valor 0 nem datas futuras — ver _pode_ser_gravada).

    DEDUPLICAÇÃO: consulta-se os identificadores já gravados NESTA conta (o
    do banco ou a impressão digital — ver _identificadores) e ignora-se
    tudo o que já lá esteja. A restrição única da base de dados (conta,
    identificador) é a rede de segurança.
    """
    ultimo_do_banco = await db.scalar(
        select(Movimento.data)
        .where(Movimento.conta_id == conta.id, Movimento.origem == "banco")
        .order_by(Movimento.data.desc())
        .limit(1)
    )
    data_de = vinculo.data_corte + timedelta(days=1)
    if ultimo_do_banco is not None:
        data_de = max(data_de, ultimo_do_banco - timedelta(days=_MARGEM_SEGURANCA_DIAS))

    transacoes = [
        # Estratégia por omissão, de propósito (não "longest"): aqui só
        # interessam os dias mais recentes, desde a última importação — e
        # fora da hora a seguir à autenticação, o banco nem teria histórico
        # antigo para dar.
        t for t in await _obter_todas_transacoes(conta_bancaria.uid, data_de) if _esta_confirmada(t)
    ]
    futuros = soma_dos_futuros(transacoes)
    transacoes = [
        t
        for t in transacoes
        if date.fromisoformat(t["booking_date"]) > vinculo.data_corte
        and date.fromisoformat(t["booking_date"]) >= conta.data_ancora
        and _pode_ser_gravada(t)
    ]

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
    novas = [
        (transacao, identificador)
        for transacao, identificador in zip(transacoes, _identificadores(transacoes))
        if identificador not in ids_existentes
    ]
    if not novas:
        return Sincronizacao(novos=0, futuros=futuros)

    categoria_entrada = await _categoria_refugio(db, conta.user_id, "entrada")
    categoria_saida = await _categoria_refugio(db, conta.user_id, "saida")

    for transacao, identificador in novas:
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
                id_transacao_externa=identificador,
                origem="banco",
                vinculo_id=vinculo.id,
            )
        )

    # flush() envia as alterações à base de dados, dentro da transação em
    # curso, mas NÃO as torna definitivas: isso é o commit(), que só a rota
    # que chamou este serviço faz, uma vez, no fim (ver a nota TRANSAÇÕES,
    # no topo do ficheiro).
    await db.flush()
    # Movimentos novos mudam o saldo calculado: os acertos das
    # reconciliações recalculam-se.
    await recalcular_acertos(db, conta.id)
    return Sincronizacao(novos=len(novas), futuros=futuros)


async def sincronizar_conta_bancaria(
    db: AsyncSession, utilizador: User, conta_bancaria: ContaBancaria
) -> int:
    """
    Sincroniza a Conta que esta conta bancária alimenta: confirma primeiro
    que há vínculo (Conflito, 409, se não houver: não há para onde
    sincronizar) e que a Conta é do utilizador, e depois importa os
    movimentos novos (ver sincronizar_movimentos, acima). Devolve quantos
    movimentos novos entraram; quem chama faz o commit.
    """
    vinculo = await vinculo_da_conta_bancaria(db, conta_bancaria.id)
    if vinculo is None:
        raise Conflito("Esta conta bancária ainda não está vinculada a nenhuma conta.")
    conta = await obter_conta_do_utilizador(db, utilizador, vinculo.conta_id)
    # Uma operação de cada vez por Conta: duas sincronizações em simultâneo
    # pediriam e gravariam os mesmos movimentos (a segunda recebe 409). O
    # bloqueio vem antes das verificações, e o vínculo volta a ler-se
    # depois dele: outra operação (desvincular, por exemplo) pode tê-lo
    # mudado entre a primeira leitura e o bloqueio.
    await bloquear_conta(db, conta.id)
    vinculo = await vinculo_da_conta_bancaria(db, conta_bancaria.id)
    if vinculo is None or vinculo.conta_id != conta.id:
        raise Conflito("Esta conta bancária deixou de estar vinculada a esta conta.")
    # Uma Conta SUSPENSA (a autorização terminou, ou o banco deixou de
    # partilhar a conta) não sincroniza: diz-se porquê, e o que fazer.
    autorizacao = await db.get(Autorizacao, conta_bancaria.autorizacao_id)
    if estado_conta_bancaria(conta_bancaria, autorizacao, tem_vinculo=True) == "suspensa":
        if conta_bancaria.indisponivel_em is not None:
            raise Conflito("O banco deixou de partilhar esta conta. Podes desvinculá-la.")
        raise Conflito("A autorização deste banco já terminou. É preciso autorizá-lo outra vez.")
    sincronizacao = await sincronizar_movimentos(db, conta, conta_bancaria, vinculo)
    await _comparar_com_o_banco(db, conta, conta_bancaria, sincronizacao.futuros)
    return sincronizacao.novos


async def _comparar_com_o_banco(
    db: AsyncSession, conta: Conta, conta_bancaria: ContaBancaria, futuros: Decimal
) -> None:
    """
    Compara o saldo da aplicação com o saldo contabilístico do banco, depois
    de sincronizar (regra R8, só interna). Numa Conta vinculada, os dois são
    iguais por construção (a âncora parte do saldo do banco e só entram
    movimentos já lançados), descontadas as transações de data futura que o
    banco já conta mas que ainda não se importam. Uma diferença é uma
    anomalia de importação (um lançamento muito atrasado, um estorno, um
    defeito) e fica no registo do servidor, para se investigar. O utilizador
    não vê nada: não tem nada a fazer com ela, e a aplicação não cria
    acertos sozinha.

    Nunca faz a sincronização falhar: se o banco não responder ao pedido do
    saldo, a comparação fica por fazer (e isso também fica registado).
    """
    try:
        saldo_banco = await saldo_contabilistico(conta_bancaria.uid)
    except ErroDeDominio as erro:
        _registo.info("Comparação com o banco por fazer (conta %s): %s", conta.id, erro.mensagem)
        return
    soma = await db.scalar(
        select(func.coalesce(func.sum(Movimento.valor), 0)).where(Movimento.conta_id == conta.id)
    )
    saldo_aplicacao = conta.saldo_ancora + Decimal(soma)
    diferenca = (saldo_banco - futuros - saldo_aplicacao).quantize(Decimal("0.01"))
    if diferenca != 0:
        _registo.warning(
            "O saldo da conta %s não bate com o do banco: banco %s (já sem %s de datas futuras), "
            "aplicação %s, diferença %s.",
            conta.id, saldo_banco, futuros, saldo_aplicacao, diferenca,
        )
