"""
TESTES ÀS PREFERÊNCIAS DO UTILIZADOR (PATCH /auth/me)
=========================================================

Cobre a moeda principal (ver UserPreferencias, em app/schemas/auth.py):
o valor por omissão de um utilizador novo, a mudança bem-sucedida, a
exigência de sessão, e a rejeição de uma moeda fora do conjunto suportado
(app/core/moedas.py).
"""

import pytest


async def _registar_e_autenticar(client, email: str) -> None:
    await client.post("/auth/registo", json={"email": email, "password": "palavrapasse123"})
    await client.post("/auth/login", json={"email": email, "password": "palavrapasse123"})


@pytest.mark.asyncio
async def test_registo_devolve_moeda_principal_eur_por_omissao(client):
    resposta = await client.post(
        "/auth/registo",
        json={"email": "nova@example.com", "password": "palavrapasse123"},
    )

    assert resposta.json()["moeda_principal"] == "EUR"


@pytest.mark.asyncio
async def test_mudar_preferencias_sem_sessao_e_recusado(client):
    resposta = await client.patch("/auth/me", json={"moeda_principal": "USD"})

    assert resposta.status_code == 401


@pytest.mark.asyncio
async def test_mudar_preferencias_muda_a_moeda_principal(client):
    await _registar_e_autenticar(client, "maria@example.com")

    resposta = await client.patch("/auth/me", json={"moeda_principal": "usd"})

    assert resposta.status_code == 200
    # Normalizada para maiúsculas (ver moeda_suportada, em
    # app/core/moedas.py), tal como a moeda de uma conta.
    assert resposta.json()["moeda_principal"] == "USD"


@pytest.mark.asyncio
async def test_mudar_preferencias_fica_guardada_para_pedidos_seguintes(client):
    await _registar_e_autenticar(client, "pedro@example.com")
    await client.patch("/auth/me", json={"moeda_principal": "GBP"})

    resposta = await client.get("/auth/me")

    assert resposta.json()["moeda_principal"] == "GBP"


@pytest.mark.asyncio
async def test_mudar_preferencias_com_moeda_nao_suportada_devolve_422(client):
    await _registar_e_autenticar(client, "ines@example.com")

    resposta = await client.patch("/auth/me", json={"moeda_principal": "JPY"})

    assert resposta.status_code == 422
