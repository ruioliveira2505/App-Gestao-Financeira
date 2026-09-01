"""
CONFIGURAÇÃO PARTILHADA DOS TESTES
=====================================

Este ficheiro é lido automaticamente pelo pytest antes de qualquer teste,
independentemente da pasta onde os testes vivam — é aqui que residem as
"fixtures" (blocos de preparação e limpeza reutilizáveis entre testes).

Carrega-se aqui, antes de qualquer importação de código da aplicação, o
ficheiro .env.test (equivalente ao .env, mas com o endereço da base de
dados de TESTE, não da de desenvolvimento). Isto é feito antes de mais
nada porque é na primeira importação de app.db.session que o "engine"
(ligação à base de dados) é criado, a partir do valor de DATABASE_URL
disponível nesse preciso momento — se a importação acontecesse primeiro,
o engine ficaria ligado à base de dados errada.
"""

from dotenv import load_dotenv

load_dotenv(".env.test", override=True)

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.db.session import Base, engine, get_db
from app.main import app


@pytest_asyncio.fixture(scope="session", autouse=True)
async def preparar_base_de_dados():
    """
    Recria o esquema da base de dados de teste uma única vez, no início de
    toda a sessão de testes — não antes de cada teste individual, porque o
    isolamento entre testes é garantido de outra forma (ver db_session,
    abaixo), através de uma transacção revertida no fim de cada teste, e
    não pela recriação das tabelas.

    autouse=True faz esta fixture correr automaticamente, sem que nenhum
    teste precise de a pedir explicitamente como argumento.
    """
    async with engine.begin() as conn:
        # drop_all antes de create_all garante um estado limpo mesmo que a
        # execução anterior dos testes tenha terminado de forma anormal
        # (ex.: interrompida a meio), deixando tabelas de uma versão
        # anterior dos modelos.
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield


@pytest_asyncio.fixture
async def db_session():
    """
    Fornece, a cada teste, uma sessão de base de dados isolada: tudo o que
    o teste (ou o código chamado por ele, incluindo as rotas da API)
    gravar é revertido no final, mesmo que esse código chame commit() —
    como acontece na rota de registo.

    O isolamento assenta em duas transacções encadeadas sobre a mesma
    ligação: uma transacção "exterior" (transacao_exterior), aberta aqui e
    nunca confirmada — só revertida no fim —, e uma "interior" (um
    SAVEPOINT), que é onde a sessão entregue à aplicação de facto trabalha.
    Quando a aplicação chama commit(), é apenas esse SAVEPOINT que fica
    confirmado; join_transaction_mode="create_savepoint" garante que um
    novo SAVEPOINT é aberto automaticamente logo a seguir, para que a
    sessão continue utilizável até ao fim do teste, mesmo que a rota
    testada chame commit() várias vezes. Só no fim, quando este gerador
    retoma depois do yield, a transacção exterior é revertida — desfazendo
    tudo o que aconteceu, savepoints incluídos.
    """
    async with engine.connect() as connection:
        transacao_exterior = await connection.begin()

        fabrica_sessao_teste = async_sessionmaker(
            bind=connection,
            expire_on_commit=False,
            join_transaction_mode="create_savepoint",
        )
        session = fabrica_sessao_teste()

        yield session

        await session.close()
        await transacao_exterior.rollback()


@pytest_asyncio.fixture
async def client(db_session):
    """
    Cliente HTTP assíncrono que chama a aplicação FastAPI directamente em
    memória, através de ASGITransport — sem precisar de um servidor
    Uvicorn a correr à parte para os testes passarem.

    Fora dos testes, cada pedido HTTP recebe a sua própria sessão de base
    de dados, criada por get_db (app/db/session.py) — o que está certo em
    produção, mas impediria a reversão descrita em db_session, acima, de
    apanhar o que uma rota chamada por este cliente gravou.
    app.dependency_overrides substitui get_db, só durante os testes, por
    uma função que devolve sempre a mesma db_session recebida como
    argumento — assim, tanto o teste como a rota que ele chama partilham a
    mesma transacção, revertida no fim.
    """

    async def sobrepor_get_db():
        yield db_session

    app.dependency_overrides[get_db] = sobrepor_get_db

    transport = ASGITransport(app=app)
    # base_url="https://..." (não "http://"), apesar de o ASGITransport não
    # fazer nenhuma ligação de rede real (chama a aplicação directamente em
    # memória) — importa na mesma, porque o cookie de sessão é marcado
    # secure=True (ver app/routers/auth.py) e o httpx, tal como um browser
    # real, só reenvia um cookie Secure em pedidos sobre HTTPS. Com
    # "http://test", o cookie ficava guardado no cliente mas nunca era
    # reenviado ao servidor — as rotas que dependem dele (logout, "quem
    # sou eu") recebiam sempre um pedido sem sessão.
    async with AsyncClient(transport=transport, base_url="https://test") as ac:
        yield ac

    # Repõe o estado original, para não afectar outros testes que não
    # peçam este fixture (ex.: testes futuros que verifiquem o
    # comportamento por omissão de get_db).
    app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def cliente_autenticado(client):
    """
    O mesmo cliente HTTP, mas já com uma sessão iniciada: regista e
    autentica um utilizador de teste, deixando o cookie de sessão guardado
    no cliente. Reutilizável por qualquer teste de uma rota protegida, para
    não repetir o par registo + login em todos eles.

    Como cada teste corre dentro de uma transacção revertida no fim (ver
    db_session), este utilizador desaparece no final de cada teste — não há
    colisão de email entre testes.
    """
    credenciais = {"email": "teste@example.com", "password": "palavrapasse123"}
    await client.post("/auth/registo", json=credenciais)
    await client.post("/auth/login", json=credenciais)
    return client
