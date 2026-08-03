"""
TESTES AO ENDPOINT DE LOGOUT (POST /auth/logout)
=====================================================

Verifica o comportamento definido em app/routers/auth.py: um logout válido
apaga a sessão na base de dados e remove o cookie do browser; um logout
sem sessão activa (sem cookie, ou com uma sessão já inexistente) continua
a devolver sucesso, sem erro — ver o comentário na própria rota para a
razão desta tolerância.

O cliente HTTP (fixture "client", definido em conftest.py) guarda os
cookies recebidos entre pedidos, tal como um browser — por isso, depois de
um login, os pedidos seguintes deste mesmo cliente já incluem
automaticamente o cookie de sessão, sem ser preciso reenviá-lo à mão.
"""

import pytest
from sqlalchemy import select

from app.core.sessions import hash_token
from app.models.session import UserSession


@pytest.mark.asyncio
async def test_logout_apaga_sessao_e_cookie(client, db_session):
    await client.post(
        "/auth/registo",
        json={"email": "helena@example.com", "password": "palavrapasse123"},
    )
    await client.post(
        "/auth/login",
        json={"email": "helena@example.com", "password": "palavrapasse123"},
    )
    token = client.cookies.get("session_token")
    assert token is not None

    resposta = await client.post("/auth/logout")

    assert resposta.status_code == 204
    assert client.cookies.get("session_token") is None

    resultado = await db_session.execute(
        select(UserSession).where(UserSession.token_hash == hash_token(token))
    )
    assert resultado.scalar_one_or_none() is None


@pytest.mark.asyncio
async def test_logout_sem_sessao_activa_nao_falha(client):
    # Nenhum registo nem login antes deste pedido — não há cookie nenhum a
    # enviar. O logout continua, mesmo assim, a devolver sucesso.
    resposta = await client.post("/auth/logout")

    assert resposta.status_code == 204


@pytest.mark.asyncio
async def test_apos_logout_a_sessao_deixa_de_autenticar(client):
    await client.post(
        "/auth/registo",
        json={"email": "ines@example.com", "password": "palavrapasse123"},
    )
    await client.post(
        "/auth/login",
        json={"email": "ines@example.com", "password": "palavrapasse123"},
    )

    await client.post("/auth/logout")

    resposta = await client.get("/auth/me")

    assert resposta.status_code == 401
