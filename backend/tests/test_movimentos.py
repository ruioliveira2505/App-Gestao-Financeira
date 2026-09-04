"""
TESTES AOS ENDPOINTS DE MOVIMENTOS
=====================================

Cobrem POST/GET/PATCH/DELETE /movimentos: criação (com sinal, e a regra da
data não poder ser anterior à âncora da conta), a lista global (todas as
contas do utilizador, filtrável por conta_id), obter/editar/apagar um
movimento, e o âmbito por utilizador (um movimento cuja conta não é sua é,
para todos os efeitos, inexistente — 404, nunca 403).
"""

import pytest

# Corpo mínimo válido para criar uma conta, só para os movimentos terem
# onde entrar. A data-âncora fica bem no passado para não colidir com as
# datas de movimento usadas nos testes.
CONTA_VALIDA = {
    "nome": "Conta à ordem",
    "banco": "BPI",
    "tipo": "Conta corrente",
    "moeda": "EUR",
    "data_ancora": "2026-01-01",
    "saldo_ancora": "1000.00",
}


async def _criar_conta(cliente, **overrides) -> str:
    """Cria uma conta pelo cliente autenticado e devolve o seu id."""
    resposta = await cliente.post("/contas", json={**CONTA_VALIDA, **overrides})
    return resposta.json()["id"]


def _movimento_valido(conta_id: str, **overrides) -> dict:
    """Corpo mínimo válido para criar/editar um movimento nessa conta."""
    return {
        "conta_id": conta_id,
        "data": "2026-02-10",
        "descricao": "Compras",
        "valor": "-50.00",
        **overrides,
    }


@pytest.mark.asyncio
async def test_criar_movimento_devolve_o_movimento_criado(cliente_autenticado):
    conta_id = await _criar_conta(cliente_autenticado)

    resposta = await cliente_autenticado.post(
        "/movimentos", json=_movimento_valido(conta_id, descricao="Renda", valor="-750.00")
    )

    assert resposta.status_code == 201
    corpo = resposta.json()
    assert corpo["conta_id"] == conta_id
    assert corpo["data"] == "2026-02-10"
    assert corpo["descricao"] == "Renda"
    # Valor com sinal, como texto com 2 casas decimais.
    assert corpo["valor"] == "-750.00"
    assert "id" in corpo


@pytest.mark.asyncio
async def test_criar_movimento_aceita_valor_positivo_para_uma_entrada(cliente_autenticado):
    conta_id = await _criar_conta(cliente_autenticado)

    resposta = await cliente_autenticado.post(
        "/movimentos", json=_movimento_valido(conta_id, descricao="Salário", valor="1500.5")
    )

    assert resposta.status_code == 201
    assert resposta.json()["valor"] == "1500.50"


@pytest.mark.asyncio
async def test_criar_movimento_sem_sessao_e_recusado(client):
    resposta = await client.post("/movimentos", json=_movimento_valido("00000000-0000-0000-0000-000000000000"))

    assert resposta.status_code == 401


@pytest.mark.asyncio
async def test_criar_movimento_com_conta_inexistente_devolve_404(cliente_autenticado):
    resposta = await cliente_autenticado.post(
        "/movimentos",
        json=_movimento_valido("00000000-0000-0000-0000-000000000000"),
    )

    assert resposta.status_code == 404


@pytest.mark.asyncio
async def test_criar_movimento_com_conta_de_outro_utilizador_devolve_404(client):
    # Utilizador A cria uma conta.
    a = {"email": "a@example.com", "password": "palavrapasse123"}
    await client.post("/auth/registo", json=a)
    await client.post("/auth/login", json=a)
    conta_id = await _criar_conta(client)

    # Termina a sessão do A e entra o utilizador B, que tenta lançar um
    # movimento na conta do A.
    await client.post("/auth/logout")
    b = {"email": "b@example.com", "password": "palavrapasse123"}
    await client.post("/auth/registo", json=b)
    await client.post("/auth/login", json=b)

    resposta = await client.post("/movimentos", json=_movimento_valido(conta_id))

    assert resposta.status_code == 404


@pytest.mark.asyncio
async def test_criar_movimento_com_data_anterior_a_ancora_e_recusado(cliente_autenticado):
    # A âncora de CONTA_VALIDA é 2026-01-01; um movimento em 2025 é
    # anterior ao ponto em que a app começou a acompanhar a conta.
    conta_id = await _criar_conta(cliente_autenticado)

    resposta = await cliente_autenticado.post(
        "/movimentos", json=_movimento_valido(conta_id, data="2025-12-31")
    )

    assert resposta.status_code == 400


@pytest.mark.asyncio
async def test_criar_movimento_com_data_igual_a_ancora_e_aceite(cliente_autenticado):
    conta_id = await _criar_conta(cliente_autenticado)

    resposta = await cliente_autenticado.post(
        "/movimentos", json=_movimento_valido(conta_id, data="2026-01-01")
    )

    assert resposta.status_code == 201


@pytest.mark.asyncio
async def test_criar_movimento_com_valor_zero_e_recusado(cliente_autenticado):
    conta_id = await _criar_conta(cliente_autenticado)

    resposta = await cliente_autenticado.post(
        "/movimentos", json=_movimento_valido(conta_id, valor="0")
    )

    assert resposta.status_code == 422


@pytest.mark.asyncio
async def test_criar_movimento_com_descricao_vazia_e_recusado(cliente_autenticado):
    conta_id = await _criar_conta(cliente_autenticado)

    resposta = await cliente_autenticado.post(
        "/movimentos", json=_movimento_valido(conta_id, descricao="   ")
    )

    assert resposta.status_code == 422


@pytest.mark.asyncio
async def test_listar_movimentos_e_global_por_data_mais_recente_primeiro(cliente_autenticado):
    conta_a = await _criar_conta(cliente_autenticado, nome="Conta A")
    conta_b = await _criar_conta(cliente_autenticado, nome="Conta B")

    await cliente_autenticado.post(
        "/movimentos", json=_movimento_valido(conta_a, data="2026-02-01", descricao="Mais antigo")
    )
    await cliente_autenticado.post(
        "/movimentos", json=_movimento_valido(conta_b, data="2026-02-15", descricao="Mais recente")
    )

    resposta = await cliente_autenticado.get("/movimentos")

    assert resposta.status_code == 200
    descricoes = [m["descricao"] for m in resposta.json()]
    assert descricoes == ["Mais recente", "Mais antigo"]


@pytest.mark.asyncio
async def test_listar_movimentos_filtra_por_conta(cliente_autenticado):
    conta_a = await _criar_conta(cliente_autenticado, nome="Conta A")
    conta_b = await _criar_conta(cliente_autenticado, nome="Conta B")
    await cliente_autenticado.post("/movimentos", json=_movimento_valido(conta_a, descricao="Da A"))
    await cliente_autenticado.post("/movimentos", json=_movimento_valido(conta_b, descricao="Da B"))

    resposta = await cliente_autenticado.get("/movimentos", params={"conta_id": conta_a})

    assert resposta.status_code == 200
    corpo = resposta.json()
    assert len(corpo) == 1
    assert corpo[0]["descricao"] == "Da A"


@pytest.mark.asyncio
async def test_listar_movimentos_com_conta_de_outro_utilizador_devolve_404(client):
    a = {"email": "a@example.com", "password": "palavrapasse123"}
    await client.post("/auth/registo", json=a)
    await client.post("/auth/login", json=a)
    conta_id = await _criar_conta(client)

    await client.post("/auth/logout")
    b = {"email": "b@example.com", "password": "palavrapasse123"}
    await client.post("/auth/registo", json=b)
    await client.post("/auth/login", json=b)

    resposta = await client.get("/movimentos", params={"conta_id": conta_id})

    assert resposta.status_code == 404


@pytest.mark.asyncio
async def test_listar_movimentos_nao_mostra_movimentos_de_outro_utilizador(client):
    a = {"email": "a@example.com", "password": "palavrapasse123"}
    await client.post("/auth/registo", json=a)
    await client.post("/auth/login", json=a)
    conta_a = await _criar_conta(client)
    await client.post("/movimentos", json=_movimento_valido(conta_a, descricao="Do A"))

    await client.post("/auth/logout")
    b = {"email": "b@example.com", "password": "palavrapasse123"}
    await client.post("/auth/registo", json=b)
    await client.post("/auth/login", json=b)

    resposta = await client.get("/movimentos")

    assert resposta.status_code == 200
    assert resposta.json() == []


@pytest.mark.asyncio
async def test_obter_movimento_devolve_o_movimento(cliente_autenticado):
    conta_id = await _criar_conta(cliente_autenticado)
    criado = await cliente_autenticado.post("/movimentos", json=_movimento_valido(conta_id))
    movimento_id = criado.json()["id"]

    resposta = await cliente_autenticado.get(f"/movimentos/{movimento_id}")

    assert resposta.status_code == 200
    assert resposta.json()["id"] == movimento_id


@pytest.mark.asyncio
async def test_obter_movimento_inexistente_devolve_404(cliente_autenticado):
    resposta = await cliente_autenticado.get(
        "/movimentos/00000000-0000-0000-0000-000000000000"
    )

    assert resposta.status_code == 404


@pytest.mark.asyncio
async def test_editar_movimento_altera_os_campos(cliente_autenticado):
    conta_id = await _criar_conta(cliente_autenticado)
    criado = await cliente_autenticado.post("/movimentos", json=_movimento_valido(conta_id))
    movimento_id = criado.json()["id"]

    resposta = await cliente_autenticado.patch(
        f"/movimentos/{movimento_id}",
        json=_movimento_valido(conta_id, descricao="Compras (corrigido)", valor="-60.00"),
    )

    assert resposta.status_code == 200
    corpo = resposta.json()
    assert corpo["descricao"] == "Compras (corrigido)"
    assert corpo["valor"] == "-60.00"


@pytest.mark.asyncio
async def test_editar_movimento_pode_move_lo_para_outra_conta(cliente_autenticado):
    conta_a = await _criar_conta(cliente_autenticado, nome="Conta A")
    conta_b = await _criar_conta(cliente_autenticado, nome="Conta B")
    criado = await cliente_autenticado.post("/movimentos", json=_movimento_valido(conta_a))
    movimento_id = criado.json()["id"]

    resposta = await cliente_autenticado.patch(
        f"/movimentos/{movimento_id}", json=_movimento_valido(conta_b)
    )

    assert resposta.status_code == 200
    assert resposta.json()["conta_id"] == conta_b


@pytest.mark.asyncio
async def test_editar_movimento_para_conta_de_outro_utilizador_devolve_404(client):
    a = {"email": "a@example.com", "password": "palavrapasse123"}
    await client.post("/auth/registo", json=a)
    await client.post("/auth/login", json=a)
    conta_a = await _criar_conta(client)
    criado = await client.post("/movimentos", json=_movimento_valido(conta_a))
    movimento_id = criado.json()["id"]

    await client.post("/auth/logout")
    b = {"email": "b@example.com", "password": "palavrapasse123"}
    await client.post("/auth/registo", json=b)
    await client.post("/auth/login", json=b)
    conta_b = await _criar_conta(client)

    # De volta ao utilizador A, tenta mover o SEU movimento para a conta
    # do B — que não é sua.
    await client.post("/auth/logout")
    await client.post("/auth/login", json=a)
    resposta = await client.patch(
        f"/movimentos/{movimento_id}", json=_movimento_valido(conta_b)
    )

    assert resposta.status_code == 404


@pytest.mark.asyncio
async def test_apagar_movimento_remove_o_movimento(cliente_autenticado):
    conta_id = await _criar_conta(cliente_autenticado)
    criado = await cliente_autenticado.post("/movimentos", json=_movimento_valido(conta_id))
    movimento_id = criado.json()["id"]

    resposta = await cliente_autenticado.delete(f"/movimentos/{movimento_id}")
    assert resposta.status_code == 204

    resposta = await cliente_autenticado.get(f"/movimentos/{movimento_id}")
    assert resposta.status_code == 404


@pytest.mark.asyncio
async def test_apagar_movimento_de_outro_utilizador_devolve_404(client):
    a = {"email": "a@example.com", "password": "palavrapasse123"}
    await client.post("/auth/registo", json=a)
    await client.post("/auth/login", json=a)
    conta_id = await _criar_conta(client)
    criado = await client.post("/movimentos", json=_movimento_valido(conta_id))
    movimento_id = criado.json()["id"]

    await client.post("/auth/logout")
    b = {"email": "b@example.com", "password": "palavrapasse123"}
    await client.post("/auth/registo", json=b)
    await client.post("/auth/login", json=b)

    resposta = await client.delete(f"/movimentos/{movimento_id}")

    assert resposta.status_code == 404
