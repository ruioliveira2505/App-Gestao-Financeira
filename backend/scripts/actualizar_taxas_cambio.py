"""
SCRIPT: ACTUALIZAR TAXAS DE CÂMBIO
=====================================

Vai buscar, à Frankfurter API (https://frankfurter.dev — gratuita, sem
chave de acesso, baseada nas taxas de referência diárias do Banco Central
Europeu), a taxa de cada moeda suportada (ver app/core/moedas.py)
relativamente a 1 EUR, e grava-as na tabela taxas_cambio (ver
app/models/taxa_cambio.py, onde está explicado porquê relativamente a 1
EUR, e não um par por cada combinação de moedas).

PREENCHE OS DIAS EM FALTA, NÃO SÓ "A MAIS RECENTE": em vez de pedir
sempre só a última taxa disponível, o script pergunta primeiro à própria
tabela a partir de que data pedir (proxima_data_a_pedir, em
app/services/cambio.py — ver esse ficheiro para a explicação completa) e
pede à API o INTERVALO desde aí até agora, tudo numa só chamada (a
Frankfurter API suporta isto através do endpoint "/{data_inicio}.."). Isto
cobre TRÊS casos, sempre sem intervenção manual:

  1. O normal, dia após dia: só o que falta desde a última execução.
  2. A primeira vez que o script corre (tabela ainda vazia): recua até à
     data-âncora mais antiga de qualquer conta — não até "hoje", que
     deixaria sem taxa qualquer movimento anterior a essa primeira
     execução, para sempre.
  3. Uma conta com uma âncora AINDA MAIS ANTIGA do que tudo o que já
     estava guardado foi criada mais tarde: o script recua outra vez até
     lá, sozinho, na próxima vez que correr — não é preciso perceber que
     isto aconteceu nem corrigir à mão.

A DATA DE CADA TAXA É A QUE A PRÓPRIA API DEVOLVE, nunca a data de hoje
do relógio: o Banco Central Europeu só publica taxas novas em dias
úteis — ao fim de semana ou num feriado, a taxa mais recente continua a
ser a do último dia útil, e é essa data (não "hoje") que fica associada
a ela.

IDEMPOTENTE: correr este script mais do que uma vez para o mesmo período
actualiza as mesmas linhas, nunca cria duplicados (ver guardar_taxas, em
app/services/cambio.py) — por isso não há problema em o pedido, por
vezes, incluir dias que já tínhamos (ver o caso 3, acima).

USO
---
A partir da pasta backend/:

    uv run python -m scripts.actualizar_taxas_cambio

QUANDO CORRER
-------------
Por agora, à mão, de vez em quando — mesmo com dias ou semanas entre
execuções, este script preenche sozinho o que faltar. Tal como
scripts/limpar_sessoes.py, agendar isto por cron só faz sentido quando
existir um servidor permanentemente ligado e acessível — a forma concreta
ainda não está decidida, porque ainda não há um alojamento escolhido.
"""

import asyncio
from datetime import date

import httpx

from app.core.moedas import MOEDAS
from app.db.session import async_session
from app.services.cambio import guardar_taxas, normalizar_resposta_frankfurter, proxima_data_a_pedir

URL_FRANKFURTER_LATEST = "https://api.frankfurter.dev/v1/latest"
URL_FRANKFURTER_INTERVALO = "https://api.frankfurter.dev/v1/{data_inicio}.."


async def _obter_taxas(data_inicio: date | None) -> dict[date, dict[str, object]]:
    """
    Pede à Frankfurter API as taxas de câmbio em falta: só a mais recente
    se "data_inicio" for None (tabela ainda vazia), ou todo o intervalo
    desde "data_inicio" até agora, caso contrário. Devolve já normalizado
    por normalizar_resposta_frankfurter (data -> (moeda -> taxa)).
    """
    moedas_a_pedir = [codigo for codigo in MOEDAS if codigo != "EUR"]
    parametros = {"base": "EUR", "symbols": ",".join(moedas_a_pedir)}
    url = (
        URL_FRANKFURTER_LATEST
        if data_inicio is None
        else URL_FRANKFURTER_INTERVALO.format(data_inicio=data_inicio.isoformat())
    )

    async with httpx.AsyncClient() as cliente:
        resposta = await cliente.get(url, params=parametros, timeout=10)
        # Sem "try/except" a apanhar isto: um pedido falhado (rede em
        # baixo, API indisponível) deve fazer o script parar com um erro
        # visível, não terminar em silêncio como se tivesse corrido bem.
        resposta.raise_for_status()
        corpo = resposta.json()

    return normalizar_resposta_frankfurter(corpo)


async def _principal() -> None:
    # async_session() (não get_db()): get_db entrega uma sessão a um
    # pedido HTTP, e este script não corre dentro de nenhum — abre a sua
    # própria sessão, tal como get_db faz por baixo, e fecha-a no fim
    # (o mesmo padrão de scripts/limpar_sessoes.py).
    async with async_session() as db:
        data_inicio = await proxima_data_a_pedir(db)
        taxas_por_dia = await _obter_taxas(data_inicio)

        for dia, taxas in taxas_por_dia.items():
            await guardar_taxas(db, dia, taxas)
        await db.commit()

    if not taxas_por_dia:
        print("Nenhuma taxa nova (a API não devolveu nenhum dia).")
        return

    primeiro_dia = min(taxas_por_dia)
    ultimo_dia = max(taxas_por_dia)
    intervalo = str(primeiro_dia) if primeiro_dia == ultimo_dia else f"{primeiro_dia} a {ultimo_dia}"
    print(f"Taxas actualizadas: {len(taxas_por_dia)} dia(s) ({intervalo}).")


if __name__ == "__main__":
    asyncio.run(_principal())
