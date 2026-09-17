"""
TESTES AOS ENDPOINTS DE CONTAS — CRIAR E LISTAR
===============================================

Cobrem POST /contas e GET /contas: criação bem-sucedida, exigência de
sessão, as validações (data futura, moeda inválida), e o âmbito por
utilizador (um utilizador nunca vê contas de outro).
"""

from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import select

from app.models.categoria import Categoria
from app.models.taxa_cambio import TaxaCambio
from app.models.user import User

# Corpo mínimo válido para criar uma conta, reutilizado e ajustado nos
# testes.
CONTA_VALIDA = {
    "nome": "Conta à ordem",
    "banco": "BPI",
    "tipo": "Conta corrente",
    "moeda": "EUR",
    "data_ancora": "2026-01-01",
    "saldo_ancora": "1000.00",
}


async def _categoria_id(db_session, email: str, direcao: str) -> str:
    """
    Devolve o id de uma subcategoria qualquer, com esta direcao, da árvore
    semeada automaticamente no registo deste utilizador (ver
    app/services/categorias_seed.py) — os testes deste ficheiro são sobre
    contas e saldos, não sobre categorias; só precisam de um id real e
    coerente com o sinal do movimento lançado para preparar cada cenário.
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


@pytest.mark.asyncio
async def test_criar_conta_devolve_a_conta_criada(cliente_autenticado):
    resposta = await cliente_autenticado.post("/contas", json=CONTA_VALIDA)

    assert resposta.status_code == 201
    corpo = resposta.json()
    assert corpo["nome"] == "Conta à ordem"
    assert corpo["banco"] == "BPI"
    assert corpo["moeda"] == "EUR"
    # Valores monetários vêm como texto, com 2 casas decimais.
    assert corpo["saldo_ancora"] == "1000.00"
    # Sem movimentos, o saldo actual é igual ao da âncora.
    assert corpo["saldo"] == "1000.00"
    assert "id" in corpo


@pytest.mark.asyncio
async def test_criar_conta_sem_sessao_e_recusado(client):
    resposta = await client.post("/contas", json=CONTA_VALIDA)

    assert resposta.status_code == 401


@pytest.mark.asyncio
async def test_criar_conta_arredonda_o_saldo_a_duas_casas(cliente_autenticado):
    resposta = await cliente_autenticado.post(
        "/contas", json={**CONTA_VALIDA, "saldo_ancora": "1000.005"}
    )

    assert resposta.status_code == 201
    assert resposta.json()["saldo_ancora"] == "1000.00"


@pytest.mark.asyncio
async def test_criar_conta_aceita_saldo_negativo(cliente_autenticado):
    resposta = await cliente_autenticado.post(
        "/contas", json={**CONTA_VALIDA, "saldo_ancora": "-250.00"}
    )

    assert resposta.status_code == 201
    assert resposta.json()["saldo_ancora"] == "-250.00"


@pytest.mark.asyncio
async def test_criar_conta_com_data_futura_e_recusado(cliente_autenticado):
    resposta = await cliente_autenticado.post(
        "/contas", json={**CONTA_VALIDA, "data_ancora": "2099-01-01"}
    )

    assert resposta.status_code == 400


@pytest.mark.asyncio
async def test_criar_conta_com_moeda_nao_suportada_e_recusado(cliente_autenticado):
    resposta = await cliente_autenticado.post(
        "/contas", json={**CONTA_VALIDA, "moeda": "XYZ"}
    )

    assert resposta.status_code == 422


@pytest.mark.asyncio
async def test_criar_conta_com_nome_vazio_e_recusado(cliente_autenticado):
    resposta = await cliente_autenticado.post(
        "/contas", json={**CONTA_VALIDA, "nome": "   "}
    )

    assert resposta.status_code == 422


@pytest.mark.asyncio
async def test_listar_contas_devolve_as_do_utilizador_por_ordem_de_nome(cliente_autenticado):
    await cliente_autenticado.post("/contas", json={**CONTA_VALIDA, "nome": "Revolut"})
    await cliente_autenticado.post("/contas", json={**CONTA_VALIDA, "nome": "Caixa"})

    resposta = await cliente_autenticado.get("/contas")

    assert resposta.status_code == 200
    nomes = [conta["nome"] for conta in resposta.json()]
    assert nomes == ["Caixa", "Revolut"]


@pytest.mark.asyncio
async def test_listar_contas_nao_mostra_contas_de_outro_utilizador(client):
    # Utilizador A cria uma conta.
    a = {"email": "a@example.com", "password": "palavrapasse123"}
    await client.post("/auth/registo", json=a)
    await client.post("/auth/login", json=a)
    await client.post("/contas", json={**CONTA_VALIDA, "nome": "Conta do A"})

    # Termina a sessão do A e entra o utilizador B.
    await client.post("/auth/logout")
    b = {"email": "b@example.com", "password": "palavrapasse123"}
    await client.post("/auth/registo", json=b)
    await client.post("/auth/login", json=b)

    resposta = await client.get("/contas")

    assert resposta.status_code == 200
    assert resposta.json() == []


async def _conta_de_outro_utilizador(client) -> str:
    """
    Regista um segundo utilizador, cria-lhe uma conta, termina-lhe a
    sessão, e devolve o id dessa conta. Deixa o cliente sem sessão — o
    teste que chamar esta função autentica de seguida o utilizador que quer
    testar.
    """
    outro = {"email": "outro@example.com", "password": "palavrapasse123"}
    await client.post("/auth/registo", json=outro)
    await client.post("/auth/login", json=outro)
    conta_id = (await client.post("/contas", json=CONTA_VALIDA)).json()["id"]
    await client.post("/auth/logout")
    return conta_id


async def _autenticar(client, email: str = "eu@example.com") -> None:
    credenciais = {"email": email, "password": "palavrapasse123"}
    await client.post("/auth/registo", json=credenciais)
    await client.post("/auth/login", json=credenciais)


# ─── GET /contas/{id} ────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_obter_conta_devolve_a_conta(cliente_autenticado):
    conta_id = (await cliente_autenticado.post("/contas", json=CONTA_VALIDA)).json()["id"]

    resposta = await cliente_autenticado.get(f"/contas/{conta_id}")

    assert resposta.status_code == 200
    assert resposta.json()["id"] == conta_id
    assert resposta.json()["nome"] == "Conta à ordem"


@pytest.mark.asyncio
async def test_obter_conta_sem_sessao_e_recusado(client):
    conta_id = await _conta_de_outro_utilizador(client)

    resposta = await client.get(f"/contas/{conta_id}")

    assert resposta.status_code == 401


@pytest.mark.asyncio
async def test_obter_conta_inexistente_devolve_404(cliente_autenticado):
    resposta = await cliente_autenticado.get(
        "/contas/00000000-0000-0000-0000-000000000000"
    )

    assert resposta.status_code == 404


@pytest.mark.asyncio
async def test_obter_conta_de_outro_utilizador_devolve_404(client):
    conta_id = await _conta_de_outro_utilizador(client)
    await _autenticar(client)

    resposta = await client.get(f"/contas/{conta_id}")

    # 404, não 403 — não se revela sequer que o id existe.
    assert resposta.status_code == 404


# ─── PATCH /contas/{id} ──────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_editar_conta_altera_os_campos_descritivos(cliente_autenticado):
    conta_id = (await cliente_autenticado.post("/contas", json=CONTA_VALIDA)).json()["id"]

    resposta = await cliente_autenticado.patch(
        f"/contas/{conta_id}",
        json={"nome": "Conta principal", "banco": "Millennium", "tipo": None, "moeda": "USD"},
    )

    assert resposta.status_code == 200
    corpo = resposta.json()
    assert corpo["nome"] == "Conta principal"
    assert corpo["banco"] == "Millennium"
    assert corpo["tipo"] is None
    assert corpo["moeda"] == "USD"


@pytest.mark.asyncio
async def test_editar_conta_nao_toca_na_ancora(cliente_autenticado):
    conta_id = (await cliente_autenticado.post("/contas", json=CONTA_VALIDA)).json()["id"]

    await cliente_autenticado.patch(
        f"/contas/{conta_id}",
        json={"nome": "Outro nome", "banco": None, "tipo": None, "moeda": "EUR"},
    )
    corpo = (await cliente_autenticado.get(f"/contas/{conta_id}")).json()

    assert corpo["data_ancora"] == "2026-01-01"
    assert corpo["saldo_ancora"] == "1000.00"


@pytest.mark.asyncio
async def test_editar_conta_com_moeda_invalida_devolve_422(cliente_autenticado):
    conta_id = (await cliente_autenticado.post("/contas", json=CONTA_VALIDA)).json()["id"]

    resposta = await cliente_autenticado.patch(
        f"/contas/{conta_id}",
        json={"nome": "X", "banco": None, "tipo": None, "moeda": "XYZ"},
    )

    assert resposta.status_code == 422


@pytest.mark.asyncio
async def test_editar_conta_de_outro_utilizador_devolve_404(client):
    conta_id = await _conta_de_outro_utilizador(client)
    await _autenticar(client)

    resposta = await client.patch(
        f"/contas/{conta_id}",
        json={"nome": "Roubada", "banco": None, "tipo": None, "moeda": "EUR"},
    )

    assert resposta.status_code == 404


# ─── DELETE /contas/{id} ─────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_apagar_conta_remove_a_conta(cliente_autenticado):
    conta_id = (await cliente_autenticado.post("/contas", json=CONTA_VALIDA)).json()["id"]

    resposta = await cliente_autenticado.delete(f"/contas/{conta_id}")

    assert resposta.status_code == 204
    assert (await cliente_autenticado.get(f"/contas/{conta_id}")).status_code == 404
    assert (await cliente_autenticado.get("/contas")).json() == []


@pytest.mark.asyncio
async def test_apagar_conta_de_outro_utilizador_devolve_404(client):
    conta_id = await _conta_de_outro_utilizador(client)
    await _autenticar(client)

    resposta = await client.delete(f"/contas/{conta_id}")

    assert resposta.status_code == 404


@pytest.mark.asyncio
async def test_apagar_conta_apaga_tambem_os_seus_movimentos(cliente_autenticado, db_session):
    """
    A eliminação é em cascata ao nível da base de dados (ver
    ondelete="CASCADE" em app/models/movimento.py) — apagar a conta não
    deve falhar com um erro de integridade referencial, e os movimentos
    não devem sobreviver "órfãos".
    """
    conta_id = (await cliente_autenticado.post("/contas", json=CONTA_VALIDA)).json()["id"]
    categoria_id = await _categoria_id(db_session, "teste@example.com", "saida")
    await cliente_autenticado.post(
        "/movimentos",
        json={
            "conta_id": conta_id,
            "categoria_id": categoria_id,
            "data": "2026-02-01",
            "descricao": "Compras",
            "valor": "-10.00",
        },
    )

    resposta = await cliente_autenticado.delete(f"/contas/{conta_id}")

    assert resposta.status_code == 204
    assert (await cliente_autenticado.get("/movimentos")).json() == []


# ─── Saldo actual, com movimentos ────────────────────────────────────────


@pytest.mark.asyncio
async def test_saldo_actual_soma_os_movimentos_ao_saldo_da_ancora(cliente_autenticado, db_session):
    conta_id = (await cliente_autenticado.post("/contas", json=CONTA_VALIDA)).json()["id"]
    categoria_entrada_id = await _categoria_id(db_session, "teste@example.com", "entrada")
    categoria_saida_id = await _categoria_id(db_session, "teste@example.com", "saida")
    # saldo_ancora de CONTA_VALIDA é 1000.00.
    await cliente_autenticado.post(
        "/movimentos",
        json={
            "conta_id": conta_id,
            "categoria_id": categoria_entrada_id,
            "data": "2026-02-01",
            "descricao": "Salário",
            "valor": "1500.00",
        },
    )
    await cliente_autenticado.post(
        "/movimentos",
        json={
            "conta_id": conta_id,
            "categoria_id": categoria_saida_id,
            "data": "2026-02-05",
            "descricao": "Renda",
            "valor": "-750.00",
        },
    )

    corpo = (await cliente_autenticado.get(f"/contas/{conta_id}")).json()

    # 1000.00 (âncora) + 1500.00 - 750.00 = 1750.00. saldo_ancora não muda.
    assert corpo["saldo_ancora"] == "1000.00"
    assert corpo["saldo"] == "1750.00"

    # A listagem (que soma os movimentos de forma agrupada, não um a um)
    # tem de dar o mesmo resultado.
    contas = (await cliente_autenticado.get("/contas")).json()
    assert contas[0]["saldo"] == "1750.00"


@pytest.mark.asyncio
async def test_saldo_actual_com_varias_contas_nao_soma_entre_contas(cliente_autenticado, db_session):
    # A soma agrupada de GET /contas (uma única consulta para todas as
    # contas do utilizador, não uma por conta — ver _somas_de_movimentos)
    # tem de atribuir cada movimento à SUA conta, nunca misturar entre
    # elas.
    conta_a_id = (
        await cliente_autenticado.post(
            "/contas", json={**CONTA_VALIDA, "nome": "Conta A", "saldo_ancora": "1000.00"}
        )
    ).json()["id"]
    conta_b_id = (
        await cliente_autenticado.post(
            "/contas", json={**CONTA_VALIDA, "nome": "Conta B", "saldo_ancora": "500.00"}
        )
    ).json()["id"]
    categoria_saida_id = await _categoria_id(db_session, "teste@example.com", "saida")

    await cliente_autenticado.post(
        "/movimentos",
        json={
            "conta_id": conta_a_id,
            "categoria_id": categoria_saida_id,
            "data": "2026-02-01",
            "descricao": "Da A",
            "valor": "-100.00",
        },
    )
    await cliente_autenticado.post(
        "/movimentos",
        json={
            "conta_id": conta_b_id,
            "categoria_id": categoria_saida_id,
            "data": "2026-02-02",
            "descricao": "Da B",
            "valor": "-50.00",
        },
    )

    contas = {c["id"]: c for c in (await cliente_autenticado.get("/contas")).json()}

    # 1000 - 100 = 900 (só a conta A); 500 - 50 = 450 (só a conta B).
    assert contas[conta_a_id]["saldo"] == "900.00"
    assert contas[conta_b_id]["saldo"] == "450.00"


@pytest.mark.asyncio
async def test_editar_conta_recusa_mudar_moeda_com_movimentos(cliente_autenticado, db_session):
    conta_id = (await cliente_autenticado.post("/contas", json=CONTA_VALIDA)).json()["id"]
    categoria_id = await _categoria_id(db_session, "teste@example.com", "saida")
    await cliente_autenticado.post(
        "/movimentos",
        json={
            "conta_id": conta_id,
            "categoria_id": categoria_id,
            "data": "2026-02-01",
            "descricao": "Compras",
            "valor": "-10.00",
        },
    )

    resposta = await cliente_autenticado.patch(
        f"/contas/{conta_id}",
        json={"nome": "Conta à ordem", "banco": "BPI", "tipo": "Conta corrente", "moeda": "USD"},
    )

    assert resposta.status_code == 400


@pytest.mark.asyncio
async def test_editar_conta_permite_manter_a_mesma_moeda_com_movimentos(cliente_autenticado, db_session):
    """A regra é "mudar" a moeda, não "ter" movimentos — reenviar a mesma moeda continua permitido."""
    conta_id = (await cliente_autenticado.post("/contas", json=CONTA_VALIDA)).json()["id"]
    categoria_id = await _categoria_id(db_session, "teste@example.com", "saida")
    await cliente_autenticado.post(
        "/movimentos",
        json={
            "conta_id": conta_id,
            "categoria_id": categoria_id,
            "data": "2026-02-01",
            "descricao": "Compras",
            "valor": "-10.00",
        },
    )

    resposta = await cliente_autenticado.patch(
        f"/contas/{conta_id}",
        json={"nome": "Novo nome", "banco": "BPI", "tipo": "Conta corrente", "moeda": "EUR"},
    )

    assert resposta.status_code == 200
    assert resposta.json()["nome"] == "Novo nome"


@pytest.mark.asyncio
async def test_criar_conta_com_a_mesma_moeda_da_principal_devolve_saldo_convertido_igual(
    cliente_autenticado,
):
    # Utilizador novo -> moeda_principal "EUR" por omissão; CONTA_VALIDA
    # também é "EUR" -> sem conversão nenhuma a fazer, e sem precisar de
    # nenhuma taxa de câmbio guardada (ver o atalho "mesma moeda" em
    # app/services/cambio.py, converter()).
    resposta = await cliente_autenticado.post("/contas", json=CONTA_VALIDA)

    corpo = resposta.json()
    assert corpo["saldo_convertido"] == corpo["saldo"]


@pytest.mark.asyncio
async def test_listar_contas_converte_o_saldo_para_a_moeda_principal(
    cliente_autenticado, db_session
):
    # 1 EUR = 1.10 USD, hoje.
    db_session.add(TaxaCambio(data=date.today(), moeda="USD", por_1_eur=Decimal("1.10")))
    await db_session.commit()
    await cliente_autenticado.patch("/auth/me", json={"moeda_principal": "USD"})

    await cliente_autenticado.post("/contas", json={**CONTA_VALIDA, "saldo_ancora": "100.00"})

    resposta = await cliente_autenticado.get("/contas")

    corpo = resposta.json()[0]
    assert corpo["saldo"] == "100.00"
    assert corpo["saldo_convertido"] == "110.00"


@pytest.mark.asyncio
async def test_obter_conta_sem_taxa_de_cambio_disponivel_devolve_saldo_convertido_none(
    cliente_autenticado,
):
    # moeda_principal passa a "USD", mas nenhuma taxa de câmbio foi
    # guardada na base de dados de teste — SemTaxaCambio é apanhada em
    # _para_saida (app/routers/contas.py), e a rota continua a responder
    # 200, só sem o valor convertido (ver a nota nesse ficheiro sobre não
    # deixar a rota inteira falhar por uma conversão de apresentação).
    await cliente_autenticado.patch("/auth/me", json={"moeda_principal": "USD"})
    conta_id = (await cliente_autenticado.post("/contas", json=CONTA_VALIDA)).json()["id"]

    resposta = await cliente_autenticado.get(f"/contas/{conta_id}")

    assert resposta.status_code == 200
    assert resposta.json()["saldo_convertido"] is None
