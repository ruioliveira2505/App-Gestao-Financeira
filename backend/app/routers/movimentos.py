"""
ROTAS DE MOVIMENTOS
======================

Endpoints para gerir os movimentos (entradas e saídas de dinheiro) das
contas do utilizador autenticado. Cada rota exige autenticação (via
obter_utilizador_atual, app/core/deps.py) e trabalha sempre no âmbito do
utilizador do pedido — um movimento cuja conta não é do utilizador é, para
todos os efeitos, inexistente (a mesma regra já aplicada às contas, ver
app/services/contas.py).

Não há aqui um "/contas/{id}/movimentos" aninhado: a lista principal
(GET /movimentos) é GLOBAL — todos os movimentos, de todas as contas do
utilizador —, com "conta_id" como parâmetro de query opcional para
filtrar para uma só. "Movimentos" é uma secção de topo da aplicação (ao
lado de "Contas"), não algo pendurado dentro de uma conta.
"""

import uuid
from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import obter_utilizador_atual
from app.db.session import get_db
from app.models.conta import Conta
from app.models.movimento import Movimento
from app.models.user import User
from app.schemas.movimentos import MovimentoCriar, MovimentoEditar, MovimentoOut
from app.services.contas import obter_conta_do_utilizador

router = APIRouter(prefix="/movimentos", tags=["movimentos"])

# Usado para arredondar/normalizar os valores monetários a 2 casas
# decimais, coerente com a coluna Numeric(14, 2) — a mesma constante que
# app/routers/contas.py define para o mesmo fim.
_DUAS_CASAS = Decimal("0.01")


async def _obter_movimento_do_utilizador(
    db: AsyncSession, utilizador: User, movimento_id: uuid.UUID
) -> Movimento:
    """
    Devolve o movimento com este id, se a sua conta pertencer ao
    utilizador. 404 nos dois casos que se juntam num só (não existe, ou
    não é do utilizador) — pela mesma razão de
    app/services/contas.py:obter_conta_do_utilizador: a resposta não deve
    revelar qual dos dois motivos se aplica.

    Um único JOIN (Movimento → Conta), em vez de duas consultas
    separadas (uma ao movimento, outra à conta), porque é a mesma
    informação — "este movimento é meu?" — numa só pergunta à base de
    dados.
    """
    resultado = await db.execute(
        select(Movimento)
        .join(Conta, Movimento.conta_id == Conta.id)
        .where(Movimento.id == movimento_id, Conta.user_id == utilizador.id)
    )
    movimento = resultado.scalar_one_or_none()
    if movimento is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Movimento não encontrado."
        )
    return movimento


def _validar_data(data_movimento: date, conta: Conta) -> None:
    """
    A data de um movimento nunca pode ser anterior à data-âncora da sua
    conta (app/models/conta.py): a âncora é o ponto a partir do qual a
    aplicação começa a acompanhar essa conta — um movimento mais antigo
    não tem onde entrar no cálculo do saldo.
    """
    if data_movimento < conta.data_ancora:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A data do movimento não pode ser anterior à data de início da conta.",
        )


def _para_saida(movimento: Movimento) -> MovimentoOut:
    """Converte uma linha da tabela "movimentos" na forma devolvida pela API."""
    return MovimentoOut(
        id=movimento.id,
        conta_id=movimento.conta_id,
        data=movimento.data,
        descricao=movimento.descricao,
        valor=f"{movimento.valor:.2f}",
        created_at=movimento.created_at,
        updated_at=movimento.updated_at,
    )


@router.post("", response_model=MovimentoOut, status_code=status.HTTP_201_CREATED)
async def criar_movimento(
    dados: MovimentoCriar,
    utilizador: User = Depends(obter_utilizador_atual),
    db: AsyncSession = Depends(get_db),
) -> MovimentoOut:
    """
    Cria um movimento numa conta do utilizador autenticado.

    O corpo do pedido já chega validado pelo schema MovimentoCriar
    (descrição não vazia, valor diferente de 0). Fica a cargo desta rota
    confirmar que a conta é do utilizador (404 caso contrário) e a única
    regra de negócio própria: a data não pode ser anterior à âncora da
    conta (ver _validar_data).
    """
    conta = await obter_conta_do_utilizador(db, utilizador, dados.conta_id)
    _validar_data(dados.data, conta)

    movimento = Movimento(
        conta_id=conta.id,
        data=dados.data,
        descricao=dados.descricao,
        valor=dados.valor.quantize(_DUAS_CASAS),
    )
    db.add(movimento)
    await db.commit()
    await db.refresh(movimento)

    return _para_saida(movimento)


@router.get("", response_model=list[MovimentoOut])
async def listar_movimentos(
    conta_id: uuid.UUID | None = None,
    utilizador: User = Depends(obter_utilizador_atual),
    db: AsyncSession = Depends(get_db),
) -> list[MovimentoOut]:
    """
    Lista os movimentos do utilizador autenticado (de todas as suas
    contas), por data mais recente primeiro — e, a desempatar (vários
    movimentos no mesmo dia), o criado mais recentemente.

    "conta_id", se indicado, filtra para uma única conta — que também tem
    de pertencer ao utilizador (404 caso contrário, antes de sequer se
    tentar listar).
    """
    query = (
        select(Movimento)
        .join(Conta, Movimento.conta_id == Conta.id)
        .where(Conta.user_id == utilizador.id)
        .order_by(Movimento.data.desc(), Movimento.created_at.desc())
    )

    if conta_id is not None:
        await obter_conta_do_utilizador(db, utilizador, conta_id)
        query = query.where(Movimento.conta_id == conta_id)

    resultado = await db.execute(query)
    return [_para_saida(movimento) for movimento in resultado.scalars()]


@router.get("/{movimento_id}", response_model=MovimentoOut)
async def obter_movimento(
    movimento_id: uuid.UUID,
    utilizador: User = Depends(obter_utilizador_atual),
    db: AsyncSession = Depends(get_db),
) -> MovimentoOut:
    """Devolve um movimento do utilizador autenticado. 404 se não for seu ou não existir."""
    movimento = await _obter_movimento_do_utilizador(db, utilizador, movimento_id)
    return _para_saida(movimento)


@router.patch("/{movimento_id}", response_model=MovimentoOut)
async def editar_movimento(
    movimento_id: uuid.UUID,
    dados: MovimentoEditar,
    utilizador: User = Depends(obter_utilizador_atual),
    db: AsyncSession = Depends(get_db),
) -> MovimentoOut:
    """
    Actualiza um movimento por completo — incluindo, se for o caso, a
    conta a que pertence ("mover" o movimento para outra conta). A conta
    de destino (dados.conta_id) tem também de pertencer ao utilizador.
    """
    movimento = await _obter_movimento_do_utilizador(db, utilizador, movimento_id)
    conta = await obter_conta_do_utilizador(db, utilizador, dados.conta_id)
    _validar_data(dados.data, conta)

    movimento.conta_id = conta.id
    movimento.data = dados.data
    movimento.descricao = dados.descricao
    movimento.valor = dados.valor.quantize(_DUAS_CASAS)

    await db.commit()
    await db.refresh(movimento)

    return _para_saida(movimento)


@router.delete("/{movimento_id}", status_code=status.HTTP_204_NO_CONTENT)
async def apagar_movimento(
    movimento_id: uuid.UUID,
    utilizador: User = Depends(obter_utilizador_atual),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Elimina um movimento do utilizador autenticado. Directa, sem confirmação — um único registo."""
    movimento = await _obter_movimento_do_utilizador(db, utilizador, movimento_id)
    await db.delete(movimento)
    await db.commit()
