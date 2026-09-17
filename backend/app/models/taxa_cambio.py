"""
MODELO DA TABELA "taxas_cambio"
==================================

Guarda, por dia, a taxa de câmbio de cada moeda suportada (ver
app/core/moedas.py) relativamente a 1 EUR — ex.: uma linha
(data=2026-01-15, moeda="USD", por_1_eur=1.10) significa "a 15 de Janeiro
de 2026, 1 EUR valia 1.10 USD".

PORQUÊ RELATIVO A UM SÓ PIVOT (EUR), E NÃO UMA LINHA POR CADA PAR DE
MOEDAS: com N moedas suportadas, guardar a taxa de CADA PAR (USD→GBP,
GBP→USD, USD→BRL, ...) precisaria de N×(N-1) linhas por dia. Guardando só
a taxa de cada moeda relativamente a uma moeda-pivot fixa (EUR), calcula-se
qualquer conversão entre duas moedas quaisquer em dois passos — converte-se
a moeda de origem para EUR, depois de EUR para a moeda de destino —, o que
precisa de apenas N linhas por dia. É também a forma em que a fonte destas
taxas (a Frankfurter API, baseada nas taxas de referência diárias do Banco
Central Europeu) já devolve os dados: uma só chamada com "base=EUR" dá a
taxa de todas as moedas de uma vez.

O EUR não tem linha própria nesta tabela (seria sempre 1.0, uma linha
redundante em todos os dias) — quem lê estes dados trata a ausência de
uma moeda como sendo, precisamente, a moeda-pivot.

PORQUÊ A DATA É UMA COLUNA, E NÃO SÓ "A TAXA DE HOJE": uma conversão de um
movimento ANTIGO (ex.: um gasto em USD do mês passado) deve usar a taxa de
câmbio QUE ESTAVA EM VIGOR nesse dia, não a taxa de hoje — senão o valor em
EUR de um movimento já fechado no passado mudaria todos os dias, só porque
o câmbio actual mudou, o que não faz sentido para um extrato histórico. Só
para saber "quanto tenho AGORA" (património actual) é que interessa a taxa
mais recente. Guardar o histórico completo, um dia de cada vez, permite as
duas coisas.

DIAS SEM TAXA PRÓPRIA (fins de semana, feriados do BCE): o Banco Central
Europeu só publica uma taxa de referência nova em dias úteis. Não se cria
aqui uma linha "vazia" para os outros dias — quem procura uma taxa para uma
data sem linha própria usa a taxa mais recente IGUAL OU ANTERIOR a essa
data (a mesma taxa que estaria em vigor nesse dia, na prática, já que nada
mudou de câmbio nele).
"""

from datetime import date
from decimal import Decimal

from sqlalchemy import CheckConstraint, Date, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class TaxaCambio(Base):
    """A taxa de câmbio de uma moeda, relativamente a 1 EUR, num dia."""

    __tablename__ = "taxas_cambio"

    # Chave primária composta (data, moeda): no máximo uma taxa por moeda,
    # por dia — nunca duas taxas em competição para a mesma combinação.
    # Ao contrário das outras tabelas da aplicação, não há aqui um "id"
    # UUID próprio: esta tabela não é criada nem editada por um
    # utilizador através da API (só o script de actualização escreve
    # nela), por isso não há razão para esconder "quantas linhas existem"
    # ou "em que ordem foram inseridas" — o único identificador que
    # importa é, precisamente, a combinação (data, moeda).
    data: Mapped[date] = mapped_column(Date, primary_key=True)

    # Código ISO 4217 de 3 letras (ver app/core/moedas.py) — nunca "EUR"
    # (ver a nota PORQUÊ RELATIVO A UM SÓ PIVOT no topo do ficheiro).
    moeda: Mapped[str] = mapped_column(String(3), primary_key=True)

    # Quantas unidades desta moeda valem 1 EUR, nesta data. Numeric (nunca
    # float, pela mesma razão de qualquer valor monetário na aplicação:
    # erros de arredondamento são inaceitáveis), com mais casas decimais
    # do que as colunas de dinheiro (Numeric(14, 2)) — isto não é um
    # valor em dinheiro arredondado a cêntimos, é uma TAXA, usada como
    # multiplicador em contas encadeadas (origem→EUR→destino); menos
    # precisão aqui significaria erros a acumularem-se a cada conversão.
    por_1_eur: Mapped[Decimal] = mapped_column(Numeric(18, 8), nullable=False)

    # Nunca zero nem negativo: uma taxa de câmbio é sempre uma quantidade
    # positiva de moeda por 1 EUR. Nada no código actual escreveria um
    # valor destes (a Frankfurter API só devolve positivos), mas esta
    # restrição elimina por completo uma classe de erro — ex.: alguém a
    # corrigir uma taxa à mão, directamente na base de dados, com um
    # valor errado — que de outra forma só se notaria mais tarde, como
    # uma divisão por zero ou uma conversão com o sinal invertido em
    # converter() (app/services/cambio.py).
    __table_args__ = (CheckConstraint("por_1_eur > 0", name="ck_taxas_cambio_por_1_eur_positivo"),)
