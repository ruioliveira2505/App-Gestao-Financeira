"""
TESTES DAS GARANTIAS DA BASE DE DADOS (INTEGRIDADE)
======================================================

Algumas regras não ficam só no código: a própria base de dados (o
PostgreSQL) recusa qualquer escrita que as viole, seja qual for o código
que a tente. Estes testes escrevem DIRETAMENTE na base de dados, sem
passar pelas regras do código, para provar que a base de dados recusa
sozinha:
  - um movimento de valor 0;
  - uma categoria com uma direção que não seja "entrada" ou "saida", ou
    com um papel desconhecido;
  - uma segunda categoria com o mesmo papel (ex.: "refugio") na mesma
    direção, para o mesmo utilizador;
  - um código de moeda que não seja três letras maiúsculas;
  - duas contas do mesmo utilizador com o mesmo nome (comparado sem
    acentos nem maiúsculas);
  - a mesma conta bancária duas vezes na mesma autorização.

Testam também que apagar um utilizador apaga TODOS os seus dados (o
direito ao apagamento do RGPD, o regulamento europeu de proteção de
dados), e as regras de datas: um movimento nunca é no futuro.

COMO SE TESTA UMA RECUSA: a escrita é enviada com flush() e a base de
dados responde com um IntegrityError (o erro do SQLAlchemy para uma
restrição violada). Depois disso a sessão fica num estado de erro, por
isso cada teste desfaz a tentativa com rollback() antes de continuar.
"db_session" é a sessão de base de dados de cada teste, preparada em
tests/conftest.py (o ficheiro de preparação partilhado); tudo o que um
teste grava é desfeito no fim.
"""

import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.core.erros import Conflito
from app.core.tempo import hoje
from app.models.autorizacao import Autorizacao
from app.models.autorizacao_pendente import AutorizacaoPendente
from app.models.categoria import Categoria
from app.models.conta import Conta
from app.models.conta_bancaria import ContaBancaria
from app.models.movimento import Movimento
from app.models.reconciliacao import Reconciliacao
from app.models.session import UserSession
from app.models.user import User
from app.models.vinculo import Vinculo
from app.services.categorias_seed import semear_categorias
from app.services.contas import gravar_conta


async def _utilizador(db_session, email: str = "integridade@example.com") -> User:
    """Um utilizador gravado diretamente, com a árvore de categorias por omissão."""
    utilizador = User(email=email, password_hash="x")
    db_session.add(utilizador)
    await db_session.flush()
    await semear_categorias(db_session, utilizador.id)
    await db_session.flush()
    return utilizador


async def _conta(db_session, utilizador: User, nome: str = "Carteira", moeda: str = "EUR") -> Conta:
    conta = Conta(
        user_id=utilizador.id, nome=nome, moeda=moeda, data_ancora=date(2026, 1, 1), saldo_ancora=0
    )
    db_session.add(conta)
    await db_session.flush()
    return conta


async def _recusado(db_session) -> None:
    """Confirma que a escrita pendente é recusada pela base de dados, e desfaz a tentativa."""
    with pytest.raises(IntegrityError):
        await db_session.flush()
    await db_session.rollback()


# --- Restrições CHECK ---


@pytest.mark.asyncio
async def test_movimento_de_valor_zero_e_recusado(db_session):
    utilizador = await _utilizador(db_session)
    conta = await _conta(db_session, utilizador)
    categoria = await db_session.scalar(select(Categoria).where(Categoria.user_id == utilizador.id))

    db_session.add(
        Movimento(
            conta_id=conta.id,
            categoria_id=categoria.id,
            data=date(2026, 2, 1),
            descricao="Nada",
            valor=Decimal("0.00"),
        )
    )
    await _recusado(db_session)


@pytest.mark.asyncio
async def test_categoria_com_direcao_ou_papel_desconhecidos_e_recusada(db_session):
    utilizador = await _utilizador(db_session)

    db_session.add(Categoria(user_id=utilizador.id, nome="X", direcao="lateral", ordem=99))
    await _recusado(db_session)

    utilizador = await _utilizador(db_session, "outro@example.com")
    db_session.add(
        Categoria(user_id=utilizador.id, nome="X", direcao="saida", papel="enfeite", ordem=99)
    )
    await _recusado(db_session)


@pytest.mark.asyncio
async def test_segunda_categoria_refugio_na_mesma_direcao_e_recusada(db_session):
    """
    Cada utilizador tem no máximo uma categoria-refúgio por direção. Com
    duas, a importação do banco não saberia para qual mandar os
    movimentos.
    """
    utilizador = await _utilizador(db_session)

    db_session.add(
        Categoria(user_id=utilizador.id, nome="Outro refúgio", direcao="saida", papel="refugio", ordem=99)
    )
    await _recusado(db_session)


@pytest.mark.asyncio
async def test_moeda_fora_do_formato_e_recusada(db_session):
    utilizador = await _utilizador(db_session)

    db_session.add(
        Conta(user_id=utilizador.id, nome="Minúsculas", moeda="eur", data_ancora=date(2026, 1, 1))
    )
    await _recusado(db_session)


@pytest.mark.asyncio
async def test_categoria_protegida_e_a_que_tem_papel(db_session):
    utilizador = await _utilizador(db_session)
    categorias = (await db_session.scalars(select(Categoria).where(Categoria.user_id == utilizador.id))).all()

    protegidas = {(c.nome, c.direcao, c.papel) for c in categorias if c.protegida}

    assert protegidas == {
        ("Outros", "entrada", "refugio"),
        ("Outros", "saida", "refugio"),
        ("Acerto de saldo", "entrada", "acerto"),
        ("Acerto de saldo", "saida", "acerto"),
    }


# --- Nome de conta único (sem acentos nem maiúsculas) ---


@pytest.mark.asyncio
async def test_nome_de_conta_repetido_e_recusado_pela_base_de_dados(db_session):
    """
    O nome normalizado preenche-se sozinho ao atribuir o nome, e o índice
    único recusa " poupanca" ao lado de "Poupança" — mesmo sem passar pela
    verificação do código.
    """
    utilizador = await _utilizador(db_session)
    conta = await _conta(db_session, utilizador, nome="Poupança")
    assert conta.nome_normalizado == "poupanca"

    db_session.add(
        Conta(user_id=utilizador.id, nome=" poupanca", moeda="EUR", data_ancora=date(2026, 1, 1))
    )
    await _recusado(db_session)


@pytest.mark.asyncio
async def test_gravar_conta_traduz_o_nome_repetido_num_conflito(db_session):
    """
    O caso de dois pedidos ao mesmo tempo: os dois passam a verificação do
    código, e é o índice único que recusa o segundo. gravar_conta traduz
    essa recusa num Conflito (409), em vez de um erro genérico (500).
    """
    utilizador = await _utilizador(db_session)
    await _conta(db_session, utilizador, nome="Carteira")

    db_session.add(
        Conta(user_id=utilizador.id, nome="CARTEIRA", moeda="EUR", data_ancora=date(2026, 1, 1))
    )
    with pytest.raises(Conflito):
        await gravar_conta(db_session)
    await db_session.rollback()


# --- Contas bancárias ---


@pytest.mark.asyncio
async def test_mesma_conta_bancaria_duas_vezes_na_mesma_autorizacao_e_recusada(db_session):
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

    for _ in range(2):
        db_session.add(ContaBancaria(autorizacao_id=autorizacao.id, uid="mesmo-uid", moeda="EUR"))
    await _recusado(db_session)


# --- Apagar um utilizador apaga tudo ---


@pytest.mark.asyncio
async def test_apagar_um_utilizador_apaga_todos_os_seus_dados(db_session):
    utilizador = await _utilizador(db_session)
    outro = await _utilizador(db_session, "fica@example.com")
    conta = await _conta(db_session, utilizador)
    categoria = await db_session.scalar(
        select(Categoria).where(Categoria.user_id == utilizador.id, Categoria.direcao == "saida")
    )
    db_session.add(
        Movimento(
            conta_id=conta.id,
            categoria_id=categoria.id,
            data=date(2026, 2, 1),
            descricao="Café",
            valor=Decimal("-1.00"),
        )
    )
    autorizacao = Autorizacao(
        user_id=utilizador.id,
        session_id=str(uuid.uuid4()),
        banco="Banco Teste",
        pais="PT",
        valido_ate=datetime.now(timezone.utc) + timedelta(days=90),
    )
    db_session.add(autorizacao)
    await db_session.flush()
    conta_bancaria = ContaBancaria(autorizacao_id=autorizacao.id, uid="u1", moeda="EUR")
    db_session.add(conta_bancaria)
    await db_session.flush()
    db_session.add_all(
        [
            Vinculo(
                user_id=utilizador.id,
                conta_id=conta.id,
                conta_bancaria_id=conta_bancaria.id,
                data_corte=date(2025, 12, 31),
            ),
            AutorizacaoPendente(state=str(uuid.uuid4()), user_id=utilizador.id),
            UserSession(
                token_hash=str(uuid.uuid4()),
                user_id=utilizador.id,
                expires_at=datetime.now(timezone.utc) + timedelta(days=1),
            ),
        ]
    )
    await db_session.flush()

    await db_session.delete(utilizador)
    await db_session.flush()
    db_session.expunge_all()  # esquece o que a sessão guardava em memória

    async def quantos(modelo, condicao) -> int:
        return await db_session.scalar(select(func.count()).select_from(modelo).where(condicao))

    assert await quantos(Conta, Conta.user_id == utilizador.id) == 0
    assert await quantos(Movimento, Movimento.conta_id == conta.id) == 0
    assert await quantos(Categoria, Categoria.user_id == utilizador.id) == 0
    assert await quantos(Autorizacao, Autorizacao.user_id == utilizador.id) == 0
    assert await quantos(ContaBancaria, ContaBancaria.autorizacao_id == autorizacao.id) == 0
    assert await quantos(AutorizacaoPendente, AutorizacaoPendente.user_id == utilizador.id) == 0
    assert await quantos(UserSession, UserSession.user_id == utilizador.id) == 0
    assert await quantos(Vinculo, Vinculo.user_id == utilizador.id) == 0
    # Os dados de outro utilizador ficam intactos.
    assert await quantos(Categoria, Categoria.user_id == outro.id) > 0


# --- Datas: um movimento nunca é no futuro ---


@pytest.mark.asyncio
async def test_movimento_com_data_futura_e_recusado(cliente_autenticado, db_session):
    conta_id = (
        await cliente_autenticado.post(
            "/contas",
            json={"nome": "Datas", "moeda": "EUR", "data_ancora": "2026-01-01", "saldo_ancora": "0"},
        )
    ).json()["id"]
    utilizador = await db_session.scalar(select(User).where(User.email == "teste@example.com"))
    categoria = await db_session.scalar(
        select(Categoria).where(
            Categoria.user_id == utilizador.id,
            Categoria.direcao == "saida",
            Categoria.parent_id.is_not(None),
        )
    )
    corpo = {
        "conta_id": conta_id,
        "categoria_id": str(categoria.id),
        "descricao": "Café",
        "valor": "-1.00",
    }

    amanha = await cliente_autenticado.post(
        "/movimentos", json={**corpo, "data": (hoje() + timedelta(days=1)).isoformat()}
    )
    hoje_mesmo = await cliente_autenticado.post(
        "/movimentos", json={**corpo, "data": hoje().isoformat()}
    )

    assert amanha.status_code == 400
    assert amanha.json()["detail"] == "A data do movimento não pode ser no futuro."
    assert hoje_mesmo.status_code == 201


# --- A verificação adiada da chave movimento → categoria, com commit real ---


@pytest.mark.asyncio
async def test_verificacao_adiada_com_commit_real():
    """
    A chave "movimento → categoria" só é verificada no FIM DA TRANSAÇÃO
    (no commit). Os outros testes nunca chegam a um commit verdadeiro
    (correm dentro de uma transação desfeita no fim), por isso este abre a
    sua própria sessão, sem essa preparação, e faz commits reais na base de
    dados de teste — e apaga, no fim, tudo o que criou.

    Confirma as duas metades da regra:
      - apagar diretamente uma categoria que ainda tem movimentos continua
        a ser RECUSADO (agora no commit);
      - apagar o UTILIZADOR passa: no fim da transação, os movimentos já
        saíram em cascata com as contas.
    """
    from app.db.session import async_session

    email = f"commit-real-{uuid.uuid4()}@example.com"
    async with async_session() as sessao:
        utilizador = await _utilizador(sessao, email)
        conta = await _conta(sessao, utilizador)
        categoria = await sessao.scalar(
            select(Categoria).where(Categoria.user_id == utilizador.id, Categoria.direcao == "saida")
        )
        sessao.add(
            Movimento(
                conta_id=conta.id,
                categoria_id=categoria.id,
                data=date(2026, 2, 1),
                descricao="Café",
                valor=Decimal("-1.00"),
            )
        )
        await sessao.commit()
        utilizador_id, categoria_id = utilizador.id, categoria.id

    async with async_session() as sessao:
        await sessao.delete(await sessao.get(Categoria, categoria_id))
        with pytest.raises(IntegrityError):
            await sessao.commit()

    async with async_session() as sessao:
        await sessao.delete(await sessao.get(User, utilizador_id))
        await sessao.commit()

    async with async_session() as sessao:
        assert await sessao.get(User, utilizador_id) is None
        assert (
            await sessao.scalar(
                select(func.count()).select_from(Categoria).where(Categoria.user_id == utilizador_id)
            )
        ) == 0


@pytest.mark.asyncio
async def test_a_mesma_conta_real_nao_alimenta_duas_contas(db_session):
    """
    A mesma conta real (a mesma identificação), mesmo que chegue por duas
    autorizações diferentes, alimenta no máximo uma Conta de cada
    utilizador: senão, o mesmo dinheiro contaria duas vezes.
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
    primeira = ContaBancaria(autorizacao_id=autorizacao.id, uid="a", moeda="EUR")
    segunda = ContaBancaria(autorizacao_id=autorizacao.id, uid="b", moeda="EUR")
    conta_1 = await _conta(db_session, utilizador, nome="Um")
    conta_2 = await _conta(db_session, utilizador, nome="Dois")
    db_session.add_all([primeira, segunda])
    await db_session.flush()

    db_session.add_all(
        [
            Vinculo(
                user_id=utilizador.id,
                conta_id=conta_1.id,
                conta_bancaria_id=primeira.id,
                identificacao="hash-igual",
                data_corte=date(2025, 12, 31),
            ),
            Vinculo(
                user_id=utilizador.id,
                conta_id=conta_2.id,
                conta_bancaria_id=segunda.id,
                identificacao="hash-igual",
                data_corte=date(2025, 12, 31),
            ),
        ]
    )
    await _recusado(db_session)


@pytest.mark.asyncio
async def test_movimento_manual_nao_tem_identificador_do_banco(db_session):
    """A origem e o identificador da transação andam juntos: só um movimento do banco o tem."""
    utilizador = await _utilizador(db_session)
    conta = await _conta(db_session, utilizador)
    categoria = await db_session.scalar(
        select(Categoria).where(Categoria.user_id == utilizador.id, Categoria.direcao == "saida")
    )

    db_session.add(
        Movimento(
            conta_id=conta.id,
            categoria_id=categoria.id,
            data=date(2026, 2, 1),
            descricao="Manual com id",
            valor=Decimal("-1.00"),
            origem="manual",
            id_transacao_externa="123",
        )
    )
    await _recusado(db_session)


# --- Reconciliações e acertos ---


@pytest.mark.asyncio
async def test_regras_da_base_de_dados_nas_reconciliacoes(db_session):
    """
    Uma reconciliação por dia em cada conta; uma do banco tem sempre a
    leitura (saldo, instante e futuros); um acerto aponta sempre para uma
    reconciliação, e cada reconciliação tem no máximo um acerto.
    """
    utilizador = await _utilizador(db_session)
    conta = await _conta(db_session, utilizador)
    categoria = await db_session.scalar(
        select(Categoria).where(Categoria.user_id == utilizador.id, Categoria.papel == "acerto")
    )
    primeira = Reconciliacao(conta_id=conta.id, data=date(2026, 2, 1), saldo=Decimal("10"))
    db_session.add(primeira)
    await db_session.commit()
    # Os ids guardam-se já: depois de cada tentativa recusada (rollback),
    # os objetos lidos ficam por recarregar.
    conta_id, categoria_id, primeira_id = conta.id, categoria.id, primeira.id

    db_session.add(Reconciliacao(conta_id=conta_id, data=date(2026, 2, 1), saldo=Decimal("20")))
    await _recusado(db_session)

    db_session.add(Reconciliacao(conta_id=conta_id, data=date(2026, 2, 2), saldo=Decimal("0"), origem="banco"))
    await _recusado(db_session)

    db_session.add(
        Reconciliacao(
            conta_id=conta_id,
            data=date(2026, 2, 3),
            saldo=Decimal("0"),
            origem="banco",
            saldo_banco=Decimal("0"),
            lido_em=datetime.now(timezone.utc),
        )
    )
    await _recusado(db_session)  # falta futuros_no_banco

    def acerto(**campos) -> Movimento:
        return Movimento(
            conta_id=conta_id,
            categoria_id=categoria_id,
            data=date(2026, 2, 1),
            descricao="Acerto de saldo",
            valor=Decimal("-1"),
            origem="acerto",
            **campos,
        )

    db_session.add(acerto())  # sem reconciliação
    await _recusado(db_session)

    db_session.add(acerto(reconciliacao_id=primeira_id))
    await db_session.commit()
    db_session.add(acerto(reconciliacao_id=primeira_id))  # um segundo acerto da mesma
    await _recusado(db_session)
