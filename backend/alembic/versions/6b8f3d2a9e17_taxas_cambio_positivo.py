"""restringir taxas_cambio.por_1_eur a valores positivos

Revision ID: 6b8f3d2a9e17
Revises: 4a1d8e6c2f97
Create Date: 2026-09-18 09:00:00.000000

NOTA (não gerada automaticamente): uma migração à parte, não uma edição
de 9c3e5f1a7b24 (a que criou a tabela) — essa já tinha sido aplicada a
uma base de dados real antes desta restrição ser pedida numa revisão de
código; editar esse ficheiro depois de aplicado não teria nenhum efeito
sobre uma base de dados que já correu essa versão (o Alembic só compara
revisões, não o conteúdo de cada uma), por isso a correcção tem de vir
como um passo novo.

Segura de aplicar mesmo com linhas já existentes: todas as taxas
gravadas até agora vêm da Frankfurter API, que nunca devolve um valor
zero ou negativo — nenhuma linha actual viola esta restrição.
"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '6b8f3d2a9e17'
down_revision: Union[str, Sequence[str], None] = '4a1d8e6c2f97'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_check_constraint(
        'ck_taxas_cambio_por_1_eur_positivo',
        'taxas_cambio',
        'por_1_eur > 0',
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint('ck_taxas_cambio_por_1_eur_positivo', 'taxas_cambio', type_='check')
