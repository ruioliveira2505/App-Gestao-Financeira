"""
TESTES AO ENDPOINT DE LOGIN (POST /auth/login)
===================================================

Verifica o comportamento definido em app/routers/auth.py: credenciais
válidas autenticam o utilizador, criam uma sessão na base de dados e
entregam o token dessa sessão num cookie httpOnly; email inexistente e
password incorrecta são ambos recusados com 401 e a mesma mensagem
genérica, sem cookie nenhum a ser definido.

Tal como em test_auth_registo.py, o fixture "client" (definido em
conftest.py) entrega um cliente HTTP já isolado numa transacção de base de
dados revertida no fim de cada teste.
"""

import uuid

import pytest
from sqlalchemy import select

from app.models.session import UserSession


@pytest.mark.asyncio
async def test_login_com_credenciais_validas_autentica_e_define_cookie(client):
    await client.post(
        "/auth/registo",
        json={"email": "diana@example.com", "password": "palavrapasse123"},
    )

    resposta = await client.post(
        "/auth/login",
        json={"email": "diana@example.com", "password": "palavrapasse123"},
    )

    assert resposta.status_code == 200
    assert resposta.json()["email"] == "diana@example.com"
    assert "session_token" in resposta.cookies


@pytest.mark.asyncio
async def test_login_com_sucesso_cria_sessao_associada_ao_utilizador(client, db_session):
    resposta_registo = await client.post(
        "/auth/registo",
        json={"email": "filipa@example.com", "password": "palavrapasse123"},
    )
    utilizador_id = uuid.UUID(resposta_registo.json()["id"])

    await client.post(
        "/auth/login",
        json={"email": "filipa@example.com", "password": "palavrapasse123"},
    )

    # db_session é a mesma sessão usada pela rota (ver a fixture "client",
    # em conftest.py), por isso vê aqui, sem novo pedido HTTP, o que essa
    # rota gravou.
    resultado = await db_session.execute(
        select(UserSession).where(UserSession.user_id == utilizador_id)
    )
    assert resultado.scalar_one_or_none() is not None


@pytest.mark.asyncio
async def test_login_com_password_incorreta_e_recusado(client):
    await client.post(
        "/auth/registo",
        json={"email": "eduardo@example.com", "password": "palavrapasse123"},
    )

    resposta = await client.post(
        "/auth/login",
        json={"email": "eduardo@example.com", "password": "password-errada"},
    )

    assert resposta.status_code == 401
    assert "session_token" not in resposta.cookies


@pytest.mark.asyncio
async def test_login_com_email_inexistente_e_recusado(client):
    resposta = await client.post(
        "/auth/login",
        json={"email": "ninguem@example.com", "password": "qualquer-coisa"},
    )

    assert resposta.status_code == 401
    assert "session_token" not in resposta.cookies


@pytest.mark.asyncio
async def test_login_devolve_a_mesma_mensagem_para_email_e_password_invalidos(client):
    """
    Confirma, ao nível da resposta observável pela API, a decisão de não
    distinguir "email não existe" de "password incorrecta" — ver o
    comentário em login() (app/routers/auth.py) para a razão de segurança
    por trás disto.
    """
    await client.post(
        "/auth/registo",
        json={"email": "goncalo@example.com", "password": "palavrapasse123"},
    )

    resposta_password_errada = await client.post(
        "/auth/login",
        json={"email": "goncalo@example.com", "password": "password-errada"},
    )
    resposta_email_inexistente = await client.post(
        "/auth/login",
        json={"email": "ninguem@example.com", "password": "qualquer-coisa"},
    )

    assert resposta_password_errada.json()["detail"] == resposta_email_inexistente.json()["detail"]
