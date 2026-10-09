"""
ROTAS DE CATEGORIAS
======================

Endpoints para gerir a árvore de categorias do utilizador autenticado —
ver app/models/categoria.py para o desenho da tabela (dois níveis, grupo
e subcategoria, na mesma tabela; direcao herdada pela subcategoria;
protegida marca as duas categorias-refúgio que nenhum movimento fica sem).

Cada rota exige autenticação (via obter_utilizador_atual, app/core/
deps.py) e trabalha sempre no âmbito do utilizador do pedido — uma
categoria de outro utilizador é, para todos os efeitos, inexistente (ver
app/services/categorias.py:obter_categoria_do_utilizador).

A ELIMINAÇÃO É O ENDPOINT MAIS ENVOLVIDO: apagar uma categoria (grupo ou
subcategoria) que ainda tenha movimentos associados — directamente, ou
por pertencerem a uma subcategoria que vai cair em cascata com o grupo —
exige que o pedido indique explicitamente, em migrar_para_id, para que
categoria esses movimentos passam. Nunca há uma reatribuição silenciosa
(nem sequer para uma categoria-refúgio "Outras Entradas"/"Outras Saídas")
e nunca uma cascata que apague os próprios movimentos — só a categoria
desaparece, os movimentos ficam sempre categorizados nalguma coisa.

AS REGRAS DE NEGÓCIO NÃO VIVEM AQUI, mas no serviço de categorias
(app/services/categorias.py). Cada rota que altera dados chama o serviço e
torna as alterações definitivas (commit), uma vez, no fim. Se uma regra
for violada, o serviço lança um erro de domínio, que a API traduz no
código HTTP certo.
"""

import uuid

from fastapi import APIRouter, Depends, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import obter_utilizador_atual
from app.db.session import get_db
from app.models.categoria import Categoria
from app.models.user import User
from app.schemas.categorias import (
    CategoriaCriar,
    CategoriaEditar,
    CategoriaOut,
    GrupoArvoreOut,
    SubcategoriaArvoreOut,
)
from app.services import categorias as servico

router = APIRouter(prefix="/categorias", tags=["categorias"])


def _para_saida(categoria: Categoria) -> CategoriaOut:
    """Converte uma linha da tabela "categorias" na forma devolvida pela API."""
    return CategoriaOut(
        id=categoria.id,
        nome=categoria.nome,
        parent_id=categoria.parent_id,
        direcao=categoria.direcao,
        protegida=categoria.protegida,
    )


@router.get("/arvore", response_model=list[GrupoArvoreOut])
async def arvore_categorias(
    utilizador: User = Depends(obter_utilizador_atual),
    db: AsyncSession = Depends(get_db),
) -> list[GrupoArvoreOut]:
    """
    Devolve todos os grupos do utilizador, cada um com as suas
    subcategorias aninhadas — a forma que os seletores da interface
    (filtros, formulário de movimento) precisam, para não terem de montar
    a árvore a partir de uma lista plana.

    Ordenados por "ordem" (ver a nota em app/models/categoria.py), não por
    nome — a árvore por omissão organiza-se deliberadamente por área de
    vida e por tipo de encargo financeiro, e uma ordenação alfabética
    apagaria essa organização.
    """
    categorias = list(
        (
            await db.scalars(
                select(Categoria).where(Categoria.user_id == utilizador.id).order_by(Categoria.ordem)
            )
        ).all()
    )
    grupos = [c for c in categorias if c.parent_id is None]
    subcategorias_por_grupo: dict[uuid.UUID, list[Categoria]] = {grupo.id: [] for grupo in grupos}
    for categoria in categorias:
        if categoria.parent_id is not None:
            subcategorias_por_grupo[categoria.parent_id].append(categoria)

    return [
        GrupoArvoreOut(
            id=grupo.id,
            nome=grupo.nome,
            direcao=grupo.direcao,
            subcategorias=[
                SubcategoriaArvoreOut(id=sub.id, nome=sub.nome, protegida=sub.protegida)
                for sub in subcategorias_por_grupo[grupo.id]
            ],
        )
        for grupo in grupos
    ]


@router.post("", response_model=CategoriaOut, status_code=status.HTTP_201_CREATED)
async def criar_categoria(
    dados: CategoriaCriar,
    utilizador: User = Depends(obter_utilizador_atual),
    db: AsyncSession = Depends(get_db),
) -> CategoriaOut:
    """
    Cria um grupo (parent_id vazio, direcao obrigatória) ou uma
    subcategoria (parent_id preenchido, direcao herdada do grupo) — ver a
    nota no topo de app/schemas/categorias.py quanto a esta distinção.
    """
    categoria = await servico.criar_categoria(
        db, utilizador, nome=dados.nome, parent_id=dados.parent_id, direcao=dados.direcao
    )
    await db.commit()
    return _para_saida(categoria)


@router.patch("/{categoria_id}", response_model=CategoriaOut)
async def editar_categoria(
    categoria_id: uuid.UUID,
    dados: CategoriaEditar,
    utilizador: User = Depends(obter_utilizador_atual),
    db: AsyncSession = Depends(get_db),
) -> CategoriaOut:
    """
    Renomeia uma categoria e, para uma subcategoria, permite movê-la para
    outro grupo (dados.parent_id) — sempre dentro da mesma direcao: o
    destino tem de ser um grupo (não outra subcategoria) e tem de
    pertencer à mesma direcao da subcategoria a mover, para nunca deixar
    um movimento com uma categoria cujo sentido (entrada/saída) já não
    corresponde ao seu próprio valor.

    Uma categoria protegida (ver a nota PROTEGIDA em app/models/
    categoria.py) não pode ser editada de forma nenhuma.
    """
    categoria = await servico.obter_categoria_do_utilizador(db, utilizador, categoria_id)
    categoria = await servico.editar_categoria(
        db, utilizador, categoria, nome=dados.nome, parent_id=dados.parent_id
    )
    await db.commit()
    return _para_saida(categoria)


@router.delete("/{categoria_id}", status_code=status.HTTP_204_NO_CONTENT)
async def eliminar_categoria(
    categoria_id: uuid.UUID,
    migrar_para_id: uuid.UUID | None = None,
    utilizador: User = Depends(obter_utilizador_atual),
    db: AsyncSession = Depends(get_db),
) -> None:
    """
    Elimina um grupo (e, em cascata, as suas subcategorias — ver
    ondelete="CASCADE" em app/models/categoria.py) ou uma subcategoria.

    Todo o movimento tem categoria obrigatória (ver a nota CATEGORIA
    OBRIGATÓRIA em app/models/movimento.py) — por isso, se algum movimento
    ficasse sem categoria com esta eliminação (porque aponta directamente
    para esta categoria, ou para uma subcategoria dela que vai cair em
    cascata), o pedido tem de indicar, em migrar_para_id, para onde esses
    movimentos são reatribuídos ANTES de a categoria ser apagada. Sem
    migrar_para_id, e havendo movimentos nessa situação, o pedido é
    recusado (409) em vez de escolher um destino sozinho — mesmo que fosse
    a categoria-refúgio, seria uma reatribuição que o utilizador nunca viu
    acontecer.

    "migrar_para_id", se indicado, é sempre validado (pertence ao
    utilizador, não é a própria categoria a desaparecer, tem a mesma
    direcao) — mesmo quando a categoria a eliminar não tem NENHUM
    movimento a migrar, e portanto o destino nem chega a ser usado: um
    valor inválido nunca deve ser aceite em silêncio só porque, por
    acaso, não fazia falta.
    """
    categoria = await servico.obter_categoria_do_utilizador(db, utilizador, categoria_id)
    await servico.eliminar_categoria(db, utilizador, categoria, migrar_para_id)
    await db.commit()
