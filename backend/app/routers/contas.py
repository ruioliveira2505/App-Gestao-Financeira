"""
ROTAS DE CONTAS
================

Endpoints para gerir as contas do utilizador autenticado. Nesta fase:
criar e listar. Cada rota exige autenticação (via obter_utilizador_atual,
app/core/deps.py) e trabalha sempre no âmbito do utilizador do pedido —
uma conta de outro utilizador é, para todos os efeitos, inexistente.
"""

import uuid
from datetime import date
from decimal import Decimal

# APIRouter agrupa rotas relacionadas; Depends injecta dependências
# (utilizador autenticado, sessão de base de dados); HTTPException
# interrompe um pedido com um erro HTTP; status fornece os códigos como
# constantes com nome.
from fastapi import APIRouter, Depends, HTTPException, status

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import obter_utilizador_atual
from app.db.session import get_db
from app.models.conta import Conta
from app.models.user import User
from app.schemas.contas import ContaCriar, ContaEditar, ContaOut

# prefix="/contas": todas as rotas aqui ficam sob "/contas". tags=["contas"]
# agrupa-as com esse nome na documentação automática do FastAPI.
router = APIRouter(prefix="/contas", tags=["contas"])

# Usado para arredondar/normalizar os valores monetários a 2 casas
# decimais, coerente com a coluna Numeric(14, 2).
_DUAS_CASAS = Decimal("0.01")


async def _obter_conta_do_utilizador(
    db: AsyncSession, utilizador: User, conta_id: uuid.UUID
) -> Conta:
    """
    Devolve a conta com este id, se pertencer ao utilizador. Caso
    contrário — não existe, ou é de outro utilizador — levanta 404, nunca
    403: para este utilizador, uma conta que não é sua é, para todos os
    efeitos, inexistente, e a resposta não deve sequer revelar que o id
    corresponde a alguma conta.
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


def _para_saida(conta: Conta) -> ContaOut:
    """
    Converte uma linha da tabela "contas" na forma devolvida pela API.

    É aqui que os valores decimais passam a texto e que o "saldo actual" é
    determinado. Sem movimentos, esse saldo é simplesmente o saldo da
    âncora; quando os movimentos existirem, esta função passará a somar-lhes
    o total.
    """
    saldo_ancora_texto = f"{conta.saldo_ancora:.2f}"
    return ContaOut(
        id=conta.id,
        nome=conta.nome,
        banco=conta.banco,
        tipo=conta.tipo,
        moeda=conta.moeda,
        data_ancora=conta.data_ancora,
        saldo_ancora=saldo_ancora_texto,
        saldo=saldo_ancora_texto,
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

    return _para_saida(conta)


@router.get("", response_model=list[ContaOut])
async def listar_contas(
    utilizador: User = Depends(obter_utilizador_atual),
    db: AsyncSession = Depends(get_db),
) -> list[ContaOut]:
    """Lista as contas do utilizador autenticado, por ordem alfabética do nome."""
    resultado = await db.execute(
        select(Conta).where(Conta.user_id == utilizador.id).order_by(Conta.nome)
    )
    return [_para_saida(conta) for conta in resultado.scalars()]


@router.get("/{conta_id}", response_model=ContaOut)
async def obter_conta(
    conta_id: uuid.UUID,
    utilizador: User = Depends(obter_utilizador_atual),
    db: AsyncSession = Depends(get_db),
) -> ContaOut:
    """Devolve uma conta do utilizador autenticado. 404 se não for sua ou não existir."""
    conta = await _obter_conta_do_utilizador(db, utilizador, conta_id)
    return _para_saida(conta)


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

    (Quando os movimentos existirem, mudar a moeda de uma conta que já
    tenha movimentos deixará de ser permitido — a nota fica aqui.)
    """
    conta = await _obter_conta_do_utilizador(db, utilizador, conta_id)

    conta.nome = dados.nome
    conta.banco = dados.banco
    conta.tipo = dados.tipo
    conta.moeda = dados.moeda

    await db.commit()
    await db.refresh(conta)

    return _para_saida(conta)


@router.delete("/{conta_id}", status_code=status.HTTP_204_NO_CONTENT)
async def apagar_conta(
    conta_id: uuid.UUID,
    utilizador: User = Depends(obter_utilizador_atual),
    db: AsyncSession = Depends(get_db),
) -> None:
    """
    Elimina uma conta do utilizador autenticado.

    (Quando os movimentos existirem, apagar uma conta com movimentos
    passará a exigir uma confirmação explícita — hoje não há movimentos,
    por isso a eliminação é directa.)
    """
    conta = await _obter_conta_do_utilizador(db, utilizador, conta_id)
    await db.delete(conta)
    await db.commit()
