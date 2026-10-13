"""
TESTES DOS ESTADOS DAS AUTORIZAÇÕES E DAS SUAS AÇÕES
=======================================================

Vocabulário: uma AUTORIZAÇÃO é o consentimento dado no banco para a
aplicação ler as contas partilhadas, durante um prazo; cada conta
partilhada é uma CONTA BANCÁRIA; o VÍNCULO é o facto de uma conta
bancária alimentar uma CONTA da aplicação.

Os ESTADOS nunca se guardam: deduzem-se dos factos (o prazo, se e porque a
autorização terminou antes dele, se a conta bancária ficou indisponível,
se há vínculo). Estes testes cobrem:
  - as funções que deduzem os estados (sem base de dados);
  - listar, revogar e esquecer autorizações;
  - uma Conta SUSPENSA (a autorização terminou): continua bloqueada, não
    sincroniza, e diz porquê;
  - o registo do que o banco responde: "a sessão já não vale" termina a
    autorização, "a conta já não existe" deixa a conta bancária
    indisponível — mesmo que o pedido falhe;
  - um pedido de autorização que expira ao fim de 15 minutos;
  - RENOVAR a partir de uma autorização: a antiga é revogada e o vínculo
    passa para a nova.

As chamadas à Enable Banking (o intermediário que fala com o banco) são
substituídas por versões falsas com "monkeypatch" (uma ferramenta do
pytest que troca um valor só durante um teste), no módulo que as usa.
"""

import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from urllib.parse import unquote

import pytest
from sqlalchemy import select

from app.core.erros import AutorizacaoTerminadaNoBanco, BancoIndisponivel, InexistenteNoBanco
from app.models.autorizacao import Autorizacao
from app.models.autorizacao_pendente import AutorizacaoPendente
from app.models.categoria import Categoria
from app.models.conta import Conta
from app.models.conta_bancaria import ContaBancaria
from app.models.movimento import Movimento
from app.models.user import User
from app.models.vinculo import Vinculo
from app.routers import open_banking as rotas_open_banking
from app.services import autorizacoes as servico_autorizacoes
from app.services import importacao_movimentos
from app.services.estados import (
    estado_autorizacao,
    estado_conta,
    estado_conta_bancaria,
    motivo_do_fim,
)

AGORA = datetime(2026, 10, 10, 12, 0, tzinfo=timezone.utc)

# O fim do prazo das sessões fictícias: daqui a 90 dias, calculado a cada
# execução. Uma data fixa ("2027-04-01") faria estes testes falhar sozinhos
# no dia em que passasse, porque a autorização passaria a "terminada".
_VALIDO_ATE = (datetime.now(timezone.utc) + timedelta(days=90)).replace(microsecond=0).isoformat()


# --- Os estados deduzidos (funções puras) ---


def _autorizacao(**factos) -> Autorizacao:
    return Autorizacao(valido_ate=factos.pop("valido_ate", AGORA + timedelta(days=30)), **factos)


def test_estado_da_autorizacao_deduz_se_do_prazo_e_do_fim():
    assert estado_autorizacao(_autorizacao(), AGORA) == "ativa"
    assert motivo_do_fim(_autorizacao(), AGORA) is None
    # O prazo passou: terminada, por expiração, sem nada ter sido escrito.
    expirada = _autorizacao(valido_ate=AGORA - timedelta(seconds=1))
    assert estado_autorizacao(expirada, AGORA) == "terminada"
    assert motivo_do_fim(expirada, AGORA) == "expirada"
    # Terminada antes do prazo: o motivo guardado.
    revogada = _autorizacao(terminada_em=AGORA, motivo="revogada")
    assert estado_autorizacao(revogada, AGORA) == "terminada"
    assert motivo_do_fim(revogada, AGORA) == "revogada"


def test_estado_da_conta_bancaria_e_da_conta():
    ativa = _autorizacao()
    terminada = _autorizacao(terminada_em=AGORA, motivo="banco")
    disponivel = ContaBancaria()
    indisponivel = ContaBancaria(indisponivel_em=AGORA)

    assert estado_conta_bancaria(disponivel, ativa, tem_vinculo=False, agora=AGORA) == "livre"
    assert estado_conta_bancaria(disponivel, terminada, tem_vinculo=False, agora=AGORA) == "livre_bloqueada"
    assert estado_conta_bancaria(indisponivel, ativa, tem_vinculo=False, agora=AGORA) == "livre_bloqueada"
    assert estado_conta_bancaria(disponivel, ativa, tem_vinculo=True, agora=AGORA) == "vinculada"
    assert estado_conta_bancaria(disponivel, terminada, tem_vinculo=True, agora=AGORA) == "suspensa"
    assert estado_conta_bancaria(indisponivel, ativa, tem_vinculo=True, agora=AGORA) == "suspensa"

    assert estado_conta(None, None, AGORA) == "manual"
    assert estado_conta(disponivel, ativa, AGORA) == "vinculada"
    assert estado_conta(disponivel, terminada, AGORA) == "suspensa"


# --- Preparação comum ---

EMAIL = "teste@example.com"


async def _utilizador(db_session) -> User:
    return await db_session.scalar(select(User).where(User.email == EMAIL))


async def _conta_vinculada(
    cliente,
    db_session,
    *,
    valido_ate: datetime | None = None,
    nome: str = "Ordenado",
    identificacao: str = "hash-x",
) -> tuple[uuid.UUID, Autorizacao, ContaBancaria]:
    """
    Uma Conta vinculada a uma conta bancária de uma autorização (ativa por
    omissão). Devolve o id da Conta, a autorização e a conta bancária.
    """
    conta_id = uuid.UUID(
        (
            await cliente.post(
                "/contas",
                json={"nome": nome, "moeda": "EUR", "data_ancora": "2026-01-01", "saldo_ancora": "0"},
            )
        ).json()["id"]
    )
    utilizador = await _utilizador(db_session)
    autorizacao = Autorizacao(
        user_id=utilizador.id,
        session_id=str(uuid.uuid4()),
        banco="Caixa Geral de Depósitos",
        pais="PT",
        valido_ate=valido_ate or datetime.now(timezone.utc) + timedelta(days=90),
    )
    db_session.add(autorizacao)
    await db_session.flush()
    conta_bancaria = ContaBancaria(
        autorizacao_id=autorizacao.id,
        uid=str(uuid.uuid4()),
        moeda="EUR",
        identification_hash=identificacao,
    )
    db_session.add(conta_bancaria)
    await db_session.flush()
    db_session.add(
        Vinculo(
            user_id=utilizador.id,
            conta_id=conta_id,
            conta_bancaria_id=conta_bancaria.id,
            identificacao=identificacao,
            data_corte=date(2025, 12, 31),
        )
    )
    (await db_session.get(Conta, conta_id)).identificacao_bancaria = identificacao
    await db_session.commit()
    return conta_id, autorizacao, conta_bancaria


# --- Listar ---


@pytest.mark.asyncio
async def test_listar_autorizacoes_com_estado_e_contas_vinculadas(cliente_autenticado, db_session):
    await _conta_vinculada(cliente_autenticado, db_session)
    await _conta_vinculada(
        cliente_autenticado,
        db_session,
        valido_ate=datetime.now(timezone.utc) - timedelta(days=1),
        nome="Antiga",
        identificacao="hash-antiga",
    )

    resposta = await cliente_autenticado.get("/open-banking/autorizacoes")

    estados = sorted((a["estado"], a["motivo"], a["contas_vinculadas"]) for a in resposta.json())
    assert estados == [("ativa", None, 1), ("terminada", "expirada", 1)]


# --- Uma Conta suspensa ---


@pytest.mark.asyncio
async def test_conta_com_autorizacao_terminada_fica_suspensa_e_nao_sincroniza(
    cliente_autenticado, db_session
):
    conta_id, _, conta_bancaria = await _conta_vinculada(
        cliente_autenticado, db_session, valido_ate=datetime.now(timezone.utc) - timedelta(days=1)
    )

    conta = (await cliente_autenticado.get(f"/contas/{conta_id}")).json()
    sincronizar = await cliente_autenticado.post(
        f"/open-banking/contas-bancarias/{conta_bancaria.id}/sincronizar"
    )

    assert conta["vinculo"]["estado"] == "suspensa"
    assert conta["vinculo"]["motivo"] == "expirada"
    assert sincronizar.status_code == 409
    assert "autorizá-lo outra vez" in sincronizar.json()["detail"]
    # Uma conta suspensa não sincroniza, mas isso não é uma falha do banco:
    # não fica guardada como tal (a página diz «Suspensa · desde …»).
    depois = (await cliente_autenticado.get(f"/contas/{conta['id']}")).json()["vinculo"]
    assert depois["falha_motivo"] is None


@pytest.mark.asyncio
async def test_conta_bancaria_de_uma_autorizacao_terminada_nao_se_vincula(
    cliente_autenticado, db_session
):
    utilizador = await _utilizador(db_session)
    autorizacao = Autorizacao(
        user_id=utilizador.id,
        session_id=str(uuid.uuid4()),
        banco="CGD",
        pais="PT",
        valido_ate=datetime.now(timezone.utc) - timedelta(days=1),
    )
    db_session.add(autorizacao)
    await db_session.flush()
    conta_bancaria = ContaBancaria(autorizacao_id=autorizacao.id, uid="z", moeda="EUR")
    db_session.add(conta_bancaria)
    await db_session.commit()

    resposta = await cliente_autenticado.post(
        f"/open-banking/contas-bancarias/{conta_bancaria.id}/criar-conta", params={"nome": "Nova"}
    )

    assert resposta.status_code == 409
    assert "autorizá-lo outra vez" in resposta.json()["detail"]


# --- O que o banco responde fica registado (A7) ---


@pytest.mark.asyncio
async def test_sessao_expirada_no_banco_termina_a_autorizacao(
    cliente_autenticado, db_session, monkeypatch
):
    conta_id, autorizacao, conta_bancaria = await _conta_vinculada(cliente_autenticado, db_session)
    autorizacao_id, conta_bancaria_id = autorizacao.id, conta_bancaria.id

    async def movimentos_falso(*args, **kwargs):
        raise AutorizacaoTerminadaNoBanco("A autorização deste banco já terminou. É preciso autorizá-lo outra vez.")

    monkeypatch.setattr(importacao_movimentos, "obter_movimentos", movimentos_falso)

    resposta = await cliente_autenticado.post(
        f"/open-banking/contas-bancarias/{conta_bancaria_id}/sincronizar"
    )
    await db_session.rollback()  # só sobrevive o que foi confirmado
    db_session.expunge_all()

    assert resposta.status_code == 409
    gravada = await db_session.get(Autorizacao, autorizacao_id)
    assert gravada.motivo == "banco" and gravada.terminada_em is not None
    conta = (await cliente_autenticado.get(f"/contas/{conta_id}")).json()
    assert conta["vinculo"]["estado"] == "suspensa"
    assert conta["vinculo"]["motivo"] == "banco"


@pytest.mark.asyncio
async def test_conta_que_o_banco_ja_nao_tem_fica_indisponivel(
    cliente_autenticado, db_session, monkeypatch
):
    conta_id, _, conta_bancaria = await _conta_vinculada(cliente_autenticado, db_session)
    conta_bancaria_id = conta_bancaria.id

    async def movimentos_falso(*args, **kwargs):
        raise InexistenteNoBanco("O banco já não tem esta conta ou esta autorização.")

    monkeypatch.setattr(importacao_movimentos, "obter_movimentos", movimentos_falso)

    resposta = await cliente_autenticado.post(
        f"/open-banking/contas-bancarias/{conta_bancaria_id}/sincronizar"
    )
    await db_session.rollback()
    db_session.expunge_all()

    assert resposta.status_code == 502
    assert (await db_session.get(ContaBancaria, conta_bancaria_id)).indisponivel_em is not None
    conta = (await cliente_autenticado.get(f"/contas/{conta_id}")).json()
    assert conta["vinculo"]["motivo"] == "indisponivel"


# --- Revogar ---


@pytest.mark.asyncio
async def test_revogar_termina_a_autorizacao_e_avisa_o_banco(cliente_autenticado, db_session, monkeypatch):
    _, autorizacao, _ = await _conta_vinculada(cliente_autenticado, db_session)
    autorizacao_id, session_id = autorizacao.id, autorizacao.session_id
    revogadas: list[str] = []

    async def revogar_falso(sessao):
        revogadas.append(sessao)

    monkeypatch.setattr(servico_autorizacoes, "revogar_sessao", revogar_falso)

    resposta = await cliente_autenticado.post(f"/open-banking/autorizacoes/{autorizacao_id}/revogar")
    outra_vez = await cliente_autenticado.post(f"/open-banking/autorizacoes/{autorizacao_id}/revogar")
    await db_session.rollback()

    assert resposta.status_code == 204
    assert revogadas == [session_id]
    assert (await db_session.get(Autorizacao, autorizacao_id)).motivo == "revogada"
    assert outra_vez.status_code == 409


@pytest.mark.asyncio
async def test_revogar_com_o_banco_em_baixo_mantem_a_autorizacao_ativa(
    cliente_autenticado, db_session, monkeypatch
):
    _, autorizacao, _ = await _conta_vinculada(cliente_autenticado, db_session)
    autorizacao_id = autorizacao.id

    async def revogar_falso(sessao):
        raise BancoIndisponivel("Não foi possível contactar o serviço de Open Banking. Tenta outra vez.")

    monkeypatch.setattr(servico_autorizacoes, "revogar_sessao", revogar_falso)

    resposta = await cliente_autenticado.post(f"/open-banking/autorizacoes/{autorizacao_id}/revogar")
    await db_session.rollback()
    db_session.expunge_all()

    assert resposta.status_code == 502
    assert (await db_session.get(Autorizacao, autorizacao_id)).terminada_em is None


# --- Esquecer ---


@pytest.mark.asyncio
async def test_esquecer_so_numa_terminada_e_a_conta_fica_manual_com_os_movimentos(
    cliente_autenticado, db_session
):
    conta_id, autorizacao, conta_bancaria = await _conta_vinculada(cliente_autenticado, db_session)
    autorizacao_id, conta_bancaria_id = autorizacao.id, conta_bancaria.id
    vinculo = await db_session.scalar(select(Vinculo).where(Vinculo.conta_id == conta_id))
    utilizador = await _utilizador(db_session)
    categoria = await db_session.scalar(
        select(Categoria).where(Categoria.user_id == utilizador.id, Categoria.direcao == "saida")
    )
    db_session.add(
        Movimento(
            conta_id=conta_id,
            categoria_id=categoria.id,
            data=date(2026, 2, 1),
            descricao="Do banco",
            valor=Decimal("-3.00"),
            origem="banco",
            id_transacao_externa="t1",
            vinculo_id=vinculo.id,
        )
    )
    await db_session.commit()

    ativa = await cliente_autenticado.delete(f"/open-banking/autorizacoes/{autorizacao_id}")
    assert ativa.status_code == 409

    (await db_session.get(Autorizacao, autorizacao_id)).valido_ate = datetime.now(timezone.utc) - timedelta(
        days=1
    )
    await db_session.commit()
    resposta = await cliente_autenticado.delete(f"/open-banking/autorizacoes/{autorizacao_id}")
    await db_session.rollback()
    db_session.expunge_all()

    assert resposta.status_code == 204
    assert await db_session.get(Autorizacao, autorizacao_id) is None
    assert await db_session.get(ContaBancaria, conta_bancaria_id) is None
    conta = (await cliente_autenticado.get(f"/contas/{conta_id}")).json()
    assert conta["vinculo"] is None  # a Conta passou a manual
    movimento = await db_session.scalar(select(Movimento).where(Movimento.conta_id == conta_id))
    assert movimento.origem == "banco" and movimento.vinculo_id is None
    # A memória fica: numa autorização futura, a conta real é reconhecida.
    assert (await db_session.get(Conta, conta_id)).identificacao_bancaria == "hash-x"


# --- Pedido de autorização expirado ---


@pytest.mark.asyncio
async def test_regresso_do_banco_depois_de_15_minutos_e_recusado(cliente_autenticado, db_session):
    utilizador = await _utilizador(db_session)
    pendente = AutorizacaoPendente(state="velho", user_id=utilizador.id)
    db_session.add(pendente)
    await db_session.flush()
    pendente.created_at = datetime.now(timezone.utc) - timedelta(minutes=16)
    await db_session.commit()

    resposta = await cliente_autenticado.get(
        "/open-banking/callback", params={"code": "c", "state": "velho"}
    )

    assert unquote(resposta.headers["location"].split("erro=")[1]) == (
        "O pedido de autorização expirou. Começa outra vez."
    )
    # O pedido ficou gasto: já não existe, nem para uma segunda tentativa.
    await db_session.rollback()
    db_session.expunge_all()
    assert await db_session.get(AutorizacaoPendente, "velho") is None


# --- Renovar ---


def _sessao_renovada() -> dict:
    return {
        "session_id": str(uuid.uuid4()),
        "aspsp": {"name": "Caixa Geral de Depósitos", "country": "PT"},
        "access": {"valid_until": _VALIDO_ATE},
        "accounts": [
            {"uid": str(uuid.uuid4()), "identification_hash": "hash-x", "currency": "EUR"}
        ],
    }


@pytest.mark.asyncio
async def test_renovar_a_partir_de_uma_autorizacao(cliente_autenticado, db_session, monkeypatch):
    """
    O fluxo completo: "/autorizar?renova=<id>" usa o banco da autorização
    antiga e guarda de onde vem; no regresso, a autorização nova fica a
    renovar a antiga, o vínculo passa para a conta bancária nova, e a
    antiga (ainda ativa) é revogada — nunca duas ativas no mesmo acesso.
    """
    conta_id, antiga, _ = await _conta_vinculada(cliente_autenticado, db_session)
    antiga_id, sessao_antiga = antiga.id, antiga.session_id
    bancos_pedidos: list[str] = []
    revogadas: list[str] = []

    async def iniciar_falso(banco, pais, redirect_url, state):
        bancos_pedidos.append(banco)
        return "https://banco.example/login"

    async def trocar_falso(code):
        return _sessao_renovada()

    async def revogar_falso(sessao):
        revogadas.append(sessao)

    monkeypatch.setattr(rotas_open_banking, "iniciar_autorizacao", iniciar_falso)
    monkeypatch.setattr(rotas_open_banking, "trocar_codigo_por_sessao", trocar_falso)
    monkeypatch.setattr(servico_autorizacoes, "revogar_sessao", revogar_falso)

    await cliente_autenticado.post("/open-banking/autorizar", params={"renova": str(antiga_id)})
    utilizador = await _utilizador(db_session)
    pendente = await db_session.scalar(
        select(AutorizacaoPendente).where(AutorizacaoPendente.user_id == utilizador.id)
    )
    assert pendente.renova_id == antiga_id
    resposta = await cliente_autenticado.get(
        "/open-banking/callback", params={"code": "c", "state": pendente.state}
    )
    await db_session.rollback()
    db_session.expunge_all()

    assert bancos_pedidos == ["Caixa Geral de Depósitos"]
    nova_id = uuid.UUID(resposta.headers["location"].split("?autorizacao=")[1])
    nova = await db_session.get(Autorizacao, nova_id)
    assert nova.renova_id == antiga_id
    assert revogadas == [sessao_antiga]
    assert (await db_session.get(Autorizacao, antiga_id)).motivo == "revogada"
    conta = (await cliente_autenticado.get(f"/contas/{conta_id}")).json()
    assert conta["vinculo"]["autorizacao_id"] == str(nova_id)
    assert conta["vinculo"]["estado"] == "vinculada"


@pytest.mark.asyncio
async def test_renovar_com_o_banco_a_falhar_ao_revogar_a_antiga_termina_a_na_mesma(
    cliente_autenticado, db_session, monkeypatch
):
    """
    A revogação da sessão antiga no banco faz-se só DEPOIS de gravar a
    renovação. Se falhar, a renovação fica gravada na mesma e a antiga fica
    terminada na aplicação (a sessão no banco expira sozinha no fim do
    prazo); a falha fica só no registo do servidor.
    """
    _, antiga, _ = await _conta_vinculada(cliente_autenticado, db_session)
    antiga_id = antiga.id

    async def iniciar_falso(banco, pais, redirect_url, state):
        return "https://banco.example/login"

    async def trocar_falso(code):
        return _sessao_renovada()

    async def revogar_em_baixo(sessao):
        raise BancoIndisponivel("O banco não aceitou o pedido. Tenta outra vez mais tarde.")

    monkeypatch.setattr(rotas_open_banking, "iniciar_autorizacao", iniciar_falso)
    monkeypatch.setattr(rotas_open_banking, "trocar_codigo_por_sessao", trocar_falso)
    monkeypatch.setattr(servico_autorizacoes, "revogar_sessao", revogar_em_baixo)

    await cliente_autenticado.post("/open-banking/autorizar", params={"renova": str(antiga_id)})
    utilizador = await _utilizador(db_session)
    pendente = await db_session.scalar(
        select(AutorizacaoPendente).where(AutorizacaoPendente.user_id == utilizador.id)
    )
    resposta = await cliente_autenticado.get(
        "/open-banking/callback", params={"code": "c", "state": pendente.state}
    )
    await db_session.rollback()
    db_session.expunge_all()

    assert "?autorizacao=" in resposta.headers["location"]
    assert (await db_session.get(Autorizacao, antiga_id)).motivo == "revogada"
