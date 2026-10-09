"""
ROTINA DE MANUTENÇÃO DA BASE DE DADOS
========================================

Tarefas que não pertencem a nenhum pedido de um utilizador, mas que
mantêm a base de dados em dia:

  1. LIMPAR O QUE EXPIROU:
     - as SESSÕES de login expiradas. Cada login cria uma linha na tabela
       "sessions" e só um logout explícito a apaga; uma sessão que
       simplesmente expira (30 minutos sem uso, ou o browser fechado sem
       "Terminar sessão") ficaria lá para sempre. Uma sessão expirada já
       não dá acesso a nada (o login rejeita-a) nem guarda nada útil, por
       isso apaga-se logo, sem histórico;
     - os PEDIDOS DE AUTORIZAÇÃO expirados: a linha que guarda o "state"
       enquanto o utilizador está no site do banco, que expira ao fim de
       15 minutos.
  2. ATUALIZAR AS TAXAS DE CÂMBIO: pede à Frankfurter API (as taxas de
     referência diárias do Banco Central Europeu) os dias que faltam desde
     a última taxa guardada, e grava-os.

O que esta rotina NUNCA apaga sozinha: autorizações, contas bancárias e
vínculos. Por regra de negócio, esquecer uma autorização é sempre uma
ação do utilizador (as Contas que ela alimentava passam a manuais, e isso
é uma decisão dele, não da aplicação).

QUEM A CORRE:
  - o próprio servidor, ao arrancar e depois uma vez por dia
    (manutencao_periodica, ligada ao ciclo de vida da aplicação em
    app/main.py);
  - à mão, pelo comando "uv run python -m scripts.manutencao".

CADA TAREFA NA SUA TRANSAÇÃO: uma transação é um conjunto de alterações
que fica gravado todo de uma vez (commit) ou não fica de todo
(rollback). A limpeza e as taxas são independentes: se a Frankfurter
estiver em baixo, a limpeza fica feita na mesma; a falha fica no registo
do servidor e as taxas tentam-se outra vez na próxima execução.

UMA EXECUÇÃO DE CADA VEZ: com mais do que um processo do servidor (ou o
servidor e o comando manual ao mesmo tempo), a mesma tarefa poderia
correr em dois sítios em simultâneo. Não estragaria nada (as duas
tarefas são idempotentes: repetir dá o mesmo resultado), mas faria
pedidos repetidos à Frankfurter. Para o evitar, cada tarefa começa por
pedir um "advisory lock" do PostgreSQL: um bloqueio "consultivo", que a
base de dados não associa a nenhuma linha (é a aplicação que decide o
que ele protege). pg_try_advisory_xact_lock devolve verdadeiro se ficou
com o bloqueio, ou falso de imediato se outra transação já o tiver; o
bloqueio é largado sozinho no fim da transação. Quem não o consegue
salta a tarefa: a outra execução já a está a fazer.
"""

import asyncio
import logging
from collections.abc import Awaitable, Callable
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import async_session
from app.services import frankfurter
from app.services.autorizacoes import apagar_pedidos_expirados
from app.services.cambio import guardar_taxas, proxima_data_a_pedir
from app.services.sessions import apagar_sessoes_expiradas

# O registo (log) deste ficheiro: mensagens para quem opera o servidor.
_registo = logging.getLogger(__name__)

# Os números do bloqueio de cada tarefa. Usa-se a forma do bloqueio com
# DOIS números inteiros: o PostgreSQL garante que estes bloqueios nunca
# colidem com os de um só número (os que bloqueiam cada Conta durante uma
# operação, calculados a partir do id da Conta). O primeiro número
# identifica "manutenção"; o segundo, a tarefa.
_BLOQUEIO_MANUTENCAO = 7001
_BLOQUEIO_LIMPEZA = 1
_BLOQUEIO_TAXAS = 2

# De quanto em quanto tempo o servidor corre a rotina sozinho.
INTERVALO = timedelta(hours=24)

# Quanto espera, depois de arrancar, antes da primeira execução. Em
# desenvolvimento, o servidor reinicia sempre que um ficheiro muda
# (--reload); sem esta espera, cada gravação de um ficheiro dispararia a
# rotina, incluindo um pedido à Frankfurter.
ATRASO_INICIAL = timedelta(minutes=1)

# O tipo de uma função que vai buscar as taxas a partir de uma data (a
# função real é frankfurter.obter_taxas; os testes passam uma falsa).
ObterTaxas = Callable[[date | None], Awaitable[dict[date, dict[str, Decimal]]]]


@dataclass
class ResumoDaManutencao:
    """
    O que uma execução fez, para quem a correu poder relatar. Cada campo
    fica None quando a tarefa não correu (falhou, ou outra execução já a
    estava a fazer).
    """

    sessoes_apagadas: int | None = None
    pedidos_apagados: int | None = None
    dias_de_taxas: list[date] | None = None
    # As tarefas saltadas porque outra execução já as fazia.
    saltadas: list[str] = field(default_factory=list)
    # As falhas, uma mensagem por tarefa que falhou.
    erros: list[str] = field(default_factory=list)


async def _bloquear(db: AsyncSession, tarefa: int) -> bool:
    """Tenta ficar com o bloqueio da tarefa até ao fim da transação."""
    return bool(
        await db.scalar(
            text("SELECT pg_try_advisory_xact_lock(:manutencao, :tarefa)"),
            {"manutencao": _BLOQUEIO_MANUTENCAO, "tarefa": tarefa},
        )
    )


async def limpar_expirados(db: AsyncSession) -> tuple[int, int] | None:
    """
    Apaga as sessões e os pedidos de autorização expirados. Devolve
    (sessões apagadas, pedidos apagados), ou None se outra execução já
    estiver a fazer esta tarefa. Não faz commit: quem chama decide.
    """
    if not await _bloquear(db, _BLOQUEIO_LIMPEZA):
        return None
    return await apagar_sessoes_expiradas(db), await apagar_pedidos_expirados(db)


async def atualizar_taxas(
    db: AsyncSession, obter_taxas: ObterTaxas = frankfurter.obter_taxas
) -> list[date] | None:
    """
    Pede à Frankfurter os dias de taxas em falta e grava-os. Devolve os
    dias gravados (por ordem), ou None se outra execução já estiver a
    fazer esta tarefa. Não faz commit: quem chama decide.

    A partir de que dia pedir decide-o proxima_data_a_pedir (em
    app/services/cambio.py): normalmente, desde a última taxa guardada;
    com a tabela vazia, ou quando aparece uma Conta com uma data inicial
    mais antiga do que todas as taxas guardadas, recua até essa data.
    Pedir de novo um dia que já existia não faz mal: guardar_taxas
    atualiza a linha em vez de a duplicar.

    "obter_taxas" é a função que faz o pedido à API; os testes trocam-na
    por uma falsa, para não dependerem da rede.
    """
    if not await _bloquear(db, _BLOQUEIO_TAXAS):
        return None
    taxas_por_dia = await obter_taxas(await proxima_data_a_pedir(db))
    for dia, taxas in taxas_por_dia.items():
        await guardar_taxas(db, dia, taxas)
    return sorted(taxas_por_dia)


async def correr_manutencao(
    fabrica: Callable[[], AbstractAsyncContextManager[AsyncSession]] = async_session,
    obter_taxas: ObterTaxas = frankfurter.obter_taxas,
) -> ResumoDaManutencao:
    """
    Corre as duas tarefas, cada uma na sua transação, e devolve o resumo.
    Nunca lança exceções: uma tarefa que falha fica no resumo e no
    registo do servidor, e a seguinte corre na mesma.

    "fabrica" abre uma sessão de base de dados nova (por omissão,
    async_session, a mesma fábrica que os pedidos HTTP usam); os testes
    passam uma que entrega a sessão de teste.
    """
    resumo = ResumoDaManutencao()

    async with fabrica() as db:
        try:
            resultado = await limpar_expirados(db)
            await db.commit()
        except Exception as erro:  # qualquer falha: regista e segue
            await db.rollback()
            _registo.exception("A limpeza da manutenção falhou.")
            resumo.erros.append(f"Limpeza: {erro}")
        else:
            if resultado is None:
                resumo.saltadas.append("limpeza")
            else:
                resumo.sessoes_apagadas, resumo.pedidos_apagados = resultado

    async with fabrica() as db:
        try:
            dias = await atualizar_taxas(db, obter_taxas)
            await db.commit()
        except Exception as erro:
            await db.rollback()
            _registo.exception("A atualização das taxas de câmbio falhou.")
            resumo.erros.append(f"Taxas de câmbio: {erro}")
        else:
            if dias is None:
                resumo.saltadas.append("taxas de câmbio")
            else:
                resumo.dias_de_taxas = dias

    _registo.info("Manutenção: %s", resumo)
    return resumo


async def manutencao_periodica() -> None:
    """
    Corre a rotina para sempre: a primeira vez ATRASO_INICIAL depois de o
    servidor arrancar, e depois a cada INTERVALO. Corre como uma tarefa
    de fundo ("asyncio task"): o servidor continua a responder a pedidos
    enquanto esta função espera ou trabalha. Termina quando o servidor
    desliga, que a cancela (ver app/main.py).
    """
    await asyncio.sleep(ATRASO_INICIAL.total_seconds())
    while True:
        # correr_manutencao já apanha as falhas de cada tarefa; esta rede a
        # mais apanha o que escapar dela (por exemplo, a ligação à base de
        # dados cair a meio de desfazer uma transação). Sem ela, uma única
        # falha destas terminava este ciclo para sempre, em silêncio, e a
        # manutenção nunca mais corria até o servidor reiniciar.
        # CancelledError (o servidor a desligar) não é apanhada aqui: em
        # Python, não é uma "Exception", e tem de terminar o ciclo.
        try:
            await correr_manutencao()
        except Exception:
            _registo.exception("A rotina de manutenção falhou; volta a correr no próximo intervalo.")
        await asyncio.sleep(INTERVALO.total_seconds())
