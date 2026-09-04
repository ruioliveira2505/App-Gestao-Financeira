"""
ROTAS DE CONTAS
================

Endpoints para gerir as contas do utilizador autenticado. Cada rota exige
autenticação (via obter_utilizador_atual, app/core/deps.py) e trabalha
sempre no âmbito do utilizador do pedido — uma conta de outro utilizador
é, para todos os efeitos, inexistente (ver
app/services/contas.py:obter_conta_do_utilizador).
"""

import uuid
from datetime import date
from decimal import Decimal

# APIRouter agrupa rotas relacionadas; Depends injecta dependências
# (utilizador autenticado, sessão de base de dados); HTTPException
# interrompe um pedido com um erro HTTP; status fornece os códigos como
# constantes com nome.
from fastapi import APIRouter, Depends, HTTPException, status

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import obter_utilizador_atual
from app.db.session import get_db
from app.models.conta import Conta
from app.models.movimento import Movimento
from app.models.user import User
from app.schemas.contas import ContaCriar, ContaEditar, ContaOut
from app.services.contas import obter_conta_do_utilizador

# prefix="/contas": todas as rotas aqui ficam sob "/contas". tags=["contas"]
# agrupa-as com esse nome na documentação automática do FastAPI.
router = APIRouter(prefix="/contas", tags=["contas"])

# Usado para arredondar/normalizar os valores monetários a 2 casas
# decimais, coerente com a coluna Numeric(14, 2).
_DUAS_CASAS = Decimal("0.01")


async def _soma_movimentos(db: AsyncSession, conta_id: uuid.UUID) -> Decimal:
    """Soma o "valor" (com sinal) de todos os movimentos de uma conta. 0 se não houver nenhum."""
    resultado = await db.execute(
        select(func.coalesce(func.sum(Movimento.valor), 0)).where(
            Movimento.conta_id == conta_id
        )
    )
    return resultado.scalar_one()


async def _somas_de_movimentos(
    db: AsyncSession, conta_ids: list[uuid.UUID]
) -> dict[uuid.UUID, Decimal]:
    """
    A mesma soma que _soma_movimentos, mas para várias contas de uma vez
    (uma query, agrupada por conta_id) — usada na listagem, para não
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


async def _tem_movimentos(db: AsyncSession, conta_id: uuid.UUID) -> bool:
    """
    True se a conta tiver pelo menos um movimento. Não é o mesmo que "a
    soma dos movimentos é diferente de 0" — uma conta pode ter movimentos
    cujo total dá exactamente 0 (ex.: +50 e -50) e ainda assim ter
    movimentos. limit(1): só interessa saber se existe algum, não quantos.
    """
    resultado = await db.execute(
        select(Movimento.id).where(Movimento.conta_id == conta_id).limit(1)
    )
    return resultado.first() is not None


def _para_saida(conta: Conta, soma_movimentos: Decimal) -> ContaOut:
    """
    Converte uma linha da tabela "contas" na forma devolvida pela API.

    É aqui que os valores decimais passam a texto e que o "saldo actual" é
    determinado: saldo_ancora + a soma (com sinal) dos movimentos da
    conta, já calculada por quem chama (_soma_movimentos /
    _somas_de_movimentos) — esta função não faz queries, só formata.
    """
    saldo_ancora_texto = f"{conta.saldo_ancora:.2f}"
    saldo_texto = f"{conta.saldo_ancora + soma_movimentos:.2f}"
    return ContaOut(
        id=conta.id,
        nome=conta.nome,
        banco=conta.banco,
        tipo=conta.tipo,
        moeda=conta.moeda,
        data_ancora=conta.data_ancora,
        saldo_ancora=saldo_ancora_texto,
        saldo=saldo_texto,
        created_at=conta.created_at,
        updated_at=conta.updated_at,
    )


@router.post("", response_model=ContaOut, status_code=status.HTTP_201_CREATED)
async def criar_conta(
    dados: ContaCriar,
    utilizador: User = Depends(obter_utilizador_atual),
    db: AsyncSession = Depends(get_db),
) -> ContaOut:
    """
    Cria uma conta para o utilizador autenticado.

    O corpo do pedido já chega validado pelo schema ContaCriar (nome não
    vazio, moeda suportada, comprimentos máximos). Fica a cargo desta rota
    a única regra de negócio: a data de início não pode ser no futuro.
    """
    if dados.data_ancora > date.today():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A data de início não pode ser no futuro.",
        )

    conta = Conta(
        user_id=utilizador.id,
        nome=dados.nome,
        banco=dados.banco,
        tipo=dados.tipo,
        moeda=dados.moeda,
        data_ancora=dados.data_ancora,
        # quantize garante exactamente 2 casas decimais antes de gravar.
        saldo_ancora=dados.saldo_ancora.quantize(_DUAS_CASAS),
    )
    db.add(conta)
    await db.commit()
    # Volta a ler a linha da base de dados para preencher os campos que só
    # ela sabe (created_at, updated_at).
    await db.refresh(conta)

    # Uma conta recém-criada nunca tem movimentos ainda — soma 0, sem
    # precisar de consultar a tabela de movimentos.
    return _para_saida(conta, Decimal(0))


@router.get("", response_model=list[ContaOut])
async def listar_contas(
    utilizador: User = Depends(obter_utilizador_atual),
    db: AsyncSession = Depends(get_db),
) -> list[ContaOut]:
    """Lista as contas do utilizador autenticado, por ordem alfabética do nome."""
    resultado = await db.execute(
        select(Conta).where(Conta.user_id == utilizador.id).order_by(Conta.nome)
    )
    contas = list(resultado.scalars())
    somas = await _somas_de_movimentos(db, [conta.id for conta in contas])
    return [_para_saida(conta, somas.get(conta.id, Decimal(0))) for conta in contas]


@router.get("/{conta_id}", response_model=ContaOut)
async def obter_conta(
    conta_id: uuid.UUID,
    utilizador: User = Depends(obter_utilizador_atual),
    db: AsyncSession = Depends(get_db),
) -> ContaOut:
    """Devolve uma conta do utilizador autenticado. 404 se não for sua ou não existir."""
    conta = await obter_conta_do_utilizador(db, utilizador, conta_id)
    soma = await _soma_movimentos(db, conta.id)
    return _para_saida(conta, soma)


@router.patch("/{conta_id}", response_model=ContaOut)
async def editar_conta(
    conta_id: uuid.UUID,
    dados: ContaEditar,
    utilizador: User = Depends(obter_utilizador_atual),
    db: AsyncSession = Depends(get_db),
) -> ContaOut:
    """
    Actualiza os campos descritivos de uma conta (nome, banco, tipo,
    moeda). Nunca toca na âncora.

    Mudar a moeda é recusado se a conta já tiver movimentos: estes foram
    lançados a pensar na moeda antiga, e mudar a moeda por baixo deles
    mudaria silenciosamente o que os seus valores significam.
    """
    conta = await obter_conta_do_utilizador(db, utilizador, conta_id)

    if dados.moeda != conta.moeda and await _tem_movimentos(db, conta.id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Não é possível mudar a moeda de uma conta com movimentos.",
        )

    conta.nome = dados.nome
    conta.banco = dados.banco
    conta.tipo = dados.tipo
    conta.moeda = dados.moeda

    await db.commit()
    await db.refresh(conta)

    soma = await _soma_movimentos(db, conta.id)
    return _para_saida(conta, soma)


@router.delete("/{conta_id}", status_code=status.HTTP_204_NO_CONTENT)
async def apagar_conta(
    conta_id: uuid.UUID,
    utilizador: User = Depends(obter_utilizador_atual),
    db: AsyncSession = Depends(get_db),
) -> None:
    """
    Elimina uma conta do utilizador autenticado, e com ela todos os seus
    movimentos (ver ondelete="CASCADE" em app/models/movimento.py — a
    própria base de dados apaga-os, num só comando). Sem confirmação nem
    parâmetro "forçar": a interface já pede confirmação antes de chamar
    este endpoint, e já avisa que os movimentos são apagados com a conta.
    """
    conta = await obter_conta_do_utilizador(db, utilizador, conta_id)
    await db.delete(conta)
    await db.commit()
