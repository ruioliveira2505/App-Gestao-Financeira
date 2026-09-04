"""
SERVIÇO DE CONTAS — VERIFICAÇÃO DE POSSE
============================================

Uma única função, obter_conta_do_utilizador, partilhada por app/routers/
contas.py e app/routers/movimentos.py: as duas rotas precisam de
confirmar que uma conta pertence ao utilizador autenticado antes de a
mostrar, editar ou apagar (contas), ou de lhe associar um movimento
(movimentos). Estar num sítio só evita duas cópias da mesma query — e da
mesma regra de segurança — a divergirem com o tempo.
"""

import uuid

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.conta import Conta
from app.models.user import User


async def obter_conta_do_utilizador(
    db: AsyncSession, utilizador: User, conta_id: uuid.UUID
) -> Conta:
    """
    Devolve a conta com este id, se pertencer ao utilizador. Caso
    contrário — não existe, ou é de outro utilizador — levanta 404, nunca
    403: para este utilizador, uma conta que não é sua é, para todos os
    efeitos, inexistente, e a resposta não deve sequer revelar que o id
    corresponde a alguma conta (de outra pessoa).
    """
    resultado = await db.execute(
        select(Conta).where(Conta.id == conta_id, Conta.user_id == utilizador.id)
    )
    conta = resultado.scalar_one_or_none()
    if conta is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Conta não encontrada."
        )
    return conta
