"""
TESTES DAS RECONCILIAÇÕES, DOS ACERTOS E DA ÂNCORA
=====================================================

Uma RECONCILIAÇÃO é a afirmação «no FIM do dia D, o saldo desta conta era
S». O ACERTO é o movimento que a aplicação cria, no dia D, pela diferença
entre S e o saldo que ela calcula (o saldo inicial da conta, mais os
movimentos até D, mais os acertos anteriores). A partir de D, o saldo é
sempre o afirmado.

Estes testes cobrem:
  - o cálculo do acerto, e a reconciliação "confirmada" (acerto zero);
  - o recálculo automático quando muda um movimento, a reconciliação
    anterior ou a âncora;
  - as regras: só numa conta manual, datas entre a data inicial e hoje, uma
    por dia, ao editar entre a anterior e a seguinte;
  - a pré-visualização do acerto (sem gravar nada);
  - os acertos intocáveis e a categoria "Acerto de saldo", reservada;
  - a edição da âncora (a data e o saldo iniciais) e o seu limite;
  - o acerto sempre como o último movimento do seu dia.

"cliente_autenticado" é um cliente HTTP já com sessão iniciada e
"db_session" a sessão de base de dados do teste, preparados em
tests/conftest.py (o ficheiro de preparação partilhado); tudo o que um
teste grava é desfeito no fim.
"""

import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pytest
from sqlalchemy import select

from app.core.tempo import hoje
from app.models.autorizacao import Autorizacao
from app.models.categoria import Categoria
from app.models.conta_bancaria import ContaBancaria
from app.models.movimento import Movimento
from app.models.user import User
from app.models.vinculo import Vinculo

EMAIL = "teste@example.com"


async def _conta(cliente, saldo_ancora: str = "100.00", data_ancora: str = "2026-01-01") -> str:
    resposta = await cliente.post(
        "/contas",
        json={"nome": f"Conta {uuid.uuid4()}"[:30], "moeda": "EUR", "data_ancora": data_ancora, "saldo_ancora": saldo_ancora},
    )
    return resposta.json()["id"]


async def _categoria(db_session, direcao: str = "saida", papel: str | None = None) -> Categoria:
    utilizador = await db_session.scalar(select(User).where(User.email == EMAIL))
    condicao = Categoria.papel.is_(None) if papel is None else Categoria.papel == papel
    return await db_session.scalar(
        select(Categoria).where(
            Categoria.user_id == utilizador.id,
            Categoria.direcao == direcao,
            Categoria.parent_id.is_not(None),
            condicao,
        )
    )


async def _movimento(cliente, db_session, conta_id: str, data: str, valor: str) -> dict:
    direcao = "entrada" if Decimal(valor) > 0 else "saida"
    categoria = await _categoria(db_session, direcao)
    resposta = await cliente.post(
        "/movimentos",
        json={
            "conta_id": conta_id,
            "categoria_id": str(categoria.id),
            "data": data,
            "descricao": "Movimento",
            "valor": valor,
        },
    )
    assert resposta.status_code == 201, resposta.text
    return resposta.json()


async def _saldo(cliente, conta_id: str) -> str:
    return (await cliente.get(f"/contas/{conta_id}")).json()["saldo"]


async def _acerto_movimento(db_session, conta_id: str) -> Movimento | None:
    return await db_session.scalar(
        select(Movimento).where(Movimento.conta_id == uuid.UUID(conta_id), Movimento.origem == "acerto")
    )


# --- O cálculo do acerto ---


@pytest.mark.asyncio
async def test_reconciliacao_cria_o_acerto_pela_diferenca(cliente_autenticado, db_session):
    """
    Saldo inicial 100, uma saída de 30: a aplicação calcula 70. O extrato
    diz 60 no fim de 10 de fevereiro: entra um acerto de −10, na categoria
    "Acerto de saldo" de saída, e o saldo passa a 60.
    """
    conta_id = await _conta(cliente_autenticado)
    await _movimento(cliente_autenticado, db_session, conta_id, "2026-02-01", "-30.00")

    resposta = await cliente_autenticado.post(
        f"/contas/{conta_id}/reconciliacoes", json={"data": "2026-02-10", "saldo": "60.00"}
    )

    assert resposta.status_code == 201
    assert resposta.json()["acerto"] == "-10.00"
    assert resposta.json()["origem"] == "utilizador"
    assert await _saldo(cliente_autenticado, conta_id) == "60.00"
    acerto = await _acerto_movimento(db_session, conta_id)
    assert acerto.valor == Decimal("-10.00") and acerto.data == date(2026, 2, 10)
    categoria = await db_session.get(Categoria, acerto.categoria_id)
    assert categoria.papel == "acerto" and categoria.direcao == "saida"


@pytest.mark.asyncio
async def test_reconciliacao_sem_diferenca_e_recusada_ao_criar_e_ao_editar(cliente_autenticado, db_session):
    """
    Uma reconciliação só se cria (ou edita) quando há algo a acertar: se o
    saldo afirmado já bate certo com o calculado, é recusada (regra R2).
    """
    conta_id = await _conta(cliente_autenticado)

    criar = await cliente_autenticado.post(
        f"/contas/{conta_id}/reconciliacoes", json={"data": "2026-02-10", "saldo": "100.00"}
    )
    existente = (
        await cliente_autenticado.post(
            f"/contas/{conta_id}/reconciliacoes", json={"data": "2026-02-10", "saldo": "90.00"}
        )
    ).json()
    editar = await cliente_autenticado.patch(
        f"/reconciliacoes/{existente['id']}", json={"data": "2026-02-10", "saldo": "100.00"}
    )

    assert criar.status_code == editar.status_code == 400
    assert criar.json()["detail"] == "O saldo já bate certo neste dia: não há nada a acertar."
    reconciliacoes = (await cliente_autenticado.get(f"/contas/{conta_id}/reconciliacoes")).json()
    assert [(r["saldo"], r["acerto"]) for r in reconciliacoes] == [("90.00", "-10.00")]


@pytest.mark.asyncio
async def test_acerto_recalcula_se_quando_muda_um_movimento_antes_da_data(cliente_autenticado, db_session):
    """
    Um movimento novo ANTES do dia reconciliado muda o saldo calculado, e o
    acerto recalcula-se sozinho; um DEPOIS não lhe toca.
    """
    conta_id = await _conta(cliente_autenticado)
    await cliente_autenticado.post(
        f"/contas/{conta_id}/reconciliacoes", json={"data": "2026-02-10", "saldo": "80.00"}
    )
    assert (await _acerto_movimento(db_session, conta_id)).valor == Decimal("-20.00")

    await _movimento(cliente_autenticado, db_session, conta_id, "2026-02-05", "-15.00")
    await db_session.refresh(acerto := await _acerto_movimento(db_session, conta_id))
    assert acerto.valor == Decimal("-5.00")

    await _movimento(cliente_autenticado, db_session, conta_id, "2026-02-20", "-7.00")
    await db_session.refresh(acerto)
    assert acerto.valor == Decimal("-5.00")
    assert await _saldo(cliente_autenticado, conta_id) == "73.00"


@pytest.mark.asyncio
async def test_varias_reconciliacoes_encadeiam_e_apagar_uma_recalcula_a_seguinte(
    cliente_autenticado, db_session
):
    """
    Duas reconciliações: a segunda parte do saldo afirmado na primeira.
    Apagar a primeira faz a segunda absorver toda a diferença.
    """
    conta_id = await _conta(cliente_autenticado)
    primeira = (
        await cliente_autenticado.post(
            f"/contas/{conta_id}/reconciliacoes", json={"data": "2026-02-01", "saldo": "90.00"}
        )
    ).json()
    segunda = (
        await cliente_autenticado.post(
            f"/contas/{conta_id}/reconciliacoes", json={"data": "2026-03-01", "saldo": "85.00"}
        )
    ).json()
    assert (primeira["acerto"], segunda["acerto"]) == ("-10.00", "-5.00")

    await cliente_autenticado.delete(f"/reconciliacoes/{primeira['id']}")
    lista = (await cliente_autenticado.get(f"/contas/{conta_id}/reconciliacoes")).json()

    assert [(r["data"], r["acerto"]) for r in lista] == [("2026-03-01", "-15.00")]
    assert await _saldo(cliente_autenticado, conta_id) == "85.00"


@pytest.mark.asyncio
async def test_editar_reconciliacao_muda_o_acerto(cliente_autenticado, db_session):
    conta_id = await _conta(cliente_autenticado)
    reconciliacao = (
        await cliente_autenticado.post(
            f"/contas/{conta_id}/reconciliacoes", json={"data": "2026-02-01", "saldo": "90.00"}
        )
    ).json()

    resposta = await cliente_autenticado.patch(
        f"/reconciliacoes/{reconciliacao['id']}", json={"data": "2026-02-02", "saldo": "120.00"}
    )

    assert resposta.status_code == 200
    assert (resposta.json()["data"], resposta.json()["acerto"]) == ("2026-02-02", "20.00")
    acerto = await _acerto_movimento(db_session, conta_id)
    assert (await db_session.get(Categoria, acerto.categoria_id)).direcao == "entrada"


# --- As regras ---


@pytest.mark.asyncio
async def test_regras_de_datas_das_reconciliacoes(cliente_autenticado, db_session):
    conta_id = await _conta(cliente_autenticado)
    rota = f"/contas/{conta_id}/reconciliacoes"

    antes_do_inicio = await cliente_autenticado.post(rota, json={"data": "2025-12-31", "saldo": "1"})
    futuro = await cliente_autenticado.post(
        rota, json={"data": (hoje() + timedelta(days=1)).isoformat(), "saldo": "1"}
    )
    hoje_mesmo = await cliente_autenticado.post(rota, json={"data": hoje().isoformat(), "saldo": "1"})
    repetida = await cliente_autenticado.post(rota, json={"data": hoje().isoformat(), "saldo": "2"})

    assert antes_do_inicio.status_code == 400
    assert futuro.status_code == 400
    assert hoje_mesmo.status_code == 201
    assert repetida.status_code == 409
    assert repetida.json()["detail"] == "Já há uma reconciliação nesse dia."


@pytest.mark.asyncio
async def test_editar_nao_salta_por_cima_de_outra_reconciliacao(cliente_autenticado, db_session):
    conta_id = await _conta(cliente_autenticado)
    rota = f"/contas/{conta_id}/reconciliacoes"
    primeira = (await cliente_autenticado.post(rota, json={"data": "2026-02-01", "saldo": "90"})).json()
    await cliente_autenticado.post(rota, json={"data": "2026-03-01", "saldo": "80"})

    resposta = await cliente_autenticado.patch(
        f"/reconciliacoes/{primeira['id']}", json={"data": "2026-03-15", "saldo": "90"}
    )

    assert resposta.status_code == 400
    assert resposta.json()["detail"] == "A data tem de ficar entre a reconciliação anterior e a seguinte."


@pytest.mark.asyncio
async def test_reconciliar_a_mao_so_numa_conta_manual(cliente_autenticado, db_session):
    conta_id = await _conta(cliente_autenticado)
    utilizador = await db_session.scalar(select(User).where(User.email == EMAIL))
    autorizacao = Autorizacao(
        user_id=utilizador.id,
        session_id=str(uuid.uuid4()),
        banco="CGD",
        pais="PT",
        valido_ate=datetime.now(timezone.utc) + timedelta(days=90),
    )
    db_session.add(autorizacao)
    await db_session.flush()
    conta_bancaria = ContaBancaria(autorizacao_id=autorizacao.id, uid="u", moeda="EUR")
    db_session.add(conta_bancaria)
    await db_session.flush()
    db_session.add(
        Vinculo(
            user_id=utilizador.id,
            conta_id=uuid.UUID(conta_id),
            conta_bancaria_id=conta_bancaria.id,
            data_corte=date(2025, 12, 31),
        )
    )
    await db_session.commit()

    resposta = await cliente_autenticado.post(
        f"/contas/{conta_id}/reconciliacoes", json={"data": "2026-02-01", "saldo": "90"}
    )

    assert resposta.status_code == 400
    assert "vinculada ao banco" in resposta.json()["detail"]


@pytest.mark.asyncio
async def test_reconciliacao_de_outro_utilizador_nao_existe(cliente_autenticado, client):
    conta_id = await _conta(cliente_autenticado)
    reconciliacao = (
        await cliente_autenticado.post(
            f"/contas/{conta_id}/reconciliacoes", json={"data": "2026-02-01", "saldo": "90"}
        )
    ).json()
    outro = {"email": "outro@example.com", "password": "palavrapasse123"}
    await client.post("/auth/registo", json=outro)
    await client.post("/auth/login", json=outro)

    resposta = await client.delete(f"/reconciliacoes/{reconciliacao['id']}")

    assert resposta.status_code == 404


# --- Pré-visualizar ---


@pytest.mark.asyncio
async def test_simular_mostra_o_acerto_sem_gravar(cliente_autenticado, db_session):
    conta_id = await _conta(cliente_autenticado)

    resposta = await cliente_autenticado.post(
        f"/contas/{conta_id}/reconciliacoes/simular", json={"data": "2026-02-01", "saldo": "68.00"}
    )

    assert resposta.json() == {"acerto": "-32.00"}
    assert (await cliente_autenticado.get(f"/contas/{conta_id}/reconciliacoes")).json() == []


# --- Acertos intocáveis, categoria reservada ---


@pytest.mark.asyncio
async def test_um_acerto_nao_se_edita_nem_se_apaga_diretamente(cliente_autenticado, db_session):
    conta_id = await _conta(cliente_autenticado)
    await cliente_autenticado.post(
        f"/contas/{conta_id}/reconciliacoes", json={"data": "2026-02-01", "saldo": "90"}
    )
    acerto = await _acerto_movimento(db_session, conta_id)
    categoria = await _categoria(db_session, "saida")

    editar = await cliente_autenticado.patch(
        f"/movimentos/{acerto.id}",
        json={
            "conta_id": conta_id,
            "categoria_id": str(categoria.id),
            "data": "2026-02-01",
            "descricao": "Outro",
            "valor": "-10.00",
        },
    )
    apagar = await cliente_autenticado.delete(f"/movimentos/{acerto.id}")
    em_lote = await cliente_autenticado.post("/movimentos/eliminar-em-lote", json={"ids": [str(acerto.id)]})

    assert editar.status_code == apagar.status_code == em_lote.status_code == 400
    assert "reconciliação" in apagar.json()["detail"]


@pytest.mark.asyncio
async def test_a_categoria_de_acerto_e_reservada(cliente_autenticado, db_session):
    conta_id = await _conta(cliente_autenticado)
    reservada = await _categoria(db_session, "saida", papel="acerto")
    movimento = await _movimento(cliente_autenticado, db_session, conta_id, "2026-02-01", "-5.00")

    criar = await cliente_autenticado.post(
        "/movimentos",
        json={
            "conta_id": conta_id,
            "categoria_id": str(reservada.id),
            "data": "2026-02-01",
            "descricao": "Não",
            "valor": "-1.00",
        },
    )
    recategorizar = await cliente_autenticado.post(
        "/movimentos/recategorizar-em-lote",
        json={"ids": [movimento["id"]], "categoria_id": str(reservada.id)},
    )

    assert criar.status_code == recategorizar.status_code == 400
    arvore = (await cliente_autenticado.get("/categorias/arvore")).json()
    reservadas = [s["nome"] for g in arvore for s in g["subcategorias"] if s["reservada"]]
    assert reservadas == ["Acerto de saldo", "Acerto de saldo"]


# --- A âncora ---


@pytest.mark.asyncio
async def test_editar_a_ancora_recalcula_o_acerto_e_respeita_o_limite(cliente_autenticado, db_session):
    """
    Com uma reconciliação, mudar o saldo inicial não muda o saldo atual (a
    partir da reconciliação, o saldo é o afirmado): muda o acerto. A data
    inicial nunca passa do primeiro movimento.
    """
    conta_id = await _conta(cliente_autenticado)
    await _movimento(cliente_autenticado, db_session, conta_id, "2026-02-05", "-10.00")
    await cliente_autenticado.post(
        f"/contas/{conta_id}/reconciliacoes", json={"data": "2026-02-10", "saldo": "80.00"}
    )

    simulacao = await cliente_autenticado.post(
        f"/contas/{conta_id}/ancora/simular", json={"data_ancora": "2026-01-01", "saldo_ancora": "120.00"}
    )
    editada = await cliente_autenticado.patch(
        f"/contas/{conta_id}/ancora", json={"data_ancora": "2026-01-01", "saldo_ancora": "120.00"}
    )
    depois_do_movimento = await cliente_autenticado.patch(
        f"/contas/{conta_id}/ancora", json={"data_ancora": "2026-02-06", "saldo_ancora": "120.00"}
    )

    assert simulacao.json() == {"saldo_atual": "80.00", "acerto_primeira_reconciliacao": "-30.00"}
    assert editada.status_code == 200 and editada.json()["saldo_ancora"] == "120.00"
    assert (await _acerto_movimento(db_session, conta_id)).valor == Decimal("-30.00")
    assert editada.json()["saldo"] == "80.00"
    assert depois_do_movimento.status_code == 400
    assert depois_do_movimento.json()["detail"] == "A data de início não pode ser depois do primeiro movimento."


@pytest.mark.asyncio
async def test_moeda_nao_muda_numa_conta_com_reconciliacoes(cliente_autenticado, db_session):
    """
    Uma conta sem movimentos, mas com uma reconciliação: criada com acerto
    (−10) e que, depois de o saldo inicial passar a 90, ficou sem ele.
    """
    conta_id = await _conta(cliente_autenticado)
    await cliente_autenticado.post(
        f"/contas/{conta_id}/reconciliacoes", json={"data": "2026-02-10", "saldo": "90.00"}
    )
    await cliente_autenticado.patch(
        f"/contas/{conta_id}/ancora", json={"data_ancora": "2026-01-01", "saldo_ancora": "90.00"}
    )
    conta = (await cliente_autenticado.get(f"/contas/{conta_id}")).json()

    resposta = await cliente_autenticado.patch(
        f"/contas/{conta_id}", json={"nome": conta["nome"], "moeda": "USD"}
    )

    assert resposta.status_code == 400
    assert resposta.json()["detail"] == "Não é possível mudar a moeda de uma conta com reconciliações."


# --- O acerto é o último movimento do seu dia ---


@pytest.mark.asyncio
async def test_o_acerto_e_sempre_o_ultimo_movimento_do_dia(cliente_autenticado, db_session):
    """
    A reconciliação é criada primeiro (o acerto nasce antes) e só depois um
    movimento no mesmo dia: mesmo assim, na lista (do mais recente para o
    mais antigo), o acerto aparece primeiro, e o saldo depois dele é o
    afirmado.
    """
    conta_id = await _conta(cliente_autenticado)
    await cliente_autenticado.post(
        f"/contas/{conta_id}/reconciliacoes", json={"data": "2026-02-10", "saldo": "50.00"}
    )
    await _movimento(cliente_autenticado, db_session, conta_id, "2026-02-10", "-5.00")

    lista = (await cliente_autenticado.get("/movimentos", params={"conta_id": conta_id})).json()

    assert [m["descricao"] for m in lista] == ["Acerto de saldo", "Movimento"]
    assert lista[0]["saldo_apos"] == "50.00"
    assert lista[1]["saldo_apos"] == "95.00"


# --- Casos encontrados na revisão da fatia ---


async def _reconciliar(cliente, conta_id: str, data: str, saldo: str) -> dict:
    resposta = await cliente.post(f"/contas/{conta_id}/reconciliacoes", json={"data": data, "saldo": saldo})
    assert resposta.status_code == 201, resposta.text
    return resposta.json()


async def _acerto(cliente, conta_id: str) -> str:
    """O acerto da (única) reconciliação da conta, como a API o mostra."""
    return (await cliente.get(f"/contas/{conta_id}/reconciliacoes")).json()[0]["acerto"]


@pytest.mark.asyncio
async def test_acerto_que_passa_a_zero_fica_a_zero_e_a_reconciliacao_fica(cliente_autenticado, db_session):
    """
    Saldo inicial 100, o extrato diz 90 a 1 de fevereiro: acerto de −10. O
    utilizador lembra-se da compra de 10 a 15 de janeiro e regista-a: o
    acerto deixa de ser preciso e o movimento de acerto sai, mas a
    reconciliação fica, com acerto 0,00 € (continua a guardar o saldo
    confirmado); o saldo fica.
    """
    conta_id = await _conta(cliente_autenticado)
    await _reconciliar(cliente_autenticado, conta_id, "2026-02-01", "90.00")

    await _movimento(cliente_autenticado, db_session, conta_id, "2026-01-15", "-10.00")

    assert await _acerto(cliente_autenticado, conta_id) == "0.00"
    assert await _acerto_movimento(db_session, conta_id) is None
    assert await _saldo(cliente_autenticado, conta_id) == "90.00"


@pytest.mark.asyncio
async def test_acertos_recalculam_ao_mover_mudar_a_data_e_apagar_movimentos(cliente_autenticado, db_session):
    """
    Duas contas com saldo inicial 100, cada uma com uma reconciliação a 1 de
    março: A diz 85 (com uma saída de 10 a 1 de fevereiro, acerto de −5); B
    diz 95 (acerto de −5).
      - a saída de A passa para depois de 1 de março: o acerto de A passa a
        −15 (a saída já não conta até ao dia reconciliado);
      - a saída volta para antes, mas para a conta B: A continua −15 e B
        passa a +5;
      - apagá-la: B volta a −5 (A fica −15);
      - uma saída de 5 em A a 10 de fevereiro: A passa a −10; eliminá-la em
        lote devolve-o a −15.
    """
    conta_a = await _conta(cliente_autenticado)
    conta_b = await _conta(cliente_autenticado)
    saida = await _movimento(cliente_autenticado, db_session, conta_a, "2026-02-01", "-10.00")
    await _reconciliar(cliente_autenticado, conta_a, "2026-03-01", "85.00")
    await _reconciliar(cliente_autenticado, conta_b, "2026-03-01", "95.00")
    campos = {k: saida[k] for k in ("categoria_id", "descricao", "valor")}

    await cliente_autenticado.patch(
        f"/movimentos/{saida['id']}", json={**campos, "conta_id": conta_a, "data": "2026-03-05"}
    )
    depois_da_data = (await _acerto(cliente_autenticado, conta_a), await _acerto(cliente_autenticado, conta_b))
    await cliente_autenticado.patch(
        f"/movimentos/{saida['id']}", json={**campos, "conta_id": conta_b, "data": "2026-02-01"}
    )
    depois_de_mover = (await _acerto(cliente_autenticado, conta_a), await _acerto(cliente_autenticado, conta_b))
    await cliente_autenticado.delete(f"/movimentos/{saida['id']}")
    depois_de_apagar = (await _acerto(cliente_autenticado, conta_a), await _acerto(cliente_autenticado, conta_b))
    outra = await _movimento(cliente_autenticado, db_session, conta_a, "2026-02-10", "-5.00")
    antes_do_lote = await _acerto(cliente_autenticado, conta_a)
    await cliente_autenticado.post("/movimentos/eliminar-em-lote", json={"ids": [outra["id"]]})

    assert depois_da_data == ("-15.00", "-5.00")
    assert depois_de_mover == ("-15.00", "5.00")
    assert depois_de_apagar == ("-15.00", "-5.00")
    assert antes_do_lote == "-10.00"
    assert await _acerto(cliente_autenticado, conta_a) == "-15.00"


@pytest.mark.asyncio
async def test_simular_a_edicao_ignora_a_propria_reconciliacao(cliente_autenticado, db_session):
    """
    O acerto que a alteração daria calcula-se como se a reconciliação a
    editar não existisse ainda (o seu acerto atual não conta no saldo).
    """
    conta_id = await _conta(cliente_autenticado)
    reconciliacao = await _reconciliar(cliente_autenticado, conta_id, "2026-02-01", "90.00")

    resposta = await cliente_autenticado.post(
        f"/reconciliacoes/{reconciliacao['id']}/simular", json={"data": "2026-02-01", "saldo": "80.00"}
    )

    assert resposta.json() == {"acerto": "-20.00"}
    assert await _acerto(cliente_autenticado, conta_id) == "-10.00"  # nada mudou


@pytest.mark.asyncio
async def test_reconciliacoes_e_ancora_gravam_de_verdade(cliente_autenticado, db_session):
    """Cada rota confirma o que fez (commit): depois de desfazer o que não foi confirmado, continua lá."""
    conta_id = await _conta(cliente_autenticado)
    criada = await _reconciliar(cliente_autenticado, conta_id, "2026-02-01", "90.00")
    await db_session.rollback()
    db_session.expunge_all()
    assert await _acerto(cliente_autenticado, conta_id) == "-10.00"

    await cliente_autenticado.patch(f"/reconciliacoes/{criada['id']}", json={"data": "2026-02-02", "saldo": "80.00"})
    await db_session.rollback()
    db_session.expunge_all()
    assert await _acerto(cliente_autenticado, conta_id) == "-20.00"

    await cliente_autenticado.patch(
        f"/contas/{conta_id}/ancora", json={"data_ancora": "2026-01-01", "saldo_ancora": "50.00"}
    )
    await db_session.rollback()
    db_session.expunge_all()
    assert await _acerto(cliente_autenticado, conta_id) == "30.00"

    await cliente_autenticado.delete(f"/reconciliacoes/{criada['id']}")
    await db_session.rollback()
    db_session.expunge_all()
    assert (await cliente_autenticado.get(f"/contas/{conta_id}/reconciliacoes")).json() == []


@pytest.mark.asyncio
async def test_rotas_de_reconciliacao_de_outro_utilizador_nao_existem(cliente_autenticado, client):
    conta_id = await _conta(cliente_autenticado)
    reconciliacao = await _reconciliar(cliente_autenticado, conta_id, "2026-02-01", "90.00")
    outro = {"email": "outro@example.com", "password": "palavrapasse123"}
    await client.post("/auth/logout")
    await client.post("/auth/registo", json=outro)
    await client.post("/auth/login", json=outro)
    dados = {"data": "2026-02-01", "saldo": "1.00"}

    respostas = [
        await client.patch(f"/reconciliacoes/{reconciliacao['id']}", json=dados),
        await client.post(f"/reconciliacoes/{reconciliacao['id']}/simular", json=dados),
        await client.get(f"/contas/{conta_id}/reconciliacoes"),
        await client.post(f"/contas/{conta_id}/reconciliacoes", json=dados),
        await client.post(f"/contas/{conta_id}/reconciliacoes/simular", json=dados),
        await client.patch(f"/contas/{conta_id}/ancora", json={"data_ancora": "2026-01-01", "saldo_ancora": "1"}),
    ]

    assert [r.status_code for r in respostas] == [404] * 6


@pytest.mark.asyncio
async def test_ancora_regras_numa_conta_vinculada_e_depois_da_primeira_reconciliacao(
    cliente_autenticado, db_session
):
    conta_id = await _conta(cliente_autenticado)
    await _reconciliar(cliente_autenticado, conta_id, "2026-02-01", "90.00")
    depois_da_reconciliacao = await cliente_autenticado.patch(
        f"/contas/{conta_id}/ancora", json={"data_ancora": "2026-02-05", "saldo_ancora": "100"}
    )
    sem_reconciliacao = await _conta(cliente_autenticado)
    simulacao = await cliente_autenticado.post(
        f"/contas/{sem_reconciliacao}/ancora/simular", json={"data_ancora": "2026-01-01", "saldo_ancora": "130"}
    )
    utilizador = await db_session.scalar(select(User).where(User.email == EMAIL))
    autorizacao = Autorizacao(
        user_id=utilizador.id,
        session_id=str(uuid.uuid4()),
        banco="CGD",
        pais="PT",
        valido_ate=datetime.now(timezone.utc) + timedelta(days=90),
    )
    db_session.add(autorizacao)
    await db_session.flush()
    conta_bancaria = ContaBancaria(autorizacao_id=autorizacao.id, uid="uid-x", moeda="EUR")
    db_session.add(conta_bancaria)
    await db_session.flush()
    db_session.add(
        Vinculo(
            user_id=utilizador.id,
            conta_id=uuid.UUID(sem_reconciliacao),
            conta_bancaria_id=conta_bancaria.id,
            data_corte=date(2025, 12, 31),
        )
    )
    await db_session.commit()
    numa_vinculada = await cliente_autenticado.patch(
        f"/contas/{sem_reconciliacao}/ancora", json={"data_ancora": "2026-01-01", "saldo_ancora": "1"}
    )

    assert depois_da_reconciliacao.status_code == 400
    assert simulacao.json() == {"saldo_atual": "130.00", "acerto_primeira_reconciliacao": None}
    assert numa_vinculada.status_code == 400


@pytest.mark.asyncio
async def test_valores_fora_do_que_cabe_na_base_de_dados_sao_recusados(cliente_autenticado):
    conta_id = await _conta(cliente_autenticado)

    reconciliacao = await cliente_autenticado.post(
        f"/contas/{conta_id}/reconciliacoes", json={"data": "2026-02-01", "saldo": "1e20"}
    )
    conta = await cliente_autenticado.post(
        "/contas",
        json={"nome": "Enorme", "moeda": "EUR", "data_ancora": "2026-01-01", "saldo_ancora": "1000000000000"},
    )

    assert reconciliacao.status_code == conta.status_code == 422


@pytest.mark.asyncio
async def test_com_outra_operacao_a_decorrer_na_conta_as_gravacoes_recebem_409(
    cliente_autenticado, db_session
):
    """
    Outra ligação à base de dados (como outro pedido a decorrer) tem o
    bloqueio da conta: criar um movimento, reconciliar, mudar a âncora e
    apagar a conta recebem 409, e nada muda.
    """
    from sqlalchemy import text

    from app.db.session import engine
    from app.services.bloqueios import _numero_do_bloqueio

    conta_id = await _conta(cliente_autenticado)
    categoria = await _categoria(db_session)
    async with engine.connect() as outra_ligacao:
        transacao = await outra_ligacao.begin()
        # pg_try_ (não espera): se, por engano, o próprio teste já tivesse
        # o bloqueio, isto falha logo em vez de ficar à espera para sempre.
        conseguiu = await outra_ligacao.scalar(
            text("SELECT pg_try_advisory_xact_lock(:numero)"),
            {"numero": _numero_do_bloqueio(uuid.UUID(conta_id))},
        )
        assert conseguiu
        respostas = [
            await cliente_autenticado.post(
                "/movimentos",
                json={
                    "conta_id": conta_id,
                    "categoria_id": str(categoria.id),
                    "data": "2026-02-01",
                    "descricao": "Café",
                    "valor": "-1.00",
                },
            ),
            await cliente_autenticado.post(
                f"/contas/{conta_id}/reconciliacoes", json={"data": "2026-02-01", "saldo": "1"}
            ),
            await cliente_autenticado.patch(
                f"/contas/{conta_id}/ancora", json={"data_ancora": "2026-01-01", "saldo_ancora": "1"}
            ),
            await cliente_autenticado.delete(f"/contas/{conta_id}"),
        ]
        await transacao.rollback()

    assert [r.status_code for r in respostas] == [409] * 4
    assert await _saldo(cliente_autenticado, conta_id) == "100.00"


@pytest.mark.asyncio
async def test_a_lista_de_movimentos_diz_quais_sao_acertos(cliente_autenticado, db_session):
    """
    Cada movimento diz de onde vem («manual», «banco» ou «acerto»); um acerto
    diz também de que reconciliação nasceu. A interface usa-o para mostrar um
    acerto de forma diferente e só para leitura.
    """
    conta_id = await _conta(cliente_autenticado)
    await _movimento(cliente_autenticado, db_session, conta_id, "2026-02-01", "-30.00")
    reconciliacao = await _reconciliar(cliente_autenticado, conta_id, "2026-02-10", "60.00")

    movimentos = (await cliente_autenticado.get("/movimentos", params={"contas": conta_id})).json()

    por_origem = {m["origem"]: m for m in movimentos}
    assert sorted(por_origem) == ["acerto", "manual"]
    assert por_origem["acerto"]["reconciliacao_id"] == reconciliacao["id"]
    assert por_origem["manual"]["reconciliacao_id"] is None
