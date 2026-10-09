"""
COMPARAR NOMES SEM ACENTOS NEM MAIÚSCULAS
============================================

Uma só função, normalizar_nome: a forma de um nome usada para COMPARAR
nomes, sem espaços nas pontas, sem acentos e sem distinção entre
maiúsculas e minúsculas. Com ela, "Poupança" e "poupanca " contam como o
mesmo nome.

Vive num ficheiro próprio porque é usada por dois serviços: o de contas
(o nome de uma conta é único por utilizador) e o de contas bancárias (a
sugestão de nome para uma conta nova nunca repete um nome existente). O
serviço de contas já importa o de contas bancárias; se a função vivesse
no de contas, o de contas bancárias teria de o importar também, e os dois
importar-se-iam mutuamente — uma
"importação circular", que o Python não consegue resolver quando os dois
módulos precisam um do outro logo ao serem carregados.
"""

import unicodedata


def normalizar_nome(nome: str) -> str:
    """
    O nome reduzido à forma usada para comparar: sem espaços nas pontas,
    sem acentos e sem distinção entre maiúsculas e minúsculas — "Poupança"
    e "poupanca " contam como o mesmo nome.

    Tirar os acentos: a decomposição "NFD" (uma forma de normalização da
    norma Unicode) separa cada letra acentuada na letra base mais o
    acento, como dois caracteres ("ç" → "c" + cedilha); depois descartam-se
    os acentos (a categoria Unicode "Mn", "marca combinatória"). "casefold"
    é a versão mais completa de "lower" para comparações (trata casos como
    o "ß" alemão).
    """
    decomposto = unicodedata.normalize("NFD", nome.strip())
    sem_acentos = "".join(c for c in decomposto if unicodedata.category(c) != "Mn")
    return sem_acentos.casefold()
