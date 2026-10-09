"""
SCRIPT: MANUTENÇÃO DA BASE DE DADOS
======================================

Corre à mão a rotina de manutenção que o servidor já corre sozinho, ao
arrancar e depois uma vez por dia:
  - apaga as sessões de login expiradas e os pedidos de autorização ao
    banco expirados (com mais de 15 minutos);
  - vai buscar à Frankfurter API (as taxas de referência diárias do Banco
    Central Europeu) as taxas de câmbio dos dias em falta, e grava-as.

A rotina em si vive em app/services/manutencao.py; este ficheiro é só o
ponto de entrada para a correr a partir da linha de comandos, e para
mostrar o resultado.

USO
---
A partir da pasta backend/:

    uv run python -m scripts.manutencao

QUANDO CORRER
-------------
Normalmente não é preciso: o servidor faz isto sozinho. Serve para
correr a rotina sem esperar pelo servidor (por exemplo, para ter logo as
taxas de hoje), ou para a agendar por fora do servidor, por exemplo com
um "cron" (o agendador de tarefas do Linux), desligando então a rotina
automática com MANUTENCAO_AUTOMATICA=false no .env.

Correr mais do que uma vez não faz mal: nada a apagar dá 0, e uma taxa
que já existia é atualizada, nunca duplicada.
"""

import asyncio

from app.services.manutencao import correr_manutencao


async def _principal() -> None:
    resumo = await correr_manutencao()

    # Cada campo do resumo é None quando essa tarefa não correu (falhou, ou
    # outra execução já a estava a fazer); nesses casos, o que aconteceu
    # aparece mais abaixo, em "saltadas" ou "erros".
    if resumo.sessoes_apagadas is not None:
        print(f"Sessões expiradas apagadas: {resumo.sessoes_apagadas}.")
        print(f"Pedidos de autorização expirados apagados: {resumo.pedidos_apagados}.")

    if resumo.dias_de_taxas is not None:
        if resumo.dias_de_taxas:
            primeiro, ultimo = resumo.dias_de_taxas[0], resumo.dias_de_taxas[-1]
            intervalo = str(primeiro) if primeiro == ultimo else f"{primeiro} a {ultimo}"
            print(f"Taxas de câmbio gravadas: {len(resumo.dias_de_taxas)} dia(s) ({intervalo}).")
        else:
            print("Taxas de câmbio: nenhum dia novo.")

    for tarefa in resumo.saltadas:
        print(f"Saltada ({tarefa}): outra execução já a estava a fazer.")
    for erro in resumo.erros:
        print(f"Falhou: {erro}")


if __name__ == "__main__":
    asyncio.run(_principal())
