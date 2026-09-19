"""
TESTES AOS ENDPOINTS DE RESUMO
==================================

Cobrem GET /resumo: exigência de sessão, o saldo total (somado entre
contas, convertido à taxa de hoje, tolerante à falta de taxa numa
conta), entradas/saídas/líquido do mês actual (convertidos à taxa do
PRÓPRIO DIA de cada movimento, não a de hoje — o caso central desta
funcionalidade), a repartição de entradas e de saídas por GRUPO de
categoria (agregação de subcategoria + grupo directo, ordem decrescente,
percentagem, grupos sem movimentos ausentes da lista), o período
devolvido na resposta, e o âmbito por utilizador (nunca soma movimentos
ou contas de outra pessoa).

E GET /resumo/categorias/{grupo_id}: a mesma agregação um nível mais
fundo, por SUBCATEGORIA dentro de um único grupo — percentagem face ao
TOTAL DO GRUPO (não ao total geral), um movimento categorizado
directamente no grupo a aparecer como a sua própria linha, ownership
(404 de outro utilizador), e a recusa (400) quando o id pedido não é o
de um grupo.
"""

from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import select

from app.models.categoria import Categoria
from app.models.taxa_cambio import TaxaCambio
from app.models.user import User

_HOJE = date.today()
_INICIO_MES = _HOJE.replace(day=1)
# O último dia do mês anterior — sempre fora do período do resumo (que só
# começa em _INICIO_MES). fromordinal(...- 1) evita ter de tratar à mão a
# viragem de Janeiro para Dezembro do ano anterior.
_MES_ANTERIOR = date.fromordinal(_INICIO_MES.toordinal() - 1)


async def _categoria_id(db_session, email: str, direcao: str) -> str:
    """Devolve o id de uma subcategoria qualquer, com esta direcao, da
    árvore semeada automaticamente no registo (ver app/services/
    categorias_seed.py) — estes testes não são sobre categorias, só
    precisam de um id real e coerente com o sinal do valor do movimento."""
    utilizador = await db_session.scalar(select(User).where(User.email == email))
    categoria = await db_session.scalar(
        select(Categoria).where(
            Categoria.user_id == utilizador.id,
            Categoria.direcao == direcao,
            Categoria.parent_id.is_not(None),
        )
    )
    return str(categoria.id)


async def _grupo_e_subcategoria(
    db_session, email: str, direcao: str, indice: int = 0
) -> tuple[str, str, str]:
    """
    Devolve (grupo_id, grupo_nome, subcategoria_id) do grupo nº "indice"
    (por "ordem", a mesma posição deliberada da árvore semeada — ver a
    nota ORDEM em app/models/categoria.py) desta direcao. Todo grupo
    semeado por omissão tem pelo menos uma subcategoria ("Outros"), por
    isso não é preciso tratar o caso de não haver nenhuma.
    """
    utilizador = await db_session.scalar(select(User).where(User.email == email))
    grupos = (
        await db_session.scalars(
            select(Categoria)
            .where(
                Categoria.user_id == utilizador.id,
                Categoria.direcao == direcao,
                Categoria.parent_id.is_(None),
            )
            .order_by(Categoria.ordem)
        )
    ).all()
    grupo = grupos[indice]
    subcategoria = await db_session.scalar(
        select(Categoria).where(Categoria.parent_id == grupo.id).order_by(Categoria.ordem)
    )
    return str(grupo.id), grupo.nome, str(subcategoria.id)


async def _subcategoria_de(db_session, grupo_id: str, indice: int) -> tuple[str, str]:
    """Devolve (subcategoria_id, nome) da subcategoria nº "indice" (por
    "ordem") deste grupo — para testes que precisam de MAIS do que uma
    subcategoria do mesmo grupo (ver _grupo_e_subcategoria, que só dá a
    primeira)."""
    subcategorias = (
        await db_session.scalars(
            select(Categoria).where(Categoria.parent_id == grupo_id).order_by(Categoria.ordem)
        )
    ).all()
    subcategoria = subcategorias[indice]
    return str(subcategoria.id), subcategoria.nome


async def _criar_conta(cliente, moeda: str = "EUR", **overrides) -> str:
    resposta = await cliente.post(
        "/contas",
        json={
            "nome": "Conta",
            "moeda": moeda,
            "data_ancora": "2020-01-01",
            "saldo_ancora": "0.00",
            **overrides,
        },
    )
    return resposta.json()["id"]


async def _criar_movimento(
    cliente,
    db_session,
    conta_id: str,
    valor: str,
    data_movimento: date,
    email: str = "teste@example.com",
    categoria_id: str | None = None,
) -> None:
    direcao = "entrada" if Decimal(valor) > 0 else "saida"
    if categoria_id is None:
        categoria_id = await _categoria_id(db_session, email, direcao)
    resposta = await cliente.post(
        "/movimentos",
        json={
            "conta_id": conta_id,
            "categoria_id": categoria_id,
            "data": data_movimento.isoformat(),
            "descricao": "Movimento de teste",
            "valor": valor,
        },
    )
    assert resposta.status_code == 201, resposta.json()


@pytest.mark.asyncio
async def test_obter_resumo_sem_sessao_e_recusado(client):
    resposta = await client.get("/resumo")

    assert resposta.status_code == 401


@pytest.mark.asyncio
async def test_obter_resumo_sem_nenhuma_conta_devolve_tudo_a_zero(cliente_autenticado):
    resposta = await cliente_autenticado.get("/resumo")

    assert resposta.status_code == 200
    corpo = resposta.json()
    assert corpo["saldo_total"] == "0.00"
    assert corpo["entradas"] == "0.00"
    assert corpo["saidas"] == "0.00"
    assert corpo["liquido"] == "0.00"
    assert corpo["categorias_entradas"] == []
    assert corpo["categorias_saidas"] == []


@pytest.mark.asyncio
async def test_obter_resumo_devolve_o_periodo_do_mes_actual(cliente_autenticado):
    resposta = await cliente_autenticado.get("/resumo")

    corpo = resposta.json()
    assert corpo["periodo_inicio"] == _INICIO_MES.isoformat()
    assert corpo["periodo_fim"] == _HOJE.isoformat()


@pytest.mark.asyncio
async def test_saldo_total_soma_contas_na_mesma_moeda_sem_precisar_de_taxa(cliente_autenticado):
    await _criar_conta(cliente_autenticado, saldo_ancora="1000.00")
    await _criar_conta(cliente_autenticado, saldo_ancora="500.00")

    resposta = await cliente_autenticado.get("/resumo")

    assert resposta.json()["saldo_total"] == "1500.00"


@pytest.mark.asyncio
async def test_saldo_total_converte_contas_em_moedas_diferentes_para_a_principal(
    cliente_autenticado, db_session
):
    # moeda_principal fica EUR (omissão); 1 EUR = 1.10 USD, hoje.
    db_session.add(TaxaCambio(data=_HOJE, moeda="USD", por_1_eur=Decimal("1.10")))
    await db_session.commit()

    await _criar_conta(cliente_autenticado, moeda="EUR", saldo_ancora="100.00")
    await _criar_conta(cliente_autenticado, moeda="USD", saldo_ancora="110.00")

    resposta = await cliente_autenticado.get("/resumo")

    # 100 EUR + (110 USD -> 100 EUR) = 200 EUR.
    assert resposta.json()["saldo_total"] == "200.00"


@pytest.mark.asyncio
async def test_saldo_total_ignora_em_silencio_uma_conta_sem_taxa_disponivel(cliente_autenticado):
    # moeda_principal EUR, uma conta em USD, e NENHUMA taxa USD guardada.
    await _criar_conta(cliente_autenticado, moeda="EUR", saldo_ancora="100.00")
    await _criar_conta(cliente_autenticado, moeda="USD", saldo_ancora="9999.00")

    resposta = await cliente_autenticado.get("/resumo")

    # A conta em USD fica de fora da soma — só os 100 EUR contam.
    assert resposta.status_code == 200
    assert resposta.json()["saldo_total"] == "100.00"


@pytest.mark.asyncio
async def test_entradas_saidas_liquido_do_mes_actual_na_mesma_moeda(
    cliente_autenticado, db_session
):
    conta_id = await _criar_conta(cliente_autenticado)
    await _criar_movimento(cliente_autenticado, db_session, conta_id, "1000.00", _INICIO_MES)
    await _criar_movimento(cliente_autenticado, db_session, conta_id, "-300.00", _HOJE)

    resposta = await cliente_autenticado.get("/resumo")

    corpo = resposta.json()
    assert corpo["entradas"] == "1000.00"
    assert corpo["saidas"] == "-300.00"
    assert corpo["liquido"] == "700.00"


@pytest.mark.asyncio
async def test_movimento_fora_do_mes_actual_nao_conta_para_entradas_saidas(
    cliente_autenticado, db_session
):
    conta_id = await _criar_conta(cliente_autenticado)
    await _criar_movimento(cliente_autenticado, db_session, conta_id, "500.00", _MES_ANTERIOR)
    await _criar_movimento(cliente_autenticado, db_session, conta_id, "50.00", _INICIO_MES)

    resposta = await cliente_autenticado.get("/resumo")

    # Só o movimento do mês actual conta — o de _MES_ANTERIOR fica de fora.
    assert resposta.json()["entradas"] == "50.00"


@pytest.mark.asyncio
async def test_entradas_converte_cada_movimento_a_taxa_do_seu_proprio_dia(
    cliente_autenticado, db_session
):
    # Duas taxas diferentes dentro do próprio período: a de "_INICIO_MES"
    # (quando o movimento acontece) e a de "_HOJE" (que não deve ser
    # usada) — confirma que a conversão usa a taxa DO DIA DO MOVIMENTO,
    # nunca a mais recente, mesmo quando ambas estão dentro do intervalo
    # pedido a obter_taxas_do_periodo.
    db_session.add(TaxaCambio(data=_INICIO_MES, moeda="USD", por_1_eur=Decimal("1.00")))
    db_session.add(TaxaCambio(data=_HOJE, moeda="USD", por_1_eur=Decimal("2.00")))
    await db_session.commit()

    conta_id = await _criar_conta(cliente_autenticado, moeda="USD")
    await _criar_movimento(cliente_autenticado, db_session, conta_id, "110.00", _INICIO_MES)

    resposta = await cliente_autenticado.get("/resumo")

    # Com a taxa de _INICIO_MES (1 EUR = 1.00 USD): 110 USD -> 110 EUR.
    # Se tivesse usado a taxa de hoje (1 EUR = 2.00 USD), daria 55.00.
    assert resposta.json()["entradas"] == "110.00"


@pytest.mark.asyncio
async def test_entradas_funciona_quando_moeda_principal_nao_e_a_de_nenhuma_conta(
    cliente_autenticado, db_session
):
    # Regressão: moeda_principal ("GBP") diferente da moeda de QUALQUER
    # conta (só há uma conta, em EUR) — e diferente de EUR, a moeda-pivot.
    # Antes da correção, a tabela de taxas pré-carregada só trazia as
    # moedas das CONTAS (aqui, só "EUR", que nem chega a precisar de taxa
    # própria — é o pivot) — nunca a moeda PRINCIPAL, o destino real da
    # conversão. Faltando "GBP" na tabela, TODOS os movimentos levantavam
    # SemTaxaCambio (apanhada em silêncio) e a soma ficava sempre "0.00",
    # indistinguível de não ter havido nenhum movimento no período.
    db_session.add(TaxaCambio(data=_INICIO_MES, moeda="GBP", por_1_eur=Decimal("0.85")))
    await db_session.commit()
    await cliente_autenticado.patch("/auth/me", json={"moeda_principal": "GBP"})

    conta_id = await _criar_conta(cliente_autenticado, moeda="EUR")
    await _criar_movimento(cliente_autenticado, db_session, conta_id, "100.00", _INICIO_MES)

    resposta = await cliente_autenticado.get("/resumo")

    # 100 EUR -> 85 GBP (1 EUR = 0.85 GBP). Não "0.00".
    assert resposta.json()["entradas"] == "85.00"


@pytest.mark.asyncio
async def test_movimento_sem_taxa_disponivel_para_a_sua_data_e_ignorado_em_silencio(
    cliente_autenticado, db_session
):
    conta_eur_id = await _criar_conta(cliente_autenticado, moeda="EUR")
    conta_usd_id = await _criar_conta(cliente_autenticado, moeda="USD")
    await _criar_movimento(cliente_autenticado, db_session, conta_eur_id, "100.00", _INICIO_MES)
    # Nenhuma taxa USD guardada — este movimento não pode ser convertido.
    await _criar_movimento(cliente_autenticado, db_session, conta_usd_id, "9999.00", _INICIO_MES)

    resposta = await cliente_autenticado.get("/resumo")

    assert resposta.status_code == 200
    assert resposta.json()["entradas"] == "100.00"


@pytest.mark.asyncio
async def test_categorias_entradas_agrega_subcategoria_e_grupo_directo_no_mesmo_grupo(
    cliente_autenticado, db_session
):
    # Dois movimentos no MESMO grupo: um categorizado directamente no
    # grupo, outro numa subcategoria desse grupo — têm de somar-se numa
    # só linha (ver a nota "REPARTIÇÃO POR GRUPO" em
    # app/routers/resumo.py), não aparecer como duas.
    grupo_id, grupo_nome, subcategoria_id = await _grupo_e_subcategoria(
        db_session, "teste@example.com", "entrada"
    )
    conta_id = await _criar_conta(cliente_autenticado)
    await _criar_movimento(
        cliente_autenticado, db_session, conta_id, "100.00", _INICIO_MES, categoria_id=grupo_id
    )
    await _criar_movimento(
        cliente_autenticado,
        db_session,
        conta_id,
        "50.00",
        _INICIO_MES,
        categoria_id=subcategoria_id,
    )

    resposta = await cliente_autenticado.get("/resumo")

    categorias = resposta.json()["categorias_entradas"]
    assert len(categorias) == 1
    assert categorias[0]["grupo_id"] == grupo_id
    assert categorias[0]["nome"] == grupo_nome
    assert categorias[0]["valor"] == "150.00"
    assert categorias[0]["percentagem"] == 100.0


@pytest.mark.asyncio
async def test_categorias_entradas_por_ordem_decrescente_com_percentagem_correcta(
    cliente_autenticado, db_session
):
    _, _, sub_a = await _grupo_e_subcategoria(db_session, "teste@example.com", "entrada", indice=0)
    _, _, sub_b = await _grupo_e_subcategoria(db_session, "teste@example.com", "entrada", indice=1)
    conta_id = await _criar_conta(cliente_autenticado)
    # Grupo A: 300 (25%); Grupo B: 900 (75%) — total 1200.
    await _criar_movimento(
        cliente_autenticado, db_session, conta_id, "300.00", _INICIO_MES, categoria_id=sub_a
    )
    await _criar_movimento(
        cliente_autenticado, db_session, conta_id, "900.00", _INICIO_MES, categoria_id=sub_b
    )

    resposta = await cliente_autenticado.get("/resumo")

    categorias = resposta.json()["categorias_entradas"]
    assert len(categorias) == 2
    # O maior (grupo B, 900) vem primeiro.
    assert categorias[0]["valor"] == "900.00"
    assert categorias[0]["percentagem"] == 75.0
    assert categorias[1]["valor"] == "300.00"
    assert categorias[1]["percentagem"] == 25.0


@pytest.mark.asyncio
async def test_categorias_saidas_mantem_o_sinal_negativo_no_valor(cliente_autenticado, db_session):
    _, _, subcategoria_id = await _grupo_e_subcategoria(db_session, "teste@example.com", "saida")
    conta_id = await _criar_conta(cliente_autenticado)
    await _criar_movimento(
        cliente_autenticado,
        db_session,
        conta_id,
        "-200.00",
        _INICIO_MES,
        categoria_id=subcategoria_id,
    )

    resposta = await cliente_autenticado.get("/resumo")

    categorias = resposta.json()["categorias_saidas"]
    assert len(categorias) == 1
    assert categorias[0]["valor"] == "-200.00"
    # A percentagem é sempre positiva, mesmo com o valor negativo.
    assert categorias[0]["percentagem"] == 100.0


@pytest.mark.asyncio
async def test_grupo_sem_movimentos_no_periodo_nao_aparece(cliente_autenticado, db_session):
    # Só um movimento, num único grupo — a árvore por omissão tem vários
    # grupos de entrada (ver app/services/categorias_seed.py); confirma
    # que só o grupo COM movimento aparece, não um por cada grupo semeado.
    _, _, subcategoria_id = await _grupo_e_subcategoria(db_session, "teste@example.com", "entrada")
    conta_id = await _criar_conta(cliente_autenticado)
    await _criar_movimento(
        cliente_autenticado,
        db_session,
        conta_id,
        "100.00",
        _INICIO_MES,
        categoria_id=subcategoria_id,
    )

    resposta = await cliente_autenticado.get("/resumo")

    assert len(resposta.json()["categorias_entradas"]) == 1


@pytest.mark.asyncio
async def test_categorias_excluem_movimento_fora_do_mes_actual(cliente_autenticado, db_session):
    _, _, subcategoria_id = await _grupo_e_subcategoria(db_session, "teste@example.com", "entrada")
    conta_id = await _criar_conta(cliente_autenticado)
    await _criar_movimento(
        cliente_autenticado,
        db_session,
        conta_id,
        "500.00",
        _MES_ANTERIOR,
        categoria_id=subcategoria_id,
    )

    resposta = await cliente_autenticado.get("/resumo")

    assert resposta.json()["categorias_entradas"] == []


@pytest.mark.asyncio
async def test_resumo_nunca_soma_contas_ou_movimentos_de_outro_utilizador(client, db_session):
    # Utilizador A: uma conta com saldo e um movimento.
    a = {"email": "a@example.com", "password": "palavrapasse123"}
    await client.post("/auth/registo", json=a)
    await client.post("/auth/login", json=a)
    conta_a_id = await _criar_conta(client, saldo_ancora="1000.00")
    await _criar_movimento(client, db_session, conta_a_id, "500.00", _INICIO_MES, email="a@example.com")
    await client.post("/auth/logout")

    # Utilizador B: sem nenhuma conta nem movimento.
    b = {"email": "b@example.com", "password": "palavrapasse123"}
    await client.post("/auth/registo", json=b)
    await client.post("/auth/login", json=b)

    resposta = await client.get("/resumo")

    corpo = resposta.json()
    assert corpo["saldo_total"] == "0.00"
    assert corpo["entradas"] == "0.00"


# ─── GET /resumo/categorias/{grupo_id} ────────────────────────────────────


@pytest.mark.asyncio
async def test_obter_detalhe_grupo_sem_sessao_e_recusado(client, db_session):
    # Regista um utilizador só para ter uma árvore de categorias semeada
    # (e portanto um grupo_id real) — depois termina a sessão, sem a qual
    # o pedido a seguir tem de ser recusado de qualquer forma.
    credenciais = {"email": "sem-sessao@example.com", "password": "palavrapasse123"}
    await client.post("/auth/registo", json=credenciais)
    await client.post("/auth/login", json=credenciais)
    grupo_id, _, _ = await _grupo_e_subcategoria(db_session, "sem-sessao@example.com", "entrada")
    await client.post("/auth/logout")

    resposta = await client.get(f"/resumo/categorias/{grupo_id}")

    assert resposta.status_code == 401


@pytest.mark.asyncio
async def test_obter_detalhe_grupo_de_outro_utilizador_e_recusado(client, db_session):
    outro = {"email": "outro-grupo@example.com", "password": "palavrapasse123"}
    await client.post("/auth/registo", json=outro)
    await client.post("/auth/login", json=outro)
    grupo_de_outro, _, _ = await _grupo_e_subcategoria(db_session, "outro-grupo@example.com", "entrada")
    await client.post("/auth/logout")

    a = {"email": "com-sessao@example.com", "password": "palavrapasse123"}
    await client.post("/auth/registo", json=a)
    await client.post("/auth/login", json=a)

    resposta = await client.get(f"/resumo/categorias/{grupo_de_outro}")

    assert resposta.status_code == 404


@pytest.mark.asyncio
async def test_obter_detalhe_grupo_com_id_de_subcategoria_e_recusado(cliente_autenticado, db_session):
    _, _, subcategoria_id = await _grupo_e_subcategoria(db_session, "teste@example.com", "entrada")

    resposta = await cliente_autenticado.get(f"/resumo/categorias/{subcategoria_id}")

    assert resposta.status_code == 400


@pytest.mark.asyncio
async def test_obter_detalhe_grupo_sem_movimentos_devolve_subcategorias_vazio(
    cliente_autenticado, db_session
):
    grupo_id, grupo_nome, _ = await _grupo_e_subcategoria(db_session, "teste@example.com", "entrada")

    resposta = await cliente_autenticado.get(f"/resumo/categorias/{grupo_id}")

    assert resposta.status_code == 200
    corpo = resposta.json()
    assert corpo["grupo_id"] == grupo_id
    assert corpo["nome"] == grupo_nome
    assert corpo["valor"] == "0.00"
    assert corpo["subcategorias"] == []


@pytest.mark.asyncio
async def test_obter_detalhe_grupo_agrega_por_subcategoria_com_percentagem_face_ao_grupo(
    cliente_autenticado, db_session
):
    grupo_id, _, _ = await _grupo_e_subcategoria(db_session, "teste@example.com", "saida")
    sub_a_id, sub_a_nome = await _subcategoria_de(db_session, grupo_id, 0)
    sub_b_id, sub_b_nome = await _subcategoria_de(db_session, grupo_id, 1)
    conta_id = await _criar_conta(cliente_autenticado)
    # Sub A: 300 (25% do grupo); Sub B: 900 (75% do grupo) — total 1200.
    await _criar_movimento(
        cliente_autenticado, db_session, conta_id, "-300.00", _INICIO_MES, categoria_id=sub_a_id
    )
    await _criar_movimento(
        cliente_autenticado, db_session, conta_id, "-900.00", _INICIO_MES, categoria_id=sub_b_id
    )

    resposta = await cliente_autenticado.get(f"/resumo/categorias/{grupo_id}")

    corpo = resposta.json()
    assert corpo["valor"] == "-1200.00"
    subcategorias = corpo["subcategorias"]
    assert len(subcategorias) == 2
    # A maior (Sub B, 900) vem primeiro.
    assert subcategorias[0]["nome"] == sub_b_nome
    assert subcategorias[0]["valor"] == "-900.00"
    assert subcategorias[0]["percentagem"] == 75.0
    assert subcategorias[1]["nome"] == sub_a_nome
    assert subcategorias[1]["valor"] == "-300.00"
    assert subcategorias[1]["percentagem"] == 25.0


@pytest.mark.asyncio
async def test_obter_detalhe_grupo_movimento_directo_no_grupo_aparece_como_linha_propria(
    cliente_autenticado, db_session
):
    # Um movimento categorizado DIRECTAMENTE no grupo (sem escolher
    # subcategoria) — ver a nota "REPARTIÇÃO POR SUBCATEGORIA" em
    # app/routers/resumo.py: tem de aparecer como a sua própria linha,
    # com o nome do próprio grupo, não desaparecer da lista.
    grupo_id, grupo_nome, subcategoria_id = await _grupo_e_subcategoria(
        db_session, "teste@example.com", "entrada"
    )
    conta_id = await _criar_conta(cliente_autenticado)
    await _criar_movimento(
        cliente_autenticado, db_session, conta_id, "100.00", _INICIO_MES, categoria_id=grupo_id
    )
    await _criar_movimento(
        cliente_autenticado,
        db_session,
        conta_id,
        "50.00",
        _INICIO_MES,
        categoria_id=subcategoria_id,
    )

    resposta = await cliente_autenticado.get(f"/resumo/categorias/{grupo_id}")

    corpo = resposta.json()
    assert corpo["valor"] == "150.00"
    subcategorias = corpo["subcategorias"]
    assert len(subcategorias) == 2
    nomes_e_valores = {s["nome"]: s["valor"] for s in subcategorias}
    assert nomes_e_valores[grupo_nome] == "100.00"


@pytest.mark.asyncio
async def test_obter_detalhe_grupo_converte_a_taxa_do_dia_do_movimento(
    cliente_autenticado, db_session
):
    db_session.add(TaxaCambio(data=_INICIO_MES, moeda="USD", por_1_eur=Decimal("1.00")))
    db_session.add(TaxaCambio(data=_HOJE, moeda="USD", por_1_eur=Decimal("2.00")))
    await db_session.commit()

    grupo_id, _, subcategoria_id = await _grupo_e_subcategoria(db_session, "teste@example.com", "entrada")
    conta_id = await _criar_conta(cliente_autenticado, moeda="USD")
    await _criar_movimento(
        cliente_autenticado,
        db_session,
        conta_id,
        "110.00",
        _INICIO_MES,
        categoria_id=subcategoria_id,
    )

    resposta = await cliente_autenticado.get(f"/resumo/categorias/{grupo_id}")

    # Com a taxa de _INICIO_MES (1 EUR = 1.00 USD): 110 USD -> 110 EUR.
    # Se tivesse usado a taxa de hoje (1 EUR = 2.00 USD), daria 55.00.
    assert resposta.json()["valor"] == "110.00"


@pytest.mark.asyncio
async def test_obter_detalhe_grupo_ignora_movimentos_de_outro_grupo_e_fora_do_periodo(
    cliente_autenticado, db_session
):
    grupo_id, _, subcategoria_id = await _grupo_e_subcategoria(db_session, "teste@example.com", "entrada")
    outro_grupo_id, _, outra_subcategoria_id = await _grupo_e_subcategoria(
        db_session, "teste@example.com", "entrada", indice=1
    )
    conta_id = await _criar_conta(cliente_autenticado)
    await _criar_movimento(
        cliente_autenticado, db_session, conta_id, "100.00", _INICIO_MES, categoria_id=subcategoria_id
    )
    # Fora do período.
    await _criar_movimento(
        cliente_autenticado, db_session, conta_id, "500.00", _MES_ANTERIOR, categoria_id=subcategoria_id
    )
    # Doutro grupo.
    await _criar_movimento(
        cliente_autenticado,
        db_session,
        conta_id,
        "999.00",
        _INICIO_MES,
        categoria_id=outra_subcategoria_id,
    )

    resposta = await cliente_autenticado.get(f"/resumo/categorias/{grupo_id}")

    corpo = resposta.json()
    assert corpo["valor"] == "100.00"
    assert len(corpo["subcategorias"]) == 1
