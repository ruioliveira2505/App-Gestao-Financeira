"""reconciliacoes_do_banco

As RECONCILIAÇÕES DO BANCO (a "F5 — Banco e reconciliações"): uma
reconciliação afirma «no fim do dia D, o saldo era S»; as do banco são
criadas pela aplicação a partir do saldo que o banco informa, sempre com a
confirmação do utilizador (ao vincular uma Conta que já tem histórico, ou
ao "Acertar" depois de comparar saldos).

O saldo de uma reconciliação do banco é DERIVADO do saldo lido num instante
T (e não fixo), para os movimentos que o banco lança com atraso não serem
"comidos" por um acerto falso. Por isso guardam-se:
- reconciliacoes.saldo_banco: o saldo contabilístico que o banco informou;
- reconciliacoes.lido_em: o instante T em que foi lido;
- reconciliacoes.vinculo_id: o vínculo que a criou (ON DELETE SET NULL),
  para "tirar o que veio do banco" ao desvincular só levar as dele.
Restrição CHECK: uma reconciliação do banco tem sempre o saldo lido e o
instante.

Só colunas novas, vazias: não há nenhuma reconciliação do banco a migrar.

Revision ID: b3e5a7c9d1f4
Revises: a2d4f6b8c1e3
Create Date: 2026-10-10 22:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# Identificadores desta revisão, usados pelo Alembic para encadear as
# migrações.
revision: str = 'b3e5a7c9d1f4'
down_revision: Union[str, Sequence[str], None] = 'a2d4f6b8c1e3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Acrescenta a leitura do banco às reconciliações."""
    op.add_column('reconciliacoes', sa.Column('saldo_banco', sa.Numeric(precision=14, scale=2), nullable=True))
    op.add_column('reconciliacoes', sa.Column('lido_em', sa.DateTime(timezone=True), nullable=True))
    op.add_column('reconciliacoes', sa.Column('vinculo_id', sa.UUID(), nullable=True))
    op.create_foreign_key(
        'reconciliacoes_vinculo_id_fkey', 'reconciliacoes', 'vinculos', ['vinculo_id'], ['id'], ondelete='SET NULL'
    )
    op.create_check_constraint(
        'ck_reconciliacoes_banco_tem_leitura',
        'reconciliacoes',
        "origem <> 'banco' OR (saldo_banco IS NOT NULL AND lido_em IS NOT NULL)",
    )


def downgrade() -> None:
    """Retira a leitura do banco (as reconciliações do banco passam a ser do utilizador)."""
    op.drop_constraint('ck_reconciliacoes_banco_tem_leitura', 'reconciliacoes', type_='check')
    op.execute("UPDATE reconciliacoes SET origem = 'utilizador' WHERE origem = 'banco'")
    op.drop_constraint('reconciliacoes_vinculo_id_fkey', 'reconciliacoes', type_='foreignkey')
    op.drop_column('reconciliacoes', 'vinculo_id')
    op.drop_column('reconciliacoes', 'lido_em')
    op.drop_column('reconciliacoes', 'saldo_banco')
