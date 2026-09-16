"""
ROTAS DE MOVIMENTOS
======================

Endpoints para gerir os movimentos (entradas e saídas de dinheiro) das
contas do utilizador autenticado. Cada rota exige autenticação (via
obter_utilizador_atual, app/core/deps.py) e trabalha sempre no âmbito do
utilizador do pedido — um movimento cuja conta não é do utilizador é, para
todos os efeitos, inexistente (a mesma regra já aplicada às contas, ver
app/services/contas.py).

Não há aqui um "/contas/{id}/movimentos" aninhado: a lista principal
(GET /movimentos) é GLOBAL — todos os movimentos, de todas as contas do
utilizador —, com "conta_id" como parâmetro de query opcional para
filtrar para uma só. "Movimentos" é uma secção de topo da aplicação (ao
lado de "Contas"), não algo pendurado dentro de uma conta.

PAGINAÇÃO POR CURSOR (GET /movimentos): a lista devolve sempre uma JANELA
("limite" movimentos, por omissão 30), nunca tudo de uma vez — carregar
anos de histórico numa só resposta seria lento a consultar, pesado a
transferir, e lento a desenhar no cliente, para um caso de uso (ver o que
aconteceu ultimamente) que raramente precisa de mais do que isso. O
cursor da PÁGINA SEGUINTE são os TRÊS campos pelos quais a lista está
ordenada — "antes_data", "antes_criado_em" e "antes_id" — tirados do
ÚLTIMO movimento da página anterior: o pedido seguinte pede "os que vêm
depois deste, pela mesma ordem". Não há um número total nem uma bandeira
"há mais": o cliente infere isso sozinho — se a resposta trouxer menos do
que "limite" movimentos, chegou ao fim.

Porquê TRÊS campos, e não só "data" (o que se vê) ou "data" + "created_at"
(o desempate óbvio): "created_at" vem de func.now() no modelo, e o
Postgres fixa "now()" ao INÍCIO DA TRANSACÇÃO, não a cada instrução —
vários movimentos criados na mesma transacção (nos testes, por exemplo,
que correm cada um dentro de uma única transacção revertida no fim — ver
tests/conftest.py) ficam com "created_at" IDÊNTICO. "id" é o único campo
que nunca empata, por isso é sempre o último desempate — sem ele, um
empate destes faria o cursor saltar ou repetir movimentos ao mudar de
página.

FILTROS COMO PARÂMETROS (contas, categorias, tipo, de, ate, pesquisa):
espelham exactamente a forma dos filtros no frontend (ver
src/lib/filtrosMovimentos.ts) — a lista deixou de ser filtrada em
JavaScript sobre tudo o que já estava carregado (deixou de fazer sentido
a partir do momento em que "tudo o que está carregado" é só uma janela) e
passou a ser filtrada aqui, em SQL, antes mesmo de se decidir que janela
devolver. Isto é o que torna possível fazer scroll DENTRO de um filtro —
os mesmos parâmetros acompanham o pedido da página seguinte, e o cursor
("antes_data"/"antes_criado_em"/"antes_id") já se refere só ao
subconjunto filtrado.
"contas" e "categorias" são listas de ids em texto separado por vírgulas
(a mesma forma que já têm no URL do frontend); os ids não têm de pertencer
todos ao utilizador — o JOIN com Conta já garante que só os SEUS
movimentos aparecem; um id alheio ou inexistente simplesmente não
corresponde a nada, sem precisar de validação própria (ao contrário de
"conta_id", que é para o caso "ver movimentos DESTA conta" — aí sim,
404 se a conta não for do utilizador, tal como antes).

SALDO REMANESCENTE ("saldo_apos", em cada movimento devolvido por GET
/movimentos): o saldo da conta IMEDIATAMENTE APÓS esse movimento — usado
pelo frontend para mostrar "saldo: X€" ao lado de cada linha, sem ele
próprio ter de somar nada. Antes da paginação, o frontend calculava isto
em JavaScript, percorrendo a lista completa; deixou de ser possível a
partir do momento em que uma página só vê uma JANELA do histórico, não o
histórico completo dessa conta. Por isso passa a ser calculado aqui, em
SQL, com uma função de janela (func.sum(...).over(...)): uma soma
cumulativa de "valor", por conta, ordenada cronologicamente, somada ao
saldo-âncora dessa conta (Conta.saldo_ancora). Esta soma corre sobre TODO
o histórico de cada conta do utilizador — nunca só sobre os movimentos já
filtrados/paginados na consulta principal —, porque o saldo remanescente
tem de reflectir a realidade completa da conta, independentemente de um
filtro (por categoria, por tipo, por pesquisa) estar ou não a esconder
outros movimentos dessa mesma conta. Por isso vive numa subconsulta à
parte (a função _saldo_apos_sq, mais abaixo — reconstruída a cada pedido,
parametrizada pelo utilizador autenticado, não uma subconsulta fixa),
depois juntada à consulta principal pelo id do movimento com um LEFT JOIN
("isouter=True") — nunca um JOIN normal: os âmbitos das duas consultas
coincidem hoje (ambas filtram por "esta conta é do utilizador"), mas um
LEFT JOIN falha de forma segura se essa coincidência alguma vez se
desfizer — um movimento sem correspondência na subconsulta continua a
aparecer na lista, só com "saldo_apos" a None, em vez de desaparecer da
lista em silêncio. A consulta principal continua com os seus próprios
filtros e paginação, inalterados.

EM LOTE (eliminar_movimentos_em_lote / recategorizar_movimentos_em_lote):
o modo de seleção múltipla da lista de Movimentos, no frontend, só
suporta duas ações — eliminar e recategorizar — daí só estes dois
endpoints, não um "mover para outra conta" em lote. Os dois são POST (não
DELETE/PATCH com corpo, incomum em REST) para "/movimentos/eliminar-em-
lote" e "/movimentos/recategorizar-em-lote" — caminhos literais, por isso
nunca colidem com "/movimentos/{movimento_id}", mesmo que esse tivesse o
mesmo método (não tem: aquele é GET/PATCH/DELETE, estes são POST).
Atómicos: confirma-se sempre que o LOTE INTEIRO é válido antes de mudar
alguma coisa — nunca uma eliminação ou recategorização parcial.
"""

import uuid
from datetime import date, datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status

from sqlalchemy import delete, func, or_, select, tuple_, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import obter_utilizador_atual
from app.db.session import get_db
from app.models.categoria import Categoria
from app.models.conta import Conta
from app.models.movimento import Movimento
from app.models.user import User
from app.schemas.categorias import Direcao
from app.schemas.movimentos import (
    MovimentoCriar,
    MovimentoEditar,
    MovimentoOut,
    MovimentosEliminarEmLote,
    MovimentosRecategorizarEmLote,
)
from app.services.categorias import obter_categoria_do_utilizador
from app.services.contas import obter_conta_do_utilizador

router = APIRouter(prefix="/movimentos", tags=["movimentos"])

# Usado para arredondar/normalizar os valores monetários a 2 casas
# decimais, coerente com a coluna Numeric(14, 2) — a mesma constante que
# app/routers/contas.py define para o mesmo fim.
_DUAS_CASAS = Decimal("0.01")


async def _obter_movimento_do_utilizador(
    db: AsyncSession, utilizador: User, movimento_id: uuid.UUID
) -> Movimento:
    """
    Devolve o movimento com este id, se a sua conta pertencer ao
    utilizador. 404 nos dois casos que se juntam num só (não existe, ou
    não é do utilizador) — pela mesma razão de
    app/services/contas.py:obter_conta_do_utilizador: a resposta não deve
    revelar qual dos dois motivos se aplica.

    Um único JOIN (Movimento → Conta), em vez de duas consultas
    separadas (uma ao movimento, outra à conta), porque é a mesma
    informação — "este movimento é meu?" — numa só pergunta à base de
    dados.
    """
    resultado = await db.execute(
        select(Movimento)
        .join(Conta, Movimento.conta_id == Conta.id)
        .where(Movimento.id == movimento_id, Conta.user_id == utilizador.id)
    )
    movimento = resultado.scalar_one_or_none()
    if movimento is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Movimento não encontrado."
        )
    return movimento


async def _obter_movimentos_do_utilizador(
    db: AsyncSession, utilizador: User, ids: list[uuid.UUID]
) -> list[Movimento]:
    """
    A versão em lote de _obter_movimento_do_utilizador, usada pelos dois
    endpoints "em lote": devolve os movimentos com estes ids, e só se
    TODOS pertencerem ao utilizador — um único JOIN, tal como o singular.

    Se faltar algum (não existe, ou não é do utilizador), 404 sem dizer
    qual — nem sequer quantos —, pela mesma razão de não revelar o motivo
    exacto em _obter_movimento_do_utilizador. Chamada sempre ANTES de
    qualquer eliminação/actualização: um lote só começa a mexer nalguma
    linha depois de se confirmar que é válido por inteiro.
    """
    resultado = await db.execute(
        select(Movimento)
        .join(Conta, Movimento.conta_id == Conta.id)
        .where(Movimento.id.in_(ids), Conta.user_id == utilizador.id)
    )
    movimentos = list(resultado.scalars().all())
    if len(movimentos) != len(set(ids)):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Um ou mais movimentos não foram encontrados.",
        )
    return movimentos


def _uuids_de_csv(valor: str | None) -> list[uuid.UUID] | None:
    """
    Converte "id1,id2,id3" (a forma que "contas"/"categorias" já têm no URL
    do frontend — ver src/lib/filtrosMovimentos.ts) numa lista de UUID.
    None quando o parâmetro não veio, ou veio vazio — para o chamador
    conseguir distinguir "sem filtro" de "filtro com zero ids" (que nunca
    devia acontecer, mas não há razão para tratar os dois casos de forma
    diferente aqui).

    422 (não 500) se algum dos ids não for um UUID válido: ao contrário de
    "conta_id" ou "movimento_id" (validados automaticamente pelo FastAPI,
    por serem parte da assinatura da rota como uuid.UUID), este parâmetro
    chega como texto livre e só se converte aqui dentro — sem este
    try/except, um id mal formado (um URL escrito à mão, um bug no
    cliente) levantaria um ValueError não apanhado, que o FastAPI devolve
    como 500, em vez do 422 que qualquer outro id inválido já dá nesta
    API.
    """
    if not valor:
        return None
    try:
        ids = [uuid.UUID(parte) for parte in valor.split(",") if parte]
    except ValueError as erro:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Um ou mais ids em 'contas'/'categorias' não são UUID válidos.",
        ) from erro
    return ids or None


def _escapar_curinga_ilike(termo: str) -> str:
    """
    Escapa "%", "_" e "\\" antes de meter "termo" num padrão de ILIKE — sem
    isto, pesquisar por um "%" ou "_" literal (ex.: uma descrição "Desconto
    10%") seria interpretado como curinga do próprio ILIKE, e a pesquisa
    devolveria correspondências que nada têm a ver com o texto escrito. A
    barra invertida escapa-se primeiro, para não escapar acidentalmente as
    barras invertidas introduzidas pelos dois escapes seguintes.
    """
    return termo.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _validar_data(data_movimento: date, conta: Conta) -> None:
    """
    A data de um movimento nunca pode ser anterior à data-âncora da sua
    conta (app/models/conta.py): a âncora é o ponto a partir do qual a
    aplicação começa a acompanhar essa conta — um movimento mais antigo
    não tem onde entrar no cálculo do saldo.
    """
    if data_movimento < conta.data_ancora:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A data do movimento não pode ser anterior à data de início da conta.",
        )


def _validar_direcao(valor: Decimal, categoria: Categoria) -> None:
    """
    A direcao da categoria (ver app/models/categoria.py) tem de
    corresponder ao sinal do valor: uma categoria de "entrada" (ex.:
    "Salário") não faz sentido num movimento negativo, e vice-versa. Sem
    esta verificação, nada impediria uma incoerência que passaria
    despercebida em qualquer soma ou gráfico organizado por categoria.
    """
    direcao_esperada = "entrada" if valor > 0 else "saida"
    if categoria.direcao != direcao_esperada:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A categoria escolhida não corresponde ao tipo do movimento (entrada/saída).",
        )


def _para_saida(movimento: Movimento, saldo_apos: Decimal | None = None) -> MovimentoOut:
    """
    Converte uma linha da tabela "movimentos" na forma devolvida pela API.

    "saldo_apos" só é passado por listar_movimentos (ver a nota SALDO
    REMANESCENTE, mais abaixo) — nos restantes endpoints fica None, porque
    nada os usa para o mostrar.
    """
    return MovimentoOut(
        id=movimento.id,
        conta_id=movimento.conta_id,
        categoria_id=movimento.categoria_id,
        data=movimento.data,
        descricao=movimento.descricao,
        valor=f"{movimento.valor:.2f}",
        created_at=movimento.created_at,
        updated_at=movimento.updated_at,
        saldo_apos=f"{saldo_apos:.2f}" if saldo_apos is not None else None,
    )


def _saldo_apos_sq(utilizador: User):
    """
    Subconsulta que calcula, para CADA movimento de CADA conta do
    utilizador, o saldo dessa conta imediatamente após esse movimento —
    ver a nota SALDO REMANESCENTE, no topo do ficheiro.

    A ordem da soma cumulativa (data, created_at, id, todos ascendentes) é
    a ordem cronológica "real" dos movimentos — a mesma lógica de
    desempate do cursor de paginação (ver a nota PAGINAÇÃO POR CURSOR),
    só que ali em ordem decrescente (mais recente primeiro) e aqui
    ascendente (mais antigo primeiro, como a própria vida financeira da
    conta avançou no tempo).

    Filtra só por "esta conta é do utilizador" — nunca pelos filtros da
    listagem (tipo, categorias, datas, pesquisa): o saldo remanescente tem
    de reflectir o histórico COMPLETO da conta, mesmo quando a página
    pedida está a mostrar só um subconjunto filtrado desse histórico.
    """
    return (
        select(
            Movimento.id.label("movimento_id"),
            (
                Conta.saldo_ancora
                + func.sum(Movimento.valor).over(
                    partition_by=Movimento.conta_id,
                    order_by=(
                        Movimento.data.asc(),
                        Movimento.created_at.asc(),
                        Movimento.id.asc(),
                    ),
                )
            ).label("saldo_apos"),
        )
        .join(Conta, Movimento.conta_id == Conta.id)
        .where(Conta.user_id == utilizador.id)
        .subquery()
    )


@router.post("", response_model=MovimentoOut, status_code=status.HTTP_201_CREATED)
async def criar_movimento(
    dados: MovimentoCriar,
    utilizador: User = Depends(obter_utilizador_atual),
    db: AsyncSession = Depends(get_db),
) -> MovimentoOut:
    """
    Cria um movimento numa conta do utilizador autenticado.

    O corpo do pedido já chega validado pelo schema MovimentoCriar
    (descrição não vazia, valor diferente de 0). Fica a cargo desta rota
    confirmar que a conta e a categoria são do utilizador (404 caso
    contrário) e as regras de negócio próprias: a data não pode ser
    anterior à âncora da conta (ver _validar_data), e a direcao da
    categoria tem de ser coerente com o sinal do valor (ver
    _validar_direcao).
    """
    conta = await obter_conta_do_utilizador(db, utilizador, dados.conta_id)
    _validar_data(dados.data, conta)
    categoria = await obter_categoria_do_utilizador(db, utilizador, dados.categoria_id)
    _validar_direcao(dados.valor, categoria)

    movimento = Movimento(
        conta_id=conta.id,
        categoria_id=categoria.id,
        data=dados.data,
        descricao=dados.descricao,
        valor=dados.valor.quantize(_DUAS_CASAS),
    )
    db.add(movimento)
    await db.commit()
    await db.refresh(movimento)

    return _para_saida(movimento)


@router.get("", response_model=list[MovimentoOut])
async def listar_movimentos(
    conta_id: uuid.UUID | None = None,
    contas: str | None = None,
    categorias: str | None = None,
    # Direcao = Literal["entrada", "saida"] (ver app/schemas/categorias.py)
    # — não "str | None": um valor fora destes dois dá 422 automaticamente
    # (validação do FastAPI/Pydantic), em vez de ser ignorado em silêncio
    # pelo if/elif mais abaixo.
    tipo: Direcao | None = None,
    de: date | None = None,
    ate: date | None = None,
    pesquisa: str | None = None,
    antes_data: date | None = None,
    antes_criado_em: datetime | None = None,
    antes_id: uuid.UUID | None = None,
    limite: int = Query(default=30, ge=1, le=100),
    utilizador: User = Depends(obter_utilizador_atual),
    db: AsyncSession = Depends(get_db),
) -> list[MovimentoOut]:
    """
    Lista uma JANELA de "limite" movimentos do utilizador autenticado (de
    todas as suas contas), por data mais recente primeiro — a desempatar,
    o criado mais recentemente, e a desempatar ainda esse empate (raro,
    mas possível — ver a nota PAGINAÇÃO POR CURSOR, no topo do ficheiro),
    o id.

    "conta_id", se indicado, filtra para uma única conta — que também tem
    de pertencer ao utilizador (404 caso contrário, antes de sequer se
    tentar listar). "contas"/"categorias" (ver a nota FILTROS COMO
    PARÂMETROS), "tipo" ("entrada"/"saida", contra o sinal do valor),
    "de"/"ate" (inclusivos) e "pesquisa" (descrição OU nome da conta,
    sem distinguir maiúsculas/acentos… na prática, só maiúsculas — o
    Postgres por omissão não ignora acentos num ILIKE) filtram-se todos em
    conjunto, antes de se aplicar o cursor e o limite.
    """
    saldo_apos_sq = _saldo_apos_sq(utilizador)

    query = (
        select(Movimento, saldo_apos_sq.c.saldo_apos)
        .join(Conta, Movimento.conta_id == Conta.id)
        # "isouter=True" (LEFT JOIN), não um JOIN normal — ver a nota
        # SALDO REMANESCENTE, no topo do ficheiro: falha de forma segura
        # (saldo_apos=None) se algum dia os âmbitos das duas consultas
        # deixarem de coincidir, em vez de fazer o movimento desaparecer
        # da lista em silêncio.
        .join(saldo_apos_sq, saldo_apos_sq.c.movimento_id == Movimento.id, isouter=True)
        .where(Conta.user_id == utilizador.id)
    )

    if conta_id is not None:
        await obter_conta_do_utilizador(db, utilizador, conta_id)
        query = query.where(Movimento.conta_id == conta_id)

    ids_contas = _uuids_de_csv(contas)
    if ids_contas is not None:
        query = query.where(Movimento.conta_id.in_(ids_contas))

    ids_categorias = _uuids_de_csv(categorias)
    if ids_categorias is not None:
        query = query.where(Movimento.categoria_id.in_(ids_categorias))

    if tipo == "entrada":
        query = query.where(Movimento.valor > 0)
    elif tipo == "saida":
        query = query.where(Movimento.valor < 0)

    if de is not None:
        query = query.where(Movimento.data >= de)
    if ate is not None:
        query = query.where(Movimento.data <= ate)

    if pesquisa:
        termo = f"%{_escapar_curinga_ilike(pesquisa)}%"
        query = query.where(
            or_(
                Movimento.descricao.ilike(termo, escape="\\"),
                Conta.nome.ilike(termo, escape="\\"),
            )
        )

    # O cursor: só o último movimento da página anterior sabe onde
    # continuar — os TRÊS campos pelos quais a lista está ordenada, juntos
    # (uma comparação de tuplo, não condições em separado: sem desempate
    # completo saltaria ou repetiria movimentos empatados). "id" é o
    # último desempate, e o único que NUNCA empata — "created_at" (de
    # func.now(), no modelo) é fixo por TRANSACÇÃO no Postgres, não por
    # instrução: vários movimentos criados na mesma transacção (nos
    # testes, por exemplo — ver tests/conftest.py) partilham o mesmo
    # "created_at" ao ponto do segundo, e só o "id" continua a distingui-
    # -los sem ambiguidade.
    if antes_data is not None and antes_criado_em is not None and antes_id is not None:
        query = query.where(
            tuple_(Movimento.data, Movimento.created_at, Movimento.id)
            < tuple_(antes_data, antes_criado_em, antes_id)
        )

    query = query.order_by(
        Movimento.data.desc(), Movimento.created_at.desc(), Movimento.id.desc()
    ).limit(limite)

    resultado = await db.execute(query)
    return [_para_saida(movimento, saldo_apos) for movimento, saldo_apos in resultado.all()]


@router.get("/{movimento_id}", response_model=MovimentoOut)
async def obter_movimento(
    movimento_id: uuid.UUID,
    utilizador: User = Depends(obter_utilizador_atual),
    db: AsyncSession = Depends(get_db),
) -> MovimentoOut:
    """Devolve um movimento do utilizador autenticado. 404 se não for seu ou não existir."""
    movimento = await _obter_movimento_do_utilizador(db, utilizador, movimento_id)
    return _para_saida(movimento)


@router.patch("/{movimento_id}", response_model=MovimentoOut)
async def editar_movimento(
    movimento_id: uuid.UUID,
    dados: MovimentoEditar,
    utilizador: User = Depends(obter_utilizador_atual),
    db: AsyncSession = Depends(get_db),
) -> MovimentoOut:
    """
    Actualiza um movimento por completo — incluindo, se for o caso, a
    conta a que pertence ("mover" o movimento para outra conta) ou a
    categoria (recategorizá-lo). A conta e a categoria de destino têm
    também de pertencer ao utilizador.
    """
    movimento = await _obter_movimento_do_utilizador(db, utilizador, movimento_id)
    conta = await obter_conta_do_utilizador(db, utilizador, dados.conta_id)
    _validar_data(dados.data, conta)
    categoria = await obter_categoria_do_utilizador(db, utilizador, dados.categoria_id)
    _validar_direcao(dados.valor, categoria)

    movimento.conta_id = conta.id
    movimento.categoria_id = categoria.id
    movimento.data = dados.data
    movimento.descricao = dados.descricao
    movimento.valor = dados.valor.quantize(_DUAS_CASAS)

    await db.commit()
    await db.refresh(movimento)

    return _para_saida(movimento)


@router.delete("/{movimento_id}", status_code=status.HTTP_204_NO_CONTENT)
async def apagar_movimento(
    movimento_id: uuid.UUID,
    utilizador: User = Depends(obter_utilizador_atual),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Elimina um movimento do utilizador autenticado. Directa, sem confirmação — um único registo."""
    movimento = await _obter_movimento_do_utilizador(db, utilizador, movimento_id)
    await db.delete(movimento)
    await db.commit()


@router.post("/eliminar-em-lote", status_code=status.HTTP_204_NO_CONTENT)
async def eliminar_movimentos_em_lote(
    dados: MovimentosEliminarEmLote,
    utilizador: User = Depends(obter_utilizador_atual),
    db: AsyncSession = Depends(get_db),
) -> None:
    """
    Elimina vários movimentos de uma vez — o "eliminar" do modo de
    seleção múltipla da lista de Movimentos. Confirma primeiro que todos
    os ids são do utilizador (_obter_movimentos_do_utilizador, 404 se
    algum faltar) e só depois apaga, num único DELETE.

    Ao contrário de eliminar uma categoria, eliminar um movimento nunca
    tem consequências em cascata — nada na aplicação aponta para um
    Movimento como chave estrangeira —, por isso não há aqui o passo de
    confirmação/migração que app/routers/categorias.py:eliminar_categoria
    exige.
    """
    movimentos = await _obter_movimentos_do_utilizador(db, utilizador, dados.ids)
    await db.execute(delete(Movimento).where(Movimento.id.in_([m.id for m in movimentos])))
    await db.commit()


@router.post("/recategorizar-em-lote", status_code=status.HTTP_204_NO_CONTENT)
async def recategorizar_movimentos_em_lote(
    dados: MovimentosRecategorizarEmLote,
    utilizador: User = Depends(obter_utilizador_atual),
    db: AsyncSession = Depends(get_db),
) -> None:
    """
    Recategoriza vários movimentos de uma vez — o "categorizar" do modo
    de seleção múltipla. A categoria de destino tem de ser do utilizador,
    e a sua direcao tem de ser coerente com o valor de CADA movimento do
    lote (_validar_direcao, um a um) — se um só falhar, todo o lote é
    recusado (400) ANTES de qualquer actualização, nunca uma
    recategorização parcial.
    """
    movimentos = await _obter_movimentos_do_utilizador(db, utilizador, dados.ids)
    categoria = await obter_categoria_do_utilizador(db, utilizador, dados.categoria_id)
    for movimento in movimentos:
        _validar_direcao(movimento.valor, categoria)

    await db.execute(
        update(Movimento)
        .where(Movimento.id.in_([m.id for m in movimentos]))
        .values(categoria_id=categoria.id)
    )
    await db.commit()
