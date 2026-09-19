"""
FORMATO DAS RESPOSTAS DE GET /resumo E GET /resumo/categorias/{grupo_id}
============================================================================

Quatro classes: GrupoResumo (uma linha da repartição de entradas ou de
saídas por grupo de categoria) e ResumoOut (a resposta completa do
primeiro), SubcategoriaResumo (uma linha da repartição por subcategoria
DENTRO de um grupo) e GrupoDetalheOut (a resposta completa do segundo) —
ver app/routers/resumo.py quanto ao cálculo de cada campo.

Valores monetários como texto ("1234.56"), não números — a mesma
convenção do resto da API (ver a nota em app/schemas/contas.py): o JSON
não tem um tipo decimal, e um número em vírgula flutuante poderia perder
precisão em cêntimos. "percentagem" é um número (não texto): não é
dinheiro, não precisa da mesma precisão exacta, e o cliente usa-a
directamente (ex.: a largura de uma barra), sem conversão nenhuma.
"""

import uuid
from datetime import date

from pydantic import BaseModel


class GrupoResumo(BaseModel):
    """
    Uma linha da repartição de entradas ou de saídas por GRUPO de
    categoria (ver a nota "REPARTIÇÃO POR GRUPO" em
    app/routers/resumo.py) — "grupo_id" é sempre o id de um GRUPO
    (Categoria.parent_id nulo), nunca de uma subcategoria, mesmo que o
    movimento em si esteja categorizado numa subcategoria.
    """

    grupo_id: uuid.UUID
    nome: str
    # Já na moeda principal, arredondado a 2 casas — "-120.00" para um
    # grupo de saídas (mantém o sinal, tal como "saidas" em ResumoOut).
    valor: str
    # 0-100, arredondada a 1 casa decimal. Face ao total de ENTRADAS ou
    # de SAÍDAS do período (nunca ao saldo, nem ao líquido).
    percentagem: float


class SubcategoriaResumo(BaseModel):
    """
    Uma linha da repartição por SUBCATEGORIA dentro de um único grupo
    (ver GET /resumo/categorias/{grupo_id}) — ao contrário de
    GrupoResumo.percentagem (face ao total de entradas/saídas do
    período), aqui "percentagem" é face ao TOTAL DO PRÓPRIO GRUPO:
    perguntas diferentes ("quanto do total do mês foi para Supermercado"
    vs. "quanto de Alimentação foi para Supermercado") — a segunda é a
    que faz sentido ao abrir uma categoria para a ver em detalhe.

    Quando um movimento está categorizado directamente no GRUPO, sem
    escolher nenhuma subcategoria, aparece como uma linha própria, com
    "subcategoria_id"/"nome" iguais aos do próprio grupo — nunca
    omitido: a soma de todas as linhas desta lista bate sempre certo com
    "valor" em GrupoDetalheOut.
    """

    subcategoria_id: uuid.UUID
    nome: str
    valor: str
    percentagem: float


class GrupoDetalheOut(BaseModel):
    """Resposta de GET /resumo/categorias/{grupo_id} — o total do grupo
    (mesmo período e mesma conversão de moeda que GET /resumo) e a sua
    repartição por subcategoria, por ordem decrescente de valor."""

    grupo_id: uuid.UUID
    nome: str
    valor: str
    subcategorias: list[SubcategoriaResumo]


class ResumoOut(BaseModel):
    """Os quatro números estáticos do resumo, a repartição de entradas e
    de saídas por grupo de categoria, e o período a que "entradas"/
    "saidas"/"liquido"/as duas listas dizem respeito (ver a nota
    "PERÍODO" em app/routers/resumo.py — "saldo_total" não depende de
    período nenhum, é sempre "quanto tenho agora")."""

    saldo_total: str
    entradas: str
    saidas: str
    liquido: str

    # Por ordem decrescente de valor; só grupos com pelo menos um
    # movimento neste período (nunca uma linha a 0%).
    categorias_entradas: list[GrupoResumo]
    categorias_saidas: list[GrupoResumo]

    periodo_inicio: date
    periodo_fim: date
