"""
TESTES DO FLUXO DE OPEN BANKING, COM O BANCO SIMULADO
=========================================================

O Open Banking desta aplicação fala com o banco através da Enable Banking
(um intermediário regulado ao abrigo da PSD2, a diretiva europeia que
obriga os bancos a dar acesso aos dados de uma conta, com consentimento
do dono). Vocabulário: uma AUTORIZAÇÃO é o consentimento dado no banco,
com prazo; cada conta partilhada é uma CONTA BANCÁRIA; o VÍNCULO é o facto
de uma conta bancária alimentar uma Conta da aplicação.

Estes testes cobrem os passos do fluxo que dependem do banco, com as
chamadas à Enable Banking SUBSTITUÍDAS por versões falsas, através de
"monkeypatch" (uma ferramenta do pytest que troca um valor só durante um
teste e o repõe no fim). A substituição faz-se no módulo que USA a
função, porque cada módulo guarda a sua própria referência à função que
importou.

Cobrem:
  - "/autorizar": envia o browser para o banco e guarda a autorização
    pendente; se o banco falhar, volta à aplicação com a mensagem;
  - "/callback": o regresso do banco, com sucesso ou com erro, e um
    "state" (o valor que identifica o pedido) que só serve uma vez;
  - "criar-conta" e "sincronizar": as mensagens das regras, e uma
    sincronização com sucesso;
  - que cada uma destas rotas GRAVA DE FACTO (faz commit).

COMO SE TESTA QUE UMA ROTA GRAVA. Cada teste corre dentro de uma
transação que é desfeita no fim (ver tests/conftest.py, o ficheiro de
preparação partilhado), e a sessão de base de dados é a mesma para o
teste e para a rota. Por isso, uma alteração só enviada (flush) sem
commit continuaria visível ao teste, e um commit esquecido passaria
despercebido. A técnica: depois do pedido, o teste chama
db_session.rollback(), que desfaz só o que ainda NÃO foi confirmado. Se a
rota fez commit, os dados sobrevivem; se não fez, desaparecem.
"""

import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from urllib.parse import unquote

import pytest
from sqlalchemy import select

from app.core.erros import BancoIndisponivel
from app.models.autorizacao import Autorizacao
from app.models.autorizacao_pendente import AutorizacaoPendente
from app.models.categoria import Categoria
from app.models.conta import Conta
from app.models.conta_bancaria import ContaBancaria
from app.models.movimento import Movimento
from app.models.user import User
from app.routers import open_banking as rotas_open_banking
from app.services import importacao_movimentos

EMAIL = "teste@example.com"


async def _utilizador(db_session) -> User:
    """O utilizador de teste criado pela fixture cliente_autenticado."""
    return await db_session.scalar(select(User).where(User.email == EMAIL))


async def _conta_bancaria(db_session, conta_id: uuid.UUID | None = None) -> ContaBancaria:
    """
    Grava uma autorização ativa e uma conta bancária dela, com vínculo à
    Conta "conta_id" (ou sem vínculo, se None), sem chamar o banco.
    """
    utilizador = await _utilizador(db_session)
    autorizacao = Autorizacao(
        user_id=utilizador.id,
        session_id=str(uuid.uuid4()),
        banco="Banco Teste",
        pais="PT",
        valido_ate=datetime.now(timezone.utc) + timedelta(days=90),
    )
    db_session.add(autorizacao)
    await db_session.flush()
    conta_bancaria = ContaBancaria(
        autorizacao_id=autorizacao.id, uid=str(uuid.uuid4()), moeda="EUR", conta_id=conta_id
    )
    db_session.add(conta_bancaria)
    await db_session.commit()
    return conta_bancaria


def _sessao_do_banco() -> dict:
    """Uma sessão fictícia, com a forma real que a Enable Banking devolve."""
    return {
        "session_id": str(uuid.uuid4()),
        "aspsp": {"name": "Caixa Geral de Depósitos", "country": "PT"},
        "access": {"valid_until": "2027-04-01T10:00:00+00:00"},
        "accounts": [
            {
                "uid": str(uuid.uuid4()),
                "identification_hash": "hash-fluxo",
                "account_id": {"iban": "PT50000000000000000009999"},
                "currency": "EUR",
            }
        ],
    }


def _transacao(referencia: str, data: str, valor: str, tipo: str = "DBIT", estado: str = "BOOK") -> dict:
    """Uma transação na forma real que a Enable Banking devolve."""
    return {
        "transaction_amount": {"currency": "EUR", "amount": valor},
        "credit_debit_indicator": tipo,
        "status": estado,
        "booking_date": data,
        "remittance_information": [f"Compra {referencia}"],
        "transaction_id": None,
        "entry_reference": referencia,
    }


# --- /autorizar ---


@pytest.mark.asyncio
async def test_autorizar_envia_para_o_banco_e_grava_a_pendente(
    cliente_autenticado, db_session, monkeypatch
):
    async def iniciar_falso(banco, pais, redirect_url, state):
        return "https://banco.example/login"

    monkeypatch.setattr(rotas_open_banking, "iniciar_autorizacao", iniciar_falso)

    resposta = await cliente_autenticado.post("/open-banking/autorizar", params={"banco": "CGD"})
    await db_session.rollback()  # só sobrevive o que a rota confirmou

    assert resposta.status_code == 303
    assert resposta.headers["location"] == "https://banco.example/login"
    utilizador = await _utilizador(db_session)
    pendentes = (
        await db_session.scalars(
            select(AutorizacaoPendente).where(AutorizacaoPendente.user_id == utilizador.id)
        )
    ).all()
    assert len(pendentes) == 1


@pytest.mark.asyncio
async def test_autorizar_com_o_banco_em_baixo_volta_a_aplicacao_sem_pendente(
    cliente_autenticado, db_session, monkeypatch
):
    """
    "/autorizar" é uma navegação do browser: se o banco falhar, o
    utilizador volta à aplicação com a mensagem (e não fica a ver uma
    resposta JSON em bruto), e não fica nenhuma autorização pendente órfã.
    """

    async def iniciar_falso(banco, pais, redirect_url, state):
        raise BancoIndisponivel("O banco não aceitou o pedido. Tenta outra vez mais tarde.")

    monkeypatch.setattr(rotas_open_banking, "iniciar_autorizacao", iniciar_falso)

    resposta = await cliente_autenticado.post("/open-banking/autorizar", params={"banco": "CGD"})
    await db_session.rollback()

    assert resposta.status_code == 307
    destino = resposta.headers["location"]
    assert "/contas/nova?erro=" in destino
    assert unquote(destino.split("erro=")[1]) == (
        "O banco não aceitou o pedido. Tenta outra vez mais tarde."
    )
    utilizador = await _utilizador(db_session)
    assert (
        await db_session.scalar(
            select(AutorizacaoPendente).where(AutorizacaoPendente.user_id == utilizador.id)
        )
    ) is None


# --- /callback ---


async def _pendente(db_session) -> str:
    """Grava uma autorização pendente do utilizador de teste e devolve o seu "state"."""
    utilizador = await _utilizador(db_session)
    state = str(uuid.uuid4())
    db_session.add(AutorizacaoPendente(state=state, user_id=utilizador.id))
    await db_session.commit()
    return state


@pytest.mark.asyncio
async def test_callback_com_sucesso_grava_a_autorizacao_e_volta_a_aplicacao(
    cliente_autenticado, db_session, monkeypatch
):
    async def trocar_falso(code):
        return _sessao_do_banco()

    monkeypatch.setattr(rotas_open_banking, "trocar_codigo_por_sessao", trocar_falso)
    state = await _pendente(db_session)

    resposta = await cliente_autenticado.get(
        "/open-banking/callback", params={"code": "c", "state": state}
    )
    await db_session.rollback()

    assert resposta.status_code == 307
    autorizacao_id = uuid.UUID(resposta.headers["location"].split("?autorizacao=")[1])
    autorizacao = await db_session.get(Autorizacao, autorizacao_id)
    assert autorizacao is not None
    assert autorizacao.user_id == (await _utilizador(db_session)).id
    assert await db_session.get(AutorizacaoPendente, state) is None


@pytest.mark.asyncio
async def test_callback_com_erro_do_banco_mostra_a_mensagem_e_consome_o_state(
    cliente_autenticado, db_session, monkeypatch
):
    async def trocar_falso(code):
        raise BancoIndisponivel("O banco não aceitou o pedido. Tenta outra vez mais tarde.")

    monkeypatch.setattr(rotas_open_banking, "trocar_codigo_por_sessao", trocar_falso)
    state = await _pendente(db_session)

    primeira = await cliente_autenticado.get(
        "/open-banking/callback", params={"code": "c", "state": state}
    )
    await db_session.rollback()
    segunda = await cliente_autenticado.get(
        "/open-banking/callback", params={"code": "c", "state": state}
    )

    assert unquote(primeira.headers["location"].split("erro=")[1]) == (
        "O banco não aceitou o pedido. Tenta outra vez mais tarde."
    )
    # O "state" ficou consumido (e gravado): um segundo regresso com o
    # mesmo "state" é recusado, sem voltar a tentar trocar o código.
    assert await db_session.get(AutorizacaoPendente, state) is None
    assert unquote(segunda.headers["location"].split("erro=")[1]) == (
        "Pedido de autorização desconhecido ou já usado."
    )


# --- criar-conta: as mensagens das regras ---


@pytest.mark.asyncio
async def test_criar_conta_de_uma_conta_bancaria_ja_vinculada_e_recusado(
    cliente_autenticado, db_session
):
    conta_id = (
        await cliente_autenticado.post(
            "/contas",
            json={"nome": "Existente", "moeda": "EUR", "data_ancora": "2026-01-01", "saldo_ancora": "0"},
        )
    ).json()["id"]
    conta_bancaria = await _conta_bancaria(db_session, uuid.UUID(conta_id))

    resposta = await cliente_autenticado.post(
        f"/open-banking/contas-bancarias/{conta_bancaria.id}/criar-conta", params={"nome": "Outra"}
    )

    assert resposta.status_code == 409
    assert resposta.json()["detail"] == "Esta conta bancária já está vinculada."


@pytest.mark.asyncio
async def test_criar_conta_com_nome_so_de_espacos_diz_que_o_nome_esta_vazio(
    cliente_autenticado, db_session
):
    """
    A mensagem exata prova que o erro vem da regra do serviço (através do
    tradutor de erros), e não da validação automática do formato do pedido,
    que devolveria uma lista de erros em "detail".
    """
    conta_bancaria = await _conta_bancaria(db_session)

    resposta = await cliente_autenticado.post(
        f"/open-banking/contas-bancarias/{conta_bancaria.id}/criar-conta", params={"nome": "   "}
    )

    assert resposta.status_code == 422
    assert resposta.json()["detail"] == "O nome não pode ser vazio."


@pytest.mark.asyncio
async def test_criar_conta_com_sucesso_grava_conta_vinculo_e_movimentos(
    cliente_autenticado, db_session, monkeypatch
):
    async def saldos_falso(uid):
        return {"balances": [{"balance_type": "CLBD", "balance_amount": {"amount": "90.00"}}]}

    async def movimentos_falso(uid, data_de=None, continuation_key=None, estrategia=None):
        return {"transactions": [_transacao("t1", "2026-02-01", "10.00")]}

    monkeypatch.setattr(importacao_movimentos, "obter_saldos", saldos_falso)
    monkeypatch.setattr(importacao_movimentos, "obter_movimentos", movimentos_falso)
    conta_bancaria = await _conta_bancaria(db_session)

    resposta = await cliente_autenticado.post(
        f"/open-banking/contas-bancarias/{conta_bancaria.id}/criar-conta", params={"nome": "Do banco"}
    )
    await db_session.rollback()

    assert resposta.status_code == 200
    conta = await db_session.get(Conta, uuid.UUID(resposta.json()["conta_id"]))
    assert conta is not None
    # Saldo de hoje 90 e uma saída de 10: a âncora é 100 no dia da transação.
    assert conta.saldo_ancora == Decimal("100.00")
    await db_session.refresh(conta_bancaria)
    assert conta_bancaria.conta_id == conta.id
    assert len((await db_session.scalars(select(Movimento).where(Movimento.conta_id == conta.id))).all()) == 1


# --- sincronizar ---


@pytest.mark.asyncio
async def test_sincronizar_importa_so_o_que_e_novo_lancado_e_depois_da_ancora(
    cliente_autenticado, db_session, monkeypatch
):
    """
    Das quatro transações que o banco devolve, só uma entra: "r1" já
    existe, "r3" ainda está pendente (só entram as lançadas, "BOOK"), e
    "r4" é anterior à data inicial da conta.
    """
    conta_id = uuid.UUID(
        (
            await cliente_autenticado.post(
                "/contas",
                json={"nome": "Sinc", "moeda": "EUR", "data_ancora": "2026-01-01", "saldo_ancora": "500"},
            )
        ).json()["id"]
    )
    utilizador = await _utilizador(db_session)
    saida = await db_session.scalar(
        select(Categoria).where(
            Categoria.user_id == utilizador.id,
            Categoria.direcao == "saida",
            Categoria.parent_id.is_not(None),
        )
    )
    db_session.add(
        Movimento(
            conta_id=conta_id,
            categoria_id=saida.id,
            data=datetime(2026, 1, 10).date(),
            descricao="Já importado",
            valor=Decimal("-5.00"),
            id_transacao_externa="r1",
        )
    )
    await db_session.commit()
    conta_bancaria = await _conta_bancaria(db_session, conta_id)

    async def movimentos_falso(uid, data_de=None, continuation_key=None, estrategia=None):
        return {
            "transactions": [
                _transacao("r1", "2026-01-10", "5.00"),
                _transacao("r2", "2026-02-01", "7.50"),
                _transacao("r3", "2026-02-02", "3.00", estado="PDNG"),
                _transacao("r4", "2025-12-31", "1.00"),
            ]
        }

    monkeypatch.setattr(importacao_movimentos, "obter_movimentos", movimentos_falso)

    resposta = await cliente_autenticado.post(
        f"/open-banking/contas-bancarias/{conta_bancaria.id}/sincronizar"
    )
    await db_session.rollback()

    assert resposta.status_code == 200
    assert resposta.json() == {"movimentos_importados": 1}
    referencias = set(
        (
            await db_session.scalars(
                select(Movimento.id_transacao_externa).where(Movimento.conta_id == conta_id)
            )
        ).all()
    )
    assert referencias == {"r1", "r2"}
    novo = await db_session.scalar(
        select(Movimento).where(Movimento.id_transacao_externa == "r2")
    )
    assert novo.valor == Decimal("-7.50")
    assert (await db_session.get(Categoria, novo.categoria_id)).direcao == "saida"


# --- desvincular ---


@pytest.mark.asyncio
async def test_desvincular_grava_de_facto(cliente_autenticado, db_session):
    conta_id = (
        await cliente_autenticado.post(
            "/contas",
            json={"nome": "Vinc", "moeda": "EUR", "data_ancora": "2026-01-01", "saldo_ancora": "0"},
        )
    ).json()["id"]
    conta_bancaria = await _conta_bancaria(db_session, uuid.UUID(conta_id))
    conta_bancaria_id = conta_bancaria.id

    resposta = await cliente_autenticado.delete(
        f"/open-banking/contas-bancarias/{conta_bancaria_id}/vinculo"
    )
    await db_session.rollback()

    assert resposta.status_code == 204
    assert await db_session.get(ContaBancaria, conta_bancaria_id) is None
    assert await db_session.get(Conta, uuid.UUID(conta_id)) is not None
