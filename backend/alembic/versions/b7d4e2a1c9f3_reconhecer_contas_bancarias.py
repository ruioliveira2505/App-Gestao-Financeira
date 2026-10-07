"""reconhecer_contas_bancarias

Acrescenta o que é preciso para reconhecer, ao ligar um banco, contas
bancárias que o utilizador já tem (ou já teve) na aplicação, e para
sugerir o nome e o tipo de uma conta nova:

- contas.identificacao_bancaria — a identificação estável da conta
  bancária real (identification_hash, ou "iban:" + IBAN + ":" + moeda).
  Preenchida a partir das ligações que já existem (ver o UPDATE abaixo),
  para as contas já ligadas serem reconhecidas logo na próxima ligação.
- um índice ÚNICO em (user_id, identificacao_bancaria): uma conta
  bancária alimenta no máximo uma Conta de cada utilizador. Os NULL (as
  contas manuais) não contam, porque o PostgreSQL trata cada NULL como
  diferente de qualquer outro.
- contas_ligadas.produto e contas_ligadas.tipo_conta_banco — o nome do
  produto e o tipo de conta que o banco envia (um código da norma ISO
  20022, a norma internacional das mensagens bancárias: CACC, SVGS…).

Escrita à mão (não gerada por "alembic revision --autogenerate"), porque
inclui uma migração de DADOS: além de mudar a ESTRUTURA das tabelas
(colunas novas), altera o CONTEÚDO de linhas que já existem (o UPDATE),
algo que o autogenerate não sabe escrever.

Revision ID: b7d4e2a1c9f3
Revises: 9e30c4da4f96
Create Date: 2026-10-03 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b7d4e2a1c9f3'
down_revision: Union[str, Sequence[str], None] = '9e30c4da4f96'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('contas', sa.Column('identificacao_bancaria', sa.String(), nullable=True))
    op.add_column('contas_ligadas', sa.Column('produto', sa.String(length=120), nullable=True))
    op.add_column('contas_ligadas', sa.Column('tipo_conta_banco', sa.String(length=4), nullable=True))

    # As contas JÁ ligadas ganham a identificação da conta bancária que as
    # alimenta, com EXATAMENTE a mesma regra de identificacao_bancaria
    # (app/services/ligacoes_bancarias.py), escrita em SQL:
    #   - NULLIF(TRIM(x), '') transforma um texto vazio (ou só espaços) em
    #     NULL, para contar como ausente (como o Python faz);
    #   - COALESCE(a, b) devolve o primeiro valor que não seja NULL: o hash,
    #     se existir; senão "iban:" + o IBAN sem espaços e em maiúsculas +
    #     ":" + a moeda. Se o IBAN for NULL, a concatenação inteira dá NULL
    #     (em SQL, juntar texto a NULL dá NULL), e a conta fica sem
    #     identificação.
    # DISTINCT ON (user_id, ident) ... ORDER BY created_at DESC: se, antes
    # deste reconhecimento existir, o mesmo utilizador tiver criado duas
    # Contas para a mesma conta bancária, só a MAIS RECENTE fica com a
    # identificação (a outra fica como conta manual). Sem isto, o índice
    # único criado a seguir falharia, e o reconhecimento seria ambíguo.
    op.execute(
        """
        UPDATE contas
        SET identificacao_bancaria = escolhidas.ident
        FROM (
            SELECT DISTINCT ON (candidatas.user_id, candidatas.ident)
                candidatas.conta_id, candidatas.ident
            FROM (
                SELECT
                    c.id AS conta_id,
                    c.user_id,
                    c.created_at,
                    COALESCE(
                        NULLIF(TRIM(cl.identification_hash), ''),
                        'iban:' || UPPER(REPLACE(NULLIF(TRIM(cl.iban), ''), ' ', ''))
                            || ':' || UPPER(cl.moeda)
                    ) AS ident
                FROM contas c
                JOIN contas_ligadas cl ON cl.conta_id = c.id
            ) AS candidatas
            WHERE candidatas.ident IS NOT NULL
            ORDER BY candidatas.user_id, candidatas.ident, candidatas.created_at DESC
        ) AS escolhidas
        WHERE contas.id = escolhidas.conta_id
        """
    )

    op.create_index(
        'ux_contas_user_id_identificacao_bancaria',
        'contas',
        ['user_id', 'identificacao_bancaria'],
        unique=True,
    )


def downgrade() -> None:
    """Downgrade schema."""
    # "IF EXISTS": uma base de dados que correu uma versão anterior desta
    # migração (que ainda não criava o índice) também consegue voltar
    # atrás, em vez de falhar por o índice não existir.
    op.execute('DROP INDEX IF EXISTS ux_contas_user_id_identificacao_bancaria')
    op.drop_column('contas_ligadas', 'tipo_conta_banco')
    op.drop_column('contas_ligadas', 'produto')
    op.drop_column('contas', 'identificacao_bancaria')
