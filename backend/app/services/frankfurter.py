"""
CLIENTE DA FRANKFURTER API (TAXAS DE CÂMBIO)
===============================================

A Frankfurter API (https://frankfurter.dev) é um serviço gratuito, sem
chave de acesso, que publica as taxas de câmbio de referência diárias do
Banco Central Europeu (BCE). Este ficheiro só faz uma coisa: pede-lhe as
taxas de cada moeda suportada pela aplicação (app/core/moedas.py),
relativamente a 1 EUR, e devolve-as já normalizadas. Não grava nada na
base de dados: isso é trabalho de quem chama (a rotina de manutenção,
app/services/manutencao.py), que decide também a partir de que dia
pedir.

PORQUÊ UM FICHEIRO À PARTE: tudo o que fala com um serviço externo fica
isolado num "cliente" próprio, como acontece com a Enable Banking
(app/services/enable_banking.py). Assim, nos testes, basta substituir
esta única função por uma versão falsa para testar o resto sem rede.

O BCE só publica taxas em dias úteis: ao fim de semana ou num feriado, a
taxa mais recente continua a ser a do último dia útil, e é essa a data
que a API devolve (nunca a data de hoje do relógio).
"""

from datetime import date
from decimal import Decimal

# httpx é o cliente HTTP do projeto: faz pedidos a outros servidores, com
# suporte para "async" (o programa não fica parado à espera da resposta).
import httpx

from app.core.moedas import MOEDAS
from app.services.cambio import normalizar_resposta_frankfurter

URL_ULTIMA = "https://api.frankfurter.dev/v1/latest"
URL_INTERVALO = "https://api.frankfurter.dev/v1/{data_inicio}.."


async def obter_taxas(data_inicio: date | None) -> dict[date, dict[str, Decimal]]:
    """
    As taxas de câmbio relativamente a 1 EUR, no formato
    data -> (moeda -> taxa): só as do dia mais recente se "data_inicio"
    for None, ou as de todos os dias úteis desde "data_inicio" até hoje,
    caso contrário (a API devolve um intervalo inteiro num só pedido, com
    o endereço "/{data_inicio}..").

    Um pedido falhado (rede em baixo, serviço indisponível, resposta com
    código de erro) lança a exceção do httpx (httpx.HTTPError): quem chama
    decide o que fazer, e nunca se grava nada a meio.
    """
    moedas_a_pedir = [codigo for codigo in MOEDAS if codigo != "EUR"]
    parametros = {"base": "EUR", "symbols": ",".join(moedas_a_pedir)}
    url = URL_ULTIMA if data_inicio is None else URL_INTERVALO.format(data_inicio=data_inicio.isoformat())

    async with httpx.AsyncClient() as cliente:
        resposta = await cliente.get(url, params=parametros, timeout=10)
        # raise_for_status transforma uma resposta de erro (4xx ou 5xx) numa
        # exceção, em vez de a tratar como se trouxesse taxas.
        resposta.raise_for_status()
        return normalizar_resposta_frankfurter(resposta.json())
