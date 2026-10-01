"""
TESTES DE app/routers/open_banking.py — SÓ A PARTE SEM CHAMADAS DE REDE
===========================================================================

A maior parte deste router (/bancos, /ligar, /contas/{uid}/saldos,
/contas/{uid}/movimentos, associar-nova-conta, sincronizar) chama a API
real da Enable Banking — sem mocks, não dá para testar automaticamente
sem um esforço à parte (ver caderno/decisoes.md), por isso continuam só
testados manualmente, ao vivo.

Este ficheiro cobre: DELETE /open-banking/contas-ligadas/{id}
("desvincular" — ver desvincular_conta, em app/services/
ligacoes_bancarias.py), GET /open-banking/ligacoes/{id}/contas-ligadas
(lógica de base de dados pura), os dois caminhos de erro de
GET /open-banking/callback que NUNCA chegam a chamar a Enable Banking
(sem "code", ou com um "state" desconhecido), e os caminhos de
POST /open-banking/contas-ligadas/{id}/sincronizar que falham ANTES de
chegar a chamar a Enable Banking (conta ainda por associar, ou de outro
utilizador) — o caminho feliz (que chegaria a sincronizar a sério) fica
de fora, tal como o resto.
"""

import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy import select

from app.models.conta_ligada import ContaLigada
from app.models.ligacao_bancaria import LigacaoBancaria
from app.models.user import User

CONTA_VALIDA = {
    "nome": "Conta à ordem",
    "banco": "CGD",
    "tipo": "Conta corrente",
    "moeda": "EUR",
    "data_ancora": "2026-01-01",
    "saldo_ancora": "1000.00",
}


async def _criar_conta_ligada(db_session, email: str, conta_id: str | None) -> str:
    """
    Cria uma LigacaoBancaria e uma ContaLigada para "email", associada a
    "conta_id" (ou por associar, se None), e devolve o id da ContaLigada.
    Não chama a Enable Banking — grava directamente na base de dados de
    teste, tal como o helper _ligar_conta em test_contas.py/
    test_movimentos.py (duplicado aqui de propósito: cada ficheiro de
    teste desta aplicação é autónomo).
    """
    utilizador = await db_session.scalar(select(User).where(User.email == email))
    ligacao = LigacaoBancaria(
        user_id=utilizador.id,
        session_id=str(uuid.uuid4()),
        aspsp_nome="Banco Teste",
        aspsp_pais="PT",
        valido_ate=datetime.now(timezone.utc),
    )
    db_session.add(ligacao)
    await db_session.flush()
    conta_ligada = ContaLigada(
        ligacao_id=ligacao.id,
        uid=str(uuid.uuid4()),
        moeda="EUR",
        conta_id=uuid.UUID(conta_id) if conta_id else None,
    )
    db_session.add(conta_ligada)
    await db_session.commit()
    await db_session.refresh(conta_ligada)
    return str(conta_ligada.id)


@pytest.mark.asyncio
async def test_desvincular_remove_a_ligacao_mas_mantem_conta_e_movimentos(
    cliente_autenticado, db_session
):
    conta_id = (await cliente_autenticado.post("/contas", json=CONTA_VALIDA)).json()["id"]
    conta_ligada_id = await _criar_conta_ligada(db_session, "teste@example.com", conta_id)

    resposta = await cliente_autenticado.delete(f"/open-banking/contas-ligadas/{conta_ligada_id}")
    assert resposta.status_code == 204

    # A ContaLigada desapareceu...
    ainda_existe = await db_session.get(ContaLigada, uuid.UUID(conta_ligada_id))
    assert ainda_existe is None

    # ...mas a Conta continua lá, sem qualquer alteração.
    resposta_conta = await cliente_autenticado.get(f"/contas/{conta_id}")
    assert resposta_conta.status_code == 200
    assert resposta_conta.json()["nome"] == "Conta à ordem"


@pytest.mark.asyncio
async def test_apos_desvincular_movimento_volta_a_ser_editavel_por_completo(
    cliente_autenticado, db_session
):
    """Fecha o ciclo com as regras de CRUD: desvincular liberta o que estava bloqueado."""
    # Importação local, não de topo: "tests/" não é um pacote (sem
    # __init__.py — ver a nota em pyproject.toml, secção pythonpath), por
    # isso o pytest torna cada ficheiro de teste importável directamente
    # pelo nome ("test_movimentos"), não como "tests.test_movimentos".
    from test_movimentos import _categoria_id, _movimento_valido

    conta_id = (await cliente_autenticado.post("/contas", json=CONTA_VALIDA)).json()["id"]
    categoria_id = await _categoria_id(db_session, "teste@example.com", "saida")
    movimento_id = (
        await cliente_autenticado.post(
            "/movimentos", json=_movimento_valido(conta_id, categoria_id=categoria_id)
        )
    ).json()["id"]
    conta_ligada_id = await _criar_conta_ligada(db_session, "teste@example.com", conta_id)

    # Enquanto ligada, mudar o valor é recusado (ver test_movimentos.py).
    recusado = await cliente_autenticado.patch(
        f"/movimentos/{movimento_id}",
        json=_movimento_valido(conta_id, categoria_id=categoria_id, valor="-99.00"),
    )
    assert recusado.status_code == 400

    await cliente_autenticado.delete(f"/open-banking/contas-ligadas/{conta_ligada_id}")

    aceite = await cliente_autenticado.patch(
        f"/movimentos/{movimento_id}",
        json=_movimento_valido(conta_id, categoria_id=categoria_id, valor="-99.00"),
    )
    assert aceite.status_code == 200
    assert aceite.json()["valor"] == "-99.00"


@pytest.mark.asyncio
async def test_desvincular_conta_ligada_de_outro_utilizador_devolve_404(client, db_session):
    a = {"email": "a@example.com", "password": "palavrapasse123"}
    await client.post("/auth/registo", json=a)
    await client.post("/auth/login", json=a)
    conta_id = (await client.post("/contas", json=CONTA_VALIDA)).json()["id"]
    conta_ligada_id = await _criar_conta_ligada(db_session, "a@example.com", conta_id)

    await client.post("/auth/logout")
    b = {"email": "b@example.com", "password": "palavrapasse123"}
    await client.post("/auth/registo", json=b)
    await client.post("/auth/login", json=b)

    resposta = await client.delete(f"/open-banking/contas-ligadas/{conta_ligada_id}")

    assert resposta.status_code == 404


@pytest.mark.asyncio
async def test_desvincular_conta_ligada_inexistente_devolve_404(cliente_autenticado):
    resposta = await cliente_autenticado.delete(
        f"/open-banking/contas-ligadas/{uuid.uuid4()}"
    )

    assert resposta.status_code == 404


# --- GET /open-banking/ligacoes/{id}/contas-ligadas ---


@pytest.mark.asyncio
async def test_listar_contas_ligadas_devolve_as_da_ligacao(cliente_autenticado, db_session):
    utilizador = await db_session.scalar(select(User).where(User.email == "teste@example.com"))
    ligacao = LigacaoBancaria(
        user_id=utilizador.id,
        session_id=str(uuid.uuid4()),
        aspsp_nome="Banco Teste",
        aspsp_pais="PT",
        valido_ate=datetime.now(timezone.utc),
    )
    db_session.add(ligacao)
    await db_session.flush()
    db_session.add(
        ContaLigada(ligacao_id=ligacao.id, uid=str(uuid.uuid4()), moeda="EUR", iban="PT50...001")
    )
    db_session.add(
        ContaLigada(ligacao_id=ligacao.id, uid=str(uuid.uuid4()), moeda="EUR", iban="PT50...002")
    )
    await db_session.commit()

    resposta = await cliente_autenticado.get(f"/open-banking/ligacoes/{ligacao.id}/contas-ligadas")

    assert resposta.status_code == 200
    ibans = {conta["iban"] for conta in resposta.json()}
    assert ibans == {"PT50...001", "PT50...002"}
    assert all(conta["conta_id"] is None for conta in resposta.json())
    # O nome do banco (da LigacaoBancaria) vem em cada conta — o frontend
    # mostra-o, bloqueado, no formulário de configurar cada conta.
    assert all(conta["banco"] == "Banco Teste" for conta in resposta.json())


@pytest.mark.asyncio
async def test_associar_nova_conta_com_tipo_demasiado_longo_devolve_422(
    cliente_autenticado, db_session
):
    """
    "tipo" tem o mesmo limite da coluna Conta.tipo (40 caracteres) —
    validado pelo FastAPI ANTES de a rota correr, por isso este caminho
    nunca chega a chamar a Enable Banking (nem precisa de mocks).
    """
    conta_ligada_id = await _criar_conta_ligada(db_session, "teste@example.com", conta_id=None)

    resposta = await cliente_autenticado.post(
        f"/open-banking/contas-ligadas/{conta_ligada_id}/associar-nova-conta",
        params={"nome": "Revolut", "tipo": "x" * 41},
    )

    assert resposta.status_code == 422


@pytest.mark.asyncio
async def test_listar_contas_ligadas_de_ligacao_de_outro_utilizador_devolve_404(client, db_session):
    a = {"email": "a@example.com", "password": "palavrapasse123"}
    await client.post("/auth/registo", json=a)
    await client.post("/auth/login", json=a)
    utilizador_a = await db_session.scalar(select(User).where(User.email == "a@example.com"))
    ligacao = LigacaoBancaria(
        user_id=utilizador_a.id,
        session_id=str(uuid.uuid4()),
        aspsp_nome="Banco Teste",
        aspsp_pais="PT",
        valido_ate=datetime.now(timezone.utc),
    )
    db_session.add(ligacao)
    await db_session.commit()

    await client.post("/auth/logout")
    b = {"email": "b@example.com", "password": "palavrapasse123"}
    await client.post("/auth/registo", json=b)
    await client.post("/auth/login", json=b)

    resposta = await client.get(f"/open-banking/ligacoes/{ligacao.id}/contas-ligadas")

    assert resposta.status_code == 404


@pytest.mark.asyncio
async def test_listar_contas_ligadas_sem_sessao_e_recusado(client):
    resposta = await client.get(f"/open-banking/ligacoes/{uuid.uuid4()}/contas-ligadas")

    assert resposta.status_code == 401


# --- POST /open-banking/contas-ligadas/{id}/sincronizar (só os caminhos
# que não tocam em rede — falham antes de chegar a chamar a Enable
# Banking) ---


@pytest.mark.asyncio
async def test_sincronizar_conta_ligada_ainda_por_associar_devolve_409(
    cliente_autenticado, db_session
):
    conta_ligada_id = await _criar_conta_ligada(db_session, "teste@example.com", conta_id=None)

    resposta = await cliente_autenticado.post(
        f"/open-banking/contas-ligadas/{conta_ligada_id}/sincronizar"
    )

    assert resposta.status_code == 409


@pytest.mark.asyncio
async def test_sincronizar_conta_ligada_de_outro_utilizador_devolve_404(client, db_session):
    a = {"email": "a@example.com", "password": "palavrapasse123"}
    await client.post("/auth/registo", json=a)
    await client.post("/auth/login", json=a)
    conta_id = (await client.post("/contas", json=CONTA_VALIDA)).json()["id"]
    conta_ligada_id = await _criar_conta_ligada(db_session, "a@example.com", conta_id)

    await client.post("/auth/logout")
    b = {"email": "b@example.com", "password": "palavrapasse123"}
    await client.post("/auth/registo", json=b)
    await client.post("/auth/login", json=b)

    resposta = await client.post(f"/open-banking/contas-ligadas/{conta_ligada_id}/sincronizar")

    assert resposta.status_code == 404


@pytest.mark.asyncio
async def test_sincronizar_conta_ligada_inexistente_devolve_404(cliente_autenticado):
    resposta = await cliente_autenticado.post(
        f"/open-banking/contas-ligadas/{uuid.uuid4()}/sincronizar"
    )

    assert resposta.status_code == 404


@pytest.mark.asyncio
async def test_sincronizar_sem_sessao_e_recusado(client):
    resposta = await client.post(f"/open-banking/contas-ligadas/{uuid.uuid4()}/sincronizar")

    assert resposta.status_code == 401


# --- GET /open-banking/callback (só os caminhos que não tocam em rede) ---


@pytest.mark.asyncio
async def test_callback_sem_code_reencaminha_para_o_frontend_com_erro(client):
    resposta = await client.get("/open-banking/callback")

    assert resposta.status_code == 307
    localizacao = resposta.headers["location"]
    assert localizacao.startswith("http://localhost:5173/contas/nova?erro=")


@pytest.mark.asyncio
async def test_callback_com_state_desconhecido_reencaminha_com_erro(client):
    resposta = await client.get(
        "/open-banking/callback", params={"code": "abc123", "state": str(uuid.uuid4())}
    )

    assert resposta.status_code == 307
    localizacao = resposta.headers["location"]
    assert localizacao.startswith("http://localhost:5173/contas/nova?erro=")
    assert "usado" in localizacao
