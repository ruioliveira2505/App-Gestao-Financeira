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
    token = _gerar_jwt()

    async with httpx.AsyncClient() as cliente:
        resposta = await cliente.get(
            f"{_URL_BASE}/aspsps",
            params={"country": pais},
            headers={"Authorization": f"Bearer {token}"},
        )

    # Em vez de deixar o httpx levantar uma excepção genérica num erro,
    # devolve-se o corpo da resposta da Enable Banking tal como veio — é
    # normalmente uma mensagem de erro específica (ex.: "assinatura
    # inválida", "aplicação inactiva"), muito mais útil para diagnosticar
    # um problema nesta fase de testes do que uma excepção genérica sem
    # esse detalhe.
    if resposta.status_code >= 400:
        raise HTTPException(status_code=resposta.status_code, detail=resposta.text)

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
    token = _gerar_jwt()

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

    async with httpx.AsyncClient() as cliente:
        resposta = await cliente.post(
            f"{_URL_BASE}/auth",
            json=corpo,
            headers={"Authorization": f"Bearer {token}"},
        )

    if resposta.status_code >= 400:
        raise HTTPException(status_code=resposta.status_code, detail=resposta.text)

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
    token = _gerar_jwt()

    async with httpx.AsyncClient() as cliente:
        resposta = await cliente.post(
            f"{_URL_BASE}/sessions",
            json={"code": code},
            headers={"Authorization": f"Bearer {token}"},
        )

    if resposta.status_code >= 400:
        raise HTTPException(status_code=resposta.status_code, detail=resposta.text)

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
    token = _gerar_jwt()

    async with httpx.AsyncClient() as cliente:
        resposta = await cliente.get(
            f"{_URL_BASE}/accounts/{uid}/balances",
            headers={"Authorization": f"Bearer {token}"},
        )

    if resposta.status_code >= 400:
        raise HTTPException(status_code=resposta.status_code, detail=resposta.text)

    return resposta.json()


async def obter_movimentos(uid: str, data_de: date | None = None) -> dict:
    """
    Consulta as transacções de uma conta já ligada — GET
    /accounts/{uid}/transactions.

    "data_de", quando indicada, filtra transacções a partir dessa data
    (inclusive) — corresponde ao parâmetro "date_from" da Enable Banking.
    Esta chamada ainda não pagina (a resposta pode incluir um
    "continuation_key" para pedir a página seguinte) — uma limitação
    conhecida e deliberada, documentada em app/services/
    importacao_movimentos.py (nota LIMITAÇÃO CONHECIDA).

    Devolve as transacções tal como a Enable Banking as der, sem
    filtrar nem decidir nada — quem chama é que decide o que fazer com
    elas: a deduplicação (por "transaction_id", ou por "entry_reference"
    quando aquele vem vazio — confirmado, em testes reais com a CGD, que
    acontece sempre), e o filtro por transacções já confirmadas
    ("status": "BOOK") vivem em app/services/importacao_movimentos.py,
    não aqui.
    """
    token = _gerar_jwt()

    parametros: dict[str, str] = {}
    if data_de is not None:
        parametros["date_from"] = data_de.isoformat()

    async with httpx.AsyncClient() as cliente:
        resposta = await cliente.get(
            f"{_URL_BASE}/accounts/{uid}/transactions",
            params=parametros,
            headers={"Authorization": f"Bearer {token}"},
        )

    if resposta.status_code >= 400:
        raise HTTPException(status_code=resposta.status_code, detail=resposta.text)

    return resposta.json()
