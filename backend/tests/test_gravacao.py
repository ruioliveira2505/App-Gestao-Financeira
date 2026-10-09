"""
TESTES DE QUE CADA ROTA GRAVA DE FACTO (FAZ COMMIT)
======================================================

Nesta aplicação, os serviços (o código com as regras de negócio) nunca
tornam as alterações definitivas: enviam-nas à base de dados com flush(),
dentro da transação em curso, e é a ROTA que faz o commit (torna tudo
definitivo), uma vez, no fim do pedido. Uma rota que se esqueça do commit
não grava nada — e os outros testes não o detetam.

PORQUÊ OS OUTROS TESTES NÃO O DETETAM. Cada teste corre dentro de uma
transação que é desfeita no fim (ver tests/conftest.py, o ficheiro de
preparação partilhado), e o teste e a rota partilham a mesma sessão de
base de dados. Uma alteração só enviada com flush continua visível ao
próprio teste, por isso um commit esquecido passaria despercebido.

A TÉCNICA: depois do pedido, o teste chama db_session.rollback(), que
desfaz só o que ainda NÃO foi confirmado (a preparação de testes trabalha
com "savepoints", pontos de gravação intermédios dentro da transação, e
um rollback volta só ao último). Se a rota fez commit, os dados
sobrevivem ao rollback; se não fez, desaparecem e o teste falha.

Os testes de Open Banking fazem o mesmo, no seu próprio ficheiro.
"""

import uuid

import pytest
from sqlalchemy import select

from app.models.categoria import Categoria
from app.models.conta import Conta
from app.models.movimento import Movimento
from app.models.user import User

CONTA = {"nome": "Gravada", "moeda": "EUR", "data_ancora": "2026-01-01", "saldo_ancora": "100"}


async def _categoria(db_session, direcao: str) -> Categoria:
    """Uma subcategoria da árvore por omissão do utilizador de teste, na direção pedida."""
    utilizador = await db_session.scalar(select(User).where(User.email == "teste@example.com"))
    return await db_session.scalar(
        select(Categoria).where(
            Categoria.user_id == utilizador.id,
            Categoria.direcao == direcao,
            Categoria.parent_id.is_not(None),
            Categoria.papel.is_(None),
        )
    )


async def _conta_e_movimento(cliente, db_session) -> tuple[str, str]:
    """Cria uma conta e um movimento de saída nela; devolve os dois ids."""
    conta_id = (await cliente.post("/contas", json=CONTA)).json()["id"]
    categoria = await _categoria(db_session, "saida")
    movimento_id = (
        await cliente.post(
            "/movimentos",
            json={
                "conta_id": conta_id,
                "categoria_id": str(categoria.id),
                "data": "2026-02-01",
                "descricao": "Café",
                "valor": "-1.50",
            },
        )
    ).json()["id"]
    return conta_id, movimento_id


# --- Contas ---


@pytest.mark.asyncio
async def test_criar_editar_e_apagar_conta_gravam(cliente_autenticado, db_session):
    conta_id = (await cliente_autenticado.post("/contas", json=CONTA)).json()["id"]
    await db_session.rollback()
    assert await db_session.get(Conta, uuid.UUID(conta_id)) is not None

    await cliente_autenticado.patch(f"/contas/{conta_id}", json={**CONTA, "nome": "Renomeada"})
    await db_session.rollback()
    conta = await db_session.get(Conta, uuid.UUID(conta_id))
    await db_session.refresh(conta)
    assert conta.nome == "Renomeada"

    await cliente_autenticado.delete(f"/contas/{conta_id}")
    await db_session.rollback()
    db_session.expunge_all()  # esquece o que a sessão guardava em memória
    assert await db_session.get(Conta, uuid.UUID(conta_id)) is None


# --- Movimentos ---


@pytest.mark.asyncio
async def test_criar_editar_e_apagar_movimento_gravam(cliente_autenticado, db_session):
    conta_id, movimento_id = await _conta_e_movimento(cliente_autenticado, db_session)
    await db_session.rollback()
    assert await db_session.get(Movimento, uuid.UUID(movimento_id)) is not None

    categoria = await _categoria(db_session, "saida")
    await cliente_autenticado.patch(
        f"/movimentos/{movimento_id}",
        json={
            "conta_id": conta_id,
            "categoria_id": str(categoria.id),
            "data": "2026-02-01",
            "descricao": "Café com bolo",
            "valor": "-3.00",
        },
    )
    await db_session.rollback()
    movimento = await db_session.get(Movimento, uuid.UUID(movimento_id))
    await db_session.refresh(movimento)
    assert movimento.descricao == "Café com bolo"

    await cliente_autenticado.delete(f"/movimentos/{movimento_id}")
    await db_session.rollback()
    db_session.expunge_all()
    assert await db_session.get(Movimento, uuid.UUID(movimento_id)) is None


@pytest.mark.asyncio
async def test_operacoes_em_lote_gravam(cliente_autenticado, db_session):
    _, movimento_id = await _conta_e_movimento(cliente_autenticado, db_session)
    outra = (
        await db_session.scalars(
            select(Categoria).where(
                Categoria.direcao == "saida",
                Categoria.parent_id.is_not(None),
                Categoria.papel.is_(None),
            )
        )
    ).all()[1]

    await cliente_autenticado.post(
        "/movimentos/recategorizar-em-lote",
        json={"ids": [movimento_id], "categoria_id": str(outra.id)},
    )
    await db_session.rollback()
    movimento = await db_session.get(Movimento, uuid.UUID(movimento_id))
    await db_session.refresh(movimento)
    assert movimento.categoria_id == outra.id

    await cliente_autenticado.post("/movimentos/eliminar-em-lote", json={"ids": [movimento_id]})
    await db_session.rollback()
    db_session.expunge_all()
    assert await db_session.get(Movimento, uuid.UUID(movimento_id)) is None


# --- Categorias ---


@pytest.mark.asyncio
async def test_criar_editar_e_eliminar_categoria_com_migracao_gravam(cliente_autenticado, db_session):
    grupo_id = (
        await cliente_autenticado.post("/categorias", json={"nome": "Viagens", "direcao": "saida"})
    ).json()["id"]
    await db_session.rollback()
    assert await db_session.get(Categoria, uuid.UUID(grupo_id)) is not None

    await cliente_autenticado.patch(f"/categorias/{grupo_id}", json={"nome": "Férias"})
    await db_session.rollback()
    grupo = await db_session.get(Categoria, uuid.UUID(grupo_id))
    await db_session.refresh(grupo)
    assert grupo.nome == "Férias"

    # Um movimento nesta categoria obriga a migrá-lo ao eliminar: a
    # migração e a eliminação gravam-se juntas.
    conta_id = (await cliente_autenticado.post("/contas", json=CONTA)).json()["id"]
    movimento_id = (
        await cliente_autenticado.post(
            "/movimentos",
            json={
                "conta_id": conta_id,
                "categoria_id": grupo_id,
                "data": "2026-02-01",
                "descricao": "Hotel",
                "valor": "-80.00",
            },
        )
    ).json()["id"]
    destino = await _categoria(db_session, "saida")

    await cliente_autenticado.delete(
        f"/categorias/{grupo_id}", params={"migrar_para_id": str(destino.id)}
    )
    await db_session.rollback()
    db_session.expunge_all()
    assert await db_session.get(Categoria, uuid.UUID(grupo_id)) is None
    assert (await db_session.get(Movimento, uuid.UUID(movimento_id))).categoria_id == destino.id
