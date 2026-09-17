"""
MOEDAS SUPORTADAS
==================

A aplicação suporta um conjunto FECHADO de moedas. Ao contrário do banco
ou do tipo de conta — que são texto livre escolhido pelo utilizador —, uma
moeda é um código normalizado (ISO 4217) escolhido de uma lista. Por isso
o conjunto é validado, e cada moeda tem um símbolo associado (usado só
para apresentação, no frontend).

Este conjunto vive na aplicação, não na base de dados: a coluna "moeda" da
tabela "contas" é apenas um VARCHAR(3). Acrescentar uma moeda é editar
este ficheiro — não é preciso migração.

Todas as moedas listadas usam 2 casas decimais, o que casa com o tipo
Numeric(14, 2) da coluna "saldo_ancora".
"""

# Código -> símbolo e nome. É a única fonte de verdade do conjunto.
MOEDAS: dict[str, dict[str, str]] = {
    "EUR": {"simbolo": "€", "nome": "Euro"},
    "USD": {"simbolo": "$", "nome": "Dólar americano"},
    "GBP": {"simbolo": "£", "nome": "Libra esterlina"},
    "BRL": {"simbolo": "R$", "nome": "Real brasileiro"},
    "CHF": {"simbolo": "CHF", "nome": "Franco suíço"},
}

# Moeda assumida quando o pedido não indica nenhuma.
MOEDA_OMISSAO = "EUR"


def moeda_suportada(valor: str) -> str:
    """
    Valida que "valor" é um dos códigos em MOEDAS (maiúsculas primeiro,
    para "usd" e "USD" serem tratados da mesma forma) — levanta ValueError
    caso contrário, que é o que o Pydantic espera de um "field_validator"
    para rejeitar o pedido com um erro 422 claro.

    Função partilhada (não um validador dentro de um único schema)
    porque mais do que um schema precisa exactamente desta regra: a moeda
    de uma conta (app/schemas/contas.py) e a moeda principal escolhida no
    perfil de um utilizador (app/schemas/auth.py, UserPreferencias) — sem
    isto, seriam duas cópias da mesma validação a divergirem com o tempo
    se MOEDAS alguma vez mudasse.
    """
    valor = valor.upper()
    if valor not in MOEDAS:
        raise ValueError(f"Moeda não suportada: {valor}")
    return valor
