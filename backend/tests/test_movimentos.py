"""
TESTES AOS ENDPOINTS DE MOVIMENTOS
=====================================

Cobrem POST/GET/PATCH/DELETE /movimentos: criação (com sinal, a regra da
data não poder ser anterior à âncora da conta, e a regra da categoria
escolhida ter de existir, ser do utilizador e ter a direcao coerente com o
sinal do valor), a lista global (todas as contas do utilizador, filtrável
por conta_id), obter/editar/apagar um movimento, e o âmbito por utilizador
(um movimento cuja conta não é sua é, para todos os efeitos, inexistente —
404, nunca 403).
"""

import pytest
from sqlalchemy import select

from app.models.categoria import Categoria
from app.models.user import User

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

# Um id sintacticamente válido, mas que não corresponde a nenhuma
# categoria real. Serve só nos testes em que o pedido tem de falhar por
# outra razão (autenticação, conta inexistente, data inválida) ANTES de a
# rota sequer chegar a validar a categoria — nesses casos não vale a pena
# ir buscar um id real à base de dados.
_CATEGORIA_QUALQUER = "00000000-0000-0000-0000-000000000000"


async def _criar_conta(cliente, **overrides) -> str:
    """Cria uma conta pelo cliente autenticado e devolve o seu id."""
    resposta = await cliente.post("/contas", json={**CONTA_VALIDA, **overrides})
    return resposta.json()["id"]


async def _categoria_id(db_session, email: str, direcao: str) -> str:
    """
    Devolve o id de uma subcategoria qualquer, com esta direcao, da árvore
    semeada automaticamente no registo deste utilizador (ver
    app/services/categorias_seed.py, chamada a partir do registo em
    app/routers/auth.py). Estes testes não testam categorias em si — só
    precisam de um id real, coerente com o sinal do valor do movimento a
    criar; qual das subcategorias dessa direcao calha não interessa aqui.

    Vai directamente à base de dados (db_session), em vez de passar por um
    endpoint de categorias — este ficheiro é sobre movimentos, e a API de
    categorias ainda não existe.
    """
    utilizador = await db_session.scalar(select(User).where(User.email == email))
    categoria = await db_session.scalar(
        select(Categoria).where(
            Categoria.user_id == utilizador.id,
            Categoria.direcao == direcao,
            Categoria.parent_id.is_not(None),
        )
    )
    return str(categoria.id)


def _movimento_valido(conta_id: str, **overrides) -> dict:
    """Corpo mínimo válido para criar/editar um movimento nessa conta —
    por omissão, uma saída; ver _CATEGORIA_QUALQUER quanto à categoria."""
    return {
        "conta_id": conta_id,
        "categoria_id": _CATEGORIA_QUALQUER,
        "data": "2026-02-10",
        "descricao": "Compras",
        "valor": "-50.00",
        **overrides,
    }


@pytest.mark.asyncio
async def test_criar_movimento_devolve_o_movimento_criado(cliente_autenticado, db_session):
    conta_id = await _criar_conta(cliente_autenticado)
    categoria_id = await _categoria_id(db_session, "teste@example.com", "saida")

    resposta = await cliente_autenticado.post(
        "/movimentos",
        json=_movimento_valido(conta_id, categoria_id=categoria_id, descricao="Renda", valor="-750.00"),
    )

    assert resposta.status_code == 201
    corpo = resposta.json()
    assert corpo["conta_id"] == conta_id
    assert corpo["categoria_id"] == categoria_id
    assert corpo["data"] == "2026-02-10"
    assert corpo["descricao"] == "Renda"
    # Valor com sinal, como texto com 2 casas decimais.
    assert corpo["valor"] == "-750.00"
    assert "id" in corpo


@pytest.mark.asyncio
async def test_criar_movimento_aceita_valor_positivo_para_uma_entrada(cliente_autenticado, db_session):
    conta_id = await _criar_conta(cliente_autenticado)
    categoria_id = await _categoria_id(db_session, "teste@example.com", "entrada")

    resposta = await cliente_autenticado.post(
        "/movimentos",
        json=_movimento_valido(conta_id, categoria_id=categoria_id, descricao="Salário", valor="1500.5"),
    )

    assert resposta.status_code == 201
    assert resposta.json()["valor"] == "1500.50"


@pytest.mark.asyncio
async def test_criar_movimento_com_categoria_da_direcao_errada_e_recusado(cliente_autenticado, db_session):
    # Um valor positivo (entrada) com uma categoria de saída é uma
    # incoerência que a rota tem de recusar (ver _validar_direcao).
    conta_id = await _criar_conta(cliente_autenticado)
    categoria_saida_id = await _categoria_id(db_session, "teste@example.com", "saida")

    resposta = await cliente_autenticado.post(
        "/movimentos",
        json=_movimento_valido(conta_id, categoria_id=categoria_saida_id, valor="100.00"),
    )

    assert resposta.status_code == 400


@pytest.mark.asyncio
async def test_criar_movimento_com_categoria_de_outro_utilizador_devolve_404(client):
    a = {"email": "a@example.com", "password": "palavrapasse123"}
    await client.post("/auth/registo", json=a)
    await client.post("/auth/login", json=a)
    conta_id = await _criar_conta(client)

    await client.post("/auth/logout")
    b = {"email": "b@example.com", "password": "palavrapasse123"}
    await client.post("/auth/registo", json=b)
    await client.post("/auth/login", json=b)

    # De volta ao utilizador A, com uma conta sua, mas tentando uma
    # categoria que nunca lhe pertenceu (o id de "outro utilizador" nem
    # sequer é preciso arranjar — qualquer id de categoria inexistente
    # para este utilizador já chega, e _CATEGORIA_QUALQUER serve).
    await client.post("/auth/logout")
    await client.post("/auth/login", json=a)
    resposta = await client.post("/movimentos", json=_movimento_valido(conta_id))

    assert resposta.status_code == 404


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
async def test_criar_movimento_com_data_igual_a_ancora_e_aceite(cliente_autenticado, db_session):
    conta_id = await _criar_conta(cliente_autenticado)
    categoria_id = await _categoria_id(db_session, "teste@example.com", "saida")

    resposta = await cliente_autenticado.post(
        "/movimentos",
        json=_movimento_valido(conta_id, categoria_id=categoria_id, data="2026-01-01"),
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
async def test_listar_movimentos_e_global_por_data_mais_recente_primeiro(cliente_autenticado, db_session):
    conta_a = await _criar_conta(cliente_autenticado, nome="Conta A")
    conta_b = await _criar_conta(cliente_autenticado, nome="Conta B")
    categoria_id = await _categoria_id(db_session, "teste@example.com", "saida")

    await cliente_autenticado.post(
        "/movimentos",
        json=_movimento_valido(conta_a, categoria_id=categoria_id, data="2026-02-01", descricao="Mais antigo"),
    )
    await cliente_autenticado.post(
        "/movimentos",
        json=_movimento_valido(conta_b, categoria_id=categoria_id, data="2026-02-15", descricao="Mais recente"),
    )

    resposta = await cliente_autenticado.get("/movimentos")

    assert resposta.status_code == 200
    descricoes = [m["descricao"] for m in resposta.json()]
    assert descricoes == ["Mais recente", "Mais antigo"]


@pytest.mark.asyncio
async def test_listar_movimentos_filtra_por_conta(cliente_autenticado, db_session):
    conta_a = await _criar_conta(cliente_autenticado, nome="Conta A")
    conta_b = await _criar_conta(cliente_autenticado, nome="Conta B")
    categoria_id = await _categoria_id(db_session, "teste@example.com", "saida")
    await cliente_autenticado.post(
        "/movimentos", json=_movimento_valido(conta_a, categoria_id=categoria_id, descricao="Da A")
    )
    await cliente_autenticado.post(
        "/movimentos", json=_movimento_valido(conta_b, categoria_id=categoria_id, descricao="Da B")
    )

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
async def test_listar_movimentos_nao_mostra_movimentos_de_outro_utilizador(client, db_session):
    a = {"email": "a@example.com", "password": "palavrapasse123"}
    await client.post("/auth/registo", json=a)
    await client.post("/auth/login", json=a)
    conta_a = await _criar_conta(client)
    categoria_id = await _categoria_id(db_session, "a@example.com", "saida")
    await client.post(
        "/movimentos", json=_movimento_valido(conta_a, categoria_id=categoria_id, descricao="Do A")
    )

    await client.post("/auth/logout")
    b = {"email": "b@example.com", "password": "palavrapasse123"}
    await client.post("/auth/registo", json=b)
    await client.post("/auth/login", json=b)

    resposta = await client.get("/movimentos")

    assert resposta.status_code == 200
    assert resposta.json() == []


@pytest.mark.asyncio
async def test_obter_movimento_devolve_o_movimento(cliente_autenticado, db_session):
    conta_id = await _criar_conta(cliente_autenticado)
    categoria_id = await _categoria_id(db_session, "teste@example.com", "saida")
    criado = await cliente_autenticado.post(
        "/movimentos", json=_movimento_valido(conta_id, categoria_id=categoria_id)
    )
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
async def test_editar_movimento_altera_os_campos(cliente_autenticado, db_session):
    conta_id = await _criar_conta(cliente_autenticado)
    categoria_id = await _categoria_id(db_session, "teste@example.com", "saida")
    criado = await cliente_autenticado.post(
        "/movimentos", json=_movimento_valido(conta_id, categoria_id=categoria_id)
    )
    movimento_id = criado.json()["id"]

    resposta = await cliente_autenticado.patch(
        f"/movimentos/{movimento_id}",
        json=_movimento_valido(
            conta_id, categoria_id=categoria_id, descricao="Compras (corrigido)", valor="-60.00"
        ),
    )

    assert resposta.status_code == 200
    corpo = resposta.json()
    assert corpo["descricao"] == "Compras (corrigido)"
    assert corpo["valor"] == "-60.00"


@pytest.mark.asyncio
async def test_editar_movimento_pode_mudar_lhe_a_categoria(cliente_autenticado, db_session):
    conta_id = await _criar_conta(cliente_autenticado)
    categoria_a_id = await _categoria_id(db_session, "teste@example.com", "saida")
    criado = await cliente_autenticado.post(
        "/movimentos", json=_movimento_valido(conta_id, categoria_id=categoria_a_id)
    )
    movimento_id = criado.json()["id"]

    # Outra categoria de saída qualquer, diferente da primeira — a árvore
    # semeada por omissão tem sempre mais do que uma (ver
    # app/services/categorias_seed.py), por isso não é preciso escolher
    # uma em concreto: só confirmar que MUDOU.
    utilizador = await db_session.scalar(select(User).where(User.email == "teste@example.com"))
    categoria_b = await db_session.scalar(
        select(Categoria).where(
            Categoria.user_id == utilizador.id,
            Categoria.direcao == "saida",
            Categoria.parent_id.is_not(None),
            Categoria.id != categoria_a_id,
        )
    )

    resposta = await cliente_autenticado.patch(
        f"/movimentos/{movimento_id}",
        json=_movimento_valido(conta_id, categoria_id=str(categoria_b.id)),
    )

    assert resposta.status_code == 200
    assert resposta.json()["categoria_id"] == str(categoria_b.id)


@pytest.mark.asyncio
async def test_editar_movimento_pode_move_lo_para_outra_conta(cliente_autenticado, db_session):
    conta_a = await _criar_conta(cliente_autenticado, nome="Conta A")
    conta_b = await _criar_conta(cliente_autenticado, nome="Conta B")
    categoria_id = await _categoria_id(db_session, "teste@example.com", "saida")
    criado = await cliente_autenticado.post(
        "/movimentos", json=_movimento_valido(conta_a, categoria_id=categoria_id)
    )
    movimento_id = criado.json()["id"]

    resposta = await cliente_autenticado.patch(
        f"/movimentos/{movimento_id}", json=_movimento_valido(conta_b, categoria_id=categoria_id)
    )

    assert resposta.status_code == 200
    assert resposta.json()["conta_id"] == conta_b


@pytest.mark.asyncio
async def test_editar_movimento_para_conta_de_outro_utilizador_devolve_404(client, db_session):
    a = {"email": "a@example.com", "password": "palavrapasse123"}
    await client.post("/auth/registo", json=a)
    await client.post("/auth/login", json=a)
    conta_a = await _criar_conta(client)
    categoria_id = await _categoria_id(db_session, "a@example.com", "saida")
    criado = await client.post(
        "/movimentos", json=_movimento_valido(conta_a, categoria_id=categoria_id)
    )
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
        f"/movimentos/{movimento_id}", json=_movimento_valido(conta_b, categoria_id=categoria_id)
    )

    assert resposta.status_code == 404


@pytest.mark.asyncio
async def test_apagar_movimento_remove_o_movimento(cliente_autenticado, db_session):
    conta_id = await _criar_conta(cliente_autenticado)
    categoria_id = await _categoria_id(db_session, "teste@example.com", "saida")
    criado = await cliente_autenticado.post(
        "/movimentos", json=_movimento_valido(conta_id, categoria_id=categoria_id)
    )
    movimento_id = criado.json()["id"]

    resposta = await cliente_autenticado.delete(f"/movimentos/{movimento_id}")
    assert resposta.status_code == 204

    resposta = await cliente_autenticado.get(f"/movimentos/{movimento_id}")
    assert resposta.status_code == 404


@pytest.mark.asyncio
async def test_apagar_movimento_de_outro_utilizador_devolve_404(client, db_session):
    a = {"email": "a@example.com", "password": "palavrapasse123"}
    await client.post("/auth/registo", json=a)
    await client.post("/auth/login", json=a)
    conta_id = await _criar_conta(client)
    categoria_id = await _categoria_id(db_session, "a@example.com", "saida")
    criado = await client.post(
        "/movimentos", json=_movimento_valido(conta_id, categoria_id=categoria_id)
    )
    movimento_id = criado.json()["id"]

    await client.post("/auth/logout")
    b = {"email": "b@example.com", "password": "palavrapasse123"}
    await client.post("/auth/registo", json=b)
    await client.post("/auth/login", json=b)

    resposta = await client.delete(f"/movimentos/{movimento_id}")

    assert resposta.status_code == 404
