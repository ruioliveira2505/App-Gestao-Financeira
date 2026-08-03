"""
TESTES AO ENDPOINT DE REGISTO (POST /auth/registo)
======================================================

Verifica o comportamento definido em app/routers/auth.py: um registo
válido cria o utilizador e nunca devolve o password_hash; um email já
registado é recusado com 409; uma password demasiado curta é recusada
com 422, antes mesmo de o código da rota correr (validação do Pydantic,
definida em app/schemas/auth.py).

O fixture "client" (definido em conftest.py) entrega um cliente HTTP
ligado à aplicação em memória, já a trabalhar dentro de uma transacção de
base de dados isolada e revertida no fim de cada teste — por isso não é
preciso, aqui, limpar manualmente o que cada teste cria.
"""

import pytest


@pytest.mark.asyncio
async def test_registo_com_dados_validos_cria_utilizador(client):
    resposta = await client.post(
        "/auth/registo",
        json={"email": "ana@example.com", "password": "palavrapasse123"},
    )

    assert resposta.status_code == 201

    corpo = resposta.json()
    # A resposta identifica o utilizador criado (id, email) mas nunca inclui
    # password_hash — é o schema UserPublico, usado como response_model na
    # rota, que garante isto mesmo que a rota devolvesse o objecto User
    # completo, como de facto devolve.
    assert corpo["email"] == "ana@example.com"
    assert "id" in corpo
    assert "password_hash" not in corpo
    assert "password" not in corpo


@pytest.mark.asyncio
async def test_registo_com_email_ja_existente_e_recusado(client):
    dados = {"email": "bruno@example.com", "password": "palavrapasse123"}

    primeira_resposta = await client.post("/auth/registo", json=dados)
    assert primeira_resposta.status_code == 201

    # Mesmo email, mesma password — a única coisa a testar aqui é se o
    # segundo registo é recusado por o email já existir, não a password.
    segunda_resposta = await client.post("/auth/registo", json=dados)
    assert segunda_resposta.status_code == 409


@pytest.mark.asyncio
async def test_registo_com_password_curta_e_recusado(client):
    resposta = await client.post(
        "/auth/registo",
        # Password com 7 caracteres — um a menos que o mínimo de 8 exigido
        # por Field(min_length=8) em UserRegisto (app/schemas/auth.py).
        json={"email": "carla@example.com", "password": "curta12"},
    )

    # 422 (Unprocessable Entity) é o código que o FastAPI devolve quando o
    # corpo do pedido não cumpre o schema esperado — a rota de registo nem
    # chega a correr neste caso.
    assert resposta.status_code == 422
