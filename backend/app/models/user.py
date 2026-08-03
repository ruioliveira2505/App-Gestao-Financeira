"""
MODELO DA TABELA "users"
==========================

Representa os utilizadores registados na aplicação. Cada atributo desta
classe corresponde a uma coluna na tabela; o SQLAlchemy utiliza esta
definição tanto para gerar ou verificar a estrutura da base de dados como
para converter entre linhas da base de dados e objectos Python.
"""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.session import Base


class User(Base):
    """Representa um utilizador registado na aplicação."""

    __tablename__ = "users"  # nome real da tabela na base de dados

    # Mapped[uuid.UUID] constitui a anotação de tipo em Python: este
    # atributo comporta-se, no código, como um valor do tipo uuid.UUID.
    # mapped_column(...) define os pormenores reais da coluna SQL:
    #   - UUID(as_uuid=True): a coluna utiliza o tipo nativo UUID do Postgres
    #   - primary_key=True: constitui a chave primária da tabela
    #   - default=uuid.uuid4: caso um User() seja criado sem indicação de
    #     id, o SQLAlchemy gera um novo UUID no lado do Python, antes mesmo
    #     de o comando de inserção ser enviado à base de dados
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # unique=True estabelece uma restrição UNIQUE — a própria base de dados
    # recusa a existência de duas linhas com o mesmo email, independentemente
    # de qualquer verificação prévia efectuada pelo código Python.
    # nullable=False torna a coluna obrigatória (nunca pode ser nula).
    email: Mapped[str] = mapped_column(String, unique=True, nullable=False)

    # Não é armazenada a password em si, apenas o seu hash — o nome do campo
    # torna esta intenção explícita.
    password_hash: Mapped[str] = mapped_column(String, nullable=False)

    # DateTime(timezone=True): a coluna regista também o fuso horário, e não
    # apenas a hora isolada.
    # server_default=func.now(): na ausência de um valor indicado, é a
    # própria base de dados — e não a aplicação Python — que preenche esta
    # coluna com a hora corrente, no momento em que a linha é inserida.
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())