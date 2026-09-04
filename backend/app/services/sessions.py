"""
SERVIÇO DE SESSÕES — LIMPEZA DE SESSÕES EXPIRADAS
=====================================================

Cada login (app/routers/auth.py) cria uma linha nova na tabela "sessions";
só um logout explícito a apaga. Uma sessão que simplesmente expira — os
30 minutos deslizantes (SESSION_DURATION, em app/core/sessions.py) passam
sem uso, ou o browser fecha sem se clicar em "Terminar sessão" — fica na
tabela PARA SEMPRE: nada, até este ficheiro existir, a ia alguma vez
apagar.

Não é uma falha de segurança — obter_utilizador_atual (app/core/deps.py)
já rejeita qualquer sessão cujo expires_at tenha passado, mesmo que a
linha continue na tabela. É só falta de limpeza: sem isto, a tabela cresce
sem qualquer travão, para sempre.

apagar_sessoes_expiradas é chamada por um script de linha de comandos
(scripts/limpar_sessoes.py), pensado para correr periodicamente (ex.:
uma vez por dia, via cron) — à maneira do comando "clearsessions" do
Django, o padrão comum para sessões guardadas numa base de dados
relacional (ao contrário de, por exemplo, o Redis, onde a própria base de
dados apaga sozinha uma chave ao fim de um TTL, sem precisar de nenhum
código deste género).
"""

from datetime import datetime, timezone

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.session import UserSession


async def apagar_sessoes_expiradas(db: AsyncSession) -> int:
    """
    Apaga todas as sessões cujo expires_at já passou (de qualquer
    utilizador — esta função não filtra por um em particular). Devolve
    quantas linhas foram apagadas, só para quem chama poder relatar o
    resultado (ver scripts/limpar_sessoes.py).
    """
    resultado = await db.execute(
        delete(UserSession).where(UserSession.expires_at < datetime.now(timezone.utc))
    )
    await db.commit()
    return resultado.rowcount
