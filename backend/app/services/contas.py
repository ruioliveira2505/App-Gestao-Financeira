"""
SERVIÇO DE CONTAS — VERIFICAÇÃO DE POSSE E SOMA DE MOVIMENTOS
=================================================================

Três funções partilhadas por mais do que uma rota:

- obter_conta_do_utilizador — por app/routers/contas.py e
  app/routers/movimentos.py: as duas rotas precisam de confirmar que uma
  conta pertence ao utilizador autenticado antes de a mostrar, editar ou
  apagar (contas), ou de lhe associar um movimento (movimentos).

- soma_movimentos / somas_de_movimentos — por app/routers/contas.py (o
  saldo actual de cada conta) e app/routers/resumo.py (_saldo_total, o
  saldo total somado entre todas as contas do utilizador). Viviam antes
  só em contas.py, privadas (nome com "_" à frente); mudaram-se para
  aqui, e perderam o "_", quando uma SEGUNDA rota passou a precisar
  exactamente do mesmo cálculo — estar num sítio só evita duas cópias da
  mesma query a divergirem com o tempo, o mesmo raciocínio já aplicado a
  obter_conta_do_utilizador.
"""

import uuid
from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.conta import Conta
from app.models.movimento import Movimento
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


async def soma_movimentos(db: AsyncSession, conta_id: uuid.UUID) -> Decimal:
    """
    Soma o "valor" (com sinal) de todos os movimentos de uma conta. 0 se
    não houver nenhum.

    SEM filtro por data aqui, mesmo sabendo que um movimento nunca pode
    ser anterior à data-âncora da conta (ver app/models/conta.py): essa
    regra já é imposta noutro sítio — _validar_data, em
    app/routers/movimentos.py, chamada tanto ao criar como ao editar um
    movimento, incluindo ao "mover" um movimento de uma conta para outra.
    Como nenhum movimento anterior à âncora chega a existir na base de
    dados, somar sem filtro de data dá exactamente o mesmo resultado que
    somar só os posteriores à âncora — mas sem repetir aqui uma
    verificação que já está garantida noutro lado.
    """
    resultado = await db.execute(
        select(func.coalesce(func.sum(Movimento.valor), 0)).where(
            Movimento.conta_id == conta_id
        )
    )
    return resultado.scalar_one()


async def somas_de_movimentos(
    db: AsyncSession, conta_ids: list[uuid.UUID]
) -> dict[uuid.UUID, Decimal]:
    """
    A mesma soma que soma_movimentos, mas para várias contas de uma vez
    (uma query, agrupada por conta_id) — usada nas listagens, para não
    repetir uma query por conta (problema "N+1").
    """
    if not conta_ids:
        return {}
    resultado = await db.execute(
        select(Movimento.conta_id, func.sum(Movimento.valor))
        .where(Movimento.conta_id.in_(conta_ids))
        .group_by(Movimento.conta_id)
    )
    return dict(resultado.all())
