"""
DEPENDÊNCIAS PARTILHADAS
===========================

Este ficheiro reúne dependências do FastAPI (funções usadas com
Depends(...)) partilhadas por várias rotas — paralelo a get_db
(app/db/session.py), que entrega uma sessão de base de dados a quem a
pedir. Aqui, obter_utilizador_atual entrega o utilizador autenticado a
qualquer rota que exija autenticação, a partir do cookie de sessão do
pedido.
"""

from datetime import datetime, timezone

# Cookie declara, de forma explícita, que este parâmetro vem de um cookie
# do pedido (aqui, "session_token") — em vez de o ler manualmente a partir
# do objecto Request. default=None torna-o opcional: um pedido sem este
# cookie não causa um erro de validação por si só, é tratado abaixo como
# "não autenticado".
from fastapi import Cookie, Depends, HTTPException, status

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.sessions import SESSION_DURATION, hash_token
from app.db.session import get_db
from app.models.session import UserSession
from app.models.user import User


async def obter_utilizador_atual(
    session_token: str | None = Cookie(default=None),
    db: AsyncSession = Depends(get_db),
) -> User:
    """
    Identifica o utilizador autenticado a partir do cookie de sessão do
    pedido actual.

    Usada como dependência (Depends(obter_utilizador_atual)) por qualquer
    rota que exija um utilizador autenticado. Devolve 401 (Unauthorized)
    caso não exista cookie, caso não corresponda a nenhuma sessão, ou caso
    essa sessão já tenha expirado. Em caso de sucesso, renova expires_at
    para SESSION_DURATION a partir de agora — é esta renovação, repetida a
    cada pedido autenticado, que implementa a expiração deslizante
    decidida para as sessões (ver app/core/sessions.py): uma sessão em uso
    activo nunca expira a meio dessa utilização; uma sessão parada expira
    SESSION_DURATION depois do último pedido.
    """
    # A mesma excepção é usada em todos os casos de falha abaixo — não
    # distinguir "sem cookie" de "sessão inexistente" de "sessão expirada"
    # evita revelar, através da resposta, qual desses três motivos se
    # aplica, pela mesma razão de princípio já aplicada ao login (ver
    # app/routers/auth.py).
    erro_nao_autenticado = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Sessão inválida ou expirada.",
    )

    if session_token is None:
        raise erro_nao_autenticado

    # Procura-se a sessão pelo hash do token recebido — nunca se guarda,
    # nem se compara, o token em texto simples (mesma razão do login: ver
    # app/core/sessions.py).
    resultado = await db.execute(
        select(UserSession).where(UserSession.token_hash == hash_token(session_token))
    )
    sessao = resultado.scalar_one_or_none()

    if sessao is None or sessao.expires_at < datetime.now(timezone.utc):
        raise erro_nao_autenticado

    sessao.expires_at = datetime.now(timezone.utc) + SESSION_DURATION
    await db.commit()

    resultado = await db.execute(select(User).where(User.id == sessao.user_id))
    return resultado.scalar_one()
