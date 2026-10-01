"""
TESTES DO TRATAMENTO DE ERROS DE app/services/enable_banking.py
==================================================================

Cobrem a função _pedido — o único ponto desse ficheiro que fala com a
rede, por onde passam todos os pedidos à Enable Banking (o intermediário
de Open Banking usado por esta aplicação). O objectivo é confirmar que
cada tipo de falha chega a quem usa a aplicação como um erro HTTP com uma
razão concreta, e nunca como um "500 Internal Server Error" genérico —
o problema real que motivou esta função (o banco demorou mais do que o
tempo limite, e a excepção do httpx escapou sem tratamento).

Nenhum destes testes faz pedidos reais. Usam duas substituições, feitas
com "monkeypatch" (uma ferramenta do pytest que troca um valor só
durante um teste e o repõe no fim):
- _gerar_jwt passa a devolver um texto fixo, porque o verdadeiro precisa
  da chave privada da aplicação, que não existe no ambiente de testes.
- httpx.AsyncClient passa a ser criado com um "MockTransport" — um
  transporte falso do próprio httpx que, em vez de enviar o pedido pela
  rede, chama uma função nossa que decide a resposta (ou a falha).
"""

import httpx
import pytest
from fastapi import HTTPException

from app.services import enable_banking


def _simular_rede(monkeypatch, responder):
    """
    Faz com que _pedido, durante o teste, receba o que "responder" decidir
    em vez de contactar a Enable Banking. "responder" recebe o pedido
    (httpx.Request) e devolve uma httpx.Response — ou lança uma excepção
    do httpx, para simular uma falha de rede.
    """
    monkeypatch.setattr(enable_banking, "_gerar_jwt", lambda: "jwt-de-teste")

    # Guarda-se a classe verdadeira ANTES de a substituir: a versão falsa
    # cria um cliente verdadeiro, só que com o transporte falso. Sem isto,
    # a versão falsa chamar-se-ia a si própria sem fim.
    cliente_verdadeiro = httpx.AsyncClient

    def cliente_falso(**opcoes):
        return cliente_verdadeiro(transport=httpx.MockTransport(responder), **opcoes)

    monkeypatch.setattr(enable_banking.httpx, "AsyncClient", cliente_falso)


@pytest.mark.asyncio
async def test_pedido_com_resposta_valida_devolve_a_resposta(monkeypatch):
    pedidos = []

    def responder(pedido):
        pedidos.append(pedido)
        return httpx.Response(200, json={"balances": []})

    _simular_rede(monkeypatch, responder)

    resposta = await enable_banking._pedido("GET", "/accounts/uid-1/balances")

    assert resposta.json() == {"balances": []}
    # O JWT segue no cabeçalho, e o caminho é juntado ao URL base.
    assert pedidos[0].headers["Authorization"] == "Bearer jwt-de-teste"
    assert str(pedidos[0].url) == "https://api.enablebanking.com/accounts/uid-1/balances"


@pytest.mark.asyncio
async def test_pedido_que_demora_demasiado_devolve_504(monkeypatch):
    # O caso real que motivou _pedido: o banco não respondeu a tempo.
    def responder(pedido):
        raise httpx.ReadTimeout("demorou demasiado", request=pedido)

    _simular_rede(monkeypatch, responder)

    with pytest.raises(HTTPException) as erro:
        await enable_banking._pedido("GET", "/accounts/uid-1/balances")

    assert erro.value.status_code == 504
    assert "demorou demasiado" in erro.value.detail


@pytest.mark.asyncio
async def test_pedido_com_falha_de_ligacao_devolve_502(monkeypatch):
    def responder(pedido):
        raise httpx.ConnectError("ligação recusada", request=pedido)

    _simular_rede(monkeypatch, responder)

    with pytest.raises(HTTPException) as erro:
        await enable_banking._pedido("GET", "/aspsps")

    assert erro.value.status_code == 502


@pytest.mark.asyncio
async def test_pedido_com_erro_da_enable_banking_mantem_codigo_e_mensagem(monkeypatch):
    def responder(pedido):
        return httpx.Response(401, text="Sessão expirada")

    _simular_rede(monkeypatch, responder)

    with pytest.raises(HTTPException) as erro:
        await enable_banking._pedido("GET", "/accounts/uid-1/transactions")

    assert erro.value.status_code == 401
    assert erro.value.detail == "Sessão expirada"
