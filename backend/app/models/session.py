"""
MODELO DA TABELA "sessions"
==============================

Representa as sessões de autenticação activas. Cada linha corresponde a um
início de sessão de um utilizador. É criada no momento do login e removida
(ou marcada como expirada) quando a sessão termina ou quando o prazo
definido em expires_at é ultrapassado.
"""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.session import Base


class UserSession(Base):
    """Representa uma sessão de autenticação activa, criada no login e removida no logout."""

    __tablename__ = "sessions"

    # Mapped[uuid.UUID] constitui a anotação de tipo em Python: este atributo
    # comporta-se, no código, como um valor do tipo uuid.UUID. mapped_column(...)
    # define os pormenores reais da coluna SQL:
    #   - UUID(as_uuid=True): a coluna utiliza o tipo nativo UUID do Postgres
    #   - primary_key=True: constitui a chave primária desta tabela — o
    #     valor que identifica, de forma única, cada sessão registada
    #   - default=uuid.uuid4: caso uma UserSession seja criada sem indicação
    #     de id, o SQLAlchemy gera um novo UUID no lado do Python, antes
    #     mesmo de o comando de inserção ser enviado à base de dados
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # É armazenado o hash do token de sessão, e não o token original. Caso
    # alguém tivesse acesso apenas a esta tabela (por exemplo, através de
    # uma cópia de segurança exposta), não conseguiria autenticar-se como
    # nenhum utilizador apenas com este valor — seria necessário conhecer o
    # token original, cujo hash teria de corresponder ao aqui armazenado.
    # unique=True assegura, adicionalmente, que dois tokens distintos nunca
    # resultam no mesmo hash armazenado. nullable=False torna a coluna
    # obrigatória (nunca pode ser nula).
    token_hash: Mapped[str] = mapped_column(String, unique=True, nullable=False)

    # Chave estrangeira (FOREIGN KEY): este valor tem de corresponder a um
    # id existente na tabela "users" — a base de dados recusa o registo de
    # uma sessão associada a um utilizador inexistente. É a base de dados,
    # e não o código da aplicação, que garante esta integridade referencial.
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)

    # DateTime(timezone=True): a coluna regista também o fuso horário, e não
    # apenas a hora isolada.
    # server_default=func.now(): na ausência de um valor indicado, é a
    # própria base de dados — e não a aplicação Python — que preenche esta
    # coluna com a hora corrente, no momento em que a linha é inserida.
    # Representa o momento em que a sessão foi criada.
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    # A validade desta sessão específica constitui uma linha nesta tabela,
    # consultada a cada pedido — em contraste com um mecanismo em que a
    # expiração estivesse embutida no próprio token e fosse verificada
    # matematicamente, sem necessidade de consultar a base de dados. É este
    # desenho que permite, por exemplo, invalidar todas as sessões de um
    # utilizador de uma só vez: basta remover (ou expirar) as linhas
    # correspondentes desta tabela.
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)