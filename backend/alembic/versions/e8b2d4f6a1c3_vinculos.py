"""vinculos

O VÍNCULO (o facto de uma conta bancária alimentar uma Conta da
aplicação) passa a ter tabela própria, "vinculos", em vez da coluna
contas_bancarias.conta_id (a "F2 — Vínculo"):

1. TABELA "vinculos": utilizador, Conta (única), conta bancária (única),
   identificação da conta real (única por utilizador, quando existe) e
   DATA DE CORTE (o último dia cujos movimentos não vêm do banco).
   MIGRAÇÃO DE DADOS: cada conta bancária que hoje alimenta uma Conta dá
   um vínculo. Essas Contas nasceram todas a partir do banco (vincular uma
   Conta existente ainda não era possível), por isso a data de corte é a
   véspera da data inicial da Conta: tudo o que elas têm vem do banco. A
   identificação é calculada com a mesma regra da aplicação (o
   "identification_hash" ou, na falta dele, "iban:" + IBAN + ":" + moeda).

2. A coluna contas_bancarias.conta_id deixa de existir.

3. MOVIMENTOS: duas colunas novas.
   - "origem" ("manual", "banco" ou "acerto"). MIGRAÇÃO DE DADOS: os
     movimentos com identificador de transação vieram do banco; os
     restantes são manuais.
   - "vinculo_id", o vínculo que importou um movimento do banco. MIGRAÇÃO
     DE DADOS: os movimentos do banco de uma Conta que ainda tem vínculo
     ficam ligados a esse vínculo; os de Contas já desvinculadas ficam sem
     (o vínculo que os importou já não existe).
   E duas restrições CHECK: a origem é uma das três, e um movimento tem
   identificador de transação se e só se for do banco.

VERIFICAÇÕES ADIADAS: a chave estrangeira "movimento → categoria" é
verificada só no fim da transação (DEFERRABLE INITIALLY DEFERRED — ver a
migração d5a1c7e3f9b2). Depois de um UPDATE aos movimentos, essa
verificação fica PENDENTE, e o PostgreSQL recusa alterar a estrutura da
tabela enquanto houver verificações pendentes ("pending trigger events").
Por isso, a seguir a cada UPDATE aos movimentos, SET CONSTRAINTS ALL
IMMEDIATE manda correr já as verificações pendentes.

O DOWNGRADE repõe contas_bancarias.conta_id a partir dos vínculos (as
datas de corte perdem-se) e retira as colunas novas dos movimentos.

Escrita à mão: inclui migrações de dados, que o "alembic revision
--autogenerate" não sabe escrever.

Revision ID: e8b2d4f6a1c3
Revises: d5a1c7e3f9b2
Create Date: 2026-10-10 15:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# Identificadores desta revisão, usados pelo Alembic para encadear as
# migrações.
revision: str = 'e8b2d4f6a1c3'
down_revision: Union[str, Sequence[str], None] = 'd5a1c7e3f9b2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Cria os vínculos a partir das contas bancárias e marca a origem dos movimentos."""
    # 1. A tabela.
    op.create_table(
        'vinculos',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('user_id', sa.UUID(), nullable=False),
        sa.Column('conta_id', sa.UUID(), nullable=False),
        sa.Column('conta_bancaria_id', sa.UUID(), nullable=False),
        sa.Column('identificacao', sa.String(), nullable=True),
        sa.Column('data_corte', sa.Date(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['conta_id'], ['contas.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['conta_bancaria_id'], ['contas_bancarias.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('conta_id'),
        sa.UniqueConstraint('conta_bancaria_id'),
    )
    op.create_index('ix_vinculos_user_id', 'vinculos', ['user_id'])
    op.create_index(
        'ux_vinculos_user_id_identificacao',
        'vinculos',
        ['user_id', 'identificacao'],
        unique=True,
        postgresql_where=sa.text('identificacao IS NOT NULL'),
    )

    # Os vínculos que já existem. gen_random_uuid() gera um UUID novo no
    # próprio PostgreSQL. NULLIF(TRIM(x), '') trata um texto vazio como
    # ausente; COALESCE escolhe o primeiro valor que não seja NULL (o hash,
    # senão o IBAN com a moeda).
    #
    # DADOS ANTIGOS QUE AS REGRAS NOVAS NÃO ADMITEM: antes desta migração,
    # nada impedia que
    #   - duas linhas de contas bancárias apontassem para a mesma Conta;
    #   - o mesmo utilizador tivesse duas Contas ligadas à mesma conta real
    #     (a migração b7d4e2a1c9f3 previu este caso).
    # A tabela nova admite no máximo um vínculo por Conta e uma
    # identificação por utilizador; copiar tudo tal como estava faria a
    # migração falhar. Por isso:
    #   - por_conta: em cada Conta, fica só a conta bancária mais recente
    #     (DISTINCT ON (c.id) ... ORDER BY cb.created_at DESC: a primeira
    #     linha de cada Conta, pela ordem pedida);
    #   - numeradas: em cada par (utilizador, identificação), numera as
    #     Contas da mais recente para a mais antiga (ROW_NUMBER() OVER
    #     (PARTITION BY ...)); só a número 1 fica com a identificação, as
    #     outras ficam vinculadas, mas sem ela (o mesmo critério da
    #     b7d4e2a1c9f3: a mais recente é a que se reconhece).
    op.execute(
        """
        WITH por_conta AS (
            SELECT DISTINCT ON (c.id)
                   c.user_id,
                   c.id AS conta_id,
                   cb.id AS conta_bancaria_id,
                   COALESCE(
                       NULLIF(TRIM(cb.identification_hash), ''),
                       'iban:' || UPPER(REPLACE(NULLIF(TRIM(cb.iban), ''), ' ', '')) || ':' || UPPER(cb.moeda)
                   ) AS ident,
                   c.data_ancora,
                   c.created_at AS conta_criada_em
            FROM contas_bancarias cb
            JOIN contas c ON c.id = cb.conta_id
            WHERE cb.conta_id IS NOT NULL
            ORDER BY c.id, cb.created_at DESC
        ),
        numeradas AS (
            SELECT por_conta.*,
                   ROW_NUMBER() OVER (
                       PARTITION BY user_id, ident ORDER BY conta_criada_em DESC
                   ) AS ordem
            FROM por_conta
        )
        INSERT INTO vinculos (id, user_id, conta_id, conta_bancaria_id, identificacao, data_corte)
        SELECT gen_random_uuid(),
               user_id,
               conta_id,
               conta_bancaria_id,
               CASE WHEN ordem = 1 THEN ident END,
               data_ancora - 1
        FROM numeradas
        """
    )

    # 2. A coluna antiga deixa de ser precisa.
    op.drop_column('contas_bancarias', 'conta_id')

    # 3. A origem e o vínculo de cada movimento.
    op.add_column('movimentos', sa.Column('origem', sa.String(length=6), nullable=True))
    op.execute(
        "UPDATE movimentos SET origem = CASE WHEN id_transacao_externa IS NULL "
        "THEN 'manual' ELSE 'banco' END"
    )
    op.execute('SET CONSTRAINTS ALL IMMEDIATE')
    op.alter_column('movimentos', 'origem', nullable=False)
    op.add_column('movimentos', sa.Column('vinculo_id', sa.UUID(), nullable=True))
    op.create_foreign_key(
        'movimentos_vinculo_id_fkey', 'movimentos', 'vinculos', ['vinculo_id'], ['id'], ondelete='SET NULL'
    )
    op.create_index('ix_movimentos_vinculo_id', 'movimentos', ['vinculo_id'])
    op.execute(
        """
        UPDATE movimentos m SET vinculo_id = v.id
        FROM vinculos v
        WHERE v.conta_id = m.conta_id AND m.origem = 'banco'
        """
    )
    op.execute('SET CONSTRAINTS ALL IMMEDIATE')
    op.create_check_constraint(
        'ck_movimentos_origem', 'movimentos', "origem IN ('manual', 'banco', 'acerto')"
    )
    op.create_check_constraint(
        'ck_movimentos_origem_banco_tem_id',
        'movimentos',
        "(origem = 'banco') = (id_transacao_externa IS NOT NULL)",
    )


def downgrade() -> None:
    """Repõe contas_bancarias.conta_id a partir dos vínculos e retira as colunas novas."""
    op.drop_constraint('ck_movimentos_origem_banco_tem_id', 'movimentos', type_='check')
    op.drop_constraint('ck_movimentos_origem', 'movimentos', type_='check')
    op.drop_index('ix_movimentos_vinculo_id', table_name='movimentos')
    op.drop_constraint('movimentos_vinculo_id_fkey', 'movimentos', type_='foreignkey')
    op.drop_column('movimentos', 'vinculo_id')
    op.drop_column('movimentos', 'origem')

    op.add_column('contas_bancarias', sa.Column('conta_id', sa.UUID(), nullable=True))
    op.create_foreign_key(
        'contas_bancarias_conta_id_fkey',
        'contas_bancarias',
        'contas',
        ['conta_id'],
        ['id'],
        ondelete='CASCADE',
    )
    op.execute(
        "UPDATE contas_bancarias cb SET conta_id = v.conta_id "
        "FROM vinculos v WHERE v.conta_bancaria_id = cb.id"
    )

    op.drop_index('ux_vinculos_user_id_identificacao', table_name='vinculos')
    op.drop_index('ix_vinculos_user_id', table_name='vinculos')
    op.drop_table('vinculos')
