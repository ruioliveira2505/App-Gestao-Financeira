"""
TESTES DAS FUNÇÕES DE MAPEAMENTO DE app/services/importacao_movimentos.py
=============================================================================

Cobrem só as funções PURAS deste ficheiro (_valor_com_sinal, _descricao,
_id_externo, _esta_confirmada) — sem base de dados, sem rede: recebem um
dicionário Python (a forma de uma transacção devolvida pela Enable
Banking, já confirmada em testes reais com a CGD) e devolvem um valor.

As funções que fazem chamadas de rede reais (criar_conta_a_partir_de_
ligacao, sincronizar_movimentos) NÃO são testadas aqui — precisariam de
substituir obter_saldos/obter_movimentos por versões falsas, um esforço
maior deixado para uma iteração futura (ver caderno/decisoes.md). Estes
testes cobrem, ainda assim, o essencial: as regras de mapeamento e
filtragem que decidem o que entra ou não numa Conta/Movimento real.
"""

from decimal import Decimal

from app.services.importacao_movimentos import (
    _descricao,
    _esta_confirmada,
    _id_externo,
    _valor_com_sinal,
)


def _transacao(**overrides) -> dict:
    """Uma transacção mínima e válida, na forma real confirmada com a CGD."""
    base = {
        "transaction_amount": {"currency": "EUR", "amount": "9.00"},
        "credit_debit_indicator": "CRDT",
        "status": "BOOK",
        "booking_date": "2026-09-27",
        "remittance_information": ["TFI ANA CAROLINA FERR"],
        "transaction_id": None,
        "entry_reference": "1742",
    }
    return {**base, **overrides}


# --- _valor_com_sinal ---


def test_valor_com_sinal_credito_e_positivo():
    assert _valor_com_sinal(_transacao(credit_debit_indicator="CRDT")) == Decimal("9.00")


def test_valor_com_sinal_debito_e_negativo():
    assert _valor_com_sinal(_transacao(credit_debit_indicator="DBIT")) == Decimal("-9.00")


def test_valor_com_sinal_preserva_casas_decimais():
    valor = _valor_com_sinal(
        _transacao(
            transaction_amount={"currency": "EUR", "amount": "11.83"},
            credit_debit_indicator="DBIT",
        )
    )
    assert valor == Decimal("-11.83")


# --- _descricao ---


def test_descricao_junta_varias_linhas():
    texto = _descricao(_transacao(remittance_information=["Linha 1", "Linha 2"]))
    assert texto == "Linha 1 Linha 2"


def test_descricao_sem_remittance_information_usa_texto_generico():
    transacao = _transacao()
    del transacao["remittance_information"]
    assert _descricao(transacao) == "Movimento importado (Open Banking)"


def test_descricao_com_lista_vazia_usa_texto_generico():
    assert _descricao(_transacao(remittance_information=[])) == "Movimento importado (Open Banking)"


def test_descricao_com_apenas_espacos_usa_texto_generico():
    assert _descricao(_transacao(remittance_information=["   "])) == "Movimento importado (Open Banking)"


def test_descricao_e_cortada_a_200_caracteres():
    texto_longo = "A" * 250
    assert len(_descricao(_transacao(remittance_information=[texto_longo]))) == 200


# --- _id_externo ---


def test_id_externo_usa_transaction_id_quando_presente():
    transacao = _transacao(transaction_id="abc-123", entry_reference="1742")
    assert _id_externo(transacao) == "abc-123"


def test_id_externo_usa_entry_reference_quando_transaction_id_e_none():
    # O caso real confirmado com a CGD: transaction_id vem sempre None.
    transacao = _transacao(transaction_id=None, entry_reference="1742")
    assert _id_externo(transacao) == "1742"


def test_id_externo_e_none_quando_os_dois_faltam():
    transacao = _transacao(transaction_id=None, entry_reference=None)
    assert _id_externo(transacao) is None


# --- _esta_confirmada ---


def test_esta_confirmada_true_para_status_book():
    assert _esta_confirmada(_transacao(status="BOOK")) is True


def test_esta_confirmada_false_para_outro_status():
    assert _esta_confirmada(_transacao(status="PDNG")) is False


def test_esta_confirmada_false_quando_status_ausente():
    transacao = _transacao()
    del transacao["status"]
    assert _esta_confirmada(transacao) is False
