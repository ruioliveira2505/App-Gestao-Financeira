"""
TESTES DO TRATAMENTO DE ERROS DE app/services/enable_banking.py
==================================================================

Cobrem a função _pedido — o único ponto desse ficheiro que fala com a
rede, por onde passam todos os pedidos à Enable Banking (o intermediário
de Open Banking usado por esta aplicação). O objectivo é confirmar que
cada tipo de falha vira um ERRO DE DOMÍNIO (um erro da lógica de negócio,
com uma mensagem pronta para o utilizador e o código HTTP certo), e nunca
um "500 Internal Server Error" genérico — o problema real que motivou
esta função (o banco demorou mais do que o tempo limite, e a excepção do
httpx escapou sem tratamento). Confirma também que o código e o texto de
erro do banco NUNCA chegam ao utilizador: um 401 do banco chegava ao
frontend como se a sessão da aplicação tivesse terminado.

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

from app.core.erros import AutorizacaoTerminadaNoBanco, BancoIndisponivel, BancoLento, InexistenteNoBanco

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

    with pytest.raises(BancoLento) as erro:
        await enable_banking._pedido("GET", "/accounts/uid-1/balances")

    assert erro.value.estado_http == 504
    assert "demorou demasiado" in erro.value.mensagem


@pytest.mark.asyncio
async def test_pedido_com_falha_de_rede_devolve_502(monkeypatch):
    def responder(pedido):
        raise httpx.ConnectError("ligação recusada", request=pedido)

    _simular_rede(monkeypatch, responder)

    with pytest.raises(BancoIndisponivel) as erro:
        await enable_banking._pedido("GET", "/aspsps")

    assert erro.value.estado_http == 502


@pytest.mark.asyncio
async def test_pedido_com_erro_da_enable_banking_nunca_passa_o_codigo_nem_o_texto(monkeypatch):
    """
    Um 401 da Enable Banking quer dizer "esta sessão bancária não é
    válida", NÃO "a tua sessão na aplicação terminou". Passá-lo tal e qual
    ao frontend tirava o utilizador da aplicação. Vira um 502 com uma
    mensagem nossa, e o texto do banco (em inglês, com detalhes internos)
    não aparece.
    """

    def responder(pedido):
        return httpx.Response(401, json={"error": "UNAUTHORIZED", "message": "Bad JWT"})

    _simular_rede(monkeypatch, responder)

    with pytest.raises(BancoIndisponivel) as erro:
        await enable_banking._pedido("GET", "/accounts/uid-1/transactions")

    assert erro.value.estado_http == 502
    assert "Bad JWT" not in erro.value.mensagem


@pytest.mark.asyncio
async def test_pedido_com_sessao_expirada_e_autorizacao_terminada(monkeypatch):
    """
    EXPIRED_SESSION (visto ao vivo: a autorização expirou ou foi revogada
    no banco antes do prazo) é um caso à parte: a solução é renovar a
    autorização, não tentar outra vez. Vira um 409 próprio.
    """

    def responder(pedido):
        return httpx.Response(401, json={"error": "EXPIRED_SESSION", "message": "Session expired"})

    _simular_rede(monkeypatch, responder)

    with pytest.raises(AutorizacaoTerminadaNoBanco) as erro:
        await enable_banking._pedido("GET", "/accounts/uid-1/transactions")

    assert erro.value.estado_http == 409
    assert "autorizá-lo outra vez" in erro.value.mensagem


@pytest.mark.asyncio
async def test_pedido_com_erro_sem_json_e_banco_indisponivel(monkeypatch):
    """Um corpo de erro que não é JSON (ex.: uma página de erro HTML) não pode rebentar a classificação."""

    def responder(pedido):
        return httpx.Response(503, text="<html>Service Unavailable</html>")

    _simular_rede(monkeypatch, responder)

    with pytest.raises(BancoIndisponivel):
        await enable_banking._pedido("GET", "/aspsps")


@pytest.mark.parametrize(
    "corpo",
    [
        {"json": ["x"]},  # uma lista em vez de um objeto
        {"json": {}},  # um objeto sem "error"
        {"json": {"error": None}},
        {"json": {"error": ["EXPIRED_SESSION"]}},  # "error" que não é texto
        {"json": {"error": {"code": "X"}}},
        {"json": None},  # o corpo é o JSON "null"
        {"content": b""},  # corpo vazio
    ],
)
@pytest.mark.asyncio
async def test_pedido_com_corpo_de_erro_estranho_e_banco_indisponivel(monkeypatch, corpo):
    """
    A classificação nunca pode rebentar com um erro inesperado (que
    chegaria ao utilizador como um "500" genérico) por causa da forma do
    corpo: só um campo "error" de TEXTO conta como código de erro.
    """

    def responder(pedido):
        return httpx.Response(400, **corpo)

    _simular_rede(monkeypatch, responder)

    with pytest.raises(BancoIndisponivel):
        await enable_banking._pedido("GET", "/aspsps")


@pytest.mark.asyncio
async def test_pedido_com_limite_diario_atingido_diz_para_tentar_amanha(monkeypatch):
    """
    429 ("Too Many Requests") quer dizer que o limite diário de acessos da
    PSD2 foi atingido. A mensagem diz isso, para o utilizador não repetir
    e gastar ainda mais acessos.
    """

    def responder(pedido):
        return httpx.Response(429, json={"error": "TOO_MANY_REQUESTS"})

    _simular_rede(monkeypatch, responder)

    with pytest.raises(BancoIndisponivel) as erro:
        await enable_banking._pedido("GET", "/accounts/uid-1/transactions")

    assert "amanhã" in erro.value.mensagem


@pytest.mark.asyncio
async def test_registo_do_erro_nao_guarda_o_corpo_nem_quebras_de_linha(monkeypatch, caplog):
    """
    O registo do servidor guarda o código HTTP, o código de erro e a
    mensagem do banco numa só linha — nunca o corpo inteiro (que pode
    repetir parâmetros do pedido, como o código de uma autenticação).
    "caplog" é uma ferramenta do pytest que apanha o que é registado
    durante o teste.
    """

    def responder(pedido):
        return httpx.Response(
            422,
            json={"error": "WRONG_REQUEST", "message": "linha um\nlinha dois", "code": "segredo-123"},
        )

    _simular_rede(monkeypatch, responder)

    with pytest.raises(BancoIndisponivel):
        await enable_banking._pedido("POST", "/sessions")

    registado = caplog.text
    assert "WRONG_REQUEST" in registado
    assert "linha um linha dois" in registado
    assert "segredo-123" not in registado


@pytest.mark.asyncio
async def test_revogar_uma_sessao_que_ja_nao_existe_conta_como_feito(monkeypatch):
    """
    Revogar é terminar a sessão no banco: se ela já não existir (404), ou já
    tiver terminado no banco, o objetivo está cumprido — não é um erro.
    """
    pedidos = []

    def responder(pedido):
        pedidos.append((pedido.method, str(pedido.url)))
        return httpx.Response(404, json={"error": "SESSION_NOT_FOUND"})

    _simular_rede(monkeypatch, responder)

    await enable_banking.revogar_sessao("sessao-1")

    assert pedidos == [("DELETE", "https://api.enablebanking.com/sessions/sessao-1")]


@pytest.mark.asyncio
async def test_revogar_com_o_servico_em_baixo_e_um_erro(monkeypatch):
    def responder(pedido):
        return httpx.Response(500, text="erro interno")

    _simular_rede(monkeypatch, responder)

    with pytest.raises(BancoIndisponivel):
        await enable_banking.revogar_sessao("sessao-1")


@pytest.mark.parametrize(
    ("estado", "corpo", "esperado"),
    [
        # Só este código diz "a conta já não existe": a conta fica indisponível.
        (404, {"error": "ACCOUNT_NOT_FOUND"}, InexistenteNoBanco),
        # Uma sessão que já não existe é uma autorização terminada.
        (404, {"error": "SESSION_NOT_FOUND"}, AutorizacaoTerminadaNoBanco),
        # Um 404 sem esse código (um endereço errado, um intermediário de
        # rede com problemas) é uma falha passageira: nunca suspende nada.
        (404, {"error": "NOT_FOUND"}, BancoIndisponivel),
        (404, {}, BancoIndisponivel),
    ],
)
@pytest.mark.asyncio
async def test_classificacao_de_nao_encontrado(monkeypatch, estado, corpo, esperado):
    def responder(pedido):
        return httpx.Response(estado, json=corpo)

    _simular_rede(monkeypatch, responder)

    with pytest.raises(esperado) as erro:
        await enable_banking._pedido("GET", "/accounts/uid-1/transactions")

    # type() e não isinstance(): InexistenteNoBanco também é um
    # BancoIndisponivel, e aqui interessa a classe exata.
    assert type(erro.value) is esperado
