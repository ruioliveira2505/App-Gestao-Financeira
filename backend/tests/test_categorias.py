"""
TESTES AOS ENDPOINTS DE CATEGORIAS
=====================================

Cobrem GET /categorias/arvore (a árvore semeada automaticamente no
registo — ver app/services/categorias_seed.py), POST /categorias (criar
um grupo ou uma subcategoria), PATCH /categorias/{id} (renomear, mover
uma subcategoria para outro grupo) e DELETE /categorias/{id} — incluindo
a regra central desta fatia: uma categoria com movimentos associados só
se elimina se o pedido indicar, em migrar_para_id, para onde esses
movimentos passam.
"""

import unicodedata

import pytest

CONTA_VALIDA = {
    "nome": "Conta à ordem",
    "banco": "BPI",
    "tipo": "Conta corrente",
    "moeda": "EUR",
    "data_ancora": "2026-01-01",
    "saldo_ancora": "1000.00",
}


def _grupo(arvore: list[dict], nome: str) -> dict:
    """Devolve o grupo com este nome, dentro da árvore devolvida por GET /categorias/arvore."""
    return next(g for g in arvore if g["nome"] == nome)


def _subcategoria(grupo: dict, nome: str) -> dict:
    """Devolve a subcategoria com este nome, dentro de um grupo da árvore."""
    return next(s for s in grupo["subcategorias"] if s["nome"] == nome)


def _chave_alfabetica(nome: str) -> str:
    """
    Chave de ordenação que trata uma letra acentuada como a sua letra base
    (ex.: "Água" ordena-se como "Agua", antes de "Bens...") — a mesma
    noção de "ordem alfabética" que a colação da base de dados aplica no
    ORDER BY da rota (app/routers/categorias.py), e que sorted() do Python
    NÃO reproduz sozinho: comparando por posição Unicode, uma maiúscula
    acentuada como "Á" tem um código muito mais alto do que qualquer letra
    ASCII, e ficaria sempre no fim de uma ordenação ingénua, nunca junto
    dos outros nomes começados por "A".
    """
    sem_acentos = unicodedata.normalize("NFKD", nome).encode("ascii", "ignore").decode("ascii")
    return sem_acentos.casefold()


async def _criar_conta_e_movimento(cliente, categoria_id: str, **overrides) -> str:
    """Cria uma conta e um movimento nessa categoria; devolve o id do movimento."""
    conta_id = (await cliente.post("/contas", json=CONTA_VALIDA)).json()["id"]
    corpo = {
        "conta_id": conta_id,
        "categoria_id": categoria_id,
        "data": "2026-02-01",
        "descricao": "Compras",
        "valor": "-50.00",
        **overrides,
    }
    resposta = await cliente.post("/movimentos", json=corpo)
    return resposta.json()["id"]


# ─── GET /categorias/arvore ────────────────────────────────────────────


@pytest.mark.asyncio
async def test_arvore_sem_sessao_e_recusada(client):
    resposta = await client.get("/categorias/arvore")
    assert resposta.status_code == 401


@pytest.mark.asyncio
async def test_arvore_tem_a_semente_por_omissao(cliente_autenticado):
    """A árvore de um utilizador recém-registado já vem semeada: 18
    grupos, 6 de entrada e 12 de saída (ver ARVORE_PADRAO)."""
    resposta = await cliente_autenticado.get("/categorias/arvore")

    assert resposta.status_code == 200
    arvore = resposta.json()
    assert len(arvore) == 18
    assert len([g for g in arvore if g["direcao"] == "entrada"]) == 6
    assert len([g for g in arvore if g["direcao"] == "saida"]) == 12


@pytest.mark.asyncio
async def test_arvore_ordena_grupos_e_subcategorias_alfabeticamente(cliente_autenticado):
    arvore = (await cliente_autenticado.get("/categorias/arvore")).json()

    nomes_grupos = [g["nome"] for g in arvore]
    assert nomes_grupos == sorted(nomes_grupos, key=_chave_alfabetica)

    nomes_subcategorias = [s["nome"] for s in _grupo(arvore, "Habitação")["subcategorias"]]
    assert nomes_subcategorias == sorted(nomes_subcategorias, key=_chave_alfabetica)


@pytest.mark.asyncio
async def test_arvore_marca_como_protegida_so_o_outros_dos_dois_grupos_refugio(cliente_autenticado):
    arvore = (await cliente_autenticado.get("/categorias/arvore")).json()

    assert _subcategoria(_grupo(arvore, "Outras Entradas"), "Outros")["protegida"] is True
    assert _subcategoria(_grupo(arvore, "Outras Saídas"), "Outros")["protegida"] is True
    # O "Outros" de um grupo normal não é protegido — é uma subcategoria
    # como outra qualquer, só com um nome sugestivo.
    assert _subcategoria(_grupo(arvore, "Habitação"), "Outros")["protegida"] is False


# ─── POST /categorias ──────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_criar_grupo_com_direcao(cliente_autenticado):
    resposta = await cliente_autenticado.post(
        "/categorias", json={"nome": "Hobbies Especiais", "direcao": "saida"}
    )

    assert resposta.status_code == 201
    corpo = resposta.json()
    assert corpo["nome"] == "Hobbies Especiais"
    assert corpo["parent_id"] is None
    assert corpo["direcao"] == "saida"
    assert corpo["protegida"] is False


@pytest.mark.asyncio
async def test_criar_grupo_sem_direcao_e_recusado(cliente_autenticado):
    resposta = await cliente_autenticado.post("/categorias", json={"nome": "Sem Direção"})
    assert resposta.status_code == 422


@pytest.mark.asyncio
async def test_criar_subcategoria_herda_a_direcao_do_grupo(cliente_autenticado):
    arvore = (await cliente_autenticado.get("/categorias/arvore")).json()
    grupo_id = _grupo(arvore, "Alimentação")["id"]

    resposta = await cliente_autenticado.post(
        "/categorias", json={"nome": "Bebidas", "parent_id": grupo_id}
    )

    assert resposta.status_code == 201
    corpo = resposta.json()
    assert corpo["parent_id"] == grupo_id
    assert corpo["direcao"] == "saida"


@pytest.mark.asyncio
async def test_criar_subcategoria_com_direcao_explicita_e_recusado(cliente_autenticado):
    arvore = (await cliente_autenticado.get("/categorias/arvore")).json()
    grupo_id = _grupo(arvore, "Alimentação")["id"]

    resposta = await cliente_autenticado.post(
        "/categorias", json={"nome": "Bebidas", "parent_id": grupo_id, "direcao": "saida"}
    )

    assert resposta.status_code == 422


@pytest.mark.asyncio
async def test_criar_subcategoria_dentro_de_outra_subcategoria_e_recusado(cliente_autenticado):
    arvore = (await cliente_autenticado.get("/categorias/arvore")).json()
    folha_id = _subcategoria(_grupo(arvore, "Alimentação"), "Supermercado")["id"]

    resposta = await cliente_autenticado.post(
        "/categorias", json={"nome": "Terceiro Nível", "parent_id": folha_id}
    )

    assert resposta.status_code == 400


@pytest.mark.asyncio
async def test_criar_categoria_com_nome_repetido_no_mesmo_grupo_e_recusado(cliente_autenticado):
    arvore = (await cliente_autenticado.get("/categorias/arvore")).json()
    grupo_id = _grupo(arvore, "Alimentação")["id"]

    # "Supermercado" já existe dentro de "Alimentação" (ver ARVORE_PADRAO).
    resposta = await cliente_autenticado.post(
        "/categorias", json={"nome": "Supermercado", "parent_id": grupo_id}
    )

    assert resposta.status_code == 409


@pytest.mark.asyncio
async def test_criar_categoria_com_parent_de_outro_utilizador_devolve_404(client):
    a = {"email": "a@example.com", "password": "palavrapasse123"}
    await client.post("/auth/registo", json=a)
    await client.post("/auth/login", json=a)
    arvore_a = (await client.get("/categorias/arvore")).json()
    grupo_a_id = _grupo(arvore_a, "Alimentação")["id"]

    await client.post("/auth/logout")
    b = {"email": "b@example.com", "password": "palavrapasse123"}
    await client.post("/auth/registo", json=b)
    await client.post("/auth/login", json=b)

    resposta = await client.post("/categorias", json={"nome": "Bebidas", "parent_id": grupo_a_id})

    assert resposta.status_code == 404


# ─── PATCH /categorias/{id} ────────────────────────────────────────────


@pytest.mark.asyncio
async def test_editar_categoria_renomeia(cliente_autenticado):
    criada = await cliente_autenticado.post(
        "/categorias", json={"nome": "Nome Antigo", "direcao": "saida"}
    )
    categoria_id = criada.json()["id"]

    resposta = await cliente_autenticado.patch(f"/categorias/{categoria_id}", json={"nome": "Nome Novo"})

    assert resposta.status_code == 200
    assert resposta.json()["nome"] == "Nome Novo"


@pytest.mark.asyncio
async def test_editar_grupo_para_ter_parent_id_e_recusado(cliente_autenticado):
    arvore = (await cliente_autenticado.get("/categorias/arvore")).json()
    grupo_id = _grupo(arvore, "Alimentação")["id"]
    outro_grupo_id = _grupo(arvore, "Transportes")["id"]

    resposta = await cliente_autenticado.patch(
        f"/categorias/{grupo_id}", json={"nome": "Alimentação", "parent_id": outro_grupo_id}
    )

    assert resposta.status_code == 400


@pytest.mark.asyncio
async def test_editar_subcategoria_sem_parent_id_e_recusado(cliente_autenticado):
    arvore = (await cliente_autenticado.get("/categorias/arvore")).json()
    folha_id = _subcategoria(_grupo(arvore, "Alimentação"), "Supermercado")["id"]

    resposta = await cliente_autenticado.patch(f"/categorias/{folha_id}", json={"nome": "Supermercado"})

    assert resposta.status_code == 400


@pytest.mark.asyncio
async def test_editar_subcategoria_pode_move_la_para_outro_grupo_da_mesma_direcao(cliente_autenticado):
    arvore = (await cliente_autenticado.get("/categorias/arvore")).json()
    folha_id = _subcategoria(_grupo(arvore, "Alimentação"), "Take-away e Entregas")["id"]
    novo_grupo_id = _grupo(arvore, "Bens de Consumo")["id"]

    resposta = await cliente_autenticado.patch(
        f"/categorias/{folha_id}", json={"nome": "Take-away e Entregas", "parent_id": novo_grupo_id}
    )

    assert resposta.status_code == 200
    assert resposta.json()["parent_id"] == novo_grupo_id


@pytest.mark.asyncio
async def test_editar_subcategoria_para_grupo_de_direcao_diferente_e_recusado(cliente_autenticado):
    arvore = (await cliente_autenticado.get("/categorias/arvore")).json()
    folha_id = _subcategoria(_grupo(arvore, "Alimentação"), "Supermercado")["id"]
    grupo_entrada_id = _grupo(arvore, "Trabalho")["id"]

    resposta = await cliente_autenticado.patch(
        f"/categorias/{folha_id}", json={"nome": "Supermercado", "parent_id": grupo_entrada_id}
    )

    assert resposta.status_code == 400


@pytest.mark.asyncio
async def test_editar_categoria_protegida_e_recusado(cliente_autenticado):
    arvore = (await cliente_autenticado.get("/categorias/arvore")).json()
    grupo = _grupo(arvore, "Outras Saídas")
    protegida_id = _subcategoria(grupo, "Outros")["id"]

    resposta = await cliente_autenticado.patch(
        f"/categorias/{protegida_id}", json={"nome": "Outra Coisa", "parent_id": grupo["id"]}
    )

    assert resposta.status_code == 400


@pytest.mark.asyncio
async def test_editar_categoria_de_outro_utilizador_devolve_404(client):
    a = {"email": "a@example.com", "password": "palavrapasse123"}
    await client.post("/auth/registo", json=a)
    await client.post("/auth/login", json=a)
    arvore_a = (await client.get("/categorias/arvore")).json()
    grupo_a_id = _grupo(arvore_a, "Alimentação")["id"]

    await client.post("/auth/logout")
    b = {"email": "b@example.com", "password": "palavrapasse123"}
    await client.post("/auth/registo", json=b)
    await client.post("/auth/login", json=b)

    resposta = await client.patch(f"/categorias/{grupo_a_id}", json={"nome": "Roubada"})

    assert resposta.status_code == 404


# ─── DELETE /categorias/{id} ───────────────────────────────────────────


@pytest.mark.asyncio
async def test_eliminar_subcategoria_sem_movimentos(cliente_autenticado):
    arvore = (await cliente_autenticado.get("/categorias/arvore")).json()
    grupo_id = _grupo(arvore, "Alimentação")["id"]
    categoria_id = (
        await cliente_autenticado.post("/categorias", json={"nome": "Temporária", "parent_id": grupo_id})
    ).json()["id"]

    resposta = await cliente_autenticado.delete(f"/categorias/{categoria_id}")
    assert resposta.status_code == 204


@pytest.mark.asyncio
async def test_eliminar_categoria_protegida_e_recusado(cliente_autenticado):
    arvore = (await cliente_autenticado.get("/categorias/arvore")).json()
    protegida_id = _subcategoria(_grupo(arvore, "Outras Entradas"), "Outros")["id"]

    resposta = await cliente_autenticado.delete(f"/categorias/{protegida_id}")

    assert resposta.status_code == 400


@pytest.mark.asyncio
async def test_eliminar_categoria_com_movimentos_sem_migrar_para_id_e_recusado(cliente_autenticado):
    arvore = (await cliente_autenticado.get("/categorias/arvore")).json()
    categoria_id = _subcategoria(_grupo(arvore, "Alimentação"), "Supermercado")["id"]
    await _criar_conta_e_movimento(cliente_autenticado, categoria_id)

    resposta = await cliente_autenticado.delete(f"/categorias/{categoria_id}")

    assert resposta.status_code == 409


@pytest.mark.asyncio
async def test_eliminar_categoria_com_movimentos_e_migrar_para_id_reatribui_os_movimentos(
    cliente_autenticado,
):
    arvore = (await cliente_autenticado.get("/categorias/arvore")).json()
    origem_id = _subcategoria(_grupo(arvore, "Alimentação"), "Supermercado")["id"]
    destino_id = _subcategoria(_grupo(arvore, "Alimentação"), "Restaurantes e Cafés")["id"]
    movimento_id = await _criar_conta_e_movimento(cliente_autenticado, origem_id)

    resposta = await cliente_autenticado.delete(
        f"/categorias/{origem_id}", params={"migrar_para_id": destino_id}
    )
    assert resposta.status_code == 204

    movimento = (await cliente_autenticado.get(f"/movimentos/{movimento_id}")).json()
    assert movimento["categoria_id"] == destino_id


@pytest.mark.asyncio
async def test_eliminar_categoria_com_migrar_para_id_de_direcao_diferente_e_recusado(cliente_autenticado):
    arvore = (await cliente_autenticado.get("/categorias/arvore")).json()
    origem_id = _subcategoria(_grupo(arvore, "Alimentação"), "Supermercado")["id"]
    destino_entrada_id = _subcategoria(_grupo(arvore, "Trabalho"), "Salário")["id"]
    await _criar_conta_e_movimento(cliente_autenticado, origem_id)

    resposta = await cliente_autenticado.delete(
        f"/categorias/{origem_id}", params={"migrar_para_id": destino_entrada_id}
    )

    assert resposta.status_code == 400


@pytest.mark.asyncio
async def test_eliminar_categoria_com_migrar_para_id_igual_a_si_propria_e_recusado(cliente_autenticado):
    arvore = (await cliente_autenticado.get("/categorias/arvore")).json()
    origem_id = _subcategoria(_grupo(arvore, "Alimentação"), "Supermercado")["id"]
    await _criar_conta_e_movimento(cliente_autenticado, origem_id)

    resposta = await cliente_autenticado.delete(
        f"/categorias/{origem_id}", params={"migrar_para_id": origem_id}
    )

    assert resposta.status_code == 400


@pytest.mark.asyncio
async def test_eliminar_grupo_apaga_as_subcategorias_em_cascata(cliente_autenticado):
    grupo_id = (
        await cliente_autenticado.post("/categorias", json={"nome": "Grupo Temporário", "direcao": "saida"})
    ).json()["id"]
    subcategoria_id = (
        await cliente_autenticado.post(
            "/categorias", json={"nome": "Subcategoria Temporária", "parent_id": grupo_id}
        )
    ).json()["id"]

    resposta = await cliente_autenticado.delete(f"/categorias/{grupo_id}")
    assert resposta.status_code == 204

    arvore = (await cliente_autenticado.get("/categorias/arvore")).json()
    assert all(g["id"] != grupo_id for g in arvore)
    # A subcategoria não sobrevive "órfã" a apagar-se o grupo.
    todas_subcategorias_ids = {s["id"] for g in arvore for s in g["subcategorias"]}
    assert subcategoria_id not in todas_subcategorias_ids


@pytest.mark.asyncio
async def test_eliminar_grupo_com_subcategoria_com_movimentos_migra_e_apaga(cliente_autenticado):
    """Apagar um grupo cujas subcategorias têm movimentos também exige
    migrar_para_id — os movimentos migram todos para o mesmo destino."""
    arvore = (await cliente_autenticado.get("/categorias/arvore")).json()
    grupo_id = _grupo(arvore, "Alimentação")["id"]
    origem_id = _subcategoria(_grupo(arvore, "Alimentação"), "Supermercado")["id"]
    destino_id = _subcategoria(_grupo(arvore, "Outras Saídas"), "Outros")["id"]
    movimento_id = await _criar_conta_e_movimento(cliente_autenticado, origem_id)

    resposta = await cliente_autenticado.delete(
        f"/categorias/{grupo_id}", params={"migrar_para_id": destino_id}
    )
    assert resposta.status_code == 204

    movimento = (await cliente_autenticado.get(f"/movimentos/{movimento_id}")).json()
    assert movimento["categoria_id"] == destino_id


@pytest.mark.asyncio
async def test_eliminar_categoria_de_outro_utilizador_devolve_404(client):
    a = {"email": "a@example.com", "password": "palavrapasse123"}
    await client.post("/auth/registo", json=a)
    await client.post("/auth/login", json=a)
    arvore_a = (await client.get("/categorias/arvore")).json()
    categoria_a_id = _subcategoria(_grupo(arvore_a, "Alimentação"), "Supermercado")["id"]

    await client.post("/auth/logout")
    b = {"email": "b@example.com", "password": "palavrapasse123"}
    await client.post("/auth/registo", json=b)
    await client.post("/auth/login", json=b)

    resposta = await client.delete(f"/categorias/{categoria_a_id}")

    assert resposta.status_code == 404
