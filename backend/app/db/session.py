"""
LIGAÇÃO À BASE DE DADOS
========================

Este ficheiro estabelece a forma como a aplicação comunica com a base de
dados. Define três elementos: a classe base da qual todas as tabelas
(modelos) herdam, o "engine" — o objecto que sabe como estabelecer essa
comunicação — e a função get_db, responsável por fornecer uma sessão de
trabalho a cada pedido recebido pela API, assegurando o seu correcto
encerramento no final.
"""

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.core.config import settings


class Base(DeclarativeBase):
    """Classe base da qual todos os modelos (tabelas) herdam."""
    # Esta classe não possui atributos próprios; serve apenas como referência
    # comum. Quando uma classe (por exemplo, User) herda desta Base, o
    # SQLAlchemy passa a reconhecer que essa classe corresponde a uma tabela
    # real na base de dados, e não a um objecto Python arbitrário. É o ponto
    # de partida da correspondência entre classes Python e tabelas SQL.


# O "engine" é o objecto que sabe como estabelecer ligação à base de dados:
# o endereço, as credenciais (obtidos de settings.database_url) e o
# dialecto SQL a utilizar. A sua criação não implica a abertura imediata de
# uma ligação real — apenas prepara tudo o que é necessário para que essa
# ligação possa ser aberta quando for solicitada.
engine = create_async_engine(settings.database_url)

# Uma "sessionmaker" funciona como uma fábrica: cada vez que é invocada
# (async_session()), gera uma nova sessão de trabalho associada a este
# engine. Uma sessão é o objecto através do qual se realizam consultas e se
# agrupam operações numa transacção.
#
# expire_on_commit=False: por defeito, após a confirmação de uma transacção
# (commit), o SQLAlchemy descarta os valores já lidos, obrigando a que sejam
# lidos novamente da base de dados na próxima utilização — garantia de que
# não se trabalha com dados desactualizados. Ao desactivar este
# comportamento, permite-se continuar a aceder aos atributos do objecto
# Python após um commit, sem que seja necessária uma nova consulta.
async_session = async_sessionmaker(engine, expire_on_commit=False)


async def get_db():
    """Fornece uma sessão de base de dados a uma rota da API, encerrando-a no final do pedido."""
    # "async with" abre a sessão e assegura o seu encerramento, mesmo perante
    # a ocorrência de um erro — tal como um "with" comum garante o
    # fecho de um ficheiro aberto, independentemente do que suceda entretanto.
    async with async_session() as session:
        # "yield" entrega esta sessão a quem a solicitou (uma rota da API) e
        # suspende, neste ponto, a execução desta função enquanto essa rota
        # é processada. Apenas quando a rota terminar — com sucesso ou com
        # erro — a execução regressa a este ponto, momento em que o "async
        # with" procede ao encerramento da sessão.
        yield session