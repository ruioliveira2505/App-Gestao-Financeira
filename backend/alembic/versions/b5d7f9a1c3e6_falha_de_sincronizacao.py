"""falha_de_sincronizacao

A ÚLTIMA FALHA de sincronização por causa do banco, em cada vínculo
(vinculos.falha_em e vinculos.falha_motivo — "sem-ligacao" ou "limite"):
a página de uma conta continua a dizer «Falhou · sem ligação» ou «Falhou ·
limite do banco» ao ser reaberta, e não só na visita em que aconteceu. Uma
sincronização que corra bem apaga-as.

Dados existentes: ficam vazias (não se sabe de falhas anteriores).

Revision ID: b5d7f9a1c3e6
Revises: a4c6e8f0b2d3
Create Date: 2026-10-13 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# Identificadores desta revisão, usados pelo Alembic para encadear as
# migrações.
revision: str = 'b5d7f9a1c3e6'
down_revision: Union[str, Sequence[str], None] = 'a4c6e8f0b2d3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Acrescenta aos vínculos a última falha de sincronização e o motivo."""
    op.add_column('vinculos', sa.Column('falha_em', sa.DateTime(timezone=True), nullable=True))
    op.add_column('vinculos', sa.Column('falha_motivo', sa.String(length=12), nullable=True))


def downgrade() -> None:
    """Retira as duas colunas; perde-se a última falha de cada vínculo."""
    op.drop_column('vinculos', 'falha_motivo')
    op.drop_column('vinculos', 'falha_em')
