"""
CONFIGURAÇÃO DO ALEMBIC
==========================

Este ficheiro é executado sempre que o Alembic corre (para gerar uma nova
migração ou para aplicar migrações existentes). O seu papel é ligar o
Alembic — que, por si só, não sabe nada sobre este projecto em concreto —
a duas coisas específicas desta aplicação:

1. A ligação à base de dados: em vez de duplicar a DATABASE_URL neste
   ficheiro (ou no alembic.ini), é lida a partir de app.core.config, o
   mesmo sítio que o resto da aplicação usa. Assim, existe um único lugar
   onde este valor está definido.

2. Os modelos da aplicação (Base.metadata): é isto que permite ao comando
   "alembic revision --autogenerate" comparar o que os modelos Python
   dizem que deveria existir (as tabelas users e sessions) com o que
   realmente existe na base de dados, e gerar automaticamente o código
   SQL da diferença.

Existe ainda uma particularidade técnica: a aplicação usa um motor
assíncrono (SQLAlchemy com o driver asyncpg), mas o Alembic foi desenhado,
originalmente, para correr de forma síncrona. As funções abaixo adaptam o
comportamento por omissão do Alembic para que este consiga, mesmo assim,
usar o mesmo motor assíncrono da aplicação, em vez de exigir uma segunda
biblioteca de ligação à base de dados só para as migrações.
"""

import asyncio
from logging.config import fileConfig

from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

from alembic import context

# Importar o pacote de modelos regista todas as tabelas conhecidas em
# Base.metadata (ver o comentário em app/models/__init__.py). Sem esta
# importação, target_metadata (definido mais abaixo) ficaria vazio, e o
# Alembic não teria como saber que as tabelas users e sessions deveriam
# existir.
import app.models  # noqa: F401
from app.core.config import settings
from app.db.session import Base

# Objecto de configuração do Alembic, com acesso aos valores definidos no
# alembic.ini.
config = context.config

# Em vez de manter a DATABASE_URL escrita (e potencialmente desactualizada)
# no alembic.ini, o valor real é definido aqui, a partir da configuração
# única da aplicação. set_main_option sobrepõe-se a qualquer valor que
# esteja no ficheiro .ini.
config.set_main_option("sqlalchemy.url", settings.database_url)

# Configura o sistema de logging do Alembic, de acordo com o alembic.ini.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# target_metadata é o que o Alembic compara com o estado real da base de
# dados para decidir o que uma migração automática deve conter. Base.metadata
# só contém as tabelas que estiverem registadas nesse momento — daí a
# importância da importação de app.models, acima, ter acontecido primeiro.
target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """
    Gera o SQL das migrações como texto, sem se ligar de facto à base de
    dados. Não é o modo usado neste projecto (preferimos aplicar as
    migrações directamente, no modo "online", abaixo), mas o Alembic
    disponibiliza sempre esta opção por omissão.
    """
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    """
    Executa as migrações numa ligação já aberta. Esta função em si é
    síncrona — é invocada, mais abaixo, através de connection.run_sync(),
    que permite correr código síncrono dentro de uma ligação assíncrona.
    """
    context.configure(connection=connection, target_metadata=target_metadata)

    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online() -> None:
    """
    Cria um motor assíncrono (tal como o resto da aplicação faz, em
    app/db/session.py) e usa-o para aplicar as migrações à base de dados
    real. É este o modo efectivamente usado neste projecto.
    """
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    # A ligação em si é assíncrona, mas o mecanismo interno do Alembic que
    # gera e aplica migrações é síncrono. connection.run_sync() é a forma
    # de correr essa lógica síncrona (do_run_migrations) dentro de uma
    # ligação assíncrona, sem precisar de duas bibliotecas de ligação
    # diferentes (uma síncrona só para o Alembic, outra assíncrona para o
    # resto da aplicação).
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)

    await connectable.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    # asyncio.run() arranca o "event loop" necessário para correr código
    # assíncrono — run_migrations_online() é uma função assíncrona (definida
    # com "async def"), por isso não pode ser chamada directamente aqui.
    asyncio.run(run_migrations_online())
