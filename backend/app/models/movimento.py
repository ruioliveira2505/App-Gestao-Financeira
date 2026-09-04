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

Ainda sem "categoria": esta fatia entrega só o registo do movimento em si
(conta, data, descrição, valor). A categorização — primeiro manual, depois
automática com um modelo de linguagem — é a fatia seguinte, e vai
acrescentar uma coluna categoria_id (chave estrangeira para uma tabela
categorias, não texto livre: o valor de uma categoria está em ser
referenciável e ter identidade estável quando é renomeada, ao contrário de
"banco"/"tipo" da conta, que são só rótulos descritivos).
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
