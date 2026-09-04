"""
SCRIPT: LIMPAR SESSÕES EXPIRADAS
====================================

Apaga da base de dados todas as sessões (tabela "sessions") cujo prazo já
passou. A explicação completa de porque isto é preciso vive em
app/services/sessions.py — aqui é só o ponto de entrada para correr a
partir da linha de comandos.

USO
---
A partir da pasta backend/:

    uv run python -m scripts.limpar_sessoes

Correr mais do que uma vez, ou com a tabela já limpa, não faz mal —
simplesmente não apaga nada, e o script diz "0 sessões apagadas".

QUANDO CORRER
-------------
Por agora, à mão, sempre que quiseres (ex.: para limpar as sessões
acumuladas durante o desenvolvimento). Quando a aplicação for para
produção, é este o script que se agenda para correr sozinho, de tempos a
tempos (ex.: uma vez por dia, via cron) — a forma concreta de o agendar
ainda não está decidida, porque ainda não há um alojamento escolhido.
"""

import asyncio

from app.db.session import async_session
from app.services.sessions import apagar_sessoes_expiradas


async def _principal() -> None:
    # async_session() (não get_db()): get_db entrega uma sessão a um
    # pedido HTTP, e este script não corre dentro de nenhum — abre a sua
    # própria sessão, tal como get_db faz por baixo, e fecha-a no fim.
    async with async_session() as db:
        apagadas = await apagar_sessoes_expiradas(db)
        print(f"{apagadas} sessão(ões) expirada(s) apagada(s).")


if __name__ == "__main__":
    asyncio.run(_principal())
