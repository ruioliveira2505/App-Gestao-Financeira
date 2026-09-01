"""
FORMATO DOS PEDIDOS E RESPOSTAS DA API DE CONTAS
================================================

Estas classes (baseadas em BaseModel, do Pydantic) descrevem o formato dos
dados que entram e saem dos endpoints de contas — são diferentes do modelo
em app/models/conta.py, que descreve a tabela da base de dados.

Duas notas de desenho:

  - Valores monetários (saldo_ancora, saldo) são texto na API ("1234.56"),
    não números. O formato JSON não tem um tipo decimal; um número em
    vírgula flutuante poderia perder precisão em cêntimos.

  - A "data de início de movimentos" que o utilizador vê É a data_ancora —
    não há conversão de +1/-1 dia. O saldo_ancora é o saldo no início desse
    dia, antes de qualquer movimento.

Os campos DESCRITIVOS de uma conta (nome, banco, tipo, moeda) são comuns à
criação e à edição — vivem numa classe-base (_CamposDescritivos) para as
regras de validação serem escritas uma só vez. A criação acrescenta a
âncora (data_ancora, saldo_ancora); a edição nunca lhe toca.
"""

import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, Field, field_validator

from app.core.moedas import MOEDA_OMISSAO, MOEDAS


class _CamposDescritivos(BaseModel):
    """Campos comuns à criação e à edição de uma conta."""

    nome: str = Field(min_length=1, max_length=120)
    # Opcionais: "Dinheiro" não tem banco nem, necessariamente, tipo.
    banco: str | None = Field(default=None, max_length=120)
    tipo: str | None = Field(default=None, max_length=40)
    # Sem valor por omissão aqui — na edição, a moeda tem de vir sempre
    # explícita, para não ser trocada por engano. A criação (abaixo)
    # acrescenta o valor por omissão.
    moeda: str

    @field_validator("nome")
    @classmethod
    def _nome_sem_espacos_e_nao_vazio(cls, valor: str) -> str:
        valor = valor.strip()
        if not valor:
            raise ValueError("O nome não pode ser vazio.")
        return valor

    @field_validator("banco", "tipo")
    @classmethod
    def _limpar_opcional(cls, valor: str | None) -> str | None:
        if valor is None:
            return None
        valor = valor.strip()
        # Uma string só com espaços equivale a "não indicado".
        return valor or None

    @field_validator("moeda")
    @classmethod
    def _moeda_suportada(cls, valor: str) -> str:
        valor = valor.upper()
        if valor not in MOEDAS:
            raise ValueError(f"Moeda não suportada: {valor}")
        return valor


class ContaCriar(_CamposDescritivos):
    """Dados recebidos no pedido de criação de uma conta (POST /contas)."""

    # Redeclarada só para acrescentar o valor por omissão; a validação
    # herdada de _CamposDescritivos continua a aplicar-se.
    moeda: str = MOEDA_OMISSAO

    data_ancora: date
    # Aceita uma string ("1234.56"), um inteiro ou um número; o Pydantic
    # converte para Decimal. Pode ser negativo (ex.: um cartão de crédito).
    saldo_ancora: Decimal


class ContaEditar(_CamposDescritivos):
    """
    Dados recebidos no pedido de edição de uma conta (PATCH /contas/{id}).

    Só os campos descritivos — a edição nunca mexe na âncora (data_ancora,
    saldo_ancora); para isso haverá um endpoint próprio, quando os
    movimentos existirem.
    """


class ContaOut(BaseModel):
    """Dados de uma conta devolvidos pela API."""

    id: uuid.UUID
    nome: str
    banco: str | None
    tipo: str | None
    moeda: str
    data_ancora: date

    # Valores monetários como texto (ver a nota no topo do ficheiro).
    saldo_ancora: str
    # Saldo actual da conta. Enquanto não existem movimentos, é igual ao
    # saldo da âncora; quando os movimentos existirem, passa a
    # saldo_ancora mais a soma dos movimentos até hoje.
    saldo: str

    created_at: datetime
    updated_at: datetime
