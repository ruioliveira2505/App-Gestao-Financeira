"""futuros_e_saldo_do_utilizador

Dois factos novos nas RECONCILIAÇÕES (uma reconciliação afirma «no fim do
dia D, o saldo da conta era S»; as do banco são criadas pela aplicação a
partir do saldo que o banco informa num instante T):

- reconciliacoes.futuros_no_banco: só nas do banco. A soma das transações
  de data FUTURA que o banco já contava no saldo lido em T. Um movimento
  nunca fica no futuro, por isso essas transações só se importam quando a
  data chegar; sem descontar esta soma, o saldo derivado contá-las-ia duas
  vezes (dentro do saldo do banco, e outra vez quando entrassem).
  Restrição CHECK: uma reconciliação do banco tem sempre este valor (zero
  quando não há nenhuma).
- reconciliacoes.saldo_do_utilizador: quando uma reconciliação do
  UTILIZADOR passa a ser do banco (só pode haver uma por dia), o saldo que
  o utilizador tinha afirmado. Ao desvincular com "tirar o que veio do
  banco", a reconciliação volta a ser dele, com esse saldo.

Dados existentes: as reconciliações do banco que já existam recebem
futuros_no_banco = 0 (é o que o cálculo antigo assumia). Não há forma de
saber o saldo que um utilizador tinha afirmado antes desta migração, por
isso saldo_do_utilizador fica vazio nas existentes.

Revision ID: c9e1f3a5b7d2
Revises: b3e5a7c9d1f4
Create Date: 2026-10-09 22:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# Identificadores desta revisão, usados pelo Alembic para encadear as
# migrações.
revision: str = 'c9e1f3a5b7d2'
down_revision: Union[str, Sequence[str], None] = 'b3e5a7c9d1f4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Acrescenta os futuros no banco e o saldo do utilizador às reconciliações."""
    op.add_column('reconciliacoes', sa.Column('futuros_no_banco', sa.Numeric(precision=14, scale=2), nullable=True))
    op.add_column('reconciliacoes', sa.Column('saldo_do_utilizador', sa.Numeric(precision=14, scale=2), nullable=True))
    # As do banco que já existam: zero, o que o cálculo antigo assumia.
    op.execute("UPDATE reconciliacoes SET futuros_no_banco = 0 WHERE origem = 'banco'")
    op.create_check_constraint(
        'ck_reconciliacoes_banco_tem_futuros',
        'reconciliacoes',
        "origem <> 'banco' OR futuros_no_banco IS NOT NULL",
    )


def downgrade() -> None:
    """
    Retira as duas colunas. Perde-se o que guardavam: o saldo derivado das
    reconciliações do banco volta a contar duas vezes as transações de
    data futura, e uma reconciliação do utilizador que passou a ser do
    banco já não volta a ser dele ao "tirar o que veio do banco".
    """
    op.drop_constraint('ck_reconciliacoes_banco_tem_futuros', 'reconciliacoes', type_='check')
    op.drop_column('reconciliacoes', 'saldo_do_utilizador')
    op.drop_column('reconciliacoes', 'futuros_no_banco')
