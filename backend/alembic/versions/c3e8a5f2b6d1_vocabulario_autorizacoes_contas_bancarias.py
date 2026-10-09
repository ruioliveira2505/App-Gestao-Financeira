"""vocabulario_autorizacoes_contas_bancarias

Muda os nomes das tabelas e colunas do Open Banking para o vocabulário das
regras de negócio, sem mudar nenhum dado nem nenhum comportamento:

- tabela "ligacoes_bancarias" → "autorizacoes" (o consentimento dado no
  banco para a aplicação ler as contas partilhadas, durante um prazo);
  as colunas "aspsp_nome" e "aspsp_pais" → "banco" e "pais";
- tabela "contas_ligadas" → "contas_bancarias" (cada conta real trazida
  por uma autorização); a coluna "ligacao_id" → "autorizacao_id".

Também muda os nomes dos índices e das restrições (chave primária, chaves
estrangeiras, unicidade), que o PostgreSQL criou com o nome antigo da
tabela. Não é obrigatório para funcionar, mas deixa a base de dados
coerente: quem a inspecionar não encontra nomes que já não existem no
código.

COMO SE MUDAM OS NOMES DAS RESTRIÇÕES. Os nomes das restrições foram
escolhidos pelo próprio PostgreSQL quando as tabelas foram criadas, a
partir do nome da tabela e da coluna (ex.: "contas_ligadas_pkey" para a
chave primária, "ligacoes_bancarias_aspsp_nome_not_null" para a
obrigatoriedade de uma coluna, que o PostgreSQL 18 também regista como
restrição com nome). Em vez de uma lista fixa, que falharia numa base de
dados com nomes ligeiramente diferentes, a migração pergunta ao catálogo
do PostgreSQL (pg_constraint) que restrições existem nestas duas tabelas
e muda o nome de cada uma, trocando as partes antigas pelas novas. Os
índices usam "ALTER INDEX IF EXISTS", que só atua se o índice existir.

Escrita à mão: mudar nomes não é algo que o "alembic revision
--autogenerate" saiba detetar (veria uma tabela apagada e outra criada, e
perder-se-iam os dados).

Revision ID: c3e8a5f2b6d1
Revises: b7d4e2a1c9f3
Create Date: 2026-10-09 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'c3e8a5f2b6d1'
down_revision: Union[str, Sequence[str], None] = 'b7d4e2a1c9f3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Índices (nome antigo, nome novo). O downgrade usa a lista ao contrário.
_INDICES = [
    ('ix_ligacoes_bancarias_user_id', 'ix_autorizacoes_user_id'),
    ('ix_contas_ligadas_ligacao_id', 'ix_contas_bancarias_autorizacao_id'),
]

# Trocas a fazer nos nomes das restrições: (padrão, substituto), no formato
# de expressões regulares do PostgreSQL. TODAS presas ao INÍCIO do nome
# ("^"), e as mais específicas primeiro: assim cada nome muda no máximo
# uma vez, e uma troca nunca apanha um nome que já está no formato de
# destino (uma troca solta, como "_pais_" → "_aspsp_pais_", também
# apanharia "ligacoes_bancarias_aspsp_pais_not_null" e duplicaria o
# "aspsp"). Isto torna a migração segura mesmo numa base de dados que
# tenha ficado num estado intermédio.
_TROCAS_UPGRADE = [
    ('^ligacoes_bancarias_aspsp_nome_', 'autorizacoes_banco_'),
    ('^ligacoes_bancarias_aspsp_pais_', 'autorizacoes_pais_'),
    ('^ligacoes_bancarias_', 'autorizacoes_'),
    ('^contas_ligadas_ligacao_id_', 'contas_bancarias_autorizacao_id_'),
    ('^contas_ligadas_', 'contas_bancarias_'),
]
_TROCAS_DOWNGRADE = [
    ('^autorizacoes_banco_', 'ligacoes_bancarias_aspsp_nome_'),
    ('^autorizacoes_pais_', 'ligacoes_bancarias_aspsp_pais_'),
    ('^autorizacoes_', 'ligacoes_bancarias_'),
    ('^contas_bancarias_autorizacao_id_', 'contas_ligadas_ligacao_id_'),
    ('^contas_bancarias_', 'contas_ligadas_'),
]


def _mudar_nomes_restricoes(tabelas: list[str], trocas: list[tuple[str, str]]) -> None:
    """
    Muda o nome de todas as restrições das tabelas indicadas. O bloco
    "DO $$ ... $$" é um pequeno programa em PL/pgSQL (a linguagem de
    programação do PostgreSQL), executado no servidor: percorre as
    restrições no catálogo (pg_constraint), calcula o nome novo com a
    primeira troca que se aplique (regexp_replace: substituir texto por
    padrão) e só renomeia as que mudam. format('%I', ...) põe os nomes
    entre aspas quando é preciso, para nunca formar SQL inválido.
    """
    # Só se aplica a PRIMEIRA troca cujo padrão corresponda (um CASE do
    # SQL, que escolhe o primeiro ramo verdadeiro): cada nome muda no
    # máximo uma vez. "~" é o operador do PostgreSQL que testa se um texto
    # corresponde a uma expressão regular.
    ramos = ' '.join(
        f"WHEN r.conname ~ '{padrao}' THEN regexp_replace(r.conname, '{padrao}', '{substituto}')"
        for padrao, substituto in trocas
    )
    expressao = f'CASE {ramos} ELSE r.conname END'
    lista = ', '.join(f"'{t}'" for t in tabelas)
    op.execute(
        f"""
        DO $$
        DECLARE
            r record;
            novo text;
        BEGIN
            FOR r IN
                SELECT conrelid::regclass::text AS tabela, conname
                FROM pg_constraint
                WHERE conrelid::regclass::text IN ({lista})
            LOOP
                novo := {expressao};
                IF novo <> r.conname THEN
                    EXECUTE format('ALTER TABLE %I RENAME CONSTRAINT %I TO %I',
                                   r.tabela, r.conname, novo);
                END IF;
            END LOOP;
        END $$;
        """
    )


def upgrade() -> None:
    """Upgrade schema."""
    op.rename_table('ligacoes_bancarias', 'autorizacoes')
    op.alter_column('autorizacoes', 'aspsp_nome', new_column_name='banco')
    op.alter_column('autorizacoes', 'aspsp_pais', new_column_name='pais')

    op.rename_table('contas_ligadas', 'contas_bancarias')
    op.alter_column('contas_bancarias', 'ligacao_id', new_column_name='autorizacao_id')

    _mudar_nomes_restricoes(['autorizacoes', 'contas_bancarias'], _TROCAS_UPGRADE)
    for antigo, novo in _INDICES:
        op.execute(f'ALTER INDEX IF EXISTS {antigo} RENAME TO {novo}')


def downgrade() -> None:
    """Downgrade schema."""
    for antigo, novo in reversed(_INDICES):
        op.execute(f'ALTER INDEX IF EXISTS {novo} RENAME TO {antigo}')
    _mudar_nomes_restricoes(['autorizacoes', 'contas_bancarias'], _TROCAS_DOWNGRADE)

    op.alter_column('contas_bancarias', 'autorizacao_id', new_column_name='ligacao_id')
    op.rename_table('contas_bancarias', 'contas_ligadas')

    op.alter_column('autorizacoes', 'pais', new_column_name='aspsp_pais')
    op.alter_column('autorizacoes', 'banco', new_column_name='aspsp_nome')
    op.rename_table('autorizacoes', 'ligacoes_bancarias')
