"""acrescentar moeda_principal a users

Revision ID: 4a1d8e6c2f97
Revises: 9c3e5f1a7b24
Create Date: 2026-09-17 15:00:00.000000

NOTA (não gerada automaticamente): "moeda_principal" é NOT NULL logo de
início, sem precisar do padrão "nullable → preencher → SET NOT NULL"
usado nas migrações de categorias (necessário lá porque não havia valor
por omissão nenhum) — aqui a coluna leva "server_default='EUR'", por
isso o Postgres preenche sozinho cada linha já existente com "EUR", no
mesmo comando que a acrescenta.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '4a1d8e6c2f97'
down_revision: Union[str, Sequence[str], None] = '9c3e5f1a7b24'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        'users',
        sa.Column('moeda_principal', sa.String(length=3), nullable=False, server_default='EUR'),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('users', 'moeda_principal')
