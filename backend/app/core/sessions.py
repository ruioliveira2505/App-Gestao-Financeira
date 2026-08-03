"""
SEGURANÇA: TOKENS DE SESSÃO
==============================

Este ficheiro isola tudo o que diz respeito à criação e à verificação de
tokens de sessão — a cadeia de texto aleatória entregue ao browser (num
cookie httpOnly) depois de um login bem-sucedido, e que identifica, em
cada pedido seguinte, qual o utilizador autenticado.

Ao contrário da password (ver app/core/security.py), o token de sessão não
é escolhido por uma pessoa: é gerado aqui por um gerador aleatório
criptográfico, com entropia suficiente para tornar impraticável adivinhá-lo
por força bruta. Por isso, o hash usado para o guardar não precisa de ser
lento nem exigente em memória (como o Argon2id, usado nas passwords) — só
precisa de impedir que, a partir do valor guardado na base de dados, se
reconstrua o token original. Um hash rápido (SHA-256) já garante isso, e é
importante que seja rápido: ao contrário da password, verificada uma única
vez no login, o token de sessão é verificado em todos os pedidos
autenticados.
"""

import hashlib
import secrets
from datetime import timedelta

# Duração da sessão desde o último pedido autenticado — uma "expiração
# deslizante": em vez de a sessão expirar sempre num prazo fixo a partir do
# login, cada pedido válido feito com ela renova expires_at para
# datetime.now(UTC) + SESSION_DURATION (a partir do momento em que existir
# essa renovação — ver a rota "quem sou eu" e as rotas protegidas que se
# seguem a esta). Uma sessão sem qualquer pedido durante este período deixa
# de ser válida, mesmo que o cookie continue a existir no browser; uma
# sessão em uso activo nunca expira a meio dessa utilização.
SESSION_DURATION = timedelta(minutes=30)


def gerar_token_sessao() -> str:
    """
    Gera um novo token de sessão aleatório, para entregar ao browser (num
    cookie httpOnly) depois de um login bem-sucedido.
    """
    # token_urlsafe(32) gera 32 bytes (256 bits) de aleatoriedade
    # criptográfica, codificados como texto seguro para usar num cookie ou
    # numa URL — entropia suficiente para tornar impraticável adivinhar
    # este valor por força bruta.
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    """Calcula o hash SHA-256 de um token, para guardar na base de dados."""
    # .encode() converte o texto do token para bytes, exigido por
    # hashlib.sha256; .hexdigest() devolve o hash resultante como uma
    # cadeia de texto legível (hexadecimal), pronta a guardar numa coluna
    # de texto (token_hash, em app/models/session.py).
    return hashlib.sha256(token.encode()).hexdigest()
