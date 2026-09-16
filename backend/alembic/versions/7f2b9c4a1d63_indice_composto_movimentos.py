"""índice composto em movimentos(conta_id, data, created_at, id)

Revision ID: 7f2b9c4a1d63
Revises: 50daa75ac214
Create Date: 2026-09-15 14:05:00.000000

Não gerada automaticamente (op.create_index escrito à mão): não há nenhuma
mudança de modelo a acompanhar — só um índice a acrescentar a colunas já
existentes.

PORQUÊ ESTE ÍNDICE: duas consultas em app/routers/movimentos.py precisam
exactamente desta ordem (conta_id, depois data/created_at/id) e, sem um
índice a acompanhá-la, o Postgres tem de ordenar as linhas do zero em cada
pedido:

  1. O cálculo de saldo_apos (a função de janela em _saldo_apos_sq) faz
     "PARTITION BY conta_id ORDER BY data ASC, created_at ASC, id ASC" —
     e corre em TODO o histórico do utilizador, em TODOS os pedidos a
     GET /movimentos, independentemente dos filtros aplicados (ver a nota
     "SALDO REMANESCENTE" no topo desse ficheiro). É o caso mais
     importante: nunca é filtrado, corre sempre.
  2. A paginação por cursor ordena "data DESC, created_at DESC, id DESC" —
     a mesma tripla, só que em sentido inverso. Um índice ascendente serve
     na mesma este caso: o Postgres lê-o de trás para a frente (uma
     "backward index scan"), sem precisar de um índice à parte.

Não inclui DESC explícito nas colunas por não ser preciso: como as três
colunas a seguir a conta_id (data, created_at, id) são todas lidas no
MESMO sentido em cada consulta (todas ASC na função de janela, todas DESC
na paginação), um índice simples, todo ascendente, serve os dois casos —
bastam ao Postgres uma leitura para a frente e uma para trás,
respectivamente.
"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '7f2b9c4a1d63'
down_revision: Union[str, Sequence[str], None] = '50daa75ac214'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_index(
        'ix_movimentos_conta_id_data_created_at_id',
        'movimentos',
        ['conta_id', 'data', 'created_at', 'id'],
        unique=False,
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_movimentos_conta_id_data_created_at_id', table_name='movimentos')
