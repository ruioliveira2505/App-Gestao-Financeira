"""
TESTES À ROTA "QUEM SOU EU" (GET /auth/me)
===============================================

Verifica o comportamento de obter_utilizador_atual (app/core/deps.py),
usado por esta rota: um pedido sem sessão válida é recusado com 401; um
pedido com uma sessão válida devolve os dados do utilizador autenticado e
renova a expiração dessa sessão (a expiração deslizante decidida para as
sessões — ver app/core/sessions.py).
"""

import pytest
from sqlalchemy import select

from app.core.sessions import hash_token
from app.models.session import UserSession


@pytest.mark.asyncio
async def test_me_sem_sessao_e_recusado(client):
    resposta = await client.get("/auth/me")

    assert resposta.status_code == 401


@pytest.mark.asyncio
async def test_me_com_sessao_valida_devolve_o_utilizador(client):
    await client.post(
        "/auth/registo",
        json={"email": "joao@example.com", "password": "palavrapasse123"},
    )
    await client.post(
        "/auth/login",
        json={"email": "joao@example.com", "password": "palavrapasse123"},
    )

    resposta = await client.get("/auth/me")

    assert resposta.status_code == 200
    assert resposta.json()["email"] == "joao@example.com"


@pytest.mark.asyncio
async def test_me_renova_a_expiracao_da_sessao(client, db_session):
    await client.post(
        "/auth/registo",
        json={"email": "leonor@example.com", "password": "palavrapasse123"},
    )
    await client.post(
        "/auth/login",
        json={"email": "leonor@example.com", "password": "palavrapasse123"},
    )
    token = client.cookies.get("session_token")

    async def expiracao_actual():
        resultado = await db_session.execute(
            select(UserSession).where(UserSession.token_hash == hash_token(token))
        )
        return resultado.scalar_one().expires_at

    expiracao_apos_login = await expiracao_actual()

    await client.get("/auth/me")

    expiracao_apos_me = await expiracao_actual()

    assert expiracao_apos_me > expiracao_apos_login
