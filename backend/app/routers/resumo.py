"""
ROTAS DE RESUMO
==================

Dois endpoints. GET /resumo — o resumo estático da página Início: saldo
total, entradas, saídas e líquido, e a repartição de entradas e de saídas
por GRUPO de categoria (para as barras comparativas dessa página). GET
/resumo/categorias/{grupo_id} — um nível mais fundo, só pedido quando o
utilizador "abre" uma dessas barras: a repartição desse grupo por
SUBCATEGORIA (ver a nota "REPARTIÇÃO POR GRUPO", abaixo). Os dois já na
moeda principal do utilizador autenticado (User.moeda_principal — ver
app/models/user.py). Exigem autenticação (via obter_utilizador_atual,
app/core/deps.py), tal como o resto da aplicação.

PERÍODO: "saldo_total" nunca depende de período — é sempre "quanto tenho
agora", a soma do saldo actual de todas as contas, convertido à taxa de
HOJE (a mesma lógica já usada em app/routers/contas.py, _para_saida, só
que somada entre contas em vez de devolvida uma a uma). "entradas",
"saidas", "liquido" e as duas listas de categorias são sempre do MÊS
ACTUAL (do dia 1 até hoje) — não há ainda nenhum filtro de período que o
mude; a resposta devolve "periodo_inicio"/"periodo_fim" explicitamente,
para o cliente nunca ter de recalcular por si próprio o que "mês actual"
significa (fuso horário, qual é o dia 1, etc.) — a mesma definição usada
aqui é a única mostrada.

CONVERSÃO ENTRE MOEDAS: ao contrário do saldo actual de uma única conta
(uma conversão, à taxa de hoje), entradas/saídas (e a sua repartição por
categoria) somam vários MOVIMENTOS ao longo do período, cada um
convertido à taxa em vigor NO SEU PRÓPRIO DIA (a mesma regra de "taxa
histórica" já decidida para a conversão de moeda em geral — ver o
caderno). Trazem-se todas as taxas necessárias de uma só vez
(obter_taxas_do_periodo, em app/services/cambio.py) em vez de uma
consulta por movimento, para não repetir, à escala do número de
movimentos, o mesmo problema N+1 já corrigido antes nesta aplicação.

REPARTIÇÃO POR GRUPO, NÃO POR SUBCATEGORIA (GET /resumo): um movimento
pode estar categorizado directamente num grupo (ex.: "Alimentação") ou
numa das suas subcategorias (ex.: "Supermercado", dentro de
"Alimentação") — ver a nota "DOIS NÍVEIS" em app/models/categoria.py. As
listas "categorias_entradas"/"categorias_saidas" agregam sempre ao nível
do GRUPO (uma subcategoria soma-se ao seu grupo-pai), com o total e a
percentagem desse grupo face ao total de entradas/saídas do período. Só
aparecem grupos com pelo menos um movimento neste período (sem barras a
0%), por ordem decrescente de valor.

REPARTIÇÃO POR SUBCATEGORIA (GET /resumo/categorias/{grupo_id}): um nível
mais fundo, dentro de UM SÓ grupo. A percentagem de cada subcategoria é
face ao TOTAL DO PRÓPRIO GRUPO, não ao total geral de entradas/saídas —
é a pergunta que faz sentido ao "abrir" uma categoria ("quanto de
Alimentação foi para Supermercado", não "quanto do mês foi para
Supermercado"). Um movimento categorizado directamente no grupo (sem
escolher subcategoria) entra como a sua própria linha, com o nome do
PRÓPRIO grupo — nunca omitido, para a soma das linhas bater sempre certo
com o total do grupo.

TOLERÂNCIA A FALTA DE TAXA: uma conta ou um movimento sem taxa de câmbio
disponível fica de fora da soma respectiva (incluindo da repartição por
categoria/subcategoria), em silêncio — a mesma tolerância já usada em
GET /contas (saldo_convertido=None nesse caso, em vez de a rota inteira
falhar). Na prática, quase nunca acontece: o script de actualização
(scripts/actualizar_taxas_cambio.py) mantém as taxas em dia.
"""

import uuid
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.core.deps import obter_utilizador_atual
from app.db.session import get_db
from app.models.categoria import Categoria
from app.models.conta import Conta
from app.models.movimento import Movimento
from app.models.user import User
from app.schemas.resumo import GrupoDetalheOut, GrupoResumo, ResumoOut, SubcategoriaResumo
from app.services.cambio import (
    SemTaxaCambio,
    converter,
    converter_com_taxas,
    obter_taxas_do_periodo,
)
from app.services.categorias import obter_categoria_do_utilizador
from app.services.contas import somas_de_movimentos

router = APIRouter(prefix="/resumo", tags=["resumo"])

# Usado para arredondar/normalizar os valores monetários a 2 casas
# decimais, coerente com a coluna Numeric(14, 2) — a mesma convenção de
# app/routers/contas.py e app/routers/movimentos.py.
_DUAS_CASAS = Decimal("0.01")


async def _saldo_total(db: AsyncSession, utilizador: User) -> Decimal:
    """
    Soma o saldo ACTUAL (saldo_ancora + movimentos) de todas as contas do
    utilizador, cada uma convertida para a sua moeda principal à taxa de
    HOJE — a mesma conversão que app/routers/contas.py, _para_saida, faz
    por conta, aqui somada entre todas. Uma conta sem taxa disponível
    fica de fora da soma, em silêncio (ver a nota "TOLERÂNCIA A FALTA DE
    TAXA" no topo do ficheiro) — nunca faz este cálculo falhar.
    """
    contas = list(
        (await db.execute(select(Conta).where(Conta.user_id == utilizador.id))).scalars()
    )
    somas = await somas_de_movimentos(db, [conta.id for conta in contas])

    total = Decimal("0")
    for conta in contas:
        saldo_atual = conta.saldo_ancora + somas.get(conta.id, Decimal(0))
        try:
            total += await converter(
                db, saldo_atual, conta.moeda, utilizador.moeda_principal, date.today()
            )
        except SemTaxaCambio:
            continue
    return total


@dataclass
class _Fluxo:
    """Resultado de _fluxo_do_periodo — ver essa função."""

    entradas: Decimal = Decimal("0")
    saidas: Decimal = Decimal("0")
    # grupo_id -> (nome do grupo, soma convertida acumulada). Um dict, não
    # uma lista, para ir somando movimentos do MESMO grupo ao longo do
    # ciclo (várias linhas podem pertencer ao mesmo grupo, ou à mesma
    # subcategoria de um grupo) sem procurar a entrada já existente.
    grupos_entrada: dict[uuid.UUID, tuple[str, Decimal]] = field(default_factory=dict)
    grupos_saida: dict[uuid.UUID, tuple[str, Decimal]] = field(default_factory=dict)


async def _fluxo_do_periodo(
    db: AsyncSession, utilizador: User, data_inicio: date, data_fim: date
) -> _Fluxo:
    """
    Soma, separadamente, os movimentos POSITIVOS (entradas) e NEGATIVOS
    (saídas) de todas as contas do utilizador, com data entre
    "data_inicio" e "data_fim" (inclusive), cada um convertido para a
    moeda principal à taxa do SEU PRÓPRIO dia — nunca a de hoje (ver a
    nota "CONVERSÃO ENTRE MOEDAS" no topo do ficheiro) — e, ao mesmo
    tempo, a soma de cada um por GRUPO de categoria (ver a nota
    "REPARTIÇÃO POR GRUPO" no topo do ficheiro).

    Uma só consulta, com um "outer join" a uma segunda referência à
    própria tabela categorias (CategoriaPai, abaixo) para resolver, já em
    SQL, o grupo de cada movimento: se a categoria do movimento não tem
    "parent_id" (já é, ela própria, um grupo), o grupo é ela mesma; senão,
    é a categoria apontada por "parent_id" (CategoriaPai).

    Um movimento cuja moeda de origem não tem taxa disponível para a sua
    data fica de fora de TODAS as somas (entradas/saídas E o grupo a que
    pertence), em silêncio (mesma tolerância de _saldo_total, acima).
    """
    CategoriaPai = aliased(Categoria)

    linhas = (
        await db.execute(
            select(
                Movimento.valor,
                Movimento.data,
                Conta.moeda,
                Categoria.id,
                Categoria.nome,
                Categoria.parent_id,
                CategoriaPai.id,
                CategoriaPai.nome,
            )
            .join(Conta, Movimento.conta_id == Conta.id)
            .join(Categoria, Movimento.categoria_id == Categoria.id)
            .outerjoin(CategoriaPai, Categoria.parent_id == CategoriaPai.id)
            .where(Conta.user_id == utilizador.id, Movimento.data.between(data_inicio, data_fim))
        )
    ).all()

    # As moedas de ORIGEM (das contas dos movimentos) MAIS a moeda
    # PRINCIPAL (o destino de toda a conversão) — as duas pontas de que
    # converter_com_taxas precisa. Sem a moeda principal aqui, faltava
    # sempre a sua taxa na tabela pré-carregada assim que ela fosse
    # diferente de qualquer moeda de conta (ex.: moeda_principal="GBP",
    # todas as contas em EUR) — SemTaxaCambio era levantada para TODOS os
    # movimentos, e a soma ficava sempre "0.00", indistinguível de não
    # ter havido nenhum movimento no período.
    moedas = {linha[2] for linha in linhas} | {utilizador.moeda_principal}
    tabela_taxas = await obter_taxas_do_periodo(db, moedas, data_inicio, data_fim)

    fluxo = _Fluxo()
    for valor, data_movimento, moeda, cat_id, cat_nome, cat_parent_id, pai_id, pai_nome in linhas:
        try:
            convertido = converter_com_taxas(
                valor, moeda, utilizador.moeda_principal, data_movimento, tabela_taxas
            )
        except SemTaxaCambio:
            continue

        # Sem "parent_id": a própria categoria do movimento já é um
        # grupo. Com "parent_id": o grupo é o pai (trazido pelo "outer
        # join" acima).
        grupo_id = cat_id if cat_parent_id is None else pai_id
        grupo_nome = cat_nome if cat_parent_id is None else pai_nome

        if valor > 0:
            fluxo.entradas += convertido
            nome_actual, soma_actual = fluxo.grupos_entrada.get(grupo_id, (grupo_nome, Decimal("0")))
            fluxo.grupos_entrada[grupo_id] = (nome_actual, soma_actual + convertido)
        else:
            fluxo.saidas += convertido
            nome_actual, soma_actual = fluxo.grupos_saida.get(grupo_id, (grupo_nome, Decimal("0")))
            fluxo.grupos_saida[grupo_id] = (nome_actual, soma_actual + convertido)

    return fluxo


@dataclass
class _LinhaResumo:
    """Uma linha genérica de _linhas_ordenadas, abaixo — id + nome + valor
    + percentagem, antes de se tornar um GrupoResumo ou um
    SubcategoriaResumo (a mesma forma, para dois schemas diferentes —
    ver a nota nessa função)."""

    id: uuid.UUID
    nome: str
    valor: str
    percentagem: float


def _linhas_ordenadas(
    grupos: dict[uuid.UUID, tuple[str, Decimal]], total: Decimal
) -> list[_LinhaResumo]:
    """
    Converte um dicionário id -> (nome, soma) — de _fluxo_do_periodo (por
    grupo) ou de obter_detalhe_grupo (por subcategoria) — numa lista
    ordenada por MAGNITUDE decrescente (a mais útil para uma barra de
    percentagem), com a percentagem de cada linha face a "total" (abs()
    nos dois lados porque "total" e as somas de saída vêm negativos, e
    uma percentagem não faz sentido negativa).

    Devolve linhas genéricas, não já GrupoResumo/SubcategoriaResumo: os
    dois endpoints deste ficheiro reaproveitam esta mesma agregação, mas
    para schemas Pydantic diferentes (nomes de campo diferentes —
    "grupo_id" vs. "subcategoria_id" — para o mesmo significado, consoante
    o nível a que a linha pertence); cada um constrói o schema certo a
    partir destas linhas.
    """
    total_abs = abs(total)
    linhas = [
        _LinhaResumo(
            id=id_,
            nome=nome,
            valor=str(soma.quantize(_DUAS_CASAS)),
            percentagem=round(float(abs(soma) / total_abs * 100), 1) if total_abs > 0 else 0.0,
        )
        for id_, (nome, soma) in grupos.items()
    ]
    linhas.sort(key=lambda l: abs(Decimal(l.valor)), reverse=True)
    return linhas


@router.get("", response_model=ResumoOut)
async def obter_resumo(
    utilizador: User = Depends(obter_utilizador_atual),
    db: AsyncSession = Depends(get_db),
) -> ResumoOut:
    """Devolve o resumo estático do utilizador autenticado — ver a
    docstring no topo do ficheiro quanto ao período e à conversão."""
    hoje = date.today()
    periodo_inicio = hoje.replace(day=1)

    saldo_total = await _saldo_total(db, utilizador)
    fluxo = await _fluxo_do_periodo(db, utilizador, periodo_inicio, hoje)

    return ResumoOut(
        saldo_total=str(saldo_total.quantize(_DUAS_CASAS)),
        entradas=str(fluxo.entradas.quantize(_DUAS_CASAS)),
        saidas=str(fluxo.saidas.quantize(_DUAS_CASAS)),
        liquido=str((fluxo.entradas + fluxo.saidas).quantize(_DUAS_CASAS)),
        categorias_entradas=[
            GrupoResumo(grupo_id=l.id, nome=l.nome, valor=l.valor, percentagem=l.percentagem)
            for l in _linhas_ordenadas(fluxo.grupos_entrada, fluxo.entradas)
        ],
        categorias_saidas=[
            GrupoResumo(grupo_id=l.id, nome=l.nome, valor=l.valor, percentagem=l.percentagem)
            for l in _linhas_ordenadas(fluxo.grupos_saida, fluxo.saidas)
        ],
        periodo_inicio=periodo_inicio,
        periodo_fim=hoje,
    )


@router.get("/categorias/{grupo_id}", response_model=GrupoDetalheOut)
async def obter_detalhe_grupo(
    grupo_id: uuid.UUID,
    utilizador: User = Depends(obter_utilizador_atual),
    db: AsyncSession = Depends(get_db),
) -> GrupoDetalheOut:
    """
    A repartição por SUBCATEGORIA de um único grupo, no mês actual (o
    mesmo período de GET /resumo) — ver a nota "REPARTIÇÃO POR
    SUBCATEGORIA" no topo do ficheiro. Só pedida quando o utilizador
    "abre" essa barra em Início — GET /resumo já soma tudo ao nível do
    grupo; esta rota vai um nível mais fundo, sob pedido.

    400 se "grupo_id" existir e for do utilizador, mas não for um GRUPO
    (ex.: é o id de uma subcategoria) — os dois níveis desta app não têm
    um terceiro nível para "abrir".
    """
    grupo = await obter_categoria_do_utilizador(db, utilizador, grupo_id)
    if grupo.parent_id is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Este id não é de um grupo de categorias.",
        )

    hoje = date.today()
    periodo_inicio = hoje.replace(day=1)

    # As subcategorias DESTE grupo, mais o próprio grupo (para apanhar
    # movimentos categorizados directamente nele, sem subcategoria — ver
    # a nota no topo do ficheiro).
    linhas = (
        await db.execute(
            select(Movimento.valor, Movimento.data, Conta.moeda, Categoria.id, Categoria.nome)
            .join(Conta, Movimento.conta_id == Conta.id)
            .join(Categoria, Movimento.categoria_id == Categoria.id)
            .where(
                Conta.user_id == utilizador.id,
                Movimento.data.between(periodo_inicio, hoje),
                (Categoria.id == grupo.id) | (Categoria.parent_id == grupo.id),
            )
        )
    ).all()

    moedas = {linha[2] for linha in linhas} | {utilizador.moeda_principal}
    tabela_taxas = await obter_taxas_do_periodo(db, moedas, periodo_inicio, hoje)

    total = Decimal("0")
    por_subcategoria: dict[uuid.UUID, tuple[str, Decimal]] = {}
    for valor, data_movimento, moeda, cat_id, cat_nome in linhas:
        try:
            convertido = converter_com_taxas(
                valor, moeda, utilizador.moeda_principal, data_movimento, tabela_taxas
            )
        except SemTaxaCambio:
            continue
        total += convertido
        nome_actual, soma_actual = por_subcategoria.get(cat_id, (cat_nome, Decimal("0")))
        por_subcategoria[cat_id] = (nome_actual, soma_actual + convertido)

    return GrupoDetalheOut(
        grupo_id=grupo.id,
        nome=grupo.nome,
        valor=str(total.quantize(_DUAS_CASAS)),
        subcategorias=[
            SubcategoriaResumo(
                subcategoria_id=l.id, nome=l.nome, valor=l.valor, percentagem=l.percentagem
            )
            for l in _linhas_ordenadas(por_subcategoria, total)
        ],
    )
