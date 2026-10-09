"""
FORMATO DOS PEDIDOS DE VINCULAÇÃO DE UMA CONTA EXISTENTE
===========================================================

Vincular uma Conta que já existe a uma conta bancária (o VÍNCULO: o facto
de uma conta bancária alimentar uma Conta) faz-se em dois passos: primeiro
a pré-visualização ("antes → depois"), depois a confirmação. Estas classes
(do Pydantic, a biblioteca que valida dados) descrevem só a FORMA dos
pedidos; as regras vivem no serviço de vinculação.

"modo" só aceita os dois valores previstos: "Literal" (do Python) diz que
o campo tem de ser exatamente um deles; outro valor é recusado (422) antes
de chegar ao serviço.
"""

import uuid
from typing import Literal

from pydantic import BaseModel


class VincularSimular(BaseModel):
    """A pré-visualização: a que Conta vincular, e em que modo."""

    conta_id: uuid.UUID
    modo: Literal["continuar", "substituir"] = "continuar"


class VincularConfirmar(VincularSimular):
    """A confirmação: o mesmo, mais os pares aceites (só em "continuar")."""

    # Os ids dos movimentos manuais cujo par (com uma transação do banco que
    # parece ser a mesma) o utilizador aceitou: esses movimentos são
    # apagados, e a transação do banco fica com a categoria deles.
    pares_aceites: list[uuid.UUID] = []
