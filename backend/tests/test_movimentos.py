"""
TESTES AOS ENDPOINTS DE MOVIMENTOS
=====================================

Cobrem POST/GET/PATCH/DELETE /movimentos: criação (com sinal, a regra da
data não poder ser anterior à âncora da conta, e a regra da categoria
escolhida ter de existir, ser do utilizador e ter a direcao coerente com o
sinal do valor), a lista global (todas as contas do utilizador, filtrável
por conta_id), obter/editar/apagar um movimento, e o âmbito por utilizador
(um movimento cuja conta não é sua é, para todos os efeitos, inexistente —
404, nunca 403). E os dois endpoints EM LOTE (eliminar-em-lote,
recategorizar-em-lote): atomicidade (um id inválido no meio do lote não
deixa nada por fazer nem faz metade), âmbito por utilizador, e a regra da
direcao no caso de recategorizar. E a PAGINAÇÃO POR CURSOR de
GET /movimentos: o "limite" é respeitado, e o cursor ("antes_data" +
"antes_criado_em" + "antes_id") continua exactamente a seguir ao último
movimento da página anterior — sem saltar nem repetir nenhum, mesmo
quando vários partilham a mesma data E o mesmo created_at (o que
acontece sempre nestes testes: correm dentro de uma única transacção, e
o Postgres fixa "now()" por transacção, não por instrução — daí "id" ser
sempre o desempate final) —, e os filtros como parâmetros de query (tipo,
contas, categorias, de/ate, pesquisa) — ver a nota PAGINAÇÃO POR CURSOR e
FILTROS COMO PARÂMETROS em app/routers/movimentos.py — incluindo que o
filtro continua a aplicar-se à SEGUNDA página de um cursor, não só à
primeira, e que um id ou "tipo" inválidos dão 422, não 500. E o
"saldo_apos" de cada movimento devolvido pela lista: reflecte sempre o
saldo real e completo da conta nesse ponto do tempo, mesmo quando um
filtro está a esconder outros movimentos dessa mesma conta, e nunca soma
entre contas diferentes do mesmo utilizador — ver a nota SALDO
REMANESCENTE, no mesmo ficheiro.
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


# --- Paginação por cursor e filtros como parâmetros de query ---


@pytest.mark.asyncio
async def test_listar_movimentos_respeita_o_limite(cliente_autenticado, db_session):
    conta_id = await _criar_conta(cliente_autenticado)
    categoria_id = await _categoria_id(db_session, "teste@example.com", "saida")
    for i in range(3):
        await cliente_autenticado.post(
            "/movimentos",
            json=_movimento_valido(
                conta_id, categoria_id=categoria_id, descricao=f"M{i}", data=f"2026-02-0{i + 1}"
            ),
        )

    resposta = await cliente_autenticado.get("/movimentos", params={"limite": 2})

    assert resposta.status_code == 200
    assert len(resposta.json()) == 2


@pytest.mark.asyncio
async def test_listar_movimentos_o_cursor_continua_a_partir_do_ultimo(cliente_autenticado, db_session):
    # Os três com a MESMA data — e, como todo este teste corre dentro de
    # uma única transacção (ver tests/conftest.py), também com o MESMO
    # "created_at" (o Postgres fixa "now()" ao início da transacção, não a
    # cada instrução). Não há, por isso, uma ordem previsível entre eles
    # a verificar (o desempate final, "id", é um UUID sem relação nenhuma
    # com a ordem de criação) — o que importa testar é a INVARIANTE: o
    # cursor nunca salta nem repete um movimento ao mudar de página.
    conta_id = await _criar_conta(cliente_autenticado)
    categoria_id = await _categoria_id(db_session, "teste@example.com", "saida")
    ids_criados = set()
    for i in range(3):
        criado = await cliente_autenticado.post(
            "/movimentos",
            json=_movimento_valido(
                conta_id, categoria_id=categoria_id, descricao=f"M{i}", data="2026-02-05"
            ),
        )
        ids_criados.add(criado.json()["id"])

    pagina1 = (await cliente_autenticado.get("/movimentos", params={"limite": 2})).json()
    assert len(pagina1) == 2

    ultimo = pagina1[-1]
    pagina2 = (
        await cliente_autenticado.get(
            "/movimentos",
            params={
                "limite": 2,
                "antes_data": ultimo["data"],
                "antes_criado_em": ultimo["created_at"],
                "antes_id": ultimo["id"],
            },
        )
    ).json()
    assert len(pagina2) == 1

    ids_lidos = {m["id"] for m in pagina1} | {m["id"] for m in pagina2}
    assert ids_lidos == ids_criados


@pytest.mark.asyncio
async def test_listar_movimentos_filtra_por_tipo_via_query(cliente_autenticado, db_session):
    conta_id = await _criar_conta(cliente_autenticado)
    categoria_entrada = await _categoria_id(db_session, "teste@example.com", "entrada")
    categoria_saida = await _categoria_id(db_session, "teste@example.com", "saida")
    await cliente_autenticado.post(
        "/movimentos",
        json=_movimento_valido(
            conta_id, categoria_id=categoria_entrada, descricao="Salário", valor="1500.00"
        ),
    )
    await cliente_autenticado.post(
        "/movimentos",
        json=_movimento_valido(
            conta_id, categoria_id=categoria_saida, descricao="Renda", valor="-750.00"
        ),
    )

    resposta = await cliente_autenticado.get("/movimentos", params={"tipo": "entrada"})

    assert resposta.status_code == 200
    assert [m["descricao"] for m in resposta.json()] == ["Salário"]


@pytest.mark.asyncio
async def test_listar_movimentos_filtra_por_contas_via_query(cliente_autenticado, db_session):
    conta_a = await _criar_conta(cliente_autenticado, nome="Conta A")
    conta_b = await _criar_conta(cliente_autenticado, nome="Conta B")
    categoria_id = await _categoria_id(db_session, "teste@example.com", "saida")
    await cliente_autenticado.post(
        "/movimentos", json=_movimento_valido(conta_a, categoria_id=categoria_id, descricao="Da A")
    )
    await cliente_autenticado.post(
        "/movimentos", json=_movimento_valido(conta_b, categoria_id=categoria_id, descricao="Da B")
    )

    resposta = await cliente_autenticado.get("/movimentos", params={"contas": conta_a})

    assert resposta.status_code == 200
    assert [m["descricao"] for m in resposta.json()] == ["Da A"]


@pytest.mark.asyncio
async def test_listar_movimentos_filtra_por_categorias_via_query(cliente_autenticado, db_session):
    conta_id = await _criar_conta(cliente_autenticado)
    utilizador = await db_session.scalar(select(User).where(User.email == "teste@example.com"))
    categorias_saida = list(
        (
            await db_session.scalars(
                select(Categoria).where(
                    Categoria.user_id == utilizador.id,
                    Categoria.direcao == "saida",
                    Categoria.parent_id.is_not(None),
                )
            )
        ).all()
    )
    categoria_a, categoria_b = categorias_saida[0], categorias_saida[1]
    await cliente_autenticado.post(
        "/movimentos",
        json=_movimento_valido(conta_id, categoria_id=str(categoria_a.id), descricao="A"),
    )
    await cliente_autenticado.post(
        "/movimentos",
        json=_movimento_valido(conta_id, categoria_id=str(categoria_b.id), descricao="B"),
    )

    resposta = await cliente_autenticado.get("/movimentos", params={"categorias": str(categoria_a.id)})

    assert resposta.status_code == 200
    assert [m["descricao"] for m in resposta.json()] == ["A"]


@pytest.mark.asyncio
async def test_listar_movimentos_filtra_por_intervalo_de_datas(cliente_autenticado, db_session):
    conta_id = await _criar_conta(cliente_autenticado)
    categoria_id = await _categoria_id(db_session, "teste@example.com", "saida")
    await cliente_autenticado.post(
        "/movimentos",
        json=_movimento_valido(conta_id, categoria_id=categoria_id, descricao="Fora", data="2026-01-01"),
    )
    await cliente_autenticado.post(
        "/movimentos",
        json=_movimento_valido(conta_id, categoria_id=categoria_id, descricao="Dentro", data="2026-02-15"),
    )

    resposta = await cliente_autenticado.get(
        "/movimentos", params={"de": "2026-02-01", "ate": "2026-02-28"}
    )

    assert resposta.status_code == 200
    assert [m["descricao"] for m in resposta.json()] == ["Dentro"]


@pytest.mark.asyncio
async def test_listar_movimentos_pesquisa_por_descricao_ou_nome_da_conta(cliente_autenticado, db_session):
    conta_a = await _criar_conta(cliente_autenticado, nome="Poupança")
    conta_b = await _criar_conta(cliente_autenticado, nome="À ordem")
    categoria_id = await _categoria_id(db_session, "teste@example.com", "saida")
    await cliente_autenticado.post(
        "/movimentos", json=_movimento_valido(conta_a, categoria_id=categoria_id, descricao="Compras")
    )
    await cliente_autenticado.post(
        "/movimentos", json=_movimento_valido(conta_b, categoria_id=categoria_id, descricao="Renda")
    )

    por_descricao = await cliente_autenticado.get("/movimentos", params={"pesquisa": "compras"})
    assert [m["descricao"] for m in por_descricao.json()] == ["Compras"]

    por_nome_da_conta = await cliente_autenticado.get("/movimentos", params={"pesquisa": "poupança"})
    assert [m["descricao"] for m in por_nome_da_conta.json()] == ["Compras"]


@pytest.mark.asyncio
async def test_listar_movimentos_calcula_o_saldo_apos_cada_movimento(cliente_autenticado, db_session):
    # CONTA_VALIDA tem saldo_ancora "1000.00". Um movimento mais antigo
    # (-50, saída, 2026-02-01) seguido de um mais recente (+200, entrada,
    # 2026-02-10): o saldo_apos de cada um é o saldo-âncora mais a soma de
    # tudo o que aconteceu ATÉ ele, por ordem cronológica — não a ordem em
    # que a lista os devolve (mais recente primeiro).
    conta_id = await _criar_conta(cliente_autenticado)
    categoria_saida = await _categoria_id(db_session, "teste@example.com", "saida")
    categoria_entrada = await _categoria_id(db_session, "teste@example.com", "entrada")
    await cliente_autenticado.post(
        "/movimentos",
        json=_movimento_valido(
            conta_id, categoria_id=categoria_saida, descricao="Mais antigo", data="2026-02-01", valor="-50.00"
        ),
    )
    await cliente_autenticado.post(
        "/movimentos",
        json=_movimento_valido(
            conta_id, categoria_id=categoria_entrada, descricao="Mais recente", data="2026-02-10", valor="200.00"
        ),
    )

    resposta = await cliente_autenticado.get("/movimentos")

    assert resposta.status_code == 200
    corpo = resposta.json()
    # corpo[0] é o mais recente (+200): 1000 - 50 + 200 = 1150.00.
    # corpo[1] é o mais antigo (-50): 1000 - 50 = 950.00.
    assert corpo[0]["descricao"] == "Mais recente"
    assert corpo[0]["saldo_apos"] == "1150.00"
    assert corpo[1]["descricao"] == "Mais antigo"
    assert corpo[1]["saldo_apos"] == "950.00"


@pytest.mark.asyncio
async def test_listar_movimentos_saldo_apos_ignora_os_filtros_da_listagem(cliente_autenticado, db_session):
    # Um filtro (aqui, por categoria) esconde o movimento mais antigo da
    # RESPOSTA, mas o saldo_apos do movimento que fica continua a contar
    # com ele — o saldo remanescente reflecte o histórico completo da
    # conta, não só o que está a ser mostrado.
    conta_id = await _criar_conta(cliente_autenticado)
    categoria_escondida = await _categoria_id(db_session, "teste@example.com", "saida")
    categoria_visivel = await _categoria_id(db_session, "teste@example.com", "entrada")
    await cliente_autenticado.post(
        "/movimentos",
        json=_movimento_valido(
            conta_id, categoria_id=categoria_escondida, descricao="Escondido", data="2026-02-01", valor="-50.00"
        ),
    )
    await cliente_autenticado.post(
        "/movimentos",
        json=_movimento_valido(
            conta_id, categoria_id=categoria_visivel, descricao="Visivel", data="2026-02-10", valor="200.00"
        ),
    )

    resposta = await cliente_autenticado.get(
        "/movimentos", params={"categorias": categoria_visivel}
    )

    assert resposta.status_code == 200
    corpo = resposta.json()
    assert [m["descricao"] for m in corpo] == ["Visivel"]
    # 1000 - 50 (escondido, mas ainda contabilizado) + 200 = 1150.00.
    assert corpo[0]["saldo_apos"] == "1150.00"


@pytest.mark.asyncio
async def test_listar_movimentos_saldo_apos_e_por_conta_nao_soma_entre_contas(cliente_autenticado, db_session):
    # A função de janela particiona por conta_id (ver _saldo_apos_sq) — o
    # saldo de uma conta nunca deve incluir movimentos de outra conta do
    # mesmo utilizador, mesmo que ambas apareçam na mesma resposta.
    conta_a = await _criar_conta(cliente_autenticado, nome="Conta A", saldo_ancora="1000.00")
    conta_b = await _criar_conta(cliente_autenticado, nome="Conta B", saldo_ancora="500.00")
    categoria_id = await _categoria_id(db_session, "teste@example.com", "saida")
    await cliente_autenticado.post(
        "/movimentos",
        json=_movimento_valido(
            conta_a, categoria_id=categoria_id, descricao="Da A", valor="-100.00", data="2026-02-01"
        ),
    )
    await cliente_autenticado.post(
        "/movimentos",
        json=_movimento_valido(
            conta_b, categoria_id=categoria_id, descricao="Da B", valor="-50.00", data="2026-02-02"
        ),
    )

    resposta = await cliente_autenticado.get("/movimentos")

    assert resposta.status_code == 200
    por_descricao = {m["descricao"]: m for m in resposta.json()}
    # 1000 - 100 = 900 (só a conta A); 500 - 50 = 450 (só a conta B).
    assert por_descricao["Da A"]["saldo_apos"] == "900.00"
    assert por_descricao["Da B"]["saldo_apos"] == "450.00"


@pytest.mark.asyncio
async def test_listar_movimentos_pagina_seguinte_continua_a_respeitar_o_filtro(cliente_autenticado, db_session):
    # Um movimento de ENTRADA entre dois de SAÍDA (por data): se o filtro
    # "tipo=saida" só se aplicasse à primeira página, esta entrada
    # apareceria na segunda — é exactamente isso que este teste confirma
    # que não acontece.
    conta_id = await _criar_conta(cliente_autenticado)
    categoria_saida = await _categoria_id(db_session, "teste@example.com", "saida")
    categoria_entrada = await _categoria_id(db_session, "teste@example.com", "entrada")
    for descricao, data in [("S1", "2026-02-06"), ("S2", "2026-02-05")]:
        await cliente_autenticado.post(
            "/movimentos",
            json=_movimento_valido(
                conta_id, categoria_id=categoria_saida, descricao=descricao, data=data
            ),
        )
    # Entre S2 (05) e S3 (03) por data — se o filtro escapasse à segunda
    # página, esta entrada apareceria ali, entre as duas saídas.
    await cliente_autenticado.post(
        "/movimentos",
        json=_movimento_valido(
            conta_id, categoria_id=categoria_entrada, descricao="E", data="2026-02-04", valor="10.00"
        ),
    )
    await cliente_autenticado.post(
        "/movimentos",
        json=_movimento_valido(conta_id, categoria_id=categoria_saida, descricao="S3", data="2026-02-03"),
    )

    pagina1 = (
        await cliente_autenticado.get("/movimentos", params={"tipo": "saida", "limite": 2})
    ).json()
    assert [m["descricao"] for m in pagina1] == ["S1", "S2"]

    ultimo = pagina1[-1]
    pagina2 = (
        await cliente_autenticado.get(
            "/movimentos",
            params={
                "tipo": "saida",
                "limite": 2,
                "antes_data": ultimo["data"],
                "antes_criado_em": ultimo["created_at"],
                "antes_id": ultimo["id"],
            },
        )
    ).json()

    assert [m["descricao"] for m in pagina2] == ["S3"]


@pytest.mark.asyncio
async def test_listar_movimentos_filtro_de_datas_inclui_os_extremos(cliente_autenticado, db_session):
    conta_id = await _criar_conta(cliente_autenticado)
    categoria_id = await _categoria_id(db_session, "teste@example.com", "saida")
    await cliente_autenticado.post(
        "/movimentos",
        json=_movimento_valido(
            conta_id, categoria_id=categoria_id, descricao="No primeiro dia", data="2026-02-01"
        ),
    )
    await cliente_autenticado.post(
        "/movimentos",
        json=_movimento_valido(
            conta_id, categoria_id=categoria_id, descricao="No ultimo dia", data="2026-02-28"
        ),
    )

    resposta = await cliente_autenticado.get(
        "/movimentos", params={"de": "2026-02-01", "ate": "2026-02-28"}
    )

    assert resposta.status_code == 200
    descricoes = {m["descricao"] for m in resposta.json()}
    assert descricoes == {"No primeiro dia", "No ultimo dia"}


@pytest.mark.asyncio
async def test_listar_movimentos_com_id_invalido_em_contas_devolve_422(cliente_autenticado):
    # "contas"/"categorias" chegam como texto livre (separado por
    # vírgulas), não como uuid.UUID na assinatura da rota — por isso não
    # ganham a validação automática do FastAPI; _uuids_de_csv tem de
    # validar isto à mão (ver a nota no próprio ficheiro).
    resposta = await cliente_autenticado.get("/movimentos", params={"contas": "nao-e-um-uuid"})

    assert resposta.status_code == 422


@pytest.mark.asyncio
async def test_listar_movimentos_com_tipo_invalido_devolve_422(cliente_autenticado):
    resposta = await cliente_autenticado.get("/movimentos", params={"tipo": "qualquer-coisa"})

    assert resposta.status_code == 422


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


# --- Em lote: eliminar-em-lote ---


@pytest.mark.asyncio
async def test_eliminar_movimentos_em_lote_remove_todos(cliente_autenticado, db_session):
    conta_id = await _criar_conta(cliente_autenticado)
    categoria_id = await _categoria_id(db_session, "teste@example.com", "saida")
    ids = []
    for descricao in ["A", "B", "C"]:
        criado = await cliente_autenticado.post(
            "/movimentos", json=_movimento_valido(conta_id, categoria_id=categoria_id, descricao=descricao)
        )
        ids.append(criado.json()["id"])

    resposta = await cliente_autenticado.post("/movimentos/eliminar-em-lote", json={"ids": ids})

    assert resposta.status_code == 204
    for movimento_id in ids:
        assert (await cliente_autenticado.get(f"/movimentos/{movimento_id}")).status_code == 404


@pytest.mark.asyncio
async def test_eliminar_movimentos_em_lote_e_atomico_se_um_id_nao_existir(cliente_autenticado, db_session):
    # Um lote com um id que não existe (ou não é do utilizador) é
    # recusado por inteiro — os válidos não podem ficar meio-eliminados.
    conta_id = await _criar_conta(cliente_autenticado)
    categoria_id = await _categoria_id(db_session, "teste@example.com", "saida")
    criado = await cliente_autenticado.post(
        "/movimentos", json=_movimento_valido(conta_id, categoria_id=categoria_id)
    )
    movimento_id = criado.json()["id"]

    resposta = await cliente_autenticado.post(
        "/movimentos/eliminar-em-lote",
        json={"ids": [movimento_id, "00000000-0000-0000-0000-000000000000"]},
    )

    assert resposta.status_code == 404
    # O movimento válido do lote continua lá — nada foi apagado.
    assert (await cliente_autenticado.get(f"/movimentos/{movimento_id}")).status_code == 200


@pytest.mark.asyncio
async def test_eliminar_movimentos_em_lote_com_movimento_de_outro_utilizador_devolve_404(client, db_session):
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

    resposta = await client.post("/movimentos/eliminar-em-lote", json={"ids": [movimento_id]})

    assert resposta.status_code == 404


@pytest.mark.asyncio
async def test_eliminar_movimentos_em_lote_com_lista_vazia_e_recusado(cliente_autenticado):
    resposta = await cliente_autenticado.post("/movimentos/eliminar-em-lote", json={"ids": []})

    assert resposta.status_code == 422


# --- Em lote: recategorizar-em-lote ---


@pytest.mark.asyncio
async def test_recategorizar_movimentos_em_lote_muda_a_categoria_de_todos(cliente_autenticado, db_session):
    conta_id = await _criar_conta(cliente_autenticado)
    categoria_a_id = await _categoria_id(db_session, "teste@example.com", "saida")
    ids = []
    for descricao in ["A", "B"]:
        criado = await cliente_autenticado.post(
            "/movimentos",
            json=_movimento_valido(conta_id, categoria_id=categoria_a_id, descricao=descricao),
        )
        ids.append(criado.json()["id"])

    # Outra categoria de saída qualquer, diferente da primeira (a árvore
    # semeada por omissão tem sempre mais do que uma — ver
    # app/services/categorias_seed.py).
    utilizador = await db_session.scalar(select(User).where(User.email == "teste@example.com"))
    categoria_b = await db_session.scalar(
        select(Categoria).where(
            Categoria.user_id == utilizador.id,
            Categoria.direcao == "saida",
            Categoria.parent_id.is_not(None),
            Categoria.id != categoria_a_id,
        )
    )

    resposta = await cliente_autenticado.post(
        "/movimentos/recategorizar-em-lote",
        json={"ids": ids, "categoria_id": str(categoria_b.id)},
    )

    assert resposta.status_code == 204
    for movimento_id in ids:
        corpo = (await cliente_autenticado.get(f"/movimentos/{movimento_id}")).json()
        assert corpo["categoria_id"] == str(categoria_b.id)


@pytest.mark.asyncio
async def test_recategorizar_movimentos_em_lote_com_direcao_errada_e_recusado(cliente_autenticado, db_session):
    # Os movimentos são de saída (valor negativo); a categoria de destino
    # é de entrada — incoerência que _validar_direcao tem de recusar.
    conta_id = await _criar_conta(cliente_autenticado)
    categoria_saida_id = await _categoria_id(db_session, "teste@example.com", "saida")
    categoria_entrada_id = await _categoria_id(db_session, "teste@example.com", "entrada")
    criado = await cliente_autenticado.post(
        "/movimentos", json=_movimento_valido(conta_id, categoria_id=categoria_saida_id)
    )
    movimento_id = criado.json()["id"]

    resposta = await cliente_autenticado.post(
        "/movimentos/recategorizar-em-lote",
        json={"ids": [movimento_id], "categoria_id": categoria_entrada_id},
    )

    assert resposta.status_code == 400
    # Nada foi recategorizado.
    corpo = (await cliente_autenticado.get(f"/movimentos/{movimento_id}")).json()
    assert corpo["categoria_id"] == categoria_saida_id


@pytest.mark.asyncio
async def test_recategorizar_movimentos_em_lote_com_categoria_de_outro_utilizador_devolve_404(client, db_session):
    a = {"email": "a@example.com", "password": "palavrapasse123"}
    await client.post("/auth/registo", json=a)
    await client.post("/auth/login", json=a)
    conta_a = await _criar_conta(client)
    categoria_a_id = await _categoria_id(db_session, "a@example.com", "saida")
    criado = await client.post(
        "/movimentos", json=_movimento_valido(conta_a, categoria_id=categoria_a_id)
    )
    movimento_id = criado.json()["id"]

    await client.post("/auth/logout")
    b = {"email": "b@example.com", "password": "palavrapasse123"}
    await client.post("/auth/registo", json=b)
    await client.post("/auth/login", json=b)
    categoria_b_id = await _categoria_id(db_session, "b@example.com", "saida")

    # De volta ao utilizador A, tenta recategorizar o SEU movimento para
    # uma categoria do B — que não é sua.
    await client.post("/auth/logout")
    await client.post("/auth/login", json=a)
    resposta = await client.post(
        "/movimentos/recategorizar-em-lote",
        json={"ids": [movimento_id], "categoria_id": categoria_b_id},
    )

    assert resposta.status_code == 404


@pytest.mark.asyncio
async def test_recategorizar_movimentos_em_lote_com_movimento_de_outro_utilizador_devolve_404(client, db_session):
    a = {"email": "a@example.com", "password": "palavrapasse123"}
    await client.post("/auth/registo", json=a)
    await client.post("/auth/login", json=a)
    conta_a = await _criar_conta(client)
    categoria_a_id = await _categoria_id(db_session, "a@example.com", "saida")
    criado = await client.post(
        "/movimentos", json=_movimento_valido(conta_a, categoria_id=categoria_a_id)
    )
    movimento_id = criado.json()["id"]

    await client.post("/auth/logout")
    b = {"email": "b@example.com", "password": "palavrapasse123"}
    await client.post("/auth/registo", json=b)
    await client.post("/auth/login", json=b)
    categoria_b_id = await _categoria_id(db_session, "b@example.com", "saida")

    resposta = await client.post(
        "/movimentos/recategorizar-em-lote",
        json={"ids": [movimento_id], "categoria_id": categoria_b_id},
    )

    assert resposta.status_code == 404
