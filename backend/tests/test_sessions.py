"""
TESTES A apagar_sessoes_expiradas (app/services/sessions.py)
=================================================================

Cobre a função que o script de limpeza (scripts/limpar_sessoes.py) chama:
apaga só as sessões cujo prazo já passou, e deixa intocadas as que ainda
são válidas.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.models.session import UserSession
from app.services.sessions import apagar_sessoes_expiradas


@pytest.mark.asyncio
async def test_apagar_sessoes_expiradas_remove_so_as_que_ja_passaram(client, db_session):
    resposta_registo = await client.post(
        "/auth/registo",
        json={"email": "eu@example.com", "password": "palavrapasse123"},
    )
    utilizador_id = uuid.UUID(resposta_registo.json()["id"])

    # O login (abaixo) cria uma sessão válida. Acrescenta-se aqui, à mão,
    # uma segunda — já expirada —, a simular uma sessão esquecida (o
    # cenário que apagar_sessoes_expiradas existe para limpar).
    await client.post(
        "/auth/login",
        json={"email": "eu@example.com", "password": "palavrapasse123"},
    )
    sessao_expirada = UserSession(
        token_hash="hash-de-teste-ja-nao-vale-nada",
        user_id=utilizador_id,
        expires_at=datetime.now(timezone.utc) - timedelta(minutes=1),
    )
    db_session.add(sessao_expirada)
    await db_session.commit()

    apagadas = await apagar_sessoes_expiradas(db_session)

    assert apagadas == 1
    resultado = await db_session.execute(
        select(UserSession).where(UserSession.user_id == utilizador_id)
    )
    restantes = resultado.scalars().all()
    assert len(restantes) == 1
    # A que sobrou é a válida (a do login), não a que foi criada já expirada.
    assert restantes[0].expires_at > datetime.now(timezone.utc)


@pytest.mark.asyncio
async def test_apagar_sessoes_expiradas_sem_nenhuma_devolve_zero(db_session):
    assert await apagar_sessoes_expiradas(db_session) == 0
