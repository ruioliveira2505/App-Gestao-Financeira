"""
TESTES DE VINCULAR UMA CONTA EXISTENTE E DESVINCULAR
======================================================

Vocabulário: uma AUTORIZAÇÃO é o consentimento dado no banco; cada conta
partilhada é uma CONTA BANCÁRIA; o VÍNCULO é o facto de uma conta bancária
alimentar uma CONTA. Uma RECONCILIAÇÃO afirma «no fim do dia D, o saldo
era S»; o ACERTO é o movimento pela diferença entre S e o saldo calculado.

O cenário-base (usado por vários testes): uma Conta manual com saldo
inicial 100 a 1 de janeiro, uma saída de 20 a 1 de fevereiro e outra de 10
a 30 de março (a mesma compra que o banco só lança a 31 de março). O banco
diz que o saldo contabilístico é 50, e tem duas transações depois de 30
de março: −10 a 31 de março e −15 a 2 de abril.

As contas, à mão:
  - saldo da aplicação: 100 − 20 − 10 = 70;
  - saldo do banco no fim de 30 de março: 50 − (−10 − 15) = 75;
  - acerto sem emparelhar: 75 − 70 = +5 (a compra de 10 contaria duas
    vezes: à mão a 30 e do banco a 31);
  - acerto com o par aceite (o −10 manual sai): 75 − 80 = −5;
  - saldo final com o par: 100 − 20 − 5 − 10 − 15 = 50, igual ao banco.

As chamadas à Enable Banking são substituídas por versões falsas com
"monkeypatch" (uma ferramenta do pytest que troca um valor só durante um
teste), no módulo que as usa.
"""

import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pytest
from sqlalchemy import select

from app.models.autorizacao import Autorizacao
from app.models.categoria import Categoria
from app.models.conta import Conta
from app.models.conta_bancaria import ContaBancaria
from app.models.movimento import Movimento
from app.models.reconciliacao import Reconciliacao
from app.models.user import User
from app.models.vinculo import Vinculo
from app.services import importacao_movimentos

EMAIL = "teste@example.com"


def _transacao(referencia: str, data: str, valor: str, tipo: str = "DBIT") -> dict:
    return {
        "transaction_amount": {"currency": "EUR", "amount": valor},
        "credit_debit_indicator": tipo,
        "status": "BOOK",
        "booking_date": data,
        "remittance_information": [f"Banco {referencia}"],
        "transaction_id": None,
        "entry_reference": referencia,
    }


def _banco_falso(monkeypatch, saldo: str, transacoes: list[dict]) -> list:
    """Substitui o banco: um saldo contabilístico fixo e uma lista de transações. Devolve os pedidos feitos."""
    pedidos = []

    async def saldos(uid):
        return {"balances": [{"balance_type": "CLBD", "balance_amount": {"amount": saldo}}]}

    async def movimentos(uid, data_de=None, continuation_key=None, estrategia=None):
        pedidos.append(data_de)
        return {"transactions": [dict(t) for t in transacoes]}

    monkeypatch.setattr(importacao_movimentos, "obter_saldos", saldos)
    monkeypatch.setattr(importacao_movimentos, "obter_movimentos", movimentos)
    return pedidos


async def _utilizador(db_session) -> User:
    return await db_session.scalar(select(User).where(User.email == EMAIL))


async def _categoria(db_session, nome: str | None = None) -> Categoria:
    utilizador = await _utilizador(db_session)
    consulta = select(Categoria).where(
        Categoria.user_id == utilizador.id,
        Categoria.direcao == "saida",
        Categoria.parent_id.is_not(None),
        Categoria.papel.is_(None),
    )
    if nome:
        consulta = consulta.where(Categoria.nome == nome)
    return (await db_session.scalars(consulta)).first()


async def _cenario(cliente, db_session) -> tuple[str, ContaBancaria]:
    """A Conta manual do cenário-base e uma conta bancária livre (ver o topo do ficheiro)."""
    conta_id = (
        await cliente.post(
            "/contas",
            json={"nome": "Ordenado", "moeda": "EUR", "data_ancora": "2026-01-01", "saldo_ancora": "100"},
        )
    ).json()["id"]
    categoria = await _categoria(db_session)
    for data, valor in (("2026-02-01", "-20.00"), ("2026-03-30", "-10.00")):
        await cliente.post(
            "/movimentos",
            json={
                "conta_id": conta_id,
                "categoria_id": str(categoria.id),
                "data": data,
                "descricao": "À mão",
                "valor": valor,
            },
        )
    utilizador = await _utilizador(db_session)
    autorizacao = Autorizacao(
        user_id=utilizador.id,
        session_id=str(uuid.uuid4()),
        banco="Caixa Geral de Depósitos",
        pais="PT",
        valido_ate=datetime.now(timezone.utc) + timedelta(days=90),
    )
    db_session.add(autorizacao)
    await db_session.flush()
    conta_bancaria = ContaBancaria(
        autorizacao_id=autorizacao.id, uid="uid-cgd", moeda="EUR", identification_hash="hash-cgd"
    )
    db_session.add(conta_bancaria)
    await db_session.commit()
    return conta_id, conta_bancaria


_TRANSACOES = [_transacao("b1", "2026-03-31", "10.00"), _transacao("b2", "2026-04-02", "15.00")]


async def _saldo(cliente, conta_id: str) -> str:
    return (await cliente.get(f"/contas/{conta_id}")).json()["saldo"]


async def _vincular(cliente, conta_bancaria_id, conta_id, **corpo):
    return await cliente.post(
        f"/open-banking/contas-bancarias/{conta_bancaria_id}/vincular",
        json={"conta_id": conta_id, **corpo},
    )


# --- Continuar ---


@pytest.mark.asyncio
async def test_pre_visualizar_continuar_mostra_o_antes_e_depois_e_o_par(
    cliente_autenticado, db_session, monkeypatch
):
    conta_id, conta_bancaria = await _cenario(cliente_autenticado, db_session)
    pedidos = _banco_falso(monkeypatch, "50.00", _TRANSACOES)

    resposta = await cliente_autenticado.post(
        f"/open-banking/contas-bancarias/{conta_bancaria.id}/vincular/simular",
        json={"conta_id": conta_id, "modo": "continuar"},
    )

    efeito = resposta.json()
    assert resposta.status_code == 200
    assert efeito["data_corte"] == "2026-03-30"
    assert pedidos == [date(2026, 3, 31)]  # o banco é lido a partir do dia a seguir ao corte
    assert (efeito["saldo_aplicacao"], efeito["saldo_banco"]) == ("70.00", "50.00")
    assert (efeito["acerto_sem_pares"], efeito["acerto_com_pares"]) == ("5.00", "-5.00")
    assert efeito["movimentos_a_importar"] == 2
    [par] = efeito["pares"]
    assert (par["valor"], par["data_manual"], par["data_banco"]) == ("-10.00", "2026-03-30", "2026-03-31")
    # Nada foi gravado.
    assert (
        await db_session.scalar(select(Vinculo).where(Vinculo.conta_bancaria_id == conta_bancaria.id))
    ) is None


@pytest.mark.asyncio
async def test_vincular_em_continuar_com_o_par_aceite_bate_com_o_banco(
    cliente_autenticado, db_session, monkeypatch
):
    conta_id, conta_bancaria = await _cenario(cliente_autenticado, db_session)
    _banco_falso(monkeypatch, "50.00", _TRANSACOES)
    simulacao = (
        await cliente_autenticado.post(
            f"/open-banking/contas-bancarias/{conta_bancaria.id}/vincular/simular",
            json={"conta_id": conta_id},
        )
    ).json()
    categoria_do_manual = (await _categoria(db_session)).id

    resposta = await _vincular(
        cliente_autenticado,
        conta_bancaria.id,
        conta_id,
        modo="continuar",
        pares_aceites=[simulacao["pares"][0]["manual_id"]],
    )
    await db_session.rollback()  # só sobrevive o que foi confirmado
    db_session.expunge_all()

    assert resposta.status_code == 200
    assert resposta.json() == {"modo": "continuar", "movimentos_importados": 2, "acerto": "-5.00"}
    assert await _saldo(cliente_autenticado, conta_id) == "50.00"
    vinculo = await db_session.scalar(select(Vinculo).where(Vinculo.conta_id == uuid.UUID(conta_id)))
    assert vinculo.data_corte == date(2026, 3, 30)
    conta = await db_session.get(Conta, uuid.UUID(conta_id))
    assert conta.banco == "Caixa Geral de Depósitos"
    assert conta.identificacao_bancaria == "hash-cgd"
    # O manual de 30 de março saiu; a mesma compra, vinda do banco, ficou
    # com a categoria dele.
    movimentos = (
        await db_session.scalars(
            select(Movimento).where(Movimento.conta_id == uuid.UUID(conta_id)).order_by(Movimento.data)
        )
    ).all()
    assert [(m.data.isoformat(), m.origem) for m in movimentos] == [
        ("2026-02-01", "manual"),
        ("2026-03-30", "acerto"),
        ("2026-03-31", "banco"),
        ("2026-04-02", "banco"),
    ]
    assert movimentos[2].categoria_id == categoria_do_manual
    reconciliacao = await db_session.scalar(select(Reconciliacao).where(Reconciliacao.conta_id == uuid.UUID(conta_id)))
    assert (reconciliacao.origem, reconciliacao.saldo_banco, reconciliacao.saldo) == (
        "banco",
        Decimal("50.00"),
        Decimal("75.00"),
    )


@pytest.mark.asyncio
async def test_regras_de_vincular_uma_conta_existente(cliente_autenticado, db_session, monkeypatch):
    conta_id, conta_bancaria = await _cenario(cliente_autenticado, db_session)
    _banco_falso(monkeypatch, "50.00", _TRANSACOES)
    em_dolares = (
        await cliente_autenticado.post(
            "/contas",
            json={"nome": "Dólares", "moeda": "USD", "data_ancora": "2026-01-01", "saldo_ancora": "0"},
        )
    ).json()["id"]

    moeda_diferente = await _vincular(cliente_autenticado, conta_bancaria.id, em_dolares)
    primeira = await _vincular(cliente_autenticado, conta_bancaria.id, conta_id)
    outra_vez = await _vincular(cliente_autenticado, conta_bancaria.id, conta_id)

    assert moeda_diferente.status_code == 400
    assert "mesma moeda" in moeda_diferente.json()["detail"]
    assert primeira.status_code == 200
    assert outra_vez.status_code == 409


# --- Substituir ---


@pytest.mark.asyncio
async def test_vincular_em_substituir_troca_o_historico_pelo_do_banco(
    cliente_autenticado, db_session, monkeypatch
):
    """
    Os movimentos e as reconciliações da Conta saem, e a data e o saldo
    iniciais vêm do banco: saldo 50, transações −10 e −15 desde 31 de
    março, por isso a âncora é 75 a 31 de março.
    """
    conta_id, conta_bancaria = await _cenario(cliente_autenticado, db_session)
    await cliente_autenticado.post(
        f"/contas/{conta_id}/reconciliacoes", json={"data": "2026-03-30", "saldo": "75.00"}
    )
    _banco_falso(monkeypatch, "50.00", _TRANSACOES)
    simulacao = (
        await cliente_autenticado.post(
            f"/open-banking/contas-bancarias/{conta_bancaria.id}/vincular/simular",
            json={"conta_id": conta_id, "modo": "substituir"},
        )
    ).json()

    resposta = await _vincular(cliente_autenticado, conta_bancaria.id, conta_id, modo="substituir")
    await db_session.rollback()
    db_session.expunge_all()

    assert (simulacao["movimentos_a_perder"], simulacao["reconciliacoes_a_perder"]) == (2, 1)
    assert resposta.json()["movimentos_importados"] == 2
    conta = await db_session.get(Conta, uuid.UUID(conta_id))
    assert (conta.data_ancora, conta.saldo_ancora) == (date(2026, 3, 31), Decimal("75.00"))
    assert await _saldo(cliente_autenticado, conta_id) == "50.00"
    assert (
        await db_session.scalar(select(Reconciliacao).where(Reconciliacao.conta_id == conta.id))
    ) is None
    vinculo = await db_session.scalar(select(Vinculo).where(Vinculo.conta_id == conta.id))
    assert vinculo.data_corte == date(2026, 3, 30)


# --- O movimento atrasado e a comparação interna com o banco ---


async def _conta_vinculada(cliente, db_session, monkeypatch) -> tuple[str, ContaBancaria]:
    """O cenário-base já vinculado em "continuar" (sem aceitar o par)."""
    conta_id, conta_bancaria = await _cenario(cliente, db_session)
    _banco_falso(monkeypatch, "50.00", _TRANSACOES)
    await _vincular(cliente, conta_bancaria.id, conta_id)
    return conta_id, conta_bancaria


@pytest.mark.asyncio
async def test_movimento_atrasado_soma_se_ao_saldo_derivado_e_o_acerto_mantem_se(
    cliente_autenticado, db_session, monkeypatch
):
    """
    A reconciliação do banco de «continuar» (30 de março, saldo derivado 75,
    acerto +5). Mais tarde chega um movimento do banco de −6 com data de 29
    de março (atrasado: não estava no saldo lido). Ao recalcular, soma-se ao
    saldo derivado (75 → 69) e o acerto não muda: o movimento conta, sem um
    acerto falso. O movimento grava-se diretamente, porque a sincronização
    nunca importa nada até ao dia de corte; o que se testa é o cálculo.
    """
    from app.services.reconciliacoes import recalcular_acertos

    conta_id, conta_bancaria = await _conta_vinculada(cliente_autenticado, db_session, monkeypatch)
    reconciliacao = await db_session.scalar(select(Reconciliacao).where(Reconciliacao.conta_id == uuid.UUID(conta_id)))
    vinculo = await db_session.scalar(select(Vinculo).where(Vinculo.conta_id == uuid.UUID(conta_id)))
    categoria = await _categoria(db_session)
    db_session.add(
        Movimento(
            conta_id=uuid.UUID(conta_id),
            categoria_id=categoria.id,
            data=date(2026, 3, 29),
            descricao="Banco atrasada",
            valor=Decimal("-6.00"),
            origem="banco",
            id_transacao_externa="atrasada",
            vinculo_id=vinculo.id,
            created_at=reconciliacao.lido_em + timedelta(hours=1),
        )
    )
    await db_session.flush()

    await recalcular_acertos(db_session, uuid.UUID(conta_id))
    await db_session.commit()
    await db_session.refresh(reconciliacao)

    assert reconciliacao.saldo == Decimal("69.00")
    acerto = await db_session.scalar(select(Movimento.valor).where(Movimento.reconciliacao_id == reconciliacao.id))
    assert acerto == Decimal("5.00")
    assert await _saldo(cliente_autenticado, conta_id) == "44.00"


@pytest.mark.asyncio
async def test_continuar_sem_diferenca_nao_cria_reconciliacao(cliente_autenticado, db_session, monkeypatch):
    """
    Se o saldo do banco no dia de corte já bate com o da aplicação, não há
    nada a acertar: vincula-se sem reconciliação (regra R2). O banco diz 45;
    com −10 e −15 depois do corte, no fim de 30 de março eram 70, o mesmo
    que a aplicação.
    """
    conta_id, conta_bancaria = await _cenario(cliente_autenticado, db_session)
    _banco_falso(monkeypatch, "45.00", _TRANSACOES)

    resposta = await _vincular(cliente_autenticado, conta_bancaria.id, conta_id)

    assert resposta.json()["acerto"] == "0.00"
    assert (await cliente_autenticado.get(f"/contas/{conta_id}/reconciliacoes")).json() == []
    assert await _saldo(cliente_autenticado, conta_id) == "45.00"


@pytest.mark.asyncio
async def test_sincronizar_compara_com_o_banco_e_so_regista_a_diferenca(
    cliente_autenticado, db_session, monkeypatch, caplog
):
    """
    Depois de sincronizar, a aplicação compara o seu saldo com o do banco
    (regra R8, só interna). A bater certo, nada; a não bater, fica um aviso
    no registo do servidor, e a sincronização corre bem na mesma: o
    utilizador não vê nada e não se cria nenhum acerto.
    """
    import logging

    conta_id, conta_bancaria = await _conta_vinculada(cliente_autenticado, db_session, monkeypatch)
    url = f"/open-banking/contas-bancarias/{conta_bancaria.id}/sincronizar"
    caplog.set_level(logging.INFO, logger="app.services.importacao_movimentos")

    _banco_falso(monkeypatch, "50.00", _TRANSACOES)
    a_bater = await cliente_autenticado.post(url)
    avisos_a_bater = [r for r in caplog.records if "não bate" in r.getMessage()]
    _banco_falso(monkeypatch, "40.00", _TRANSACOES)
    sem_bater = await cliente_autenticado.post(url)
    avisos = [r.getMessage() for r in caplog.records if "não bate" in r.getMessage()]

    assert a_bater.status_code == sem_bater.status_code == 200
    assert avisos_a_bater == []
    assert len(avisos) == 1 and "diferença -10.00" in avisos[0]
    reconciliacoes = (await cliente_autenticado.get(f"/contas/{conta_id}/reconciliacoes")).json()
    assert len(reconciliacoes) == 1  # só a do vínculo; nenhum acerto novo
    assert await _saldo(cliente_autenticado, conta_id) == "50.00"


@pytest.mark.asyncio
async def test_uma_reconciliacao_do_banco_nao_se_edita_nem_se_apaga(
    cliente_autenticado, db_session, monkeypatch
):
    conta_id, _ = await _conta_vinculada(cliente_autenticado, db_session, monkeypatch)
    reconciliacao = (await cliente_autenticado.get(f"/contas/{conta_id}/reconciliacoes")).json()[0]

    editar = await cliente_autenticado.patch(
        f"/reconciliacoes/{reconciliacao['id']}", json={"data": "2026-03-30", "saldo": "1"}
    )
    apagar = await cliente_autenticado.delete(f"/reconciliacoes/{reconciliacao['id']}")

    assert reconciliacao["origem"] == "banco"
    assert editar.status_code == apagar.status_code == 400


# --- Desvincular ---


@pytest.mark.asyncio
async def test_desvincular_mantendo_tudo_passa_a_reconciliacao_a_do_utilizador(
    cliente_autenticado, db_session, monkeypatch
):
    conta_id, conta_bancaria = await _conta_vinculada(cliente_autenticado, db_session, monkeypatch)

    resposta = await cliente_autenticado.delete(
        f"/open-banking/contas-bancarias/{conta_bancaria.id}/vinculo"
    )
    reconciliacoes = (await cliente_autenticado.get(f"/contas/{conta_id}/reconciliacoes")).json()

    assert resposta.status_code == 204
    assert [(r["origem"], r["saldo"]) for r in reconciliacoes] == [("utilizador", "75.00")]
    assert await _saldo(cliente_autenticado, conta_id) == "50.00"


@pytest.mark.asyncio
async def test_desvincular_tirando_o_que_veio_do_banco(cliente_autenticado, db_session, monkeypatch):
    """
    Saem os movimentos do banco e a reconciliação do banco DESTE vínculo;
    os movimentos manuais ficam, e o saldo volta ao que era antes de
    vincular (70).
    """
    conta_id, conta_bancaria = await _conta_vinculada(cliente_autenticado, db_session, monkeypatch)

    resposta = await cliente_autenticado.delete(
        f"/open-banking/contas-bancarias/{conta_bancaria.id}/vinculo", params={"modo": "tirar"}
    )

    assert resposta.status_code == 204
    origens = (
        await db_session.scalars(select(Movimento.origem).where(Movimento.conta_id == uuid.UUID(conta_id)))
    ).all()
    assert sorted(origens) == ["manual", "manual"]
    assert (await cliente_autenticado.get(f"/contas/{conta_id}/reconciliacoes")).json() == []
    assert await _saldo(cliente_autenticado, conta_id) == "70.00"


@pytest.mark.asyncio
async def test_esquecer_a_autorizacao_passa_as_reconciliacoes_do_banco_a_do_utilizador(
    cliente_autenticado, db_session, monkeypatch
):
    conta_id, conta_bancaria = await _conta_vinculada(cliente_autenticado, db_session, monkeypatch)
    autorizacao = await db_session.get(Autorizacao, conta_bancaria.autorizacao_id)
    autorizacao.valido_ate = datetime.now(timezone.utc) - timedelta(days=1)
    await db_session.commit()

    resposta = await cliente_autenticado.delete(f"/open-banking/autorizacoes/{autorizacao.id}")
    reconciliacoes = (await cliente_autenticado.get(f"/contas/{conta_id}/reconciliacoes")).json()

    assert resposta.status_code == 204
    assert [r["origem"] for r in reconciliacoes] == ["utilizador"]
    assert await _saldo(cliente_autenticado, conta_id) == "50.00"


# --- Casos encontrados na revisão da fatia ---


def _recuar_no_tempo(movimentos, reconciliacoes) -> None:
    """
    Num teste, tudo corre numa só transação e o "agora" da base de dados
    fica fixo: a leitura do saldo do banco e uma importação seguinte teriam
    a mesma hora. Na vida real são pedidos diferentes, em momentos
    diferentes. Para o simular, a leitura e os movimentos já importados
    recuam no tempo; a importação seguinte fica "depois" deles.
    """
    for reconciliacao in reconciliacoes:
        if reconciliacao.lido_em is not None:
            reconciliacao.lido_em = reconciliacao.lido_em - timedelta(minutes=30)
    for movimento in movimentos:
        movimento.created_at = movimento.created_at - timedelta(hours=1)


async def _tudo_da_conta(db_session, conta_id: str):
    conta = uuid.UUID(conta_id)
    movimentos = (await db_session.scalars(select(Movimento).where(Movimento.conta_id == conta))).all()
    reconciliacoes = (
        await db_session.scalars(select(Reconciliacao).where(Reconciliacao.conta_id == conta))
    ).all()
    return movimentos, reconciliacoes


@pytest.mark.asyncio
async def test_transacao_de_data_futura_nao_conta_duas_vezes(cliente_autenticado, db_session, monkeypatch):
    """
    O banco já lançou um débito de 10 com data daqui a 10 dias: está no
    saldo que informa (40), mas só se importa quando a data chegar. O
    acerto de "continuar" (+5) é o mesmo na pré-visualização e no
    resultado; quando a data chega e o débito entra, o acerto mantém-se e
    o saldo fica igual ao do banco (40), sem contar o débito duas vezes.
    """
    conta_id, conta_bancaria = await _cenario(cliente_autenticado, db_session)
    daqui_a_10_dias = date.today() + timedelta(days=10)
    futura = _transacao("futura", daqui_a_10_dias.isoformat(), "10.00")
    _banco_falso(monkeypatch, "40.00", [*_TRANSACOES, futura])
    simulacao = (
        await cliente_autenticado.post(
            f"/open-banking/contas-bancarias/{conta_bancaria.id}/vincular/simular",
            json={"conta_id": conta_id},
        )
    ).json()

    vincular = await _vincular(cliente_autenticado, conta_bancaria.id, conta_id)
    saldo_antes = await _saldo(cliente_autenticado, conta_id)
    _recuar_no_tempo(*await _tudo_da_conta(db_session, conta_id))
    await db_session.commit()
    # A data chega: "hoje" passa a ser o dia do débito.
    monkeypatch.setattr(importacao_movimentos, "hoje", lambda: daqui_a_10_dias)
    sincronizar = await cliente_autenticado.post(
        f"/open-banking/contas-bancarias/{conta_bancaria.id}/sincronizar"
    )

    assert simulacao["acerto_sem_pares"] == vincular.json()["acerto"] == "5.00"
    assert saldo_antes == "50.00"  # o débito futuro ainda não entrou
    assert sincronizar.json() == {"movimentos_importados": 1}
    reconciliacao = (await cliente_autenticado.get(f"/contas/{conta_id}/reconciliacoes")).json()[0]
    assert reconciliacao["acerto"] == "5.00"
    assert await _saldo(cliente_autenticado, conta_id) == "40.00"


@pytest.mark.asyncio
async def test_continuar_sobre_uma_reconciliacao_do_utilizador_no_dia_de_corte(
    cliente_autenticado, db_session, monkeypatch
):
    """
    O utilizador já tinha reconciliado a 30 de março (saldo 60, acerto −10).
    Esse é o dia de corte: a reconciliação passa a ser do banco. O acerto
    mostrado na pré-visualização é o que fica (+5, contra o saldo SEM o
    acerto antigo). Ao desvincular com "tirar", volta a ser do utilizador,
    com o saldo 60 que ele tinha afirmado.
    """
    conta_id, conta_bancaria = await _cenario(cliente_autenticado, db_session)
    await cliente_autenticado.post(
        f"/contas/{conta_id}/reconciliacoes", json={"data": "2026-03-30", "saldo": "60.00"}
    )
    _banco_falso(monkeypatch, "50.00", _TRANSACOES)
    simulacao = (
        await cliente_autenticado.post(
            f"/open-banking/contas-bancarias/{conta_bancaria.id}/vincular/simular",
            json={"conta_id": conta_id},
        )
    ).json()

    vincular = await _vincular(cliente_autenticado, conta_bancaria.id, conta_id)
    durante = (await cliente_autenticado.get(f"/contas/{conta_id}/reconciliacoes")).json()
    tirar = await cliente_autenticado.delete(
        f"/open-banking/contas-bancarias/{conta_bancaria.id}/vinculo", params={"modo": "tirar"}
    )
    await db_session.rollback()  # só sobrevive o que foi confirmado
    db_session.expunge_all()
    depois = (await cliente_autenticado.get(f"/contas/{conta_id}/reconciliacoes")).json()

    assert simulacao["acerto_sem_pares"] == vincular.json()["acerto"] == "5.00"
    assert [(r["origem"], r["data"]) for r in durante] == [("banco", "2026-03-30")]
    assert tirar.status_code == 204
    assert [(r["origem"], r["saldo"], r["acerto"]) for r in depois] == [("utilizador", "60.00", "-10.00")]
    assert await _saldo(cliente_autenticado, conta_id) == "60.00"


@pytest.mark.asyncio
async def test_tirar_so_leva_o_que_veio_do_vinculo_atual(cliente_autenticado, db_session, monkeypatch):
    """
    Primeiro vínculo (movimentos b1 e b2, reconciliação a 30 de março),
    desvinculado mantendo tudo. Segundo vínculo, que traz b3 a 10 de
    abril e uma reconciliação do banco a 2 de abril. "Tirar" leva só b3 e
    essa reconciliação; o que veio do primeiro vínculo fica.
    """
    conta_id, conta_bancaria = await _conta_vinculada(cliente_autenticado, db_session, monkeypatch)
    await cliente_autenticado.delete(f"/open-banking/contas-bancarias/{conta_bancaria.id}/vinculo")
    _banco_falso(monkeypatch, "45.00", [*_TRANSACOES, _transacao("b3", "2026-04-10", "5.00")])
    segundo = await _vincular(cliente_autenticado, conta_bancaria.id, conta_id)

    tirar = await cliente_autenticado.delete(
        f"/open-banking/contas-bancarias/{conta_bancaria.id}/vinculo", params={"modo": "tirar"}
    )
    await db_session.rollback()  # só sobrevive o que foi confirmado
    db_session.expunge_all()

    assert segundo.json()["movimentos_importados"] == 1
    assert tirar.status_code == 204
    movimentos, reconciliacoes = await _tudo_da_conta(db_session, conta_id)
    do_banco = sorted(m.id_transacao_externa for m in movimentos if m.origem == "banco")
    assert do_banco == ["b1", "b2"]
    assert [(r.data, r.origem) for r in reconciliacoes] == [(date(2026, 3, 30), "utilizador")]
    assert await _saldo(cliente_autenticado, conta_id) == "50.00"


@pytest.mark.asyncio
async def test_substituir_nao_toca_noutras_contas(cliente_autenticado, db_session, monkeypatch):
    conta_id, conta_bancaria = await _cenario(cliente_autenticado, db_session)
    outra = (
        await cliente_autenticado.post(
            "/contas",
            json={"nome": "Carteira", "moeda": "EUR", "data_ancora": "2026-01-01", "saldo_ancora": "30"},
        )
    ).json()["id"]
    categoria = await _categoria(db_session)
    await cliente_autenticado.post(
        "/movimentos",
        json={
            "conta_id": outra,
            "categoria_id": str(categoria.id),
            "data": "2026-02-01",
            "descricao": "Café",
            "valor": "-2.00",
        },
    )
    await cliente_autenticado.post(f"/contas/{outra}/reconciliacoes", json={"data": "2026-02-02", "saldo": "27.00"})
    _banco_falso(monkeypatch, "50.00", _TRANSACOES)

    await _vincular(cliente_autenticado, conta_bancaria.id, conta_id, modo="substituir")
    await db_session.rollback()
    db_session.expunge_all()

    movimentos, reconciliacoes = await _tudo_da_conta(db_session, outra)
    assert sorted(m.origem for m in movimentos) == ["acerto", "manual"]
    assert len(reconciliacoes) == 1
    assert await _saldo(cliente_autenticado, outra) == "27.00"


@pytest.mark.asyncio
async def test_sincronizar_pede_ao_banco_desde_5_dias_antes_do_ultimo_do_banco(
    cliente_autenticado, db_session, monkeypatch
):
    conta_id, conta_bancaria = await _conta_vinculada(cliente_autenticado, db_session, monkeypatch)
    pedidos = _banco_falso(monkeypatch, "45.00", [*_TRANSACOES, _transacao("b3", "2026-04-20", "5.00")])

    await cliente_autenticado.post(f"/open-banking/contas-bancarias/{conta_bancaria.id}/sincronizar")
    await cliente_autenticado.post(f"/open-banking/contas-bancarias/{conta_bancaria.id}/sincronizar")

    # 1.ª: o último do banco era 2 de abril; 5 dias antes (28 de março) é
    # antes do corte, por isso vale o dia a seguir ao corte (31 de março).
    # 2.ª: o último do banco passou a 20 de abril, por isso 15 de abril.
    assert pedidos == [date(2026, 3, 31), date(2026, 4, 15)]


@pytest.mark.asyncio
async def test_rotas_de_vincular_com_contas_de_outro_utilizador_nao_existem(
    cliente_autenticado, client, db_session, monkeypatch
):
    """Uma conta bancária ou uma Conta de outra pessoa: 404, sem revelar que existe."""
    conta_id, conta_bancaria = await _cenario(cliente_autenticado, db_session)
    _banco_falso(monkeypatch, "50.00", _TRANSACOES)
    await client.post("/auth/logout")
    intruso = {"email": "intruso@example.com", "password": "palavrapasse123"}
    await client.post("/auth/registo", json=intruso)
    await client.post("/auth/login", json=intruso)
    conta_do_intruso = (
        await client.post(
            "/contas",
            json={"nome": "Minha", "moeda": "EUR", "data_ancora": "2026-01-01", "saldo_ancora": "0"},
        )
    ).json()["id"]
    base = f"/open-banking/contas-bancarias/{conta_bancaria.id}"

    respostas = [
        await client.post(f"{base}/vincular/simular", json={"conta_id": conta_do_intruso}),
        await client.post(f"{base}/vincular", json={"conta_id": conta_do_intruso}),
    ]

    assert [r.status_code for r in respostas] == [404, 404]
    # E a Conta do dono continua manual.
    assert (await db_session.scalar(select(Vinculo).where(Vinculo.conta_id == uuid.UUID(conta_id)))) is None


@pytest.mark.asyncio
async def test_com_outra_operacao_a_decorrer_sincronizar_e_desvincular_recebem_409(
    cliente_autenticado, db_session, monkeypatch
):
    """
    Outra ligação à base de dados (como outro pedido a decorrer) tem o
    bloqueio da Conta vinculada.

    A Conta cria-se sem movimentos e o vínculo grava-se diretamente, sem
    passar pelas rotas que bloqueiam a Conta (criar movimentos, vincular):
    um teste corre todo numa só transação, e o bloqueio dessas rotas
    ficaria com o próprio teste até ao fim (a outra ligação nunca o
    conseguiria).
    """
    from sqlalchemy import text

    from app.db.session import engine
    from app.services.bloqueios import _numero_do_bloqueio

    conta_id = (
        await cliente_autenticado.post(
            "/contas",
            json={"nome": "Ordenado", "moeda": "EUR", "data_ancora": "2026-01-01", "saldo_ancora": "100"},
        )
    ).json()["id"]
    utilizador = await _utilizador(db_session)
    autorizacao = Autorizacao(
        user_id=utilizador.id,
        session_id=str(uuid.uuid4()),
        banco="Caixa Geral de Depósitos",
        pais="PT",
        valido_ate=datetime.now(timezone.utc) + timedelta(days=90),
    )
    db_session.add(autorizacao)
    await db_session.flush()
    conta_bancaria = ContaBancaria(autorizacao_id=autorizacao.id, uid="uid-cgd", moeda="EUR")
    db_session.add(conta_bancaria)
    await db_session.flush()
    db_session.add(
        Vinculo(
            user_id=utilizador.id,
            conta_id=uuid.UUID(conta_id),
            conta_bancaria_id=conta_bancaria.id,
            data_corte=date(2026, 3, 30),
        )
    )
    await db_session.commit()
    _banco_falso(monkeypatch, "50.00", _TRANSACOES)
    base = f"/open-banking/contas-bancarias/{conta_bancaria.id}"
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
            await cliente_autenticado.post(f"{base}/sincronizar"),
            await cliente_autenticado.delete(f"{base}/vinculo"),
        ]
        await transacao.rollback()

    assert [r.status_code for r in respostas] == [409] * 2
    assert all("outra operação" in r.json()["detail"] for r in respostas)


@pytest.mark.asyncio
async def test_uma_reconciliacao_do_banco_diz_quando_foi_lida(cliente_autenticado, db_session, monkeypatch):
    """
    As do banco trazem o instante em que se leu o saldo ao banco («Lido no
    banco»); as do utilizador não (None).
    """
    conta_id, conta_bancaria = await _conta_vinculada(cliente_autenticado, db_session, monkeypatch)

    do_banco = (await cliente_autenticado.get(f"/contas/{conta_id}/reconciliacoes")).json()
    await cliente_autenticado.delete(f"/open-banking/contas-bancarias/{conta_bancaria.id}/vinculo")
    do_utilizador = (await cliente_autenticado.get(f"/contas/{conta_id}/reconciliacoes")).json()

    assert [(r["origem"], r["lido_em"] is not None) for r in do_banco] == [("banco", True)]
    assert [(r["origem"], r["lido_em"]) for r in do_utilizador] == [("utilizador", None)]
