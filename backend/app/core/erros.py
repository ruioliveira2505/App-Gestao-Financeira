"""
ERROS DE DOMÍNIO
==================

Os erros que a LÓGICA DE NEGÓCIO da aplicação pode lançar: "esta conta
não existe", "já tens uma conta com este nome", "o banco não respondeu a
tempo"… Cada um traz uma mensagem pronta a mostrar ao utilizador, em
português.

PORQUÊ ERROS PRÓPRIOS, E NÃO OS ERROS HTTP DO FASTAPI. O FastAPI tem a
sua própria exceção, HTTPException, que se transforma diretamente numa
resposta HTTP (um código como 404 e uma mensagem). Usá-la nos serviços
(o código que aplica as regras de negócio) prenderia essas regras à web:
um serviço chamado por outro caminho (um script, uma tarefa agendada, um
teste) teria de saber o que é um "código HTTP". Com erros de domínio, o
serviço diz só O QUE correu mal ("não encontrado", "conflito"); a
tradução para HTTP faz-se num único sítio, à saída (ver
registar_tradutor, abaixo).

A RESPOSTA FICA IGUAL À DE SEMPRE: {"detail": "<mensagem>"}, o mesmo
formato que a HTTPException já produzia. O frontend não nota diferença.

CADA CLASSE DIZ QUE CÓDIGO HTTP LHE CORRESPONDE (estado_http). Os
códigos usados:
  - 400 Bad Request: o pedido viola uma regra de negócio;
  - 403 Forbidden: não é permitido a quem o pediu (ex.: falta confirmar
    com a password certa);
  - 404 Not Found: não existe, ou não é deste utilizador (os dois casos
    juntam-se de propósito, para a resposta não revelar qual se aplica);
  - 409 Conflict: o pedido choca com o estado atual (um nome repetido,
    uma conta bancária já vinculada, uma autorização que já terminou);
  - 422 Unprocessable Content: os dados enviados são inválidos;
  - 502 Bad Gateway: um serviço de que dependemos (o banco) falhou;
  - 504 Gateway Timeout: um serviço de que dependemos não respondeu a
    tempo.
"""

import logging

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError

# O registo (log) deste ficheiro: mensagens para quem opera o servidor.
_registo = logging.getLogger(__name__)


class ErroDeDominio(Exception):
    """A base de todos os erros de domínio: uma mensagem para o utilizador e um código HTTP."""

    # Código HTTP por omissão; cada subclasse define o seu.
    estado_http: int = 400

    def __init__(self, mensagem: str) -> None:
        # super().__init__ guarda a mensagem também como texto da exceção,
        # o que a torna legível em registos e em testes (str(erro)).
        super().__init__(mensagem)
        self.mensagem = mensagem


class RegraViolada(ErroDeDominio):
    """O pedido viola uma regra de negócio (ex.: mudar a moeda de uma conta com movimentos)."""

    estado_http = 400


class Proibido(ErroDeDominio):
    """
    O pedido não é permitido a quem o fez (ex.: apagar a conta com uma
    password errada). 403 Forbidden: a sessão é válida, mas falta a
    confirmação.
    """

    estado_http = 403


class NaoEncontrado(ErroDeDominio):
    """Não existe, ou não pertence a este utilizador."""

    estado_http = 404


class Conflito(ErroDeDominio):
    """O pedido choca com o estado atual (ex.: um nome de conta repetido)."""

    estado_http = 409


class DadosInvalidos(ErroDeDominio):
    """Os dados enviados são inválidos (ex.: um nome só com espaços)."""

    estado_http = 422


class AutorizacaoTerminadaNoBanco(Conflito):
    """
    O banco respondeu que a autorização (o consentimento dado pelo
    utilizador ao banco) já não é válida: expirou, foi revogada no banco,
    ou o banco fechou-a. Pode acontecer antes do prazo previsto, e a
    aplicação só o descobre quando faz um pedido. É um conflito (409) com
    o estado da autorização, não uma falha do banco: a solução é renová-la.
    """


class BancoIndisponivel(ErroDeDominio):
    """O banco (ou a Enable Banking, o intermediário) falhou ou recusou o pedido."""

    estado_http = 502


class InexistenteNoBanco(BancoIndisponivel):
    """
    O banco (ou a Enable Banking) respondeu que aquilo que se pediu já não
    existe: uma conta bancária que deixou de ser partilhada ou foi fechada,
    ou uma sessão que já não existe. É um caso particular de
    BancoIndisponivel (chega ao utilizador como 502, se ninguém o tratar),
    mas quem chama pode apanhá-lo para reagir: marcar a conta bancária como
    indisponível, ou dar como feita a revogação de uma sessão que já não
    existia.
    """


class BancoLento(ErroDeDominio):
    """O banco (ou a Enable Banking) não respondeu dentro do tempo limite."""

    estado_http = 504


def registar_tradutor(app: FastAPI) -> None:
    """
    Ensina a aplicação FastAPI a transformar qualquer ErroDeDominio numa
    resposta HTTP: o código vem de "estado_http" e o corpo é
    {"detail": mensagem}. Chamada uma vez, ao montar a aplicação. Um
    "exception handler" (tradutor de exceções) é uma função que o FastAPI
    chama sempre que uma exceção daquele tipo escapa de uma rota.
    """

    @app.exception_handler(ErroDeDominio)
    async def traduzir(_pedido: Request, erro: ErroDeDominio) -> JSONResponse:
        return JSONResponse(status_code=erro.estado_http, content={"detail": erro.mensagem})

    # UMA REGRA DA BASE DE DADOS RECUSOU A GRAVAÇÃO (IntegrityError: um
    # índice único, uma chave estrangeira, uma restrição CHECK). Os
    # serviços verificam as regras antes de gravar; quando, mesmo assim, a
    # base de dados recusa, quase sempre é porque OUTRO pedido, ao mesmo
    # tempo, gravou algo que choca com este (dois pedidos a vincular a
    # mesma conta bancária, por exemplo). A resposta é um 409 (conflito)
    # com uma mensagem genérica, e não um 500 ("erro interno"): o
    # utilizador pode atualizar e tentar outra vez. O pormenor técnico
    # fica só no registo do servidor, nunca na resposta.
    @app.exception_handler(IntegrityError)
    async def traduzir_integridade(_pedido: Request, erro: IntegrityError) -> JSONResponse:
        _registo.warning("A base de dados recusou uma gravação: %s", erro.orig)
        return JSONResponse(
            status_code=409,
            content={"detail": "Os dados mudaram entretanto. Atualiza a página e tenta outra vez."},
        )
