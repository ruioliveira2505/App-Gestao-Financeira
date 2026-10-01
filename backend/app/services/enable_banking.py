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
— e usado a sério por app/routers/open_banking.py; listar_bancos continua
a servir também para listar bancos a um utilizador real (só falta a
interface no frontend, não a função em si).
"""

import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

# httpx é o cliente HTTP já usado neste projecto (é dependência do
# FastAPI para os seus próprios testes) — reaproveitado aqui para fazer
# pedidos a um serviço externo, agora pela primeira vez fora de testes.
import httpx

# PyJWT é a biblioteca que sabe construir e assinar um JWT a partir de um
# dicionário de dados (o "payload") e uma chave privada. Só é usada aqui,
# não é uma dependência do resto da aplicação.
import jwt
from fastapi import HTTPException

from app.core.config import settings

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


async def _pedido(metodo: str, caminho: str, **opcoes) -> httpx.Response:
    """
    Faz UM pedido à API da Enable Banking — o único sítio deste ficheiro
    que fala com a rede. Todas as funções públicas abaixo passam por aqui,
    o que garante que todas têm o mesmo tempo limite, a mesma autenticação
    e o mesmo tratamento de erros.

    Assina um JWT novo (ver _gerar_jwt, acima) e envia-o no cabeçalho
    "Authorization". "opcoes" são passadas tal e qual ao httpx (ex.:
    "params" para a query string, "json" para o corpo do pedido).

    TRATAMENTO DE ERROS — três casos, todos convertidos numa HTTPException
    (a excepção do FastAPI que se transforma directamente numa resposta
    HTTP com esse código e mensagem), para que quem usa a aplicação veja
    sempre uma razão concreta, nunca um "500 Internal Server Error"
    genérico:
    - O banco demora demasiado (httpx.TimeoutException) → 504 "Gateway
      Timeout", o código HTTP próprio para "um serviço de que dependo não
      respondeu a tempo".
    - Outra falha de rede (httpx.HTTPError — ligação recusada, DNS, etc.)
      → 502 "Bad Gateway", o código para "um serviço de que dependo
      falhou".
    - A Enable Banking responde, mas com um erro (código >= 400) →
      devolve-se esse mesmo código, com o corpo da resposta tal como veio
      — é normalmente uma mensagem específica (ex.: "assinatura inválida",
      "sessão expirada"), muito mais útil para diagnosticar do que uma
      excepção genérica.

    Repetir o pedido automaticamente, em caso de falha, foi deliberadamente
    evitado: o PSD2 limita o número de acessos que uma aplicação faz a uma
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
                headers={"Authorization": f"Bearer {token}"},
                **opcoes,
            )
    # A ordem importa: TimeoutException é um caso particular de HTTPError,
    # por isso tem de ser apanhada primeiro — senão nunca chegava aqui.
    except httpx.TimeoutException:
        raise HTTPException(
            status_code=504,
            detail="O banco demorou demasiado a responder. Tente outra vez.",
        )
    except httpx.HTTPError:
        raise HTTPException(
            status_code=502,
            detail="Não foi possível contactar o serviço de Open Banking. Tente outra vez.",
        )

    if resposta.status_code >= 400:
        raise HTTPException(status_code=resposta.status_code, detail=resposta.text)

    return resposta


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


async def listar_bancos(pais: str) -> list[dict]:
    """
    Devolve a lista de bancos (ASPSPs) suportados pela Enable Banking num
    dado país (código ISO 3166 de duas letras, ex.: "PT"). Sem qualquer
    efeito secundário (só lê uma lista pública) — usada tanto pela rota de
    depuração "/open-banking/bancos" (app/routers/open_banking.py) como,
    no futuro, por um selector de bancos no frontend.
    """
    # Autenticação, tempo limite e erros são tratados em _pedido (acima).
    resposta = await _pedido("GET", "/aspsps", params={"country": pais})

    # A resposta da Enable Banking vem embrulhada num objecto com uma
    # única chave, "aspsps" — não é a lista directamente. Desembrulha-se
    # aqui, para quem chamar esta função (e o endpoint que a expõe) lidar
    # sempre com uma lista simples, tal como o nome da função promete.
    return resposta.json()["aspsps"]


async def iniciar_autorizacao(aspsp_nome: str, aspsp_pais: str, redirect_url: str, state: str) -> str:
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
    atribuir a ligação bancária resultante.

    aspsp_nome tem de corresponder EXACTAMENTE ao campo "name" devolvido
    por listar_bancos (ex.: "BPI", "Millennium BCP") — é assim,
    literalmente pelo nome, que a Enable Banking identifica o banco
    aqui, sem um código à parte.
    """
    # "access.valid_until" é a data até quando o CONSENTIMENTO do
    # utilizador (não o JWT — coisas diferentes) fica válido. 90 dias é o
    # período habitualmente associado ao PSD2 para este tipo de
    # consentimento; alguns bancos permitem mais (ver
    # "maximum_consent_validity" na resposta de listar_bancos, em
    # segundos), mas 90 dias é um valor seguro, aceite por todos.
    valido_ate = datetime.now(timezone.utc) + timedelta(days=90)

    corpo = {
        "access": {"valid_until": valido_ate.isoformat()},
        "aspsp": {"name": aspsp_nome, "country": aspsp_pais},
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
    inclui um "session_id" (identifica esta ligação para pedidos futuros,
    como consultar saldos e movimentos — ver obter_saldos e
    obter_movimentos, abaixo) e a lista de contas ("accounts") que o
    utilizador autorizou.

    Ao contrário de iniciar_autorizacao, este "code" só pode ser usado UMA
    VEZ — se este pedido falhar por o código já ter sido consumido ou ter
    expirado, a única forma de continuar é repetir o fluxo desde
    "/ligar" (em app/routers/open_banking.py), para obter um "code" novo.
    """
    # Autenticação, tempo limite e erros são tratados em _pedido (acima).
    resposta = await _pedido("POST", "/sessions", json={"code": code})

    return resposta.json()


async def obter_saldos(uid: str) -> dict:
    """
    Consulta os saldos de uma conta já ligada — GET /accounts/{uid}/balances.

    "uid" é o identificador que a Enable Banking atribuiu a esta conta em
    concreto (ver ContaLigada.uid, em app/models/conta_ligada.py) — não é
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
    Consulta UMA PÁGINA das transacções de uma conta já ligada — GET
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
    WRONG_TRANSACTIONS_PERIOD. PORQUÊ ISTO IMPORTA: pelo PSD2, o histórico
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
