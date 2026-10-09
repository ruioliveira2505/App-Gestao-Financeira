"""
TESTES DE APAGAR A CONTA DE UTILIZADOR (DELETE /auth/me)
===========================================================

O RGPD (o regulamento europeu de proteção de dados) dá a cada pessoa o
direito de pedir que os seus dados sejam apagados. Apagar a conta de
utilizador apaga TODOS os seus dados — a base de dados apaga em cascata a
partir do utilizador —, depois de confirmar a password e de revogar no
banco as autorizações ainda ativas (os consentimentos dados ao banco para
a aplicação ler as contas).

Os pedidos à Enable Banking (o intermediário que fala com os bancos) são
substituídos por versões falsas com "monkeypatch" (uma ferramenta do
pytest que troca um valor só durante um teste). Um pedido DELETE com
corpo faz-se com client.request("DELETE", …, json=…), porque o atalho
client.delete não aceita corpo.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select

from app.core.erros import BancoIndisponivel
from app.models.autorizacao import Autorizacao
from app.models.categoria import Categoria
from app.models.conta import Conta
from app.models.movimento import Movimento
from app.models.reconciliacao import Reconciliacao
from app.models.user import User
from app.services import utilizadores

PASSWORD = "palavrapasse123"


async def _apagar(cliente, password: str = PASSWORD):
    return await cliente.request("DELETE", "/auth/me", json={"password": password})


async def _autorizacao(db_session, user_id, ativa: bool) -> Autorizacao:
    agora = datetime.now(timezone.utc)
    autorizacao = Autorizacao(
        user_id=user_id,
        session_id=f"sessao-{'ativa' if ativa else 'terminada'}-{uuid.uuid4()}",
        banco="CGD",
        pais="PT",
        valido_ate=agora + timedelta(days=90) if ativa else agora - timedelta(days=1),
    )
    db_session.add(autorizacao)
    await db_session.commit()
    return autorizacao


@pytest.mark.asyncio
async def test_password_errada_nao_apaga_nada(cliente_autenticado, db_session):
    resposta = await _apagar(cliente_autenticado, "errada")

    assert resposta.status_code == 403
    assert resposta.json()["detail"] == "A password não está certa."
    assert (await cliente_autenticado.get("/auth/me")).status_code == 200


@pytest.mark.asyncio
async def test_apagar_a_conta_apaga_todos_os_dados_e_revoga_so_as_ativas(
    cliente_autenticado, client, db_session, monkeypatch
):
    utilizador = await db_session.scalar(select(User).where(User.email == "teste@example.com"))
    utilizador_id = utilizador.id
    conta_id = (
        await cliente_autenticado.post(
            "/contas",
            json={"nome": "Carteira", "moeda": "EUR", "data_ancora": "2026-01-01", "saldo_ancora": "10"},
        )
    ).json()["id"]
    categoria = await db_session.scalar(
        select(Categoria).where(
            Categoria.user_id == utilizador_id,
            Categoria.direcao == "saida",
            Categoria.parent_id.is_not(None),
            Categoria.papel.is_(None),
        )
    )
    await cliente_autenticado.post(
        "/movimentos",
        json={
            "conta_id": conta_id,
            "categoria_id": str(categoria.id),
            "data": "2026-02-01",
            "descricao": "Café",
            "valor": "-1.00",
        },
    )
    # Uma reconciliação com um acerto de verdade (o saldo calculado é 9,
    # o afirmado 5: acerto de −4), para o apagamento passar também por um
    # movimento de acerto e pela sua categoria reservada.
    acerto = (
        await cliente_autenticado.post(
            f"/contas/{conta_id}/reconciliacoes", json={"data": "2026-02-02", "saldo": "5.00"}
        )
    ).json()["acerto"]
    ativa = await _autorizacao(db_session, utilizador_id, ativa=True)
    sessao_ativa = ativa.session_id
    await _autorizacao(db_session, utilizador_id, ativa=False)
    revogadas: list[str] = []

    async def revogar_falso(sessao):
        revogadas.append(sessao)

    monkeypatch.setattr(utilizadores, "revogar_sessao", revogar_falso)

    resposta = await _apagar(cliente_autenticado)
    await db_session.rollback()  # só sobrevive o que foi confirmado
    db_session.expunge_all()

    assert acerto == "-4.00"
    assert resposta.status_code == 204
    assert revogadas == [sessao_ativa]  # só a ativa
    assert await db_session.get(User, utilizador_id) is None
    for modelo, condicao in (
        (Conta, Conta.user_id == utilizador_id),
        (Categoria, Categoria.user_id == utilizador_id),
        (Autorizacao, Autorizacao.user_id == utilizador_id),
        (Movimento, Movimento.conta_id == uuid.UUID(conta_id)),
        (Reconciliacao, Reconciliacao.conta_id == uuid.UUID(conta_id)),
    ):
        assert await db_session.scalar(select(func.count()).select_from(modelo).where(condicao)) == 0
    # A sessão terminou: o cookie foi apagado, e a sessão já não existe.
    assert (await cliente_autenticado.get("/auth/me")).status_code == 401


@pytest.mark.asyncio
async def test_uma_falha_do_banco_nao_impede_o_apagamento(cliente_autenticado, db_session, monkeypatch):
    """O direito ao apagamento não fica refém de um serviço externo em baixo."""
    utilizador = await db_session.scalar(select(User).where(User.email == "teste@example.com"))
    utilizador_id = utilizador.id
    await _autorizacao(db_session, utilizador_id, ativa=True)

    async def revogar_falso(sessao):
        raise BancoIndisponivel("Não foi possível contactar o serviço de Open Banking. Tenta outra vez.")

    monkeypatch.setattr(utilizadores, "revogar_sessao", revogar_falso)

    resposta = await _apagar(cliente_autenticado)
    await db_session.rollback()
    db_session.expunge_all()

    assert resposta.status_code == 204
    assert await db_session.get(User, utilizador_id) is None


@pytest.mark.asyncio
async def test_apagar_uma_conta_nao_toca_nos_dados_de_outro_utilizador(cliente_autenticado, client, db_session):
    outro = {"email": "fica@example.com", "password": "outrapasse123"}
    await client.post("/auth/registo", json=outro)
    outro_utilizador = await db_session.scalar(select(User).where(User.email == "fica@example.com"))
    outro_id = outro_utilizador.id

    await _apagar(cliente_autenticado)
    await db_session.rollback()
    db_session.expunge_all()

    assert await db_session.get(User, outro_id) is not None
    assert (
        await db_session.scalar(
            select(func.count()).select_from(Categoria).where(Categoria.user_id == outro_id)
        )
    ) > 0
