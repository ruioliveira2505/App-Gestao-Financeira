"""
FORMATO DOS PEDIDOS E RESPOSTAS DA API DE MOVIMENTOS
=====================================================

Estas classes (baseadas em BaseModel, do Pydantic) descrevem o formato dos
dados que entram e saem dos endpoints de movimentos — são diferentes do
modelo em app/models/movimento.py, que descreve a tabela da base de
dados.

VALOR COM SINAL: um único campo, positivo para uma entrada e negativo para
uma saída (ver a nota em app/models/movimento.py). O ecrã de
criar/editar um movimento pode continuar a perguntar "entrada ou saída?" e
pedir um valor sempre positivo — é só a forma de apresentação; a conversão
para um valor com sinal faz-se no próprio formulário, antes do pedido
chegar aqui.

Ainda sem "categoria" — ver a nota em app/models/movimento.py.

Os campos são os mesmos na criação e na edição (ao contrário de Conta, uma
edição de movimento pode mexer em tudo, incluindo mudar a conta a que
pertence — "mover" o movimento) — por isso vivem numa única classe-base
(_CamposMovimento), sem precisar de duas versões.
"""

import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, Field, field_validator


class _CamposMovimento(BaseModel):
    """Os campos de um movimento, comuns à criação e à edição."""

    # A conta a que este movimento pertence. Tem de pertencer ao
    # utilizador autenticado — verificado na rota (app/routers/
    # movimentos.py), não aqui: este schema só sabe validar a FORMA dos
    # dados, não se um determinado id existe ou é deste utilizador.
    conta_id: uuid.UUID

    data: date

    descricao: str = Field(min_length=1, max_length=200)

    # Com sinal: positivo é uma entrada, negativo é uma saída.
    valor: Decimal

    @field_validator("descricao")
    @classmethod
    def _descricao_sem_espacos_e_nao_vazia(cls, valor: str) -> str:
        valor = valor.strip()
        if not valor:
            raise ValueError("A descrição não pode ser vazia.")
        return valor

    @field_validator("valor")
    @classmethod
    def _valor_nao_pode_ser_zero(cls, valor: Decimal) -> Decimal:
        # Um movimento de valor 0 não muda saldo nenhum — não corresponde
        # a nenhuma transacção real, é quase de certeza um erro de
        # preenchimento.
        if valor == 0:
            raise ValueError("O valor não pode ser zero.")
        return valor


class MovimentoCriar(_CamposMovimento):
    """Dados recebidos no pedido de criação de um movimento (POST /movimentos)."""


class MovimentoEditar(_CamposMovimento):
    """Dados recebidos no pedido de edição de um movimento (PATCH /movimentos/{id})."""


class MovimentoOut(BaseModel):
    """Dados de um movimento devolvidos pela API."""

    id: uuid.UUID
    conta_id: uuid.UUID
    data: date
    descricao: str

    # Texto, não número (ver a mesma nota em app/schemas/contas.py): o
    # JSON não tem um tipo decimal exacto.
    valor: str

    created_at: datetime
    updated_at: datetime
