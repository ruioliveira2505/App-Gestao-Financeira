"""
TESTES DE app/routers/open_banking.py — A PARTE SEM CHAMADAS AO BANCO
===========================================================================

Vocabulário: uma AUTORIZAÇÃO é o consentimento dado no banco para a
aplicação ler as contas partilhadas, durante um prazo; cada conta
partilhada é uma CONTA BANCÁRIA; o VÍNCULO é o facto de uma conta
bancária alimentar uma Conta da aplicação.

Este ficheiro testa o que não precisa de falar com o banco (a Enable
Banking, o intermediário de Open Banking). Os passos que falam com o
banco (/autorizar, o regresso do banco com sucesso, criar uma Conta a
partir de uma conta bancária, sincronizar) são testados com o banco
simulado em tests/test_open_banking_fluxo.py.

Também cobre, sem rede, o RECONHECIMENTO de contas já conhecidas ao
gravar uma autorização (gravar_autorizacao recebe a sessão já pronta, por isso
os testes passam-lhe uma sessão fictícia), as sugestões de nome e tipo
de uma conta nova, e o prazo do consentimento pedido a cada banco.

Este ficheiro cobre: DELETE /open-banking/contas-bancarias/{id}/vinculo
("desvincular" — ver desvincular, em app/services/
contas_bancarias.py), GET /open-banking/autorizacoes/{id}/contas-bancarias
(lógica de base de dados pura), os dois caminhos de erro de
GET /open-banking/callback que NUNCA chegam a chamar a Enable Banking
(sem "code", ou com um "state" desconhecido), e os caminhos de
POST /open-banking/contas-bancarias/{id}/sincronizar e de
POST .../criar-conta que falham ANTES de chegar a chamar a Enable Banking
(conta bancária sem vínculo ou já vinculada, de outro utilizador, tipo ou
nome inválidos, nome repetido).
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.models.conta import Conta
from app.models.conta_bancaria import ContaBancaria
from app.models.autorizacao import Autorizacao
from app.models.user import User
from app.services import importacao_movimentos
from app.services.enable_banking import dias_de_validade, validade_do_consentimento
from app.services.contas_bancarias import (
    abreviar_banco,
    conta_antiga_de,
    gravar_autorizacao,
    identificacao_bancaria,
    nome_sugerido,
    tipo_sugerido,
)

CONTA_VALIDA = {
    "nome": "Conta à ordem",
    "banco": "CGD",
    "tipo": "Conta corrente",
    "moeda": "EUR",
    "data_ancora": "2026-01-01",
    "saldo_ancora": "1000.00",
}


async def _criar_conta_bancaria(db_session, email: str, conta_id: str | None) -> str:
    """
    Cria uma Autorizacao e uma ContaBancaria para "email", associada a
    "conta_id" (ou sem vínculo, se None), e devolve o id da ContaBancaria.
    Não chama a Enable Banking — grava diretamente na base de dados de
    teste (cada ficheiro de teste desta aplicação é autónomo, por isso
    outros ficheiros têm um ajudante parecido).
    """
    utilizador = await db_session.scalar(select(User).where(User.email == email))
    autorizacao = Autorizacao(
        user_id=utilizador.id,
        session_id=str(uuid.uuid4()),
        banco="Banco Teste",
        pais="PT",
        valido_ate=datetime.now(timezone.utc),
    )
    db_session.add(autorizacao)
    await db_session.flush()
    conta_bancaria = ContaBancaria(
        autorizacao_id=autorizacao.id,
        uid=str(uuid.uuid4()),
        moeda="EUR",
        conta_id=uuid.UUID(conta_id) if conta_id else None,
    )
    db_session.add(conta_bancaria)
    await db_session.commit()
    await db_session.refresh(conta_bancaria)
    return str(conta_bancaria.id)


@pytest.mark.asyncio
async def test_desvincular_remove_o_vinculo_mas_mantem_conta_e_movimentos(
    cliente_autenticado, db_session
):
    conta_id = (await cliente_autenticado.post("/contas", json=CONTA_VALIDA)).json()["id"]
    conta_bancaria_id = await _criar_conta_bancaria(db_session, "teste@example.com", conta_id)

    resposta = await cliente_autenticado.delete(f"/open-banking/contas-bancarias/{conta_bancaria_id}/vinculo")
    assert resposta.status_code == 204

    # A ContaBancaria desapareceu...
    ainda_existe = await db_session.get(ContaBancaria, uuid.UUID(conta_bancaria_id))
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
    conta_bancaria_id = await _criar_conta_bancaria(db_session, "teste@example.com", conta_id)

    # Enquanto vinculada, mudar o valor é recusado (ver test_movimentos.py).
    recusado = await cliente_autenticado.patch(
        f"/movimentos/{movimento_id}",
        json=_movimento_valido(conta_id, categoria_id=categoria_id, valor="-99.00"),
    )
    assert recusado.status_code == 400

    await cliente_autenticado.delete(f"/open-banking/contas-bancarias/{conta_bancaria_id}/vinculo")

    aceite = await cliente_autenticado.patch(
        f"/movimentos/{movimento_id}",
        json=_movimento_valido(conta_id, categoria_id=categoria_id, valor="-99.00"),
    )
    assert aceite.status_code == 200
    assert aceite.json()["valor"] == "-99.00"


@pytest.mark.asyncio
async def test_desvincular_conta_bancaria_de_outro_utilizador_devolve_404(client, db_session):
    a = {"email": "a@example.com", "password": "palavrapasse123"}
    await client.post("/auth/registo", json=a)
    await client.post("/auth/login", json=a)
    conta_id = (await client.post("/contas", json=CONTA_VALIDA)).json()["id"]
    conta_bancaria_id = await _criar_conta_bancaria(db_session, "a@example.com", conta_id)

    await client.post("/auth/logout")
    b = {"email": "b@example.com", "password": "palavrapasse123"}
    await client.post("/auth/registo", json=b)
    await client.post("/auth/login", json=b)

    resposta = await client.delete(f"/open-banking/contas-bancarias/{conta_bancaria_id}/vinculo")

    assert resposta.status_code == 404


@pytest.mark.asyncio
async def test_desvincular_conta_bancaria_inexistente_devolve_404(cliente_autenticado):
    resposta = await cliente_autenticado.delete(
        f"/open-banking/contas-bancarias/{uuid.uuid4()}/vinculo"
    )

    assert resposta.status_code == 404


# --- GET /open-banking/autorizacoes/{id}/contas-bancarias ---


@pytest.mark.asyncio
async def test_listar_contas_bancarias_devolve_as_da_autorizacao(cliente_autenticado, db_session):
    utilizador = await db_session.scalar(select(User).where(User.email == "teste@example.com"))
    autorizacao = Autorizacao(
        user_id=utilizador.id,
        session_id=str(uuid.uuid4()),
        banco="Banco Teste",
        pais="PT",
        valido_ate=datetime.now(timezone.utc),
    )
    db_session.add(autorizacao)
    await db_session.flush()
    db_session.add(
        ContaBancaria(autorizacao_id=autorizacao.id, uid=str(uuid.uuid4()), moeda="EUR", iban="PT50...001")
    )
    db_session.add(
        ContaBancaria(autorizacao_id=autorizacao.id, uid=str(uuid.uuid4()), moeda="EUR", iban="PT50...002")
    )
    await db_session.commit()

    resposta = await cliente_autenticado.get(f"/open-banking/autorizacoes/{autorizacao.id}/contas-bancarias")

    assert resposta.status_code == 200
    ibans = {conta["iban"] for conta in resposta.json()}
    assert ibans == {"PT50...001", "PT50...002"}
    assert all(conta["conta_id"] is None for conta in resposta.json())
    # O nome do banco (da Autorizacao) vem em cada conta — o frontend
    # mostra-o, bloqueado, no formulário de configurar cada conta.
    assert all(conta["banco"] == "Banco Teste" for conta in resposta.json())


@pytest.mark.asyncio
async def test_criar_conta_com_tipo_demasiado_longo_devolve_422(
    cliente_autenticado, db_session
):
    """
    "tipo" tem o mesmo limite da coluna Conta.tipo (40 caracteres) —
    validado pelo FastAPI ANTES de a rota correr, por isso este caminho
    nunca chega a chamar a Enable Banking (nem precisa de mocks).
    """
    conta_bancaria_id = await _criar_conta_bancaria(db_session, "teste@example.com", conta_id=None)

    resposta = await cliente_autenticado.post(
        f"/open-banking/contas-bancarias/{conta_bancaria_id}/criar-conta",
        params={"nome": "Revolut", "tipo": "x" * 41},
    )

    assert resposta.status_code == 422


@pytest.mark.asyncio
async def test_criar_conta_com_nome_repetido_devolve_409(cliente_autenticado, db_session):
    """
    O nome não pode repetir o de outra conta do utilizador (ver
    garantir_nome_livre, em app/services/contas.py). A verificação é feita
    ANTES de qualquer pedido ao banco — por isso este teste não precisa de
    mocks da Enable Banking: se a chamasse, falharia por falta de chave.
    """
    await cliente_autenticado.post(
        "/contas",
        json={"nome": "Revolut", "moeda": "EUR", "data_ancora": "2026-01-01", "saldo_ancora": "0"},
    )
    conta_bancaria_id = await _criar_conta_bancaria(db_session, "teste@example.com", conta_id=None)

    resposta = await cliente_autenticado.post(
        f"/open-banking/contas-bancarias/{conta_bancaria_id}/criar-conta",
        params={"nome": "revolut"},
    )

    assert resposta.status_code == 409
    assert resposta.json()["detail"] == "Já tens uma conta chamada «Revolut»."


@pytest.mark.asyncio
async def test_listar_contas_bancarias_de_autorizacao_de_outro_utilizador_devolve_404(client, db_session):
    a = {"email": "a@example.com", "password": "palavrapasse123"}
    await client.post("/auth/registo", json=a)
    await client.post("/auth/login", json=a)
    utilizador_a = await db_session.scalar(select(User).where(User.email == "a@example.com"))
    autorizacao = Autorizacao(
        user_id=utilizador_a.id,
        session_id=str(uuid.uuid4()),
        banco="Banco Teste",
        pais="PT",
        valido_ate=datetime.now(timezone.utc),
    )
    db_session.add(autorizacao)
    await db_session.commit()

    await client.post("/auth/logout")
    b = {"email": "b@example.com", "password": "palavrapasse123"}
    await client.post("/auth/registo", json=b)
    await client.post("/auth/login", json=b)

    resposta = await client.get(f"/open-banking/autorizacoes/{autorizacao.id}/contas-bancarias")

    assert resposta.status_code == 404


@pytest.mark.asyncio
async def test_listar_contas_bancarias_sem_sessao_e_recusado(client):
    resposta = await client.get(f"/open-banking/autorizacoes/{uuid.uuid4()}/contas-bancarias")

    assert resposta.status_code == 401


# --- POST /open-banking/contas-bancarias/{id}/sincronizar (só os caminhos
# que não tocam em rede — falham antes de chegar a chamar a Enable
# Banking) ---


@pytest.mark.asyncio
async def test_sincronizar_conta_bancaria_sem_vinculo_devolve_409(
    cliente_autenticado, db_session
):
    conta_bancaria_id = await _criar_conta_bancaria(db_session, "teste@example.com", conta_id=None)

    resposta = await cliente_autenticado.post(
        f"/open-banking/contas-bancarias/{conta_bancaria_id}/sincronizar"
    )

    assert resposta.status_code == 409


@pytest.mark.asyncio
async def test_sincronizar_conta_bancaria_de_outro_utilizador_devolve_404(client, db_session):
    a = {"email": "a@example.com", "password": "palavrapasse123"}
    await client.post("/auth/registo", json=a)
    await client.post("/auth/login", json=a)
    conta_id = (await client.post("/contas", json=CONTA_VALIDA)).json()["id"]
    conta_bancaria_id = await _criar_conta_bancaria(db_session, "a@example.com", conta_id)

    await client.post("/auth/logout")
    b = {"email": "b@example.com", "password": "palavrapasse123"}
    await client.post("/auth/registo", json=b)
    await client.post("/auth/login", json=b)

    resposta = await client.post(f"/open-banking/contas-bancarias/{conta_bancaria_id}/sincronizar")

    assert resposta.status_code == 404


@pytest.mark.asyncio
async def test_sincronizar_conta_bancaria_inexistente_devolve_404(cliente_autenticado):
    resposta = await cliente_autenticado.post(
        f"/open-banking/contas-bancarias/{uuid.uuid4()}/sincronizar"
    )

    assert resposta.status_code == 404


@pytest.mark.asyncio
async def test_sincronizar_sem_sessao_e_recusado(client):
    resposta = await client.post(f"/open-banking/contas-bancarias/{uuid.uuid4()}/sincronizar")

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


# --- Sugestões para uma conta nova (funções puras, sem base de dados) ---


def test_identificacao_bancaria_prefere_o_hash_e_cai_no_iban():
    assert identificacao_bancaria("abc123", "PT50 0035 0001") == "abc123"
    # Sem hash: o IBAN, sem espaços e em maiúsculas, com um prefixo que o
    # impede de alguma vez coincidir com um hash.
    assert identificacao_bancaria(None, "pt50 0035 0001") == "iban:PT5000350001"
    # Com a moeda: bancos com várias moedas no mesmo IBAN (Revolut, Wise)
    # ficam com uma identificação por moeda.
    assert identificacao_bancaria(None, "PT50 0035 0001", "eur") == "iban:PT5000350001:EUR"
    assert identificacao_bancaria(None, "PT50 0035 0001", "USD") == "iban:PT5000350001:USD"
    assert identificacao_bancaria(None, None) is None
    # Texto vazio (ou só espaços) conta como ausente, tal como na migração.
    assert identificacao_bancaria("", "PT50 0035 0001", "EUR") == "iban:PT5000350001:EUR"
    assert identificacao_bancaria("  ", "", "EUR") is None


def test_tipo_sugerido_traduz_os_codigos_iso_20022():
    assert tipo_sugerido("CACC") == "Conta à ordem"
    assert tipo_sugerido("svgs") == "Poupança"
    assert tipo_sugerido("CARD") == "Cartão de crédito"
    # Código desconhecido ou em falta: sem sugestão.
    assert tipo_sugerido("XXXX") is None
    assert tipo_sugerido(None) is None


def test_abreviar_banco_so_abrevia_nomes_longos():
    assert abreviar_banco("Caixa Geral de Depósitos") == "CGD"
    assert abreviar_banco("Banco Comercial Português") == "BCP"
    assert abreviar_banco("Santander Totta") == "Santander Totta"
    assert abreviar_banco("Banco BPI") == "Banco BPI"


def test_nome_sugerido_junta_tipo_e_banco_e_nunca_repete_um_nome():
    conta = ContaBancaria(tipo_conta_banco="CACC", iban="PT50 0035 0123 2084", moeda="EUR", uid="x")
    assert nome_sugerido(conta, "Caixa Geral de Depósitos", []) == "Conta à ordem CGD"
    # Já existe uma conta com esse nome (sem contar acentos nem
    # maiúsculas): junta o fim do IBAN.
    assert (
        nome_sugerido(conta, "Caixa Geral de Depósitos", ["conta a ordem cgd"])
        == "Conta à ordem CGD ••2084"
    )
    # Sem tipo: o produto que o banco envia; sem nenhum dos dois, "Conta".
    com_produto = ContaBancaria(produto="Conta Mais", uid="y", moeda="EUR")
    assert nome_sugerido(com_produto, "Banco BPI", []) == "Conta Mais Banco BPI"
    sem_nada = ContaBancaria(uid="z", moeda="EUR")
    assert nome_sugerido(sem_nada, "Banco BPI", []) == "Conta Banco BPI"


# --- Prazo do consentimento ---


def test_validade_e_o_maximo_do_banco_ate_180_dias():
    um_dia = 86400
    # O banco aceita 180 dias: pede-se 180 (menos uma folga de minutos).
    validade = validade_do_consentimento({"maximum_consent_validity": 180 * um_dia})
    assert timedelta(days=179) < validade < timedelta(days=180)
    assert dias_de_validade({"maximum_consent_validity": 180 * um_dia}) == 180
    # O banco só aceita 90: 90.
    assert dias_de_validade({"maximum_consent_validity": 90 * um_dia}) == 90
    # O banco aceitaria mais do que a lei: fica nos 180.
    assert dias_de_validade({"maximum_consent_validity": 365 * um_dia}) == 180
    # O banco não diz: 90, o prazo que todos aceitam.
    assert validade_do_consentimento({}) == timedelta(days=90)


def test_validade_com_valores_estranhos_do_banco_usa_o_prazo_seguro():
    """
    O banco pode mandar o máximo num formato inesperado. Um decimal conta
    como número; tudo o resto que não seja um prazo positivo (booleano,
    texto, zero, negativo, ou mais curto do que a folga de 5 minutos, que
    daria uma data já no passado) cai nos 90 dias seguros.
    """
    um_dia = 86400
    noventa = timedelta(days=90)
    # Um decimal é aceite como número.
    assert dias_de_validade({"maximum_consent_validity": 180.0 * um_dia}) == 180
    # True é um "int" em Python, mas não é um prazo.
    assert validade_do_consentimento({"maximum_consent_validity": True}) == noventa
    assert validade_do_consentimento({"maximum_consent_validity": "15552000"}) == noventa
    assert validade_do_consentimento({"maximum_consent_validity": 0}) == noventa
    assert validade_do_consentimento({"maximum_consent_validity": -100}) == noventa
    # 60 segundos menos a folga de 5 minutos daria um prazo negativo.
    assert validade_do_consentimento({"maximum_consent_validity": 60}) == noventa


# --- Reconhecer contas já conhecidas, ao gravar uma autorização ---


def _sessao(
    hash_: str | None, iban: str | None = "PT50000000000000000002084", moeda: str = "EUR"
) -> dict:
    """Uma sessão fictícia, com a forma real devolvida pela Enable Banking."""
    return {
        "session_id": str(uuid.uuid4()),
        "aspsp": {"name": "Caixa Geral de Depósitos", "country": "PT"},
        "access": {"valid_until": "2027-04-01T10:00:00+00:00"},
        "accounts": [
            {
                "uid": str(uuid.uuid4()),
                "identification_hash": hash_,
                "account_id": {"iban": iban},
                "currency": moeda,
                "product": "Conta Caixa",
                "cash_account_type": "CACC",
            }
        ],
    }


@pytest.mark.asyncio
async def test_autorizacao_nova_a_conta_ja_vinculada_renova_o_vinculo(cliente_autenticado, db_session):
    """
    A conta bancária já alimenta uma Conta, com vínculo (ex.: o prazo da
    autorização está a acabar e o utilizador voltou a autorizar): o
    vínculo passa para a conta bancária nova, sem o utilizador fazer nada.
    """
    conta_id = (await cliente_autenticado.post("/contas", json=CONTA_VALIDA)).json()["id"]
    antiga_id = await _criar_conta_bancaria(db_session, "teste@example.com", conta_id)
    conta = await db_session.get(Conta, uuid.UUID(conta_id))
    conta.identificacao_bancaria = "hash-cgd"
    await db_session.commit()
    utilizador = await db_session.scalar(select(User).where(User.email == "teste@example.com"))

    autorizacao = await gravar_autorizacao(db_session, utilizador.id, _sessao("hash-cgd"))

    nova = await db_session.scalar(select(ContaBancaria).where(ContaBancaria.autorizacao_id == autorizacao.id))
    assert nova.conta_id == uuid.UUID(conta_id)
    # A linha antiga da conta bancária desapareceu: nunca há duas contas
    # bancárias vinculadas à mesma Conta.
    assert await db_session.get(ContaBancaria, uuid.UUID(antiga_id)) is None

    resposta = await cliente_autenticado.get(f"/open-banking/autorizacoes/{autorizacao.id}/contas-bancarias")
    [conta_devolvida] = resposta.json()
    assert conta_devolvida["conta_id"] == conta_id
    assert conta_devolvida["conta_nome"] == CONTA_VALIDA["nome"]
    assert conta_devolvida["valido_ate"].startswith("2027-04-01")


@pytest.mark.asyncio
async def test_autorizacao_nova_a_conta_desvinculada_nao_se_vincula_sozinha(cliente_autenticado, db_session):
    """
    A conta bancária já alimentou uma Conta, entretanto desvinculada (sem
    vínculo): nada se associa sozinho — aparece como nova, com a
    Conta antiga indicada («Já foi a «X»»). Religar precisa de
    reconciliações, que ainda não existem.
    """
    conta_id = (await cliente_autenticado.post("/contas", json=CONTA_VALIDA)).json()["id"]
    conta = await db_session.get(Conta, uuid.UUID(conta_id))
    conta.identificacao_bancaria = "iban:PT50000000000000000002084:EUR"
    await db_session.commit()
    utilizador = await db_session.scalar(select(User).where(User.email == "teste@example.com"))

    # O banco não envia hash: reconhece-se pelo IBAN.
    autorizacao = await gravar_autorizacao(db_session, utilizador.id, _sessao(None))

    resposta = await cliente_autenticado.get(f"/open-banking/autorizacoes/{autorizacao.id}/contas-bancarias")
    [conta_devolvida] = resposta.json()
    assert conta_devolvida["conta_id"] is None
    assert conta_devolvida["conta_antiga"] == {"id": conta_id, "nome": CONTA_VALIDA["nome"]}


@pytest.mark.asyncio
async def test_contas_bancarias_trazem_tipo_e_nome_sugeridos(cliente_autenticado, db_session):
    """Uma conta nunca vista: sem conta antiga, com tipo e nome sugeridos."""
    utilizador = await db_session.scalar(select(User).where(User.email == "teste@example.com"))
    autorizacao = await gravar_autorizacao(db_session, utilizador.id, _sessao("hash-novo"))

    resposta = await cliente_autenticado.get(f"/open-banking/autorizacoes/{autorizacao.id}/contas-bancarias")
    [conta_devolvida] = resposta.json()
    assert conta_devolvida["conta_id"] is None
    assert conta_devolvida["conta_antiga"] is None
    assert conta_devolvida["tipo_sugerido"] == "Conta à ordem"
    assert conta_devolvida["nome_sugerido"] == "Conta à ordem CGD"


@pytest.mark.asyncio
async def test_conta_bancaria_sem_hash_nem_iban_nao_corresponde_a_conta_manual(
    cliente_autenticado, db_session
):
    """
    Uma conta manual tem identificacao_bancaria vazia (NULL). Uma conta
    bancária sem hash nem IBAN também não tem identificação. As duas
    nunca podem corresponder: sem a guarda em conta_com_identificacao, o
    SQL "= NULL" passaria a "IS NULL" e ligaria a conta bancária a uma
    conta manual qualquer.
    """
    await cliente_autenticado.post("/contas", json=CONTA_VALIDA)
    utilizador = await db_session.scalar(select(User).where(User.email == "teste@example.com"))

    autorizacao = await gravar_autorizacao(db_session, utilizador.id, _sessao(None, iban=None))

    nova = await db_session.scalar(select(ContaBancaria).where(ContaBancaria.autorizacao_id == autorizacao.id))
    assert nova.conta_id is None
    assert await conta_antiga_de(db_session, utilizador.id, nova) is None


@pytest.mark.asyncio
async def test_a_mesma_conta_bancaria_noutro_utilizador_nao_se_cruza(cliente_autenticado, db_session):
    """
    Duas pessoas com a mesma conta bancária (ex.: uma conta conjunta): o
    segundo utilizador, ao autorizá-la, não "rouba" o vínculo do primeiro nem
    vê a conta dele como «Já foi a «X»».
    """
    # Utilizador A: uma Conta vinculada e uma desvinculada, com identificações.
    vinculada_id = (await cliente_autenticado.post("/contas", json=CONTA_VALIDA)).json()["id"]
    antiga_id = await _criar_conta_bancaria(db_session, "teste@example.com", vinculada_id)
    desvinculada_id = (
        await cliente_autenticado.post("/contas", json={**CONTA_VALIDA, "nome": "Antiga"})
    ).json()["id"]
    (await db_session.get(Conta, uuid.UUID(vinculada_id))).identificacao_bancaria = "hash-a"
    (await db_session.get(Conta, uuid.UUID(desvinculada_id))).identificacao_bancaria = "hash-b"
    await db_session.commit()

    # Utilizador B liga as mesmas duas contas bancárias.
    b = {"email": "b@example.com", "password": "palavrapasse123"}
    await cliente_autenticado.post("/auth/registo", json=b)
    utilizador_b = await db_session.scalar(select(User).where(User.email == "b@example.com"))
    lig_a = await gravar_autorizacao(db_session, utilizador_b.id, _sessao("hash-a"))
    lig_b = await gravar_autorizacao(db_session, utilizador_b.id, _sessao("hash-b"))

    nova_a = await db_session.scalar(select(ContaBancaria).where(ContaBancaria.autorizacao_id == lig_a.id))
    nova_b = await db_session.scalar(select(ContaBancaria).where(ContaBancaria.autorizacao_id == lig_b.id))
    # O vínculo de A continua intacto e a de B não herdou a Conta de A.
    antiga = await db_session.get(ContaBancaria, uuid.UUID(antiga_id))
    assert antiga is not None and antiga.conta_id == uuid.UUID(vinculada_id)
    assert nova_a.conta_id is None
    # B não vê a conta desvinculada de A como sua.
    assert await conta_antiga_de(db_session, utilizador_b.id, nova_b) is None


@pytest.mark.asyncio
async def test_renovacao_so_na_mesma_moeda(cliente_autenticado, db_session):
    """
    Uma conta bancária noutra moeda nunca renova o vínculo de uma Conta:
    uma conta em USD não pode passar a alimentar uma Conta em EUR.
    """
    conta_id = (await cliente_autenticado.post("/contas", json=CONTA_VALIDA)).json()["id"]
    antiga_id = await _criar_conta_bancaria(db_session, "teste@example.com", conta_id)
    (await db_session.get(Conta, uuid.UUID(conta_id))).identificacao_bancaria = "hash-x"
    await db_session.commit()
    utilizador = await db_session.scalar(select(User).where(User.email == "teste@example.com"))

    autorizacao = await gravar_autorizacao(db_session, utilizador.id, _sessao("hash-x", moeda="USD"))

    nova = await db_session.scalar(select(ContaBancaria).where(ContaBancaria.autorizacao_id == autorizacao.id))
    assert nova.conta_id is None
    assert await db_session.get(ContaBancaria, uuid.UUID(antiga_id)) is not None


@pytest.mark.asyncio
async def test_duas_contas_com_a_mesma_identificacao_sao_recusadas_pela_base_de_dados(
    cliente_autenticado, db_session
):
    """
    O índice único (user_id, identificacao_bancaria) impede duas Contas do
    mesmo utilizador com a mesma identificação (contas manuais, com a
    identificação vazia, não contam: o PostgreSQL trata cada NULL como
    diferente).
    """
    um = (await cliente_autenticado.post("/contas", json=CONTA_VALIDA)).json()["id"]
    dois = (await cliente_autenticado.post("/contas", json={**CONTA_VALIDA, "nome": "Outra"})).json()["id"]
    (await db_session.get(Conta, uuid.UUID(um))).identificacao_bancaria = "hash-dup"
    (await db_session.get(Conta, uuid.UUID(dois))).identificacao_bancaria = "hash-dup"

    with pytest.raises(IntegrityError):
        await db_session.commit()
    await db_session.rollback()


@pytest.mark.asyncio
async def test_criar_conta_ja_vinculada_noutra_conta_devolve_409(
    cliente_autenticado, db_session
):
    """
    A conta bancária já alimenta uma Conta ainda vinculada (por outra
    autorização). Criar uma Conta nova a partir de uma linha antiga da
    mesma conta bancária, sem vínculo, poria a mesma conta bancária a alimentar duas Contas: é
    recusado, antes de qualquer pedido ao banco (este teste não precisa
    de substituir a Enable Banking).
    """
    conta_id = (await cliente_autenticado.post("/contas", json=CONTA_VALIDA)).json()["id"]
    await _criar_conta_bancaria(db_session, "teste@example.com", conta_id)
    (await db_session.get(Conta, uuid.UUID(conta_id))).identificacao_bancaria = "hash-x"
    # Uma ContaBancaria antiga, sem vínculo, da mesma conta real.
    pendente_id = await _criar_conta_bancaria(db_session, "teste@example.com", conta_id=None)
    (await db_session.get(ContaBancaria, uuid.UUID(pendente_id))).identification_hash = "hash-x"
    await db_session.commit()

    resposta = await cliente_autenticado.post(
        f"/open-banking/contas-bancarias/{pendente_id}/criar-conta",
        params={"nome": "Duplicada"},
    )

    assert resposta.status_code == 409
    assert resposta.json()["detail"] == "Esta conta bancária já está vinculada à conta «Conta à ordem»."


@pytest.mark.asyncio
async def test_criar_conta_valida_o_nome(cliente_autenticado, db_session):
    """
    O nome tem as regras do formulário manual: sem espaços nas pontas, não
    vazio, até 120 caracteres. Validado antes de qualquer pedido ao banco.
    """
    conta_bancaria_id = await _criar_conta_bancaria(db_session, "teste@example.com", conta_id=None)
    rota = f"/open-banking/contas-bancarias/{conta_bancaria_id}/criar-conta"

    so_espacos = await cliente_autenticado.post(rota, params={"nome": "   "})
    longo = await cliente_autenticado.post(rota, params={"nome": "x" * 121})

    assert so_espacos.status_code == 422
    assert longo.status_code == 422


@pytest.mark.asyncio
async def test_criar_conta_a_partir_de_conta_bancaria_transfere_a_identificacao(
    cliente_autenticado, db_session, monkeypatch
):
    """
    A conta bancária já foi de uma Conta, entretanto desvinculada. Ao criar
    uma Conta NOVA a partir dela, a identificação passa para a nova: a
    antiga fica manual, sem identificação (nunca duas com a mesma), e a
    próxima autorização reconhece a nova.

    As chamadas à Enable Banking são substituídas ("monkeypatch", do
    pytest, troca uma função só durante o teste) por versões falsas: um
    saldo fixo e nenhuma transação.
    """

    async def obter_saldos_falso(uid):
        return {"balances": [{"balance_type": "CLBD", "balance_amount": {"amount": "100.00"}}]}

    async def obter_movimentos_falso(uid, data_de=None, continuation_key=None, estrategia=None):
        return {"transactions": []}

    monkeypatch.setattr(importacao_movimentos, "obter_saldos", obter_saldos_falso)
    monkeypatch.setattr(importacao_movimentos, "obter_movimentos", obter_movimentos_falso)

    velha_id = (await cliente_autenticado.post("/contas", json={**CONTA_VALIDA, "nome": "Velha"})).json()["id"]
    (await db_session.get(Conta, uuid.UUID(velha_id))).identificacao_bancaria = "hash-x"
    await db_session.commit()
    utilizador = await db_session.scalar(select(User).where(User.email == "teste@example.com"))
    autorizacao = await gravar_autorizacao(db_session, utilizador.id, _sessao("hash-x"))
    pendente = await db_session.scalar(
        select(ContaBancaria).where(ContaBancaria.autorizacao_id == autorizacao.id)
    )

    resposta = await cliente_autenticado.post(
        f"/open-banking/contas-bancarias/{pendente.id}/criar-conta",
        params={"nome": "Nova"},
    )

    assert resposta.status_code == 200
    nova_id = uuid.UUID(resposta.json()["conta_id"])
    await db_session.refresh(await db_session.get(Conta, uuid.UUID(velha_id)))
    assert (await db_session.get(Conta, uuid.UUID(velha_id))).identificacao_bancaria is None
    assert (await db_session.get(Conta, nova_id)).identificacao_bancaria == "hash-x"
