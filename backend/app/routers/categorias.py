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
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import obter_utilizador_atual
from app.db.session import get_db
from app.models.categoria import Categoria
from app.models.movimento import Movimento
from app.models.user import User
from app.schemas.categorias import (
    CategoriaCriar,
    CategoriaEditar,
    CategoriaOut,
    GrupoArvoreOut,
    SubcategoriaArvoreOut,
)
from app.services.categorias import obter_categoria_do_utilizador

router = APIRouter(prefix="/categorias", tags=["categorias"])


async def _nome_duplicado(
    db: AsyncSession,
    utilizador: User,
    parent_id: uuid.UUID | None,
    nome: str,
    ignorar_id: uuid.UUID | None = None,
) -> bool:
    """
    True se já existir, para este utilizador, uma categoria com este nome
    dentro do mesmo grupo (mesmo parent_id) — incluindo dois grupos de
    topo com o mesmo nome (parent_id NULO nos dois), caso em que a
    comparação teria de ser feita aqui de qualquer forma: o Postgres trata
    cada NULO como distinto de qualquer outro, por isso uma restrição
    UNIQUE na base de dados não apanharia este caso.

    ignorar_id exclui a própria categoria a editar da comparação — senão
    "renomear para o mesmo nome que já tem" seria sempre recusado como
    duplicado de si próprio.
    """
    condicao_parent = Categoria.parent_id.is_(None) if parent_id is None else Categoria.parent_id == parent_id
    query = select(Categoria.id).where(
        Categoria.user_id == utilizador.id, condicao_parent, Categoria.nome == nome
    )
    if ignorar_id is not None:
        query = query.where(Categoria.id != ignorar_id)
    resultado = await db.execute(query.limit(1))
    return resultado.first() is not None


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

    Ordem alfabética em ambos os níveis: não há uma coluna "ordem" nesta
    fatia (ver a nota em app/services/categorias_seed.py) — se a
    ordenação manual vier a fazer falta, é uma mudança à parte.
    """
    categorias = list(
        (
            await db.scalars(
                select(Categoria).where(Categoria.user_id == utilizador.id).order_by(Categoria.nome)
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
    if dados.parent_id is None:
        direcao = dados.direcao
        parent_id = None
    else:
        grupo = await obter_categoria_do_utilizador(db, utilizador, dados.parent_id)
        if grupo.parent_id is not None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Não é possível criar uma subcategoria dentro de outra subcategoria.",
            )
        direcao = grupo.direcao
        parent_id = grupo.id

    if await _nome_duplicado(db, utilizador, parent_id, dados.nome):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Já existe uma categoria com este nome no mesmo grupo.",
        )

    categoria = Categoria(user_id=utilizador.id, parent_id=parent_id, nome=dados.nome, direcao=direcao)
    db.add(categoria)
    await db.commit()
    await db.refresh(categoria)

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
    corresponde ao seu próprio valor (ver _validar_direcao em
    app/routers/movimentos.py).

    Uma categoria protegida (ver a nota PROTEGIDA em app/models/
    categoria.py) não pode ser editada de forma nenhuma.
    """
    categoria = await obter_categoria_do_utilizador(db, utilizador, categoria_id)
    if categoria.protegida:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Esta categoria é necessária para o funcionamento da aplicação e não pode ser editada.",
        )

    if categoria.parent_id is None:
        # É um grupo: só se renomeia, nunca ganha um parent_id.
        if dados.parent_id is not None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Um grupo não pode tornar-se subcategoria de outro grupo.",
            )
        novo_parent_id = None
    else:
        # É uma subcategoria: parent_id é sempre obrigatório (não pode
        # "subir" a grupo) e o destino tem de ser um grupo da mesma
        # direcao.
        if dados.parent_id is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Uma subcategoria não pode deixar de pertencer a um grupo.",
            )
        novo_grupo = await obter_categoria_do_utilizador(db, utilizador, dados.parent_id)
        if novo_grupo.parent_id is not None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="O destino tem de ser um grupo, não outra subcategoria.",
            )
        if novo_grupo.direcao != categoria.direcao:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Não é possível mover uma subcategoria para um grupo de direção diferente.",
            )
        novo_parent_id = novo_grupo.id

    if await _nome_duplicado(db, utilizador, novo_parent_id, dados.nome, ignorar_id=categoria.id):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Já existe uma categoria com este nome no mesmo grupo.",
        )

    categoria.nome = dados.nome
    categoria.parent_id = novo_parent_id

    await db.commit()
    await db.refresh(categoria)

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
    """
    categoria = await obter_categoria_do_utilizador(db, utilizador, categoria_id)
    if categoria.protegida:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Esta categoria é necessária para o funcionamento da aplicação e não pode ser eliminada.",
        )

    # As subcategorias que caem em cascata com este grupo (lista vazia se
    # categoria for, ela própria, uma subcategoria).
    subcategorias_id = list(
        (
            await db.scalars(select(Categoria.id).where(Categoria.parent_id == categoria.id))
        ).all()
    )
    ids_a_desaparecer = [categoria.id, *subcategorias_id]

    n_movimentos = await db.scalar(
        select(func.count()).select_from(Movimento).where(Movimento.categoria_id.in_(ids_a_desaparecer))
    )

    if n_movimentos > 0:
        if migrar_para_id is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    f"{n_movimentos} movimento(s) usam esta categoria (ou uma das suas "
                    "subcategorias). Indica para onde migrar em migrar_para_id antes de eliminar."
                ),
            )

        destino = await obter_categoria_do_utilizador(db, utilizador, migrar_para_id)
        if destino.id in ids_a_desaparecer:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="O destino da migração não pode ser a própria categoria a eliminar (nem uma das suas subcategorias).",
            )
        if destino.direcao != categoria.direcao:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="O destino da migração tem de ser da mesma direção (entrada ou saída).",
            )

        await db.execute(
            update(Movimento)
            .where(Movimento.categoria_id.in_(ids_a_desaparecer))
            .values(categoria_id=destino.id)
        )

    await db.delete(categoria)
    await db.commit()
