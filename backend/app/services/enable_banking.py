"""
CLIENTE DA API DA ENABLE BANKING
===================================

Este ficheiro reúne a lógica de comunicação com a Enable Banking
(enablebanking.com) — o intermediário regulado, ao abrigo da directiva
europeia PSD2, escolhido para a integração de Open Banking desta
aplicação (importação de contas e movimentos bancários reais). "PSD2" é
a directiva que obriga os bancos a expor os dados de uma conta, mediante
consentimento explícito do seu dono, a aplicações terceiras autorizadas
como esta; um "ASPSP" ("Account Servicing Payment Service Provider") é o
nome técnico, usado pela API, para um banco em concreto.

AUTENTICAÇÃO DOS PEDIDOS — NÃO é uma simples chave de API enviada tal e
qual. Cada pedido a esta API tem de vir acompanhado de um JWT ("JSON Web
Token" — um bloco de texto com três partes, separadas por pontos: um
cabeçalho, um conteúdo, e uma assinatura) assinado com a chave privada
RSA gerada no registo desta aplicação no painel da Enable Banking. A
Enable Banking guarda a chave PÚBLICA correspondente; ao receber um
pedido, verifica com ela que a assinatura só podia ter sido produzida por
quem tem a chave privada — ou seja, por esta aplicação. RS256 é o nome do
algoritmo de assinatura usado (RSA + SHA-256).

Esta foi a primeira vez que este projecto assinou um JWT e fez um pedido
real a um serviço externo deste tipo — por isso, a primeira função escrita
aqui (listar_bancos) foi deliberadamente uma chamada sem qualquer efeito
secundário (só lê uma lista pública de bancos suportados), para confirmar
que a assinatura estava correcta e era aceite, ANTES de avançar para o
pedido que desencadeia uma autenticação bancária real. Esse pedido
(POST /auth) já está implementado, mais abaixo — ver iniciar_autorizacao
— e usado a sério por app/routers/open_banking.py; listar_bancos alimenta
a lista de bancos que o utilizador vê na aplicação.
"""

import logging
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

# contextvars guarda um valor "do pedido em curso" (aqui, os dados do
# utilizador presente), visível em todas as funções chamadas a partir dele
# sem ter de ser passado de mão em mão — e separado entre pedidos que
# correm ao mesmo tempo. ipaddress sabe se um IP é local ou público.
import ipaddress
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from contextvars import ContextVar

# httpx é o cliente HTTP já usado neste projecto (é dependência do
# FastAPI para os seus próprios testes) — reaproveitado aqui para fazer
# pedidos a um serviço externo, agora pela primeira vez fora de testes.
import httpx

# PyJWT é a biblioteca que sabe construir e assinar um JWT a partir de um
# dicionário de dados (o "payload") e uma chave privada. Só é usada aqui,
# não é uma dependência do resto da aplicação.
import jwt

from app.core.config import settings
from app.core.erros import (
    AutorizacaoTerminadaNoBanco,
    BancoIndisponivel,
    BancoLento,
    InexistenteNoBanco,
    LimiteDoBanco,
)

# O registo (log) deste ficheiro: mensagens para quem opera o servidor, não
# para o utilizador. logging.getLogger(__name__) cria um registo com o nome
# deste módulo ("app.services.enable_banking"), o que permite filtrar as
# mensagens por origem.
_registo = logging.getLogger(__name__)

# Os códigos de erro da Enable Banking (campo "error" do corpo de uma
# resposta de erro) que querem dizer "esta autorização já não é válida".
# EXPIRED_SESSION foi visto ao vivo: chega quando a sessão expirou ou foi
# revogada no banco antes do prazo previsto. Uma sessão que já não existe
# (SESSION_NOT_FOUND) é o mesmo caso: a autorização inteira terminou.
_ERROS_AUTORIZACAO_TERMINADA = {
    "EXPIRED_SESSION",
    "REVOKED_SESSION",
    "CLOSED_SESSION",
    "SESSION_NOT_FOUND",
}

# O código de erro que quer dizer "esta conta já não existe no banco" (deixou
# de ser partilhada, ou foi fechada). Só este, e com o código exato: a
# consequência é permanente (a conta bancária fica indisponível, e a Conta
# que ela alimentava fica suspensa). Um 404 ("Not Found") sem este código
# (um endereço errado, um intermediário de rede com problemas) é tratado
# como uma falha passageira, para nunca suspender uma conta por engano.
_ERRO_CONTA_INEXISTENTE = "ACCOUNT_NOT_FOUND"

# URL base da API da Enable Banking em produção (existe também um
# "api.tilisy.com", mas está marcado como obsoleto na documentação
# deles — usa-se sempre este).
_URL_BASE = "https://api.enablebanking.com"

# Quanto tempo esperar por cada pedido à Enable Banking. Sem isto, o httpx
# usa 5 segundos por omissão — e um banco real pode demorar mais do que
# isso (confirmado ao vivo com o Santander Totta: o pedido de saldos
# excedeu os 5 segundos na primeira tentativa e respondeu a tempo na
# segunda). "connect" é o limite só para ESTABELECER a ligação (se nem
# isso acontece em 10 segundos, o serviço está provavelmente em baixo);
# o primeiro valor, 30 segundos, aplica-se a cada uma das restantes fases
# — sobretudo esperar pela resposta, que é o que um banco lento atrasa,
# e que pode ser maior ao pedir histórico longo (estratégia "longest",
# ver obter_movimentos, abaixo).
_TEMPO_LIMITE = httpx.Timeout(30.0, connect=10.0)


# --- O UTILIZADOR PRESENTE (cabeçalhos PSU) ---
#
# A PSD2 (a diretiva europeia dos pagamentos) limita a 4 por dia os acessos
# a uma conta SEM o utilizador presente — por conta, por tipo de pedido e
# por consentimento. Esse limite NÃO se aplica quando é o próprio
# utilizador (o "PSU", Payment Service User) a pedir, desde que o pedido o
# identifique: a Enable Banking aceita, nos pedidos às contas (saldos e
# movimentos), cabeçalhos "Psu-*" com o IP e o navegador dele.
#
# As rotas em que o utilizador age (sincronizar, criar uma conta a partir
# do banco, vincular) marcam o pedido com com_o_utilizador_presente(...); a
# partir daí, todos os pedidos às contas feitos nesse pedido levam os
# cabeçalhos. Fora disso (uma futura sincronização automática), não levam:
# aí o utilizador não está mesmo presente.
#
# "Ou todos, ou nenhum": cada banco exige um conjunto de cabeçalhos PSU, e
# se faltar algum a Enable Banking recusa o pedido (PSU_HEADER_NOT_PROVIDED)
# antes de chegar ao banco. Nesse caso repete-se uma vez sem eles (ver
# _pedido) — funciona como antes, e não gasta um acesso a mais.

# Os dados do utilizador presente, no pedido em curso (None: não está).
_utilizador_presente: ContextVar[dict | None] = ContextVar("utilizador_presente", default=None)

# Os cabeçalhos do navegador que se passam ao banco, com o nome PSU.
_CABECALHOS_DO_NAVEGADOR = {
    "user-agent": "Psu-User-Agent",
    "accept": "Psu-Accept",
    "accept-language": "Psu-Accept-Language",
    "accept-encoding": "Psu-Accept-Encoding",
    "referer": "Psu-Referer",
}


@contextmanager
def com_o_utilizador_presente(pedido) -> Iterator[None]:
    """
    Marca o pedido em curso como feito COM o utilizador presente: dentro
    deste bloco "with", os pedidos às contas levam os cabeçalhos PSU, com o
    IP e o navegador de quem fez "pedido" (o Request do FastAPI). O IP é o
    que o servidor vê (request.client.host): atrás de um proxy de confiança
    (o do Vite, em desenvolvimento), o uvicorn já o troca pelo verdadeiro,
    lido do cabeçalho X-Forwarded-For.
    """
    dados = {"ip": pedido.client.host if pedido.client else None}
    for nome, nome_psu in _CABECALHOS_DO_NAVEGADOR.items():
        valor = pedido.headers.get(nome)
        if valor:
            dados[nome_psu] = valor
    marca = _utilizador_presente.set(dados)
    try:
        yield
    finally:
        _utilizador_presente.reset(marca)


def utilizador_presente() -> bool:
    """Se o pedido em curso foi marcado como feito com o utilizador presente."""
    return _utilizador_presente.get() is not None


def _ip_do_utilizador(ip: str | None, ip_publico: Callable[[], str | None]) -> str | None:
    """
    O IP a dar ao banco como o do utilizador. Um IPv4 escrito à maneira do
    IPv6 ("::ffff:85.240.10.20") volta à forma normal (há bancos que só
    aceitam IPv4). Um IP LOCAL (o próprio computador, 127.0.0.1, ou a rede
    de casa, 192.168.…) não diz nada ao banco: em desenvolvimento, o
    servidor corre na máquina do utilizador, por isso o IP público da rede
    ("ip_publico") é o dele. Sem forma de o saber, None (e o pedido segue
    sem cabeçalhos PSU, como antes).
    """
    if not ip:
        return None
    try:
        endereco = ipaddress.ip_address(ip)
    except ValueError:
        return None
    if isinstance(endereco, ipaddress.IPv6Address) and endereco.ipv4_mapped:
        endereco = endereco.ipv4_mapped
    if endereco.is_global:
        return str(endereco)
    return ip_publico()


# O IP público da rede onde corre o servidor, descoberto uma vez (só usado
# quando o IP do utilizador é local, em desenvolvimento).
_ip_publico_da_rede: str | None = None


async def _descobrir_ip_publico() -> str | None:
    """
    Pergunta a um serviço público (ipify) o IP público desta rede, uma vez
    por arranque do servidor. Se falhar, None: os pedidos seguem sem
    cabeçalhos PSU.
    """
    global _ip_publico_da_rede
    if _ip_publico_da_rede is None:
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(5.0)) as cliente:
                resposta = await cliente.get("https://api.ipify.org", params={"format": "json"})
                _ip_publico_da_rede = resposta.json().get("ip")
        except (httpx.HTTPError, ValueError):
            _registo.info("Não foi possível descobrir o IP público: pedidos sem cabeçalhos PSU.")
            return None
    return _ip_publico_da_rede


async def _cabecalhos_psu(caminho: str) -> dict[str, str]:
    """
    Os cabeçalhos PSU a juntar a um pedido: só nos pedidos às contas
    ("/accounts/…"), só com o utilizador presente, e só se se souber o IP
    dele (sem IP, nenhum — «ou todos, ou nenhum»).
    """
    dados = _utilizador_presente.get()
    if dados is None or not caminho.startswith("/accounts/"):
        return {}
    ip_bruto = dados.get("ip")
    publico = None
    if ip_bruto:
        try:
            local = not ipaddress.ip_address(ip_bruto).is_global
        except ValueError:
            local = False
        if local:
            publico = await _descobrir_ip_publico()
    ip = _ip_do_utilizador(ip_bruto, lambda: publico)
    if ip is None:
        return {}
    return {"Psu-Ip-Address": ip, **{nome: valor for nome, valor in dados.items() if nome != "ip"}}


async def _pedido(metodo: str, caminho: str, **opcoes) -> httpx.Response:
    """
    Faz UM pedido à Enable Banking (ver _enviar, abaixo), com os cabeçalhos
    PSU quando o utilizador está presente (ver «O UTILIZADOR PRESENTE»,
    acima). Se a Enable Banking os recusar (um erro "PSU_…": o banco exige
    um cabeçalho que não temos), repete uma vez SEM eles: essa recusa
    acontece antes de chegar ao banco, por isso não gasta um acesso.
    """
    psu = await _cabecalhos_psu(caminho)
    if not psu:
        return await _enviar(metodo, caminho, {}, **opcoes)
    _registo.info("Pedido ao banco com o utilizador presente (cabeçalhos PSU): %s %s", metodo, caminho)
    try:
        return await _enviar(metodo, caminho, psu, **opcoes)
    except _RecusaPsu as recusa:
        _registo.warning(
            "A Enable Banking recusou os cabeçalhos PSU (%s); repete-se sem eles: %s %s",
            recusa.codigo, metodo, caminho,
        )
        return await _enviar(metodo, caminho, {}, **opcoes)


class _RecusaPsu(Exception):
    """A Enable Banking recusou os cabeçalhos PSU (um erro "PSU_…")."""

    def __init__(self, codigo: str) -> None:
        super().__init__(codigo)
        self.codigo = codigo


async def _enviar(metodo: str, caminho: str, psu: dict[str, str], **opcoes) -> httpx.Response:
    """
    Faz UM pedido à API da Enable Banking — o único sítio deste ficheiro
    que fala com a rede. Todas as funções públicas abaixo passam por aqui,
    o que garante que todas têm o mesmo tempo limite, a mesma autenticação
    e o mesmo tratamento de erros.

    Assina um JWT novo (ver _gerar_jwt, abaixo) e envia-o no cabeçalho
    "Authorization". "opcoes" são passadas tal e qual ao httpx (ex.:
    "params" para a query string, "json" para o corpo do pedido).

    TRATAMENTO DE ERROS — cada falha vira um erro de domínio (os erros da
    lógica de negócio da aplicação, com uma mensagem pronta para o
    utilizador, que a API traduz no código HTTP certo), para quem usa a
    aplicação ver sempre uma razão concreta, nunca um "500 Internal Server
    Error" genérico:
    - O banco demora demasiado (httpx.TimeoutException) → BancoLento
      (504 "Gateway Timeout": um serviço de que dependemos não respondeu a
      tempo).
    - Outra falha de rede (httpx.HTTPError: ligação recusada, nome do
      servidor desconhecido…) → BancoIndisponivel (502 "Bad Gateway": um
      serviço de que dependemos falhou).
    - A Enable Banking responde com um erro (código >= 400) → ver
      _erro_da_resposta, abaixo.

    Repetir o pedido automaticamente, em caso de falha, foi deliberadamente
    evitado: a PSD2 limita o número de acessos que uma aplicação faz a uma
    conta sem o utilizador presente (4 por dia, no caso da CGD), e
    repetições silenciosas gastariam essa quota. Quem decide repetir é o
    utilizador, a partir do ecrã de erro.
    """
    token = _gerar_jwt()

    try:
        async with httpx.AsyncClient(timeout=_TEMPO_LIMITE) as cliente:
            resposta = await cliente.request(
                metodo,
                f"{_URL_BASE}{caminho}",
                headers={"Authorization": f"Bearer {token}", **psu},
                **opcoes,
            )
    # A ordem importa: TimeoutException é um caso particular de HTTPError,
    # por isso tem de ser apanhada primeiro — senão nunca chegava aqui.
    except httpx.TimeoutException:
        raise BancoLento("O banco demorou demasiado a responder. Tenta outra vez.")
    except httpx.HTTPError:
        raise BancoIndisponivel(
            "Não foi possível contactar o serviço de Open Banking. Tenta outra vez."
        )

    if resposta.status_code >= 400:
        # Uma recusa dos cabeçalhos PSU (só quando se mandaram): quem chama
        # repete sem eles. Qualquer outro erro segue o caminho de sempre.
        if psu:
            codigo = _codigo_de_erro(resposta)
            if codigo and codigo.startswith("PSU_"):
                raise _RecusaPsu(codigo)
        raise _erro_da_resposta(resposta)

    return resposta


def _codigo_de_erro(resposta: httpx.Response) -> str | None:
    """O código de erro da Enable Banking ("error"), se houver e for texto."""
    try:
        corpo = resposta.json()
    except ValueError:
        return None
    codigo = corpo.get("error") if isinstance(corpo, dict) else None
    return codigo if isinstance(codigo, str) else None


def _erro_da_resposta(
    resposta: httpx.Response,
) -> AutorizacaoTerminadaNoBanco | InexistenteNoBanco | LimiteDoBanco | BancoIndisponivel:
    """
    O erro de domínio que corresponde a uma resposta de erro da Enable
    Banking.

    NUNCA SE PASSA AO UTILIZADOR O CÓDIGO NEM O TEXTO DO BANCO. O código
    HTTP da Enable Banking não é o desta aplicação: um 401 vindo de lá quer
    dizer "esta sessão bancária não é válida", e se chegasse ao frontend
    tal e qual pareceria que a SESSÃO DA APLICAÇÃO tinha terminado. O
    texto do banco também não é para o utilizador: vem em inglês, com
    detalhes internos do fornecedor.

    Por isso o erro é CLASSIFICADO:
      - um código de "autorização terminada" (ver
        _ERROS_AUTORIZACAO_TERMINADA, no topo) → AutorizacaoTerminadaNoBanco
        (409): a autorização já não é válida e é preciso autorizar outra vez;
      - um código de "já não existe" (ver _ERROS_INEXISTENTE, no topo), ou o
        código HTTP 404 → InexistenteNoBanco (502, se ninguém o tratar):
        uma conta que deixou de ser partilhada, ou uma sessão que já não
        existe;
      - o código HTTP 429 ("Too Many Requests", demasiados pedidos) → o
        limite diário de acessos que a PSD2 permite a uma conta foi
        atingido → LimiteDoBanco (429). É dito ao utilizador, para não
        tentar repetidamente e gastar ainda mais acessos;
      - qualquer outro → BancoIndisponivel (502): o banco recusou ou falhou.

    O CORPO DA RESPOSTA PODE TER QUALQUER FORMA: um objeto JSON com o campo
    "error", mas também uma lista, um "error" que não é texto, um corpo
    vazio, ou uma página HTML de um servidor intermédio. Só um "error" de
    texto conta como código; tudo o resto fica sem código, e a resposta
    nunca rebenta com um erro inesperado.

    O REGISTO do servidor (para quem o opera diagnosticar) guarda só o
    código HTTP, o código de erro e a mensagem do banco, curta e numa só
    linha. Não guarda o corpo inteiro: uma resposta de erro pode repetir
    parâmetros do pedido (por exemplo, o código de uma autenticação), e
    uma quebra de linha no meio permitiria forjar linhas falsas no registo.
    """
    try:
        corpo = resposta.json()
    except ValueError:
        # O corpo não é JSON (ex.: uma página de erro de um servidor
        # intermédio), ou está vazio: fica sem código de erro.
        corpo = None
    if not isinstance(corpo, dict):
        corpo = {}
    codigo = corpo.get("error")
    if not isinstance(codigo, str):
        codigo = None
    mensagem = corpo.get("message")
    mensagem = mensagem if isinstance(mensagem, str) else ""
    # Só caracteres que se veem: as quebras de linha passam a espaços.
    mensagem = " ".join(mensagem.split())[:200]

    _registo.warning(
        "Enable Banking respondeu %s (%s): %s", resposta.status_code, codigo, mensagem
    )

    if codigo in _ERROS_AUTORIZACAO_TERMINADA:
        return AutorizacaoTerminadaNoBanco(
            "A autorização deste banco já terminou. É preciso autorizá-lo outra vez."
        )
    if codigo == _ERRO_CONTA_INEXISTENTE:
        return InexistenteNoBanco("O banco já não tem esta conta.")
    if resposta.status_code == 429:
        return LimiteDoBanco(
            "Atingiste o limite de acessos que o banco permite por dia. Tenta outra vez amanhã."
        )
    return BancoIndisponivel("O banco não aceitou o pedido. Tenta outra vez mais tarde.")


def _gerar_jwt() -> str:
    """
    Constrói e assina um JWT novo, válido por uma hora, para autenticar
    UM pedido à API da Enable Banking.

    Um JWT novo por pedido (em vez de reutilizar um já assinado) evita ter
    de gerir a sua expiração explicitamente — cada chamada simplesmente
    assina um token fresco, válido tempo mais do que suficiente para essa
    chamada terminar. A documentação da Enable Banking permite até 24
    horas de validade; uma hora é uma margem generosa para um pedido
    individual, sem deixar um token válido "à solta" por mais tempo do
    que o necessário.
    """
    # A chave privada é lida do ficheiro .pem indicado em
    # ENABLE_BANKING_PRIVATE_KEY_PATH (ver app/core/config.py) — o mesmo
    # ficheiro descarregado no registo desta aplicação no painel da
    # Enable Banking, nunca commitado ao repositório.
    chave_privada = Path(settings.enable_banking_private_key_path).read_text()

    agora = int(time.time())

    # "iss" (issuer) e "aud" (audience) têm valores fixos, definidos pela
    # própria Enable Banking na sua documentação — não são o ID desta
    # aplicação, mas sim identificadores fixos da plataforma. "iat"
    # (issued at) e "exp" (expiration) são timestamps Unix (segundos
    # desde 1 de Janeiro de 1970).
    payload = {
        "iss": "enablebanking.com",
        "aud": "api.enablebanking.com",
        "iat": agora,
        "exp": agora + 3600,
    }

    # "kid" (key id) vai no CABEÇALHO do JWT (não no payload) — é como a
    # Enable Banking sabe, ao verificar a assinatura, qual das chaves
    # públicas registadas usar (a desta aplicação em concreto).
    cabecalho = {"kid": settings.enable_banking_application_id}

    return jwt.encode(payload, chave_privada, algorithm="RS256", headers=cabecalho)


# O prazo máximo de um consentimento de acesso a informação de contas:
# 180 dias, pela regra europeia em vigor desde 25 de julho de 2023
# (Regulamento Delegado (UE) 2022/2360, que alargou os 90 dias iniciais).
_VALIDADE_MAXIMA = timedelta(days=180)

# Quando o banco não diz o seu máximo: 90 dias, o prazo que todos aceitam.
_VALIDADE_SEGURA = timedelta(days=90)

# Folga tirada ao máximo do banco: a Enable Banking recusa um prazo que
# passe "agora + máximo" — e o "agora" deles é uns instantes depois do
# nosso, quando o pedido lá chega.
_FOLGA = timedelta(minutes=5)


def validade_do_consentimento(banco: dict) -> timedelta:
    """
    O prazo a pedir para o consentimento junto de um banco: o máximo que
    ESSE banco aceita ("maximum_consent_validity", em segundos, na lista
    de bancos da Enable Banking — varia: alguns aceitam 180 dias, outros
    só 90), nunca acima dos 180 dias da regra europeia. Sem essa
    informação, 90 dias (aceite por todos).

    Pedir o máximo poupa ao utilizador metade das renovações (voltar ao
    site do banco para autorizar outra vez), dentro do que a lei permite.
    """
    segundos = banco.get("maximum_consent_validity")
    # Só se aceita um número (inteiro ou decimal, ex.: 15552000.0). Em
    # Python, True e False também contam como inteiros (bool é um tipo
    # derivado de int), por isso são excluídos à parte: um "true" vindo do
    # banco não é um prazo.
    if isinstance(segundos, bool) or not isinstance(segundos, (int, float)):
        return _VALIDADE_SEGURA
    validade = timedelta(seconds=segundos) - _FOLGA
    # Um valor zero, negativo, ou mais curto do que a folga daria um prazo
    # nulo ou já no passado: nesses casos, usa-se o prazo seguro.
    if validade <= timedelta(0):
        return _VALIDADE_SEGURA
    return min(validade, _VALIDADE_MAXIMA)


def dias_de_validade(banco: dict) -> int:
    """
    O mesmo prazo de validade_do_consentimento, em dias inteiros, para
    mostrar ao utilizador (o ecrã de permissões, no frontend: "Duração:
    180 dias"). Arredonda para cima: a folga de minutos não deve fazer
    "180 dias" aparecer como "179".
    """
    validade = validade_do_consentimento(banco)
    # Divisão inteira arredondada para CIMA. O operador "//" arredonda para
    # BAIXO; negando o dividendo, dividindo e negando o resultado obtém-se o
    # arredondamento para cima: -(-x // y) é o menor inteiro >= x / y.
    return -(-validade // timedelta(days=1))


async def listar_bancos(pais: str) -> list[dict]:
    """
    Devolve a lista de bancos (ASPSPs) suportados pela Enable Banking num
    dado país (código ISO 3166 de duas letras, ex.: "PT"). Sem qualquer
    efeito secundário (só lê uma lista pública) — usada pela rota
    "/open-banking/bancos" (app/routers/open_banking.py), que alimenta a
    lista de bancos e o ecrã de permissões no frontend.
    """
    # Autenticação, tempo limite e erros são tratados em _pedido (acima).
    resposta = await _pedido("GET", "/aspsps", params={"country": pais})

    # A resposta da Enable Banking vem embrulhada num objecto com uma
    # única chave, "aspsps" — não é a lista directamente. Desembrulha-se
    # aqui, para quem chamar esta função (e o endpoint que a expõe) lidar
    # sempre com uma lista simples, tal como o nome da função promete.
    return resposta.json()["aspsps"]


async def iniciar_autorizacao(banco: str, pais: str, redirect_url: str, state: str) -> str:
    """
    Inicia, junto de um banco (ASPSP) concreto, um pedido de autorização
    real (POST /auth), e devolve o URL para onde o browser do utilizador
    deve ser enviado para o completar — o ecrã de login e autenticação
    forte (SCA) desse banco.

    AO CONTRÁRIO de listar_bancos, este pedido tem um efeito real do lado
    da Enable Banking: cria um pedido de autorização associado a "state"
    (um valor à nossa escolha, devolvido inalterado no callback final —
    ver a rota "/callback" em app/routers/open_banking.py). Quem chama
    esta função é responsável por gerar um "state" único e por o guardar
    associado ao utilizador que iniciou o pedido (ver
    app/models/autorizacao_pendente.py) — sem isso, o callback final, que
    chega sem qualquer cookie de sessão, não teria forma de saber a quem
    atribuir a autorização resultante.

    "banco" tem de corresponder EXATAMENTE ao campo "name" devolvido
    por listar_bancos (ex.: "BPI", "Millennium BCP") — é assim,
    literalmente pelo nome, que a Enable Banking identifica o banco
    aqui, sem um código à parte.
    """
    # "access.valid_until" é a data até quando o CONSENTIMENTO do
    # utilizador (não o JWT — coisas diferentes) fica válido: o máximo que
    # este banco aceita, até 180 dias (ver validade_do_consentimento,
    # acima). O máximo de cada banco vem na lista de bancos — pede-se aqui
    # outra vez, em vez de confiar num valor enviado pelo browser.
    bancos = await listar_bancos(pais)
    dados_banco = next((b for b in bancos if b.get("name") == banco), {})
    valido_ate = datetime.now(timezone.utc) + validade_do_consentimento(dados_banco)

    corpo = {
        "access": {"valid_until": valido_ate.isoformat()},
        "aspsp": {"name": banco, "country": pais},
        "state": state,
        "redirect_url": redirect_url,
        "psu_type": "personal",
    }

    # Autenticação, tempo limite e erros são tratados em _pedido (acima).
    resposta = await _pedido("POST", "/auth", json=corpo)

    return resposta.json()["url"]


async def trocar_codigo_por_sessao(code: str) -> dict:
    """
    Troca um "code" recebido no callback (depois de o utilizador
    autenticar junto do banco — ver iniciar_autorizacao, acima) por uma
    sessão junto da Enable Banking, através de POST /sessions. A resposta
    inclui um "session_id" (identifica esta autorização para pedidos futuros,
    como consultar saldos e movimentos — ver obter_saldos e
    obter_movimentos, abaixo) e a lista de contas ("accounts") que o
    utilizador autorizou.

    Ao contrário de iniciar_autorizacao, este "code" só pode ser usado UMA
    VEZ — se este pedido falhar por o código já ter sido consumido ou ter
    expirado, a única forma de continuar é repetir o fluxo desde
    "/autorizar" (em app/routers/open_banking.py), para obter um "code" novo.
    """
    # Autenticação, tempo limite e erros são tratados em _pedido (acima).
    resposta = await _pedido("POST", "/sessions", json={"code": code})

    return resposta.json()


async def obter_saldos(uid: str) -> dict:
    """
    Consulta os saldos de uma conta bancária — GET /accounts/{uid}/balances.

    "uid" é o identificador que a Enable Banking atribuiu a esta conta em
    concreto (ver ContaBancaria.uid, em app/models/conta_bancaria.py) — não é
    o IBAN nem o id interno desta aplicação.

    Devolve TODOS os saldos tal como a Enable Banking os der — um banco
    pode devolver mais do que um tipo (ex.: "CLBD", contabilístico, vs.
    "ITAV", disponível agora). Esta função não escolhe qual usar: essa
    decisão (usar sempre "CLBD", ver a nota SALDO-ÂNCORA em
    app/services/importacao_movimentos.py) é feita por quem chama.
    """
    # Autenticação, tempo limite e erros são tratados em _pedido (acima).
    resposta = await _pedido("GET", f"/accounts/{uid}/balances")

    return resposta.json()


async def obter_movimentos(
    uid: str,
    data_de: date | None = None,
    continuation_key: str | None = None,
    estrategia: str | None = None,
) -> dict:
    """
    Consulta UMA PÁGINA das transacções de uma conta bancária — GET
    /accounts/{uid}/transactions. Devolve sempre a resposta tal como a
    Enable Banking a der: {"transactions": [...], "continuation_key":
    <opcional>}. Esta função nunca segue esse "continuation_key" sozinha —
    é uma chamada, uma página; quem quiser TODO o histórico pede-o
    explicitamente, uma página de cada vez (ver _obter_todas_transacoes,
    em app/services/importacao_movimentos.py, que é quem faz esse ciclo).

    "data_de", quando indicada, filtra transacções a partir dessa data
    (inclusive) — corresponde ao parâmetro "date_from" da Enable Banking.

    "continuation_key", quando indicada, pede a página SEGUINTE a uma
    resposta anterior que tenha devolvido esse valor — corresponde ao
    parâmetro do mesmo nome da Enable Banking.

    "estrategia" corresponde ao parâmetro "strategy" da Enable Banking.
    Sem ele (a estratégia por omissão), o banco devolve só o intervalo
    pedido — ou, sem "date_from", o seu intervalo por omissão, normalmente
    os últimos ~90 dias. Com "longest", a API procura a transacção mais
    antiga disponível e traz tudo daí em diante ("date_from" passa a ser só
    o limite inferior sugerido), e nunca devolve o erro
    WRONG_TRANSACTIONS_PERIOD. PORQUÊ ISTO IMPORTA: pela PSD2, o histórico
    com mais de ~90 dias só está disponível durante um curto período depois
    de o utilizador se autenticar no banco — "cerca de uma hora", segundo a
    FAQ da Enable Banking (enablebanking.com/docs/faq) — e "longest" é a
    estratégia que a própria Enable Banking recomenda para a PRIMEIRA
    importação, feita dentro desse período.

    Devolve as transacções tal como a Enable Banking as der, sem
    filtrar nem decidir nada — quem chama é que decide o que fazer com
    elas: a deduplicação (por "transaction_id", ou por "entry_reference"
    quando aquele vem vazio — confirmado, em testes reais com a CGD, que
    acontece sempre), e o filtro por transacções já confirmadas
    ("status": "BOOK") vivem em app/services/importacao_movimentos.py,
    não aqui.
    """
    parametros: dict[str, str] = {}
    if data_de is not None:
        parametros["date_from"] = data_de.isoformat()
    if continuation_key is not None:
        parametros["continuation_key"] = continuation_key
    if estrategia is not None:
        parametros["strategy"] = estrategia

    # Autenticação, tempo limite e erros são tratados em _pedido (acima).
    resposta = await _pedido("GET", f"/accounts/{uid}/transactions", params=parametros)

    return resposta.json()


async def revogar_sessao(session_id: str) -> None:
    """
    Pede à Enable Banking para terminar uma sessão (uma autorização) — DELETE
    /sessions/{session_id}. A partir daí, a aplicação deixa de poder ler as
    contas dessa autorização.

    Se a sessão já não existir, ou já tiver terminado no banco, o objetivo
    está cumprido: não é um erro. Qualquer outra falha (rede, serviço em
    baixo) é lançada, para quem chama decidir o que fazer (na aplicação, a
    autorização continua ativa e o utilizador pode tentar outra vez).
    """
    try:
        await _pedido("DELETE", f"/sessions/{session_id}")
    except (InexistenteNoBanco, AutorizacaoTerminadaNoBanco):
        return
