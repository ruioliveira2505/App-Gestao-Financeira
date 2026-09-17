"""
SERVIÇO DE CÂMBIO — CONVERSÃO ENTRE MOEDAS
=============================================

Duas funções: obter_taxa (a taxa de câmbio de uma moeda, num dia) e
converter (usa duas chamadas a obter_taxa para converter um valor de uma
moeda para outra). Consultam apenas a tabela taxas_cambio (ver
app/models/taxa_cambio.py, onde está explicado porquê as taxas são
guardadas relativamente a 1 EUR, e não uma linha por cada par de moedas) —
nunca fazem, elas próprias, nenhum pedido a uma fonte externa; isso é
trabalho do script de actualização (scripts/actualizar_taxas_cambio.py),
que só escreve nesta tabela, nunca a lê para converter nada.

Esta separação (quem escreve as taxas vs. quem as usa) permite testar a
conversão sem qualquer dependência de rede: um teste semeia a tabela com
taxas conhecidas e verifica a matemática, sem chamar nenhuma API externa.
"""

from datetime import date
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.conta import Conta
from app.models.taxa_cambio import TaxaCambio


class SemTaxaCambio(Exception):
    """
    Levantada quando não existe, na tabela taxas_cambio, nenhuma taxa para
    uma moeda na data pedida OU ANTES dela — normalmente porque o script
    de actualização ainda não tem histórico suficiente (ex.: uma moeda
    nova, acabada de acrescentar a app/core/moedas.py, ou uma data
    anterior ao dia em que se começou a guardar taxas).

    Não é um HTTPException, ao contrário dos outros serviços desta
    aplicação (ex.: obter_conta_do_utilizador, em app/services/contas.py):
    aqueles representam sempre "isto não pertence a este utilizador" — um
    erro do PEDIDO de um utilizador concreto, sempre 404. Esta excepção
    representa antes uma lacuna nos dados de referência, partilhados por
    todos os utilizadores — o estado HTTP e a mensagem certos só fazem
    sentido decidir no endpoint que a vier a apanhar, por isso fica como
    uma excepção comum.
    """

    def __init__(self, moeda: str, data_pedida: date):
        self.moeda = moeda
        self.data_pedida = data_pedida
        super().__init__(f"Sem taxa de câmbio para {moeda} em {data_pedida} ou antes.")


async def obter_taxa(db: AsyncSession, moeda: str, data_referencia: date) -> Decimal:
    """
    Quantas unidades de "moeda" valem 1 EUR, na taxa mais recente igual ou
    anterior a "data_referencia".

    Devolve sempre Decimal("1") para "EUR", sem consultar a base de
    dados — é a moeda-pivot da tabela taxas_cambio (ver a nota no topo de
    app/models/taxa_cambio.py), que nunca tem linha própria para o EUR.

    "mais recente IGUAL OU ANTERIOR", não "exactamente nessa data": o
    Banco Central Europeu só publica taxas de referência em dias úteis
    (ver a mesma nota) — para uma data sem taxa própria (fim de semana,
    feriado), usa-se a última taxa conhecida antes dela, que é a taxa que
    estava realmente em vigor nesse dia (nada mudou de câmbio nele).
    """
    if moeda == "EUR":
        return Decimal("1")

    resultado = await db.execute(
        select(TaxaCambio.por_1_eur)
        .where(TaxaCambio.moeda == moeda, TaxaCambio.data <= data_referencia)
        .order_by(TaxaCambio.data.desc())
        .limit(1)
    )
    taxa = resultado.scalar_one_or_none()
    if taxa is None:
        raise SemTaxaCambio(moeda, data_referencia)
    return taxa


async def converter(
    db: AsyncSession,
    valor: Decimal,
    moeda_origem: str,
    moeda_destino: str,
    data_referencia: date,
) -> Decimal:
    """
    Converte "valor" de "moeda_origem" para "moeda_destino", à taxa em
    vigor em "data_referencia" — a data do MOVIMENTO a converter, para uma
    análise de histórico (nunca a data de hoje: o valor em EUR de um
    movimento já fechado no passado não deve mudar todos os dias só
    porque o câmbio actual mudou); a data de hoje, para saber quanto vale
    AGORA (ver a nota "PORQUÊ A DATA É UMA COLUNA" em
    app/models/taxa_cambio.py).

    Passa sempre pelo EUR como intermediário: valor ÷ taxa(origem) dá o
    valor em EUR; × taxa(destino) dá o valor na moeda pedida (ver a nota
    "PORQUÊ RELATIVO A UM SÓ PIVOT" em app/models/taxa_cambio.py).

    Sem arredondamento nenhum aqui — quem chama esta função decide quantas
    casas decimais o resultado final deve ter, consoante o uso (ex.: 2,
    para apresentação monetária).
    """
    if moeda_origem == moeda_destino:
        # Sem este atalho, uma conversão "para a mesma moeda" ainda assim
        # dividiria e multiplicaria por uma taxa — inofensivo em teoria
        # (dá sempre o valor original), mas obrigaria a tabela a ter
        # sempre taxa disponível para essa moeda/data mesmo quando não há
        # conversão nenhuma a fazer.
        return valor

    taxa_origem = await obter_taxa(db, moeda_origem, data_referencia)
    taxa_destino = await obter_taxa(db, moeda_destino, data_referencia)
    valor_em_eur = valor / taxa_origem
    return valor_em_eur * taxa_destino


async def guardar_taxas(db: AsyncSession, data_referencia: date, taxas: dict[str, Decimal]) -> None:
    """
    Grava, para "data_referencia", a taxa de cada moeda em "taxas"
    (moeda -> quantas unidades valem 1 EUR). Usada por
    scripts/actualizar_taxas_cambio.py, depois de ir buscar os valores
    à Frankfurter API — este ficheiro nunca faz, ele próprio, nenhum
    pedido de rede (ver a nota no topo do ficheiro).

    IDEMPOTENTE por linha (data, moeda): se já existir uma taxa para essa
    combinação, é ACTUALIZADA, não duplicada — corre-se este script mais
    do que uma vez no mesmo dia (ex.: por engano, ou para corrigir um
    valor) sem consequências, e sem ele próprio ter de verificar antes
    "já existe isto?".

    Não faz commit: quem chama decide quando confirmar a transacção (ver
    scripts/actualizar_taxas_cambio.py, que faz um único commit no fim,
    depois de todas as moedas gravadas).
    """
    for moeda, taxa in taxas.items():
        comando = insert(TaxaCambio).values(data=data_referencia, moeda=moeda, por_1_eur=taxa)
        # "ON CONFLICT (data, moeda) DO UPDATE" — a chave primária composta
        # é precisamente (data, moeda) (ver app/models/taxa_cambio.py), por
        # isso um conflito aqui só pode significar "já existe uma taxa
        # para esta moeda, nesta data".
        comando = comando.on_conflict_do_update(
            index_elements=["data", "moeda"],
            set_={"por_1_eur": comando.excluded.por_1_eur},
        )
        await db.execute(comando)


async def ultima_data_guardada(db: AsyncSession) -> date | None:
    """
    A data mais recente com alguma taxa guardada, em toda a tabela —
    "None" se a tabela ainda estiver vazia (primeira vez que o script de
    actualização corre). Usada por scripts/actualizar_taxas_cambio.py
    para saber a partir de que dia pedir a taxas em falta à Frankfurter
    API, em vez de pedir sempre só "a mais recente": sem isto, um
    intervalo de dias sem o script correr (ex.: uma semana de férias)
    deixaria um buraco na tabela, nunca preenchido — cada dia em falta
    ficaria, para sempre, a usar a taxa do último dia antes do buraco
    (ainda correcto, pela regra "mais recente igual ou anterior", mas
    menos preciso do que ter a taxa REAL de cada um desses dias).
    """
    resultado = await db.execute(select(func.max(TaxaCambio.data)))
    return resultado.scalar_one_or_none()


async def primeira_data_guardada(db: AsyncSession) -> date | None:
    """
    A data MAIS ANTIGA com alguma taxa guardada, em toda a tabela —
    "None" se a tabela ainda estiver vazia. O complemento de
    ultima_data_guardada (essa devolve a mais recente): esta serve para
    detectar se o histórico já guardado recua o suficiente — ver
    proxima_data_a_pedir, mais abaixo.
    """
    resultado = await db.execute(select(func.min(TaxaCambio.data)))
    return resultado.scalar_one_or_none()


async def data_inicio_do_historico(db: AsyncSession) -> date | None:
    """
    A data-âncora mais antiga entre TODAS as contas de TODOS os
    utilizadores — "None" se ainda não existir nenhuma conta.

    Nenhum movimento pode ter uma data anterior à âncora da sua conta
    (essa regra é imposta em _validar_data, em app/routers/movimentos.py,
    ao criar ou editar um movimento) — por isso esta é, precisamente, a
    data mais antiga que algum dia vai ser preciso converter. Usada por
    proxima_data_a_pedir (mais abaixo) para decidir até onde recuar.
    """
    resultado = await db.execute(select(func.min(Conta.data_ancora)))
    return resultado.scalar_one_or_none()


async def proxima_data_a_pedir(db: AsyncSession) -> date | None:
    """
    A partir de que data scripts/actualizar_taxas_cambio.py deve pedir
    taxas à API, desta vez — "None" significa "só a mais recente"
    (equivalente a pedir /latest, sem intervalo).

    Cobre os dois casos em que é preciso recuar no tempo, não só avançar:

    1. A tabela ainda está completamente vazia (primeira execução de
       sempre) — usa-se a data-âncora mais antiga entre todas as contas
       (data_inicio_do_historico). Sem isto, converter um movimento
       anterior à primeira execução deste script falharia sempre com
       SemTaxaCambio, por mais tempo que passasse a correr o script a
       partir daí — o problema é falta de histórico ANTIGO, e só se
       resolve recuando, nunca avançando.

    2. A tabela já tem histórico, mas uma conta com uma âncora AINDA MAIS
       ANTIGA do que tudo o que já está guardado foi criada entretanto —
       o mesmo problema, só que descoberto mais tarde. Comparando sempre
       a data-âncora mais antiga necessária com primeira_data_guardada
       (não só verificando "a tabela está vazia?"), este caso corrige-se
       sozinho na próxima vez que o script correr, sem precisar de
       nenhuma intervenção manual.

    Fora destes dois casos (o normal, dia após dia, sem contas novas mais
    antigas), devolve ultima_data_guardada — só o que falta desde a
    última vez que o script correu.
    """
    necessaria = await data_inicio_do_historico(db)
    primeira = await primeira_data_guardada(db)
    ultima = await ultima_data_guardada(db)

    if ultima is None:
        # Tabela vazia: um único pedido cobre tudo (None se ainda não
        # houver nenhuma conta, e portanto nada para recuar).
        return necessaria

    if necessaria is not None and (primeira is None or necessaria < primeira):
        # Apareceu uma conta com uma âncora mais antiga do que tudo o que
        # já tínhamos — recua até lá. O pedido resultante volta a incluir
        # dias que já tínhamos (entre "necessaria" e "ultima") — sem
        # problema, guardar_taxas é idempotente, e o volume de dados é
        # irrelevante a esta escala.
        return necessaria

    return ultima


def normalizar_resposta_frankfurter(corpo: dict) -> dict[date, dict[str, Decimal]]:
    """
    A Frankfurter API devolve duas formas diferentes de resposta, consoante
    o que se pede: um único dia — GET /latest ou GET /{data} — devolve
    {"date": "2026-01-15", "rates": {"USD": 1.1, ...}}; um INTERVALO de
    datas — GET /{data_inicio}.. — devolve vários de uma vez,
    {"rates": {"2026-01-15": {"USD": 1.1, ...}, "2026-01-16": {...}, ...}},
    sem nenhum "date" ao nível de topo. Esta função normaliza qualquer uma
    das duas formas para a mesma: um dicionário data -> (moeda -> taxa).

    Função pura (sem rede, sem base de dados) precisamente para ser
    testável sem depender da API real — só a transformação dos dados.
    """
    if "date" in corpo:
        # Resposta de um único dia.
        return {
            date.fromisoformat(corpo["date"]): {
                moeda: Decimal(str(valor)) for moeda, valor in corpo["rates"].items()
            }
        }

    # Resposta de um intervalo: corpo["rates"] já é dia -> (moeda -> taxa).
    return {
        date.fromisoformat(dia): {moeda: Decimal(str(valor)) for moeda, valor in taxas_do_dia.items()}
        for dia, taxas_do_dia in corpo["rates"].items()
    }
