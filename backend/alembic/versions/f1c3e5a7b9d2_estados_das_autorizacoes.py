"""estados_das_autorizacoes

Os FACTOS de que se deduzem os estados das autorizações e das contas
bancárias (a "F3 — Estados"):

- autorizacoes.terminada_em e autorizacoes.motivo: quando e porque uma
  autorização terminou ANTES do prazo ("revogada" na aplicação, ou "banco",
  quando o banco respondeu que a sessão já não vale). Restrições CHECK: o
  motivo é um dos dois, e existe se e só se terminada_em estiver
  preenchido. O estado (ativa ou terminada) deduz-se destes factos e do
  prazo; nunca se guarda.
- autorizacoes.renova_id: a autorização que esta renova (ON DELETE SET
  NULL: esquecer a antiga não apaga a nova).
- contas_bancarias.indisponivel_em: quando o banco respondeu que a conta
  já não existe ou deixou de ser partilhada.
- autorizacoes_pendentes.renova_id: num pedido de autorização em curso, a
  autorização que ele renova (ON DELETE CASCADE).

Só colunas novas, todas vazias por omissão: os dados que já existem
ficam como estão (uma autorização sem terminada_em está ativa ou expirada,
conforme o prazo).

Revision ID: f1c3e5a7b9d2
Revises: e8b2d4f6a1c3
Create Date: 2026-10-10 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# Identificadores desta revisão, usados pelo Alembic para encadear as
# migrações.
revision: str = 'f1c3e5a7b9d2'
down_revision: Union[str, Sequence[str], None] = 'e8b2d4f6a1c3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Acrescenta os factos dos estados."""
    op.add_column('autorizacoes', sa.Column('terminada_em', sa.DateTime(timezone=True), nullable=True))
    op.add_column('autorizacoes', sa.Column('motivo', sa.String(length=10), nullable=True))
    op.add_column('autorizacoes', sa.Column('renova_id', sa.UUID(), nullable=True))
    op.create_foreign_key(
        'autorizacoes_renova_id_fkey', 'autorizacoes', 'autorizacoes', ['renova_id'], ['id'], ondelete='SET NULL'
    )
    op.create_check_constraint('ck_autorizacoes_motivo', 'autorizacoes', "motivo IN ('revogada', 'banco')")
    op.create_check_constraint(
        'ck_autorizacoes_motivo_com_data', 'autorizacoes', '(terminada_em IS NULL) = (motivo IS NULL)'
    )
    op.add_column(
        'contas_bancarias', sa.Column('indisponivel_em', sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column('autorizacoes_pendentes', sa.Column('renova_id', sa.UUID(), nullable=True))
    op.create_foreign_key(
        'autorizacoes_pendentes_renova_id_fkey',
        'autorizacoes_pendentes',
        'autorizacoes',
        ['renova_id'],
        ['id'],
        ondelete='CASCADE',
    )


def downgrade() -> None:
    """
    Retira os factos dos estados. ATENÇÃO, perde-se informação: sem
    terminada_em e motivo, uma autorização revogada na aplicação, ou
    terminada pelo banco, volta a parecer válida até ao fim do prazo
    (valido_ate); sem renova_id, perde-se que autorização renovou qual;
    sem indisponivel_em, uma conta bancária que o banco deixou de partilhar
    volta a parecer disponível.
    """
    op.drop_constraint('autorizacoes_pendentes_renova_id_fkey', 'autorizacoes_pendentes', type_='foreignkey')
    op.drop_column('autorizacoes_pendentes', 'renova_id')
    op.drop_column('contas_bancarias', 'indisponivel_em')
    op.drop_constraint('ck_autorizacoes_motivo_com_data', 'autorizacoes', type_='check')
    op.drop_constraint('ck_autorizacoes_motivo', 'autorizacoes', type_='check')
    op.drop_constraint('autorizacoes_renova_id_fkey', 'autorizacoes', type_='foreignkey')
    op.drop_column('autorizacoes', 'renova_id')
    op.drop_column('autorizacoes', 'motivo')
    op.drop_column('autorizacoes', 'terminada_em')
