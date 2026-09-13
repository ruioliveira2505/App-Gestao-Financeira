"""
SERVIÇO DE CATEGORIAS — VERIFICAÇÃO DE POSSE
================================================

Uma única função, obter_categoria_do_utilizador, usada por app/routers/
movimentos.py (para confirmar que a categoria escolhida ao criar ou editar
um movimento pertence ao utilizador) e, mais tarde, por app/routers/
categorias.py. Estar num sítio só evita duas cópias da mesma query — e da
mesma regra de segurança — a divergirem com o tempo; é o mesmo padrão já
usado em app/services/contas.py, para o mesmo efeito com contas.
"""

import uuid

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.categoria import Categoria
from app.models.user import User


async def obter_categoria_do_utilizador(
    db: AsyncSession, utilizador: User, categoria_id: uuid.UUID
) -> Categoria:
    """
    Devolve a categoria com este id, se pertencer ao utilizador. Caso
    contrário — não existe, ou é de outro utilizador — levanta 404, nunca
    403: para este utilizador, uma categoria que não é sua é, para todos
    os efeitos, inexistente, e a resposta não deve sequer revelar que o id
    corresponde a alguma categoria (de outra pessoa).
    """
    resultado = await db.execute(
        select(Categoria).where(Categoria.id == categoria_id, Categoria.user_id == utilizador.id)
    )
    categoria = resultado.scalar_one_or_none()
    if categoria is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Categoria não encontrada."
        )
    return categoria
