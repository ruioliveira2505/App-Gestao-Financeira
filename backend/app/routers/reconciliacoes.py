"""
ROTAS DE RECONCILIAÇÕES
==========================

Uma RECONCILIAÇÃO é a afirmação «no FIM do dia D, o saldo desta conta era
S» (por exemplo, o saldo do extrato do banco). A aplicação cria um
movimento de ACERTO pela diferença entre S e o saldo que ela própria
calcula, e a partir de D o saldo é sempre o afirmado. O acerto recalcula-se
sozinho sempre que muda alguma coisa de que depende.

Endpoints:
  - GET    /contas/{id}/reconciliacoes          — as reconciliações da conta;
  - POST   /contas/{id}/reconciliacoes          — cria uma;
  - POST   /contas/{id}/reconciliacoes/simular  — o acerto que uma
    reconciliação nova daria, sem gravar (para mostrar antes de gravar);
  - PATCH  /reconciliacoes/{id}                 — muda a data e o saldo;
  - POST   /reconciliacoes/{id}/simular         — o acerto que a alteração
    daria, sem gravar;
  - DELETE /reconciliacoes/{id}                 — apaga (e o seu acerto).

AS REGRAS DE NEGÓCIO NÃO VIVEM AQUI, mas no serviço de reconciliações
(app/services/reconciliacoes.py): só numa conta manual, datas entre a data
inicial e hoje, uma por dia. Cada rota que altera dados chama o serviço e
torna as alterações definitivas (commit), uma vez, no fim. Se uma regra
for violada, o serviço lança um erro de domínio, que a API traduz no
código HTTP certo. Uma conta ou reconciliação de outro utilizador é, para
todos os efeitos, inexistente (404).
"""

import uuid

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import obter_utilizador_atual
from app.db.session import get_db
from app.models.reconciliacao import Reconciliacao
from app.models.user import User
from app.schemas.reconciliacoes import AcertoSimuladoOut, ReconciliacaoDados, ReconciliacaoOut
from app.services import reconciliacoes as servico
from app.services.contas import obter_conta_do_utilizador

router = APIRouter(tags=["reconciliacoes"])


def _para_saida(reconciliacao: Reconciliacao, acerto) -> ReconciliacaoOut:
    """Converte uma reconciliação (e o valor do seu acerto) na forma devolvida pela API."""
    return ReconciliacaoOut(
        id=reconciliacao.id,
        conta_id=reconciliacao.conta_id,
        data=reconciliacao.data,
        saldo=f"{reconciliacao.saldo:.2f}",
        origem=reconciliacao.origem,
        acerto=f"{acerto:.2f}",
        # Só as do banco: uma que passou a ser do utilizador (ao desvincular
        # a conta) guarda a leitura, mas já não é «do banco».
        lido_em=reconciliacao.lido_em if reconciliacao.origem == "banco" else None,
    )


async def _com_acerto(db: AsyncSession, conta, reconciliacao: Reconciliacao) -> ReconciliacaoOut:
    """A reconciliação na forma da API, com o valor atual do seu acerto."""
    for item in await servico.listar(db, conta):
        if item.reconciliacao.id == reconciliacao.id:
            return _para_saida(item.reconciliacao, item.acerto)
    raise AssertionError("a reconciliação acabada de gravar tem de estar na lista")


@router.get("/contas/{conta_id}/reconciliacoes", response_model=list[ReconciliacaoOut])
async def listar_reconciliacoes(
    conta_id: uuid.UUID,
    utilizador: User = Depends(obter_utilizador_atual),
    db: AsyncSession = Depends(get_db),
) -> list[ReconciliacaoOut]:
    """As reconciliações de uma conta, por ordem de data, cada uma com o seu acerto."""
    conta = await obter_conta_do_utilizador(db, utilizador, conta_id)
    return [_para_saida(item.reconciliacao, item.acerto) for item in await servico.listar(db, conta)]


@router.post(
    "/contas/{conta_id}/reconciliacoes",
    response_model=ReconciliacaoOut,
    status_code=status.HTTP_201_CREATED,
)
async def criar_reconciliacao(
    conta_id: uuid.UUID,
    dados: ReconciliacaoDados,
    utilizador: User = Depends(obter_utilizador_atual),
    db: AsyncSession = Depends(get_db),
) -> ReconciliacaoOut:
    """Cria uma reconciliação numa conta manual; o acerto é calculado e gravado."""
    conta = await obter_conta_do_utilizador(db, utilizador, conta_id)
    reconciliacao = await servico.criar(db, conta, dados.data, dados.saldo)
    await db.commit()
    return await _com_acerto(db, conta, reconciliacao)


@router.post("/contas/{conta_id}/reconciliacoes/simular", response_model=AcertoSimuladoOut)
async def simular_reconciliacao(
    conta_id: uuid.UUID,
    dados: ReconciliacaoDados,
    utilizador: User = Depends(obter_utilizador_atual),
    db: AsyncSession = Depends(get_db),
) -> AcertoSimuladoOut:
    """O acerto que uma reconciliação nova daria, sem gravar nada."""
    conta = await obter_conta_do_utilizador(db, utilizador, conta_id)
    acerto = await servico.simular_acerto(db, conta, dados.data, dados.saldo)
    return AcertoSimuladoOut(acerto=f"{acerto:.2f}")


@router.patch("/reconciliacoes/{reconciliacao_id}", response_model=ReconciliacaoOut)
async def editar_reconciliacao(
    reconciliacao_id: uuid.UUID,
    dados: ReconciliacaoDados,
    utilizador: User = Depends(obter_utilizador_atual),
    db: AsyncSession = Depends(get_db),
) -> ReconciliacaoOut:
    """Muda a data e o saldo de uma reconciliação do utilizador; os acertos recalculam-se."""
    reconciliacao, conta = await servico.obter_reconciliacao_do_utilizador(
        db, utilizador, reconciliacao_id
    )
    reconciliacao = await servico.editar(db, reconciliacao, conta, dados.data, dados.saldo)
    await db.commit()
    return await _com_acerto(db, conta, reconciliacao)


@router.post("/reconciliacoes/{reconciliacao_id}/simular", response_model=AcertoSimuladoOut)
async def simular_edicao(
    reconciliacao_id: uuid.UUID,
    dados: ReconciliacaoDados,
    utilizador: User = Depends(obter_utilizador_atual),
    db: AsyncSession = Depends(get_db),
) -> AcertoSimuladoOut:
    """O acerto que a reconciliação passaria a ter com esta data e este saldo, sem gravar."""
    reconciliacao, conta = await servico.obter_reconciliacao_do_utilizador(
        db, utilizador, reconciliacao_id
    )
    acerto = await servico.simular_acerto(
        db, conta, dados.data, dados.saldo, ignorar_reconciliacao_id=reconciliacao.id
    )
    return AcertoSimuladoOut(acerto=f"{acerto:.2f}")


@router.delete("/reconciliacoes/{reconciliacao_id}", status_code=status.HTTP_204_NO_CONTENT)
async def apagar_reconciliacao(
    reconciliacao_id: uuid.UUID,
    utilizador: User = Depends(obter_utilizador_atual),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Apaga uma reconciliação do utilizador (e o seu acerto); os acertos seguintes recalculam-se."""
    reconciliacao, conta = await servico.obter_reconciliacao_do_utilizador(
        db, utilizador, reconciliacao_id
    )
    await servico.apagar(db, reconciliacao, conta)
    await db.commit()
