"""integridade

Faz a base de dados garantir regras que até aqui só o código garantia
(a "F1 — Integridade"):

1. RESTRIÇÕES CHECK (condições que o PostgreSQL verifica em cada escrita,
   seja qual for o código que a faça):
   - movimentos.valor nunca é 0;
   - categorias.direcao é sempre "entrada" ou "saida";
   - a moeda (contas.moeda, contas_bancarias.moeda, users.moeda_principal)
     tem sempre três letras maiúsculas.

2. APAGAR EM CASCATA A PARTIR DO UTILIZADOR: as chaves estrangeiras para
   users (contas, categorias, sessions, autorizacoes,
   autorizacoes_pendentes) passam a ON DELETE CASCADE. Apagar um
   utilizador apaga todos os seus dados — o direito ao apagamento do RGPD.
   Uma chave estrangeira não se altera no sítio: apaga-se e cria-se de
   novo, com a regra nova.
   A chave movimentos.categoria_id passa a ser verificada só no FIM DA
   TRANSAÇÃO (DEFERRABLE INITIALLY DEFERRED): ao apagar um utilizador, as
   suas categorias podem sair, a meio da cascata, antes dos movimentos
   que apontam para elas, e uma verificação imediata recusaria o
   apagamento. No fim da transação os movimentos já saíram. Apagar uma
   categoria que ainda tenha movimentos continua a ser recusado.

3. NOME DE CONTA ÚNICO NA BASE DE DADOS: coluna contas.nome_normalizado (o
   nome sem acentos, maiúsculas nem espaços nas pontas), preenchida a
   partir do nome de cada conta que já existe, e um índice único sobre
   (user_id, nome_normalizado). MIGRAÇÃO DE DADOS: a normalização é feita
   em Python, com uma cópia da função da aplicação escrita aqui dentro. A
   cópia é de propósito: uma migração tem de dar sempre o mesmo resultado,
   mesmo que a função da aplicação mude no futuro.

4. PAPEL DAS CATEGORIAS: a coluna booleana categorias.protegida dá lugar a
   categorias.papel ("refugio", "acerto" ou vazio). As categorias que eram
   protegidas passam a ter o papel "refugio". Restrição CHECK sobre os
   valores, e um índice único PARCIAL (só sobre as linhas com papel) sobre
   (user_id, papel, direcao): no máximo uma categoria de cada papel em
   cada direção, por utilizador.

5. CONTAS BANCÁRIAS: (autorizacao_id, uid) passa a ser único — cada conta
   bancária aparece uma só vez em cada autorização.

Antes de a escrever, confirmou-se que os dados da base de desenvolvimento
não violam nenhuma destas regras. Se uma base de dados as violar, a
migração falha (e nada fica feito, porque corre numa só transação), com a
mensagem do PostgreSQL a dizer qual.

Escrita à mão: inclui uma migração de dados (o preenchimento de
nome_normalizado e de papel), que o "alembic revision --autogenerate" não
sabe escrever.

Revision ID: d5a1c7e3f9b2
Revises: c3e8a5f2b6d1
Create Date: 2026-10-10 12:00:00.000000

"""
import unicodedata
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# Identificadores desta revisão, usados pelo Alembic para encadear as
# migrações.
revision: str = 'd5a1c7e3f9b2'
down_revision: Union[str, Sequence[str], None] = 'c3e8a5f2b6d1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# (tabela, nome da chave estrangeira para users). Os nomes são os que o
# PostgreSQL escolheu ao criar as tabelas, confirmados no catálogo.
_CHAVES_PARA_USERS = [
    ('contas', 'contas_user_id_fkey'),
    ('categorias', 'categorias_user_id_fkey'),
    ('sessions', 'sessions_user_id_fkey'),
    ('autorizacoes', 'autorizacoes_user_id_fkey'),
    ('autorizacoes_pendentes', 'autorizacoes_pendentes_user_id_fkey'),
]

_CHECKS = [
    ('ck_movimentos_valor_nao_zero', 'movimentos', 'valor <> 0'),
    ('ck_categorias_direcao', 'categorias', "direcao IN ('entrada', 'saida')"),
    ('ck_contas_moeda_formato', 'contas', "moeda ~ '^[A-Z]{3}$'"),
    ('ck_contas_bancarias_moeda_formato', 'contas_bancarias', "moeda ~ '^[A-Z]{3}$'"),
    ('ck_users_moeda_principal_formato', 'users', "moeda_principal ~ '^[A-Z]{3}$'"),
]


def _normalizar_nome(nome: str) -> str:
    """
    Cópia fixa da normalização da aplicação: sem espaços nas pontas, sem
    acentos (a decomposição Unicode "NFD" separa cada letra do seu acento,
    e os acentos, da categoria "Mn", são descartados) e sem distinção de
    maiúsculas (casefold).
    """
    decomposto = unicodedata.normalize("NFD", nome.strip())
    sem_acentos = "".join(c for c in decomposto if unicodedata.category(c) != "Mn")
    return sem_acentos.casefold()


def upgrade() -> None:
    """Aplica as garantias de integridade."""
    # 1. Restrições CHECK.
    for nome, tabela, condicao in _CHECKS:
        op.create_check_constraint(nome, tabela, condicao)

    # 2. Chaves estrangeiras para users, agora com ON DELETE CASCADE.
    for tabela, chave in _CHAVES_PARA_USERS:
        op.drop_constraint(chave, tabela, type_='foreignkey')
        op.create_foreign_key(chave, tabela, 'users', ['user_id'], ['id'], ondelete='CASCADE')

    op.drop_constraint('movimentos_categoria_id_fkey', 'movimentos', type_='foreignkey')
    op.create_foreign_key(
        'movimentos_categoria_id_fkey',
        'movimentos',
        'categorias',
        ['categoria_id'],
        ['id'],
        deferrable=True,
        initially='DEFERRED',
    )

    # 3. contas.nome_normalizado: criada vazia, preenchida linha a linha,
    #    e só depois obrigatória (NOT NULL) e única por utilizador.
    op.add_column('contas', sa.Column('nome_normalizado', sa.String(length=120), nullable=True))
    ligacao = op.get_bind()
    for conta_id, nome in ligacao.execute(sa.text('SELECT id, nome FROM contas')).all():
        ligacao.execute(
            sa.text('UPDATE contas SET nome_normalizado = :normalizado WHERE id = :id'),
            {'normalizado': _normalizar_nome(nome), 'id': conta_id},
        )
    op.alter_column('contas', 'nome_normalizado', nullable=False)
    op.create_index(
        'ux_contas_user_id_nome_normalizado', 'contas', ['user_id', 'nome_normalizado'], unique=True
    )

    # 4. categorias.papel substitui categorias.protegida.
    op.add_column('categorias', sa.Column('papel', sa.String(length=10), nullable=True))
    op.execute("UPDATE categorias SET papel = 'refugio' WHERE protegida")
    op.drop_column('categorias', 'protegida')
    op.create_check_constraint('ck_categorias_papel', 'categorias', "papel IN ('refugio', 'acerto')")
    op.create_index(
        'ux_categorias_user_id_papel_direcao',
        'categorias',
        ['user_id', 'papel', 'direcao'],
        unique=True,
        postgresql_where=sa.text('papel IS NOT NULL'),
    )

    # 5. Cada conta bancária uma só vez em cada autorização.
    op.create_unique_constraint(
        'uq_contas_bancarias_autorizacao_id_uid', 'contas_bancarias', ['autorizacao_id', 'uid']
    )


def downgrade() -> None:
    """Desfaz as garantias, pela ordem inversa."""
    op.drop_constraint('uq_contas_bancarias_autorizacao_id_uid', 'contas_bancarias', type_='unique')

    op.drop_index('ux_categorias_user_id_papel_direcao', table_name='categorias')
    op.drop_constraint('ck_categorias_papel', 'categorias', type_='check')
    op.add_column(
        'categorias',
        sa.Column('protegida', sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.execute("UPDATE categorias SET protegida = true WHERE papel IS NOT NULL")
    op.alter_column('categorias', 'protegida', server_default=None)
    op.drop_column('categorias', 'papel')

    op.drop_index('ux_contas_user_id_nome_normalizado', table_name='contas')
    op.drop_column('contas', 'nome_normalizado')

    op.drop_constraint('movimentos_categoria_id_fkey', 'movimentos', type_='foreignkey')
    op.create_foreign_key(
        'movimentos_categoria_id_fkey', 'movimentos', 'categorias', ['categoria_id'], ['id']
    )
    for tabela, chave in reversed(_CHAVES_PARA_USERS):
        op.drop_constraint(chave, tabela, type_='foreignkey')
        op.create_foreign_key(chave, tabela, 'users', ['user_id'], ['id'])

    for nome, tabela, _condicao in reversed(_CHECKS):
        op.drop_constraint(nome, tabela, type_='check')
