"""ultima_sincronizacao

A ÚLTIMA SINCRONIZAÇÃO de cada vínculo (vinculos.sincronizado_em): o
momento em que uma sincronização correu bem pela última vez. A página de
uma conta mostra-a («Sincronizada · há 2 horas»). Fica no vínculo, e não
na conta bancária, porque ao renovar uma autorização o vínculo é o mesmo
(passa só para a conta bancária da autorização nova) e a data não se deve
perder.

Dados existentes: o melhor que se sabe é quando entrou o último movimento
do banco trazido por cada vínculo (Movimento.created_at, com
Movimento.vinculo_id) ou, sem nenhum, quando o vínculo foi criado (que é
quando se fez a primeira importação).

Revision ID: a4c6e8f0b2d3
Revises: c9e1f3a5b7d2
Create Date: 2026-10-13 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# Identificadores desta revisão, usados pelo Alembic para encadear as
# migrações.
revision: str = 'a4c6e8f0b2d3'
down_revision: Union[str, Sequence[str], None] = 'c9e1f3a5b7d2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Acrescenta a última sincronização aos vínculos e preenche as existentes."""
    op.add_column('vinculos', sa.Column('sincronizado_em', sa.DateTime(timezone=True), nullable=True))
    # O último movimento do banco trazido por cada vínculo ou, sem nenhum,
    # o momento em que o vínculo foi criado.
    op.execute(
        """
        UPDATE vinculos SET sincronizado_em = COALESCE(
            (SELECT MAX(m.created_at) FROM movimentos m WHERE m.vinculo_id = vinculos.id),
            vinculos.created_at
        )
        """
    )


def downgrade() -> None:
    """Retira a coluna; perde-se a data da última sincronização de cada vínculo."""
    op.drop_column('vinculos', 'sincronizado_em')
