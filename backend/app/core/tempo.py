"""
A DATA DE HOJE, NO FUSO HORÁRIO DO UTILIZADOR
================================================

"Hoje" parece óbvio, mas depende de onde se está. date.today(), do Python,
devolve a data do RELÓGIO DO SERVIDOR, que pode estar noutro fuso horário
(muitos servidores trabalham em UTC, o tempo universal coordenado). Entre
a meia-noite e a uma da manhã em Lisboa, no horário de verão, o UTC ainda
está no dia anterior: um servidor em UTC recusaria a data de "hoje" como
data inicial de uma conta, por lhe parecer o futuro.

Por isso a aplicação usa sempre hoje(), definida aqui: a data civil em
Lisboa. Mais tarde, com utilizadores noutros países, passará a ser o fuso
de cada utilizador.

Os PRAZOS (por exemplo, até quando vale uma autorização bancária) não
usam isto: são instantes, guardados com fuso horário, e comparam-se com o
instante atual, não com uma data.
"""

from datetime import date, datetime
from zoneinfo import ZoneInfo

# O fuso horário de Portugal continental, pelo nome da base de dados de
# fusos da IANA (a lista oficial usada por todos os sistemas operativos).
# Pelo nome, e não por um desvio fixo como "+01:00", para a mudança da hora
# de verão para inverno (e vice-versa) ficar automaticamente certa.
FUSO_HORARIO = ZoneInfo("Europe/Lisbon")


def hoje() -> date:
    """A data civil de hoje em Lisboa (e não a do relógio do servidor)."""
    return datetime.now(FUSO_HORARIO).date()
