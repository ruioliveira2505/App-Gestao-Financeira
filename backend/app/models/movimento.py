"""
MODELO DA TABELA "movimentos"
===============================

Representa um movimento (uma transacção) — uma entrada ou saída de
dinheiro numa conta, numa data. É a tabela que a âncora da conta
(data_ancora, saldo_ancora — ver app/models/conta.py) foi desenhada para
ajustar: o saldo actual de uma conta é sempre saldo_ancora + a soma do
"valor" de todos os seus movimentos.

VALOR COM SINAL, não um campo "tipo" (entrada/saída) à parte: um único
número, positivo para entradas e negativo para saídas, soma-se
directamente ao saldo. O formulário do frontend pode continuar a pedir
"Entrada ou saída?" e um valor sempre positivo — essa é só a forma como se
apresenta ao utilizador; a conversão para um único valor com sinal
acontece no próprio formulário, antes de chegar aqui.

CATEGORIA OBRIGATÓRIA, nunca "nenhuma": a coluna categoria_id é NOT NULL —
todo o movimento tem sempre uma categoria (chave estrangeira para a
tabela categorias — ver app/models/categoria.py —, não texto livre: o
valor de uma categoria está em ser referenciável e ter identidade estável
quando é renomeada, ao contrário de "banco"/"tipo" da conta, que são só
rótulos descritivos), e pode apontar tanto para uma subcategoria (ex.:
"Supermercado") como directamente para um grupo de topo — a estrutura não
obriga uma categoria a ter subcategorias, mesmo que a árvore por omissão
(app/services/categorias_seed.py) dê sempre pelo menos um "Outros" a cada
grupo. Um movimento criado sem escolha explícita fica com a
categoria-refúgio da sua direcção ("Outras Entradas" ou "Outras Saídas" —
ver a nota PROTEGIDA em app/models/categoria.py), nunca sem nenhuma: dessa
forma, uma soma ou um agrupamento por categoria (nas estatísticas, ou na
futura categorização automática por modelo de linguagem) nunca precisa de
tratar "sem categoria" como um caso especial à parte.

Esta obrigatoriedade tem uma consequência do lado da eliminação de
categorias: apagar uma categoria que ainda tenha movimentos (dela ou de
subcategorias que caiam com ela em cascata) exige que o serviço
(app/services/categorias.py) receba explicitamente para onde esses
movimentos migram — nunca uma reatribuição silenciosa à categoria-refúgio,
e nunca a eliminação dos próprios movimentos.
"""

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Date, DateTime, ForeignKey, Numeric, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.session import Base


class Movimento(Base):
    """Um movimento (entrada ou saída de dinheiro) associado a uma conta."""

    __tablename__ = "movimentos"

    # Chave primária. UUID, pela mesma razão das outras tabelas (users,
    # sessions, contas): um id sequencial expõe quantos movimentos existem
    # e é fácil de adivinhar.
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # Chave estrangeira para a conta a que este movimento pertence.
    # index=True porque toda e qualquer consulta a movimentos filtra por
    # este campo ("os movimentos desta conta") ou, na lista global, ordena
    # com ele.
    #
    # ondelete="CASCADE": ao apagar uma conta, os seus movimentos são
    # apagados com ela, ao nível da própria base de dados (não é preciso
    # o SQLAlchemy ir buscá-los um a um). É o que a interface já promete
    # no ecrã de "Eliminar conta" ("A conta e os movimentos associados
    # serão apagados") — sem isto, apagar uma conta com movimentos falharia
    # com um erro de integridade referencial, porque a base de dados
    # recusaria deixar "movimentos órfãos" (a apontar para uma conta que
    # deixou de existir).
    conta_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("contas.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # A data do movimento (não hora — os movimentos financeiros do dia a
    # dia raramente precisam de mais precisão do que isso). Indexada:
    # tanto a lista global como a soma que dá o saldo de uma conta
    # ordenam ou filtram por data.
    data: Mapped[date] = mapped_column(Date, nullable=False, index=True)

    # Descrição livre do movimento ("Renda de setembro", "Supermercado").
    descricao: Mapped[str] = mapped_column(String(200), nullable=False)

    # O valor, COM SINAL (ver a nota no topo do ficheiro): positivo é uma
    # entrada, negativo é uma saída. Numeric(14, 2) — nunca float, pela
    # mesma razão das colunas monetárias da conta (saldo_ancora): erros de
    # arredondamento são inaceitáveis em dinheiro.
    valor: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)

    # Categoria atribuída a este movimento — obrigatória, ver a nota
    # CATEGORIA OBRIGATÓRIA no topo do ficheiro. index=True pela mesma
    # razão de conta_id: os filtros por categoria (a acrescentar no
    # frontend) e as estatísticas agrupadas por categoria vão consultar
    # por este campo.
    #
    # Sem ondelete explícito (o que o Postgres chama NO ACTION): a base de
    # dados recusa apagar uma categoria enquanto este movimento ainda
    # apontar para ela — o que nunca deveria acontecer, porque o serviço
    # (app/services/categorias.py) reatribui sempre os movimentos antes de
    # apagar uma categoria, mas serve de rede de segurança caso essa regra
    # alguma vez falhe. Note-se o contraste com conta_id (acima,
    # ondelete="CASCADE") e com parent_id em app/models/categoria.py
    # (também CASCADE): aqueles dois representam relações onde a linha
    # "filha" deixa de fazer sentido sem a "pai" e deve desaparecer com
    # ela; aqui é o oposto — um movimento nunca deve desaparecer por causa
    # de uma categoria que se apagou.
    categoria_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("categorias.id"),
        nullable=False,
        index=True,
    )

    # Momento de criação da linha, preenchido pela própria base de dados.
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # Momento da última alteração. server_default preenche na criação;
    # onupdate faz o SQLAlchemy actualizar este valor sempre que a linha é
    # modificada e gravada.
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
