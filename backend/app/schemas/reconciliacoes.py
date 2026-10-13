"""
FORMATO DOS PEDIDOS E RESPOSTAS DA API DE RECONCILIAÇÕES
===========================================================

Uma RECONCILIAÇÃO é a afirmação «no FIM do dia D, o saldo desta conta era
S». O ACERTO é o movimento que a aplicação cria, no dia D, pela diferença
entre S e o saldo que ela própria calcula (0 se batia certo).

Estas classes (baseadas em BaseModel, do Pydantic, a biblioteca que valida
dados) descrevem só a FORMA dos dados que entram e saem da API. As regras
de negócio (as datas permitidas, só numa conta manual…) vivem no serviço
de reconciliações.

Os valores monetários são TEXTO na API ("1234.56"), não números: o formato
JSON não tem um tipo decimal, e um número de vírgula flutuante poderia
perder cêntimos.
"""

import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, Field

from app.core.moedas import LIMITE_DE_VALOR


class ReconciliacaoDados(BaseModel):
    """Os dados de uma reconciliação a criar, editar ou pré-visualizar: o dia e o saldo no fim dele."""

    data: date
    # Aceita uma string ("1234.56") ou um número; o Pydantic converte para
    # Decimal. Pode ser negativo (ex.: um cartão de crédito).
    # Field(ge=..., le=...): o valor tem de caber na coluna da base de
    # dados (Numeric(14, 2): até 12 algarismos antes da vírgula e 2 depois).
    # Um valor maior é recusado aqui com 422, em vez de rebentar mais à
    # frente com um erro da base de dados. As casas a mais não se recusam:
    # o serviço arredonda o valor aos cêntimos.
    saldo: Decimal = Field(ge=-LIMITE_DE_VALOR, le=LIMITE_DE_VALOR)


class ReconciliacaoOut(BaseModel):
    """Uma reconciliação devolvida pela API, com o valor do seu acerto."""

    id: uuid.UUID
    conta_id: uuid.UUID
    data: date
    saldo: str
    # "utilizador" ou "banco".
    origem: str
    # O acerto da reconciliação. Cria-se sempre com acerto, mas pode passar
    # a "0.00" mais tarde (quando se regista o movimento que explicava a
    # diferença): a reconciliação fica, a guardar o saldo confirmado.
    acerto: str
    # Só nas reconciliações do BANCO: o instante em que a aplicação leu o
    # saldo ao banco. A interface mostra-o («Lido no banco: 12 ago, 14:32»).
    # None numa reconciliação do utilizador.
    lido_em: datetime | None = None


class AcertoSimuladoOut(BaseModel):
    """O acerto que resultaria de uma reconciliação, sem gravar nada."""

    acerto: str
