"""reconciliacoes

As RECONCILIAÇÕES (a afirmação «no fim do dia D, o saldo desta conta era
S») e os seus ACERTOS (o movimento que a aplicação cria pela diferença
entre S e o saldo calculado) — a "F4 — Reconciliações":

1. TABELA "reconciliacoes": conta, dia, saldo afirmado e origem
   ("utilizador" ou "banco"). No máximo uma por dia em cada conta (índice
   único). Apagar a conta apaga as suas reconciliações.

2. MOVIMENTOS: a coluna "reconciliacao_id" liga um acerto à sua
   reconciliação (única: cada reconciliação tem no máximo um acerto; ON
   DELETE CASCADE: apagar a reconciliação apaga o acerto). Restrição
   CHECK: um movimento é um acerto se e só se tiver reconciliação.

3. CATEGORIAS "ACERTO DE SALDO": MIGRAÇÃO DE DADOS. Cada utilizador que já
   existe ganha duas categorias com o papel "acerto" (reservadas aos
   acertos), uma de entrada e outra de saída, como subcategorias dos
   mesmos grupos onde está o seu "Outros" de refúgio ("Outras Entradas" e
   "Outras Saídas"), no fim da lista desse grupo. Os utilizadores novos
   recebem-nas na árvore por omissão.

Não há nenhuma reconciliação a migrar: a funcionalidade é nova.

Revision ID: a2d4f6b8c1e3
Revises: f1c3e5a7b9d2
Create Date: 2026-10-10 20:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# Identificadores desta revisão, usados pelo Alembic para encadear as
# migrações.
revision: str = 'a2d4f6b8c1e3'
down_revision: Union[str, Sequence[str], None] = 'f1c3e5a7b9d2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Cria as reconciliações, liga os acertos e dá a cada utilizador as categorias de acerto."""
    op.create_table(
        'reconciliacoes',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('conta_id', sa.UUID(), nullable=False),
        sa.Column('data', sa.Date(), nullable=False),
        sa.Column('saldo', sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column('origem', sa.String(length=10), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['conta_id'], ['contas.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('conta_id', 'data', name='uq_reconciliacoes_conta_id_data'),
        sa.CheckConstraint("origem IN ('utilizador', 'banco')", name='ck_reconciliacoes_origem'),
    )
    op.create_index('ix_reconciliacoes_conta_id', 'reconciliacoes', ['conta_id'])

    op.add_column('movimentos', sa.Column('reconciliacao_id', sa.UUID(), nullable=True))
    op.create_foreign_key(
        'movimentos_reconciliacao_id_fkey',
        'movimentos',
        'reconciliacoes',
        ['reconciliacao_id'],
        ['id'],
        ondelete='CASCADE',
    )
    op.create_unique_constraint('movimentos_reconciliacao_id_key', 'movimentos', ['reconciliacao_id'])
    op.create_check_constraint(
        'ck_movimentos_acerto_tem_reconciliacao',
        'movimentos',
        "(origem = 'acerto') = (reconciliacao_id IS NOT NULL)",
    )

    # As duas categorias de acerto de cada utilizador, ao lado do seu
    # "Outros" de refúgio (o mesmo grupo, a mesma direção), no fim do grupo.
    op.execute(
        """
        INSERT INTO categorias (id, user_id, parent_id, nome, direcao, papel, ordem)
        SELECT gen_random_uuid(),
               r.user_id,
               r.parent_id,
               'Acerto de saldo',
               r.direcao,
               'acerto',
               (SELECT COALESCE(MAX(irma.ordem), -1) + 1 FROM categorias irma WHERE irma.parent_id = r.parent_id)
        FROM categorias r
        WHERE r.papel = 'refugio'
        """
    )

    # VERIFICAÇÃO: cada utilizador tem de ficar com as duas categorias de
    # acerto (uma de entrada, uma de saída), ou nenhuma reconciliação dele
    # funcionaria. A cópia acima parte das categorias de refúgio
    # ("Outros"); um utilizador a quem falte uma delas (por exemplo, criado
    # antes de existir a árvore de categorias por omissão) ficaria sem a
    # de acerto correspondente. Nesse caso a migração para aqui, com uma
    # mensagem que diz quem, em vez de deixar o problema escondido até à
    # primeira reconciliação. O Alembic corre toda a migração numa só
    # transação: ao parar, nada do que esta migração fez fica gravado.
    em_falta = (
        op.get_bind()
        .execute(
            sa.text(
                """
                SELECT u.email
                FROM users u
                LEFT JOIN categorias c ON c.user_id = u.id AND c.papel = 'acerto'
                GROUP BY u.id, u.email
                HAVING COUNT(DISTINCT c.direcao) < 2
                """
            )
        )
        .scalars()
        .all()
    )
    if em_falta:
        raise RuntimeError(
            "Estes utilizadores não têm as duas categorias de refúgio (\"Outros\", de entrada e de "
            f"saída), por isso não receberam as de acerto: {', '.join(em_falta)}. "
            "Cria-lhes primeiro as categorias de refúgio e corre a migração outra vez."
        )


def downgrade() -> None:
    """Retira as categorias de acerto (sem movimentos), os acertos e as reconciliações."""
    op.drop_constraint('ck_movimentos_acerto_tem_reconciliacao', 'movimentos', type_='check')
    op.drop_constraint('movimentos_reconciliacao_id_key', 'movimentos', type_='unique')
    op.drop_constraint('movimentos_reconciliacao_id_fkey', 'movimentos', type_='foreignkey')
    # Os acertos deixam de ter sentido sem reconciliações.
    op.execute("DELETE FROM movimentos WHERE origem = 'acerto'")
    op.execute('SET CONSTRAINTS ALL IMMEDIATE')
    op.drop_column('movimentos', 'reconciliacao_id')
    op.execute("DELETE FROM categorias WHERE papel = 'acerto'")
    op.drop_index('ix_reconciliacoes_conta_id', table_name='reconciliacoes')
    op.drop_table('reconciliacoes')
