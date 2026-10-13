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
from datetime import date, datetime, timedelta, timezone
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
from app.models.vinculo import Vinculo
from app.routers import open_banking as rotas_open_banking
from app.services import importacao_movimentos

EMAIL = "teste@example.com"

# O fim do prazo das sessões fictícias: daqui a 90 dias, calculado a cada
# execução. Uma data fixa ("2027-04-01") faria estes testes falhar sozinhos
# no dia em que passasse, porque a autorização passaria a "terminada".
_VALIDO_ATE = (datetime.now(timezone.utc) + timedelta(days=90)).replace(microsecond=0).isoformat()


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
    conta_bancaria = ContaBancaria(autorizacao_id=autorizacao.id, uid=str(uuid.uuid4()), moeda="EUR")
    db_session.add(conta_bancaria)
    await db_session.flush()
    if conta_id is not None:
        # O vínculo, com a data de corte na véspera do início do ano.
        db_session.add(
            Vinculo(
                user_id=utilizador.id,
                conta_id=conta_id,
                conta_bancaria_id=conta_bancaria.id,
                data_corte=date(2025, 12, 31),
            )
        )
    await db_session.commit()
    return conta_bancaria


def _sessao_do_banco() -> dict:
    """Uma sessão fictícia, com a forma real que a Enable Banking devolve."""
    return {
        "session_id": str(uuid.uuid4()),
        "aspsp": {"name": "Caixa Geral de Depósitos", "country": "PT"},
        "access": {"valid_until": _VALIDO_ATE},
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
    # O id guarda-se antes: depois do rollback, o objeto em memória fica
    # desatualizado e não se pode ler.
    conta_bancaria_id = conta_bancaria.id

    resposta = await cliente_autenticado.post(
        f"/open-banking/contas-bancarias/{conta_bancaria_id}/criar-conta", params={"nome": "Do banco"}
    )
    await db_session.rollback()

    assert resposta.status_code == 200
    conta = await db_session.get(Conta, uuid.UUID(resposta.json()["conta_id"]))
    assert conta is not None
    # Saldo de hoje 90 e uma saída de 10: a âncora é 100 no dia da transação.
    assert conta.saldo_ancora == Decimal("100.00")
    vinculo = await db_session.scalar(
        select(Vinculo).where(Vinculo.conta_bancaria_id == conta_bancaria_id)
    )
    assert vinculo.conta_id == conta.id
    # Numa Conta criada a partir do banco, a data de corte é a véspera da
    # data inicial: tudo vem do banco.
    assert vinculo.data_corte == date(2026, 1, 31)
    assert len((await db_session.scalars(select(Movimento).where(Movimento.conta_id == conta.id))).all()) == 1
    # A primeira importação conta como a primeira sincronização.
    assert vinculo.sincronizado_em is not None


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
            origem="banco",
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
    # A sincronização fica registada no vínculo: a página da conta diz
    # «Sincronizada · agora» (e depois «há 2 horas»…).
    vinculo = (await cliente_autenticado.get(f"/contas/{conta_id}")).json()["vinculo"]
    assert vinculo["sincronizado_em"] is not None
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
    # O vínculo desapareceu; a conta bancária e a Conta ficam.
    assert (
        await db_session.scalar(select(Vinculo).where(Vinculo.conta_bancaria_id == conta_bancaria_id))
    ) is None
    assert await db_session.get(ContaBancaria, conta_bancaria_id) is not None
    assert await db_session.get(Conta, uuid.UUID(conta_id)) is not None


# --- Transações que não viram movimentos: valor 0 e data futura ---


@pytest.mark.asyncio
async def test_criar_conta_nao_grava_valor_zero_nem_datas_futuras_mas_conta_as_na_ancora(
    cliente_autenticado, db_session, monkeypatch
):
    """
    O banco devolve três transações lançadas: uma normal, uma de valor 0 e
    uma com data de amanhã. Só a normal vira movimento (um movimento nunca
    tem valor 0 nem está no futuro). A de amanhã continua a contar na
    âncora, porque já está no saldo do banco: senão, quando entrasse numa
    sincronização seguinte, contaria duas vezes.
    """
    from app.core.tempo import hoje

    amanha = (hoje() + timedelta(days=1)).isoformat()

    async def saldos_falso(uid):
        return {"balances": [{"balance_type": "CLBD", "balance_amount": {"amount": "100.00"}}]}

    async def movimentos_falso(uid, data_de=None, continuation_key=None, estrategia=None):
        return {
            "transactions": [
                _transacao("n1", "2026-02-01", "10.00"),
                _transacao("z1", "2026-02-02", "0.00"),
                _transacao("f1", amanha, "5.00"),
            ]
        }

    monkeypatch.setattr(importacao_movimentos, "obter_saldos", saldos_falso)
    monkeypatch.setattr(importacao_movimentos, "obter_movimentos", movimentos_falso)
    conta_bancaria = await _conta_bancaria(db_session)

    resposta = await cliente_autenticado.post(
        f"/open-banking/contas-bancarias/{conta_bancaria.id}/criar-conta", params={"nome": "Futuro"}
    )

    assert resposta.status_code == 200
    conta = await db_session.get(Conta, uuid.UUID(resposta.json()["conta_id"]))
    referencias = set(
        (
            await db_session.scalars(
                select(Movimento.id_transacao_externa).where(Movimento.conta_id == conta.id)
            )
        ).all()
    )
    assert referencias == {"n1"}
    # Âncora = saldo do banco (100) menos TODAS as transações lançadas
    # (−10, 0 e −5): 115. O saldo na aplicação fica 105 até a de amanhã
    # entrar, e então bate certo com o banco (100).
    assert conta.saldo_ancora == Decimal("115.00")


@pytest.mark.asyncio
async def test_sincronizar_ignora_valor_zero_e_datas_futuras(
    cliente_autenticado, db_session, monkeypatch
):
    from app.core.tempo import hoje

    conta_id = uuid.UUID(
        (
            await cliente_autenticado.post(
                "/contas",
                json={"nome": "Sinc2", "moeda": "EUR", "data_ancora": "2026-01-01", "saldo_ancora": "0"},
            )
        ).json()["id"]
    )
    conta_bancaria = await _conta_bancaria(db_session, conta_id)
    amanha = (hoje() + timedelta(days=1)).isoformat()

    async def movimentos_falso(uid, data_de=None, continuation_key=None, estrategia=None):
        return {
            "transactions": [
                _transacao("s1", "2026-02-01", "4.00"),
                _transacao("s0", "2026-02-02", "0.00"),
                _transacao("sf", amanha, "6.00"),
            ]
        }

    monkeypatch.setattr(importacao_movimentos, "obter_movimentos", movimentos_falso)

    resposta = await cliente_autenticado.post(
        f"/open-banking/contas-bancarias/{conta_bancaria.id}/sincronizar"
    )

    assert resposta.json() == {"movimentos_importados": 1}


@pytest.mark.asyncio
async def test_sincronizar_sem_nada_de_novo_marca_a_sincronizacao(cliente_autenticado, db_session, monkeypatch):
    """Sem movimentos novos, a sincronização correu bem na mesma: fica registada no vínculo."""
    conta_id = uuid.UUID(
        (
            await cliente_autenticado.post(
                "/contas",
                json={"nome": "Nada novo", "moeda": "EUR", "data_ancora": "2026-01-01", "saldo_ancora": "0"},
            )
        ).json()["id"]
    )
    conta_bancaria = await _conta_bancaria(db_session, conta_id)
    conta_bancaria_id = conta_bancaria.id

    async def movimentos_falso(uid, data_de=None, continuation_key=None, estrategia=None):
        return {"transactions": []}

    monkeypatch.setattr(importacao_movimentos, "obter_movimentos", movimentos_falso)

    resposta = await cliente_autenticado.post(f"/open-banking/contas-bancarias/{conta_bancaria_id}/sincronizar")
    await db_session.rollback()

    assert resposta.json() == {"movimentos_importados": 0}
    vinculo = await db_session.scalar(select(Vinculo).where(Vinculo.conta_bancaria_id == conta_bancaria_id))
    assert vinculo.sincronizado_em is not None


@pytest.mark.asyncio
async def test_sincronizar_que_falha_nao_mexe_na_ultima_sincronizacao(cliente_autenticado, db_session, monkeypatch):
    """O banco falha (limite diário): a última sincronização que correu bem fica como estava."""
    from app.core.erros import LimiteDoBanco

    conta_id = uuid.UUID(
        (
            await cliente_autenticado.post(
                "/contas",
                json={"nome": "Falha", "moeda": "EUR", "data_ancora": "2026-01-01", "saldo_ancora": "0"},
            )
        ).json()["id"]
    )
    conta_bancaria = await _conta_bancaria(db_session, conta_id)
    conta_bancaria_id = conta_bancaria.id

    async def movimentos_falso(uid, data_de=None, continuation_key=None, estrategia=None):
        raise LimiteDoBanco("Tenta outra vez amanhã.")

    monkeypatch.setattr(importacao_movimentos, "obter_movimentos", movimentos_falso)

    resposta = await cliente_autenticado.post(f"/open-banking/contas-bancarias/{conta_bancaria_id}/sincronizar")
    await db_session.rollback()

    assert resposta.status_code == 429
    vinculo = await db_session.scalar(select(Vinculo).where(Vinculo.conta_bancaria_id == conta_bancaria_id))
    # O vínculo de teste começa sem nenhuma sincronização, e continua assim.
    assert vinculo.sincronizado_em is None
    # Mas a falha fica guardada, com o motivo: a página da conta continua a
    # dizer «Falhou · limite do banco» ao ser reaberta.
    assert vinculo.falha_em is not None
    assert vinculo.falha_motivo == "limite"


@pytest.mark.asyncio
async def test_falha_sem_ligacao_fica_guardada_e_uma_sincronizacao_boa_apaga_a(
    cliente_autenticado, db_session, monkeypatch
):
    """
    O banco falha (502): fica guardado «sem-ligacao» e a API devolve-o no
    vínculo. Uma sincronização que corre bem a seguir apaga a falha.
    """
    from app.core.erros import BancoIndisponivel

    conta_id = uuid.UUID(
        (
            await cliente_autenticado.post(
                "/contas",
                json={"nome": "Volta", "moeda": "EUR", "data_ancora": "2026-01-01", "saldo_ancora": "0"},
            )
        ).json()["id"]
    )
    conta_bancaria = await _conta_bancaria(db_session, conta_id)
    conta_bancaria_id = conta_bancaria.id
    falhar = True

    async def movimentos_falso(uid, data_de=None, continuation_key=None, estrategia=None):
        if falhar:
            raise BancoIndisponivel("O banco não respondeu.")
        return {"transactions": []}

    monkeypatch.setattr(importacao_movimentos, "obter_movimentos", movimentos_falso)

    resposta = await cliente_autenticado.post(f"/open-banking/contas-bancarias/{conta_bancaria_id}/sincronizar")
    assert resposta.status_code == 502
    vinculo = (await cliente_autenticado.get(f"/contas/{conta_id}")).json()["vinculo"]
    assert vinculo["falha_motivo"] == "sem-ligacao"
    assert vinculo["falha_em"] is not None

    falhar = False
    resposta = await cliente_autenticado.post(f"/open-banking/contas-bancarias/{conta_bancaria_id}/sincronizar")
    assert resposta.status_code == 200
    vinculo = (await cliente_autenticado.get(f"/contas/{conta_id}")).json()["vinculo"]
    assert vinculo["falha_motivo"] is None
    assert vinculo["falha_em"] is None
    assert vinculo["sincronizado_em"] is not None


# --- O vínculo (F2): data de corte, origem, impressão digital, bloqueio ---


@pytest.mark.asyncio
async def test_eliminar_uma_conta_vinculada_deixa_a_conta_bancaria_livre(cliente_autenticado, db_session):
    conta_id = (
        await cliente_autenticado.post(
            "/contas",
            json={"nome": "Vai", "moeda": "EUR", "data_ancora": "2026-01-01", "saldo_ancora": "0"},
        )
    ).json()["id"]
    conta_bancaria = await _conta_bancaria(db_session, uuid.UUID(conta_id))
    conta_bancaria_id = conta_bancaria.id

    resposta = await cliente_autenticado.delete(f"/contas/{conta_id}")
    await db_session.rollback()
    db_session.expunge_all()

    assert resposta.status_code == 204
    assert await db_session.get(ContaBancaria, conta_bancaria_id) is not None
    assert (
        await db_session.scalar(select(Vinculo).where(Vinculo.conta_bancaria_id == conta_bancaria_id))
    ) is None


@pytest.mark.asyncio
async def test_desvincular_uma_conta_bancaria_livre_e_um_conflito(cliente_autenticado, db_session):
    conta_bancaria = await _conta_bancaria(db_session)

    resposta = await cliente_autenticado.delete(
        f"/open-banking/contas-bancarias/{conta_bancaria.id}/vinculo"
    )

    assert resposta.status_code == 409
    assert resposta.json()["detail"] == "Esta conta bancária não está vinculada."


@pytest.mark.asyncio
async def test_sincronizar_respeita_a_data_de_corte_e_so_conta_movimentos_do_banco(
    cliente_autenticado, db_session, monkeypatch
):
    """
    A Conta tem um movimento MANUAL recente (de antes do vínculo) e a data
    de corte é 31 de março. A sincronização pede ao banco a partir de 1 de
    abril (o dia a seguir ao corte) — o movimento manual não a puxa para
    trás —, e uma transação de 20 de março, anterior ao corte, nunca entra.
    """
    conta_id = uuid.UUID(
        (
            await cliente_autenticado.post(
                "/contas",
                json={"nome": "Corte", "moeda": "EUR", "data_ancora": "2026-01-01", "saldo_ancora": "0"},
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
            data=date(2026, 3, 30),
            descricao="Manual",
            valor=Decimal("-2.00"),
        )
    )
    await db_session.commit()
    conta_bancaria = await _conta_bancaria(db_session, conta_id)
    vinculo = await db_session.scalar(
        select(Vinculo).where(Vinculo.conta_bancaria_id == conta_bancaria.id)
    )
    vinculo.data_corte = date(2026, 3, 31)
    await db_session.commit()
    pedidos: list[date | None] = []

    async def movimentos_falso(uid, data_de=None, continuation_key=None, estrategia=None):
        pedidos.append(data_de)
        return {
            "transactions": [
                _transacao("antes", "2026-03-20", "1.00"),
                _transacao("depois", "2026-04-02", "3.00"),
            ]
        }

    monkeypatch.setattr(importacao_movimentos, "obter_movimentos", movimentos_falso)

    resposta = await cliente_autenticado.post(
        f"/open-banking/contas-bancarias/{conta_bancaria.id}/sincronizar"
    )

    assert resposta.json() == {"movimentos_importados": 1}
    assert pedidos == [date(2026, 4, 1)]
    novo = await db_session.scalar(select(Movimento).where(Movimento.id_transacao_externa == "depois"))
    assert novo.origem == "banco"
    assert novo.vinculo_id == vinculo.id
    manual = await db_session.scalar(select(Movimento).where(Movimento.descricao == "Manual"))
    assert manual.origem == "manual" and manual.vinculo_id is None


@pytest.mark.asyncio
async def test_transacoes_sem_identificador_recebem_impressao_digital_e_nao_duplicam(
    cliente_autenticado, db_session, monkeypatch
):
    """
    Dois cafés iguais no mesmo dia, sem identificador do banco: entram os
    dois (a ordem distingue-os) e uma segunda sincronização não os repete.
    """
    conta_id = uuid.UUID(
        (
            await cliente_autenticado.post(
                "/contas",
                json={"nome": "Cafés", "moeda": "EUR", "data_ancora": "2026-01-01", "saldo_ancora": "0"},
            )
        ).json()["id"]
    )
    conta_bancaria = await _conta_bancaria(db_session, conta_id)
    cafe = {**_transacao("x", "2026-02-01", "1.20"), "entry_reference": None}

    async def movimentos_falso(uid, data_de=None, continuation_key=None, estrategia=None):
        return {"transactions": [dict(cafe), dict(cafe)]}

    monkeypatch.setattr(importacao_movimentos, "obter_movimentos", movimentos_falso)
    rota = f"/open-banking/contas-bancarias/{conta_bancaria.id}/sincronizar"

    primeira = await cliente_autenticado.post(rota)
    segunda = await cliente_autenticado.post(rota)

    assert primeira.json() == {"movimentos_importados": 2}
    assert segunda.json() == {"movimentos_importados": 0}
    ids = (
        await db_session.scalars(
            select(Movimento.id_transacao_externa).where(Movimento.conta_id == conta_id)
        )
    ).all()
    assert len(set(ids)) == 2 and all(i.startswith("fp:") for i in ids)


@pytest.mark.asyncio
async def test_uma_operacao_de_cada_vez_por_conta():
    """
    Duas sessões de base de dados independentes, como dois pedidos ao mesmo
    tempo: enquanto a primeira tem o bloqueio da Conta (até ao fim da sua
    transação), a segunda recebe um Conflito (409) em vez de avançar.
    """
    from app.core.erros import Conflito
    from app.db.session import async_session
    from app.services.bloqueios import bloquear_conta

    conta_id = uuid.uuid4()  # o bloqueio não precisa de uma Conta gravada
    async with async_session() as primeira, async_session() as segunda:
        await bloquear_conta(primeira, conta_id)
        # A mesma transação pode pedir o mesmo bloqueio outra vez.
        await bloquear_conta(primeira, conta_id)

        with pytest.raises(Conflito):
            await bloquear_conta(segunda, conta_id)

        await primeira.rollback()  # o fim da transação larga o bloqueio
        await bloquear_conta(segunda, conta_id)
        await segunda.rollback()



@pytest.mark.asyncio
async def test_sincronizar_e_criar_conta_fazem_os_pedidos_com_o_utilizador_presente(
    cliente_autenticado, db_session, monkeypatch
):
    """
    Foi o utilizador a pedir: os pedidos ao banco correm marcados como «com
    o utilizador presente» (levam os cabeçalhos PSU e não contam para o
    limite diário — ver enable_banking.py). Fora de um pedido, não.
    """
    from app.services import enable_banking

    presencas = []

    async def movimentos_falso(uid, data_de=None, continuation_key=None, estrategia=None):
        presencas.append(enable_banking.utilizador_presente())
        return {"transactions": []}

    async def saldos_falso(uid):
        presencas.append(enable_banking.utilizador_presente())
        return {"balances": [{"balance_type": "CLBD", "balance_amount": {"amount": "0.00"}}]}

    monkeypatch.setattr(importacao_movimentos, "obter_movimentos", movimentos_falso)
    monkeypatch.setattr(importacao_movimentos, "obter_saldos", saldos_falso)

    livre = await _conta_bancaria(db_session)
    criada = await cliente_autenticado.post(
        f"/open-banking/contas-bancarias/{livre.id}/criar-conta", params={"nome": "Presente"}
    )
    assert criada.status_code == 200
    sincronizada = await cliente_autenticado.post(f"/open-banking/contas-bancarias/{livre.id}/sincronizar")
    assert sincronizada.status_code == 200

    assert presencas and all(presencas)
    assert not enable_banking.utilizador_presente()


@pytest.mark.asyncio
async def test_sem_o_utilizador_presente_a_sincronizacao_nao_pede_o_saldo(
    cliente_autenticado, db_session, monkeypatch
):
    """
    Sem o utilizador presente (uma futura sincronização automática), não se
    gasta um acesso ao banco só para comparar o saldo: pedem-se só os
    movimentos.
    """
    pedidos = []

    async def movimentos_falso(uid, data_de=None, continuation_key=None, estrategia=None):
        pedidos.append("movimentos")
        return {"transactions": []}

    async def saldos_falso(uid):
        pedidos.append("saldo")
        return {"balances": []}

    monkeypatch.setattr(importacao_movimentos, "obter_movimentos", movimentos_falso)
    monkeypatch.setattr(importacao_movimentos, "obter_saldos", saldos_falso)
    utilizador = await _utilizador(db_session)
    conta = Conta(user_id=utilizador.id, nome="Ausente", moeda="EUR", data_ancora=date(2026, 1, 1), saldo_ancora=Decimal("0"))
    db_session.add(conta)
    await db_session.flush()
    conta_bancaria = await _conta_bancaria(db_session, conta.id)

    await importacao_movimentos.sincronizar_conta_bancaria(db_session, utilizador, conta_bancaria)

    assert pedidos == ["movimentos"]
