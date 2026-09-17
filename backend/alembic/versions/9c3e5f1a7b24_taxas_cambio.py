"""criar tabela taxas_cambio

Revision ID: 9c3e5f1a7b24
Revises: 7f2b9c4a1d63
Create Date: 2026-09-17 10:00:00.000000

Escrita à mão (não por "alembic revision --autogenerate"): é só uma
tabela nova, sem nenhuma mudança a um modelo já existente para o Alembic
detectar sozinho.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '9c3e5f1a7b24'
down_revision: Union[str, Sequence[str], None] = '7f2b9c4a1d63'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'taxas_cambio',
        sa.Column('data', sa.Date(), nullable=False),
        sa.Column('moeda', sa.String(length=3), nullable=False),
        sa.Column('por_1_eur', sa.Numeric(precision=18, scale=8), nullable=False),
        sa.PrimaryKeyConstraint('data', 'moeda'),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('taxas_cambio')
