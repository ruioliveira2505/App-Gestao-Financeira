"""
TESTES DO SERVIÇO DE CÂMBIO
==============================

Semeiam directamente a tabela taxas_cambio (sem passar por nenhuma rota
da API — esta tabela não tem endpoints próprios, só é escrita pelo script
de actualização) e verificam a matemática de obter_taxa/converter. Nenhum
destes testes faz um pedido de rede: é precisamente a vantagem de separar
"quem escreve as taxas" de "quem as usa" (ver a nota no topo de
app/services/cambio.py).
"""

from datetime import date
from decimal import Decimal

import pytest

from sqlalchemy import select

from app.models.conta import Conta
from app.models.taxa_cambio import TaxaCambio
from app.services.cambio import (
    SemTaxaCambio,
    converter,
    data_inicio_do_historico,
    guardar_taxas,
    normalizar_resposta_frankfurter,
    obter_taxa,
    primeira_data_guardada,
    proxima_data_a_pedir,
    ultima_data_guardada,
)


async def _semear_taxa(db_session, moeda: str, data_: date, por_1_eur: str) -> None:
    db_session.add(TaxaCambio(data=data_, moeda=moeda, por_1_eur=Decimal(por_1_eur)))
    await db_session.flush()


@pytest.mark.asyncio
async def test_obter_taxa_de_eur_e_sempre_um_sem_consultar_a_tabela(db_session):
    # Nenhuma linha "EUR" semeada — se a função fosse à tabela, não
    # encontrava nada. Confirma que nem tenta.
    taxa = await obter_taxa(db_session, "EUR", date(2026, 1, 15))
    assert taxa == Decimal("1")


@pytest.mark.asyncio
async def test_obter_taxa_devolve_a_taxa_exacta_dessa_data(db_session):
    await _semear_taxa(db_session, "USD", date(2026, 1, 15), "1.10")
    await _semear_taxa(db_session, "USD", date(2026, 1, 16), "1.12")

    taxa = await obter_taxa(db_session, "USD", date(2026, 1, 15))

    assert taxa == Decimal("1.10")


@pytest.mark.asyncio
async def test_obter_taxa_sem_linha_nessa_data_usa_a_mais_recente_anterior(db_session):
    # Regressão do caso mais importante desta tabela: um fim de semana ou
    # feriado do BCE não tem taxa própria — usa-se a última conhecida.
    await _semear_taxa(db_session, "USD", date(2026, 1, 14), "1.09")  # sexta-feira

    # sábado e domingo (16, 17) sem taxa nenhuma — pede-se a de domingo.
    taxa = await obter_taxa(db_session, "USD", date(2026, 1, 17))

    assert taxa == Decimal("1.09")


@pytest.mark.asyncio
async def test_obter_taxa_ignora_taxas_futuras(db_session):
    # Uma taxa "futura" (posterior à data pedida) nunca deve ser usada —
    # senão um movimento de hoje "veria o futuro" do câmbio.
    await _semear_taxa(db_session, "USD", date(2026, 1, 10), "1.05")
    await _semear_taxa(db_session, "USD", date(2026, 1, 20), "1.20")

    taxa = await obter_taxa(db_session, "USD", date(2026, 1, 15))

    assert taxa == Decimal("1.05")


@pytest.mark.asyncio
async def test_obter_taxa_sem_nenhuma_taxa_anterior_levanta_sem_taxa_cambio(db_session):
    await _semear_taxa(db_session, "USD", date(2026, 2, 1), "1.10")

    with pytest.raises(SemTaxaCambio):
        # Pede-se uma data ANTERIOR à primeira taxa alguma vez guardada.
        await obter_taxa(db_session, "USD", date(2026, 1, 1))


@pytest.mark.asyncio
async def test_converter_para_a_mesma_moeda_devolve_o_valor_tal_e_qual(db_session):
    # Sem nenhuma taxa semeada: se a função fosse mesmo à tabela, isto
    # levantaria SemTaxaCambio. Confirma que o atalho evita a consulta.
    valor = await converter(db_session, Decimal("42.50"), "USD", "USD", date(2026, 1, 15))

    assert valor == Decimal("42.50")


@pytest.mark.asyncio
async def test_converter_entre_eur_e_uma_outra_moeda(db_session):
    # 1 EUR = 1.10 USD nesta data.
    await _semear_taxa(db_session, "USD", date(2026, 1, 15), "1.10")

    de_eur_para_usd = await converter(db_session, Decimal("100"), "EUR", "USD", date(2026, 1, 15))
    de_usd_para_eur = await converter(db_session, Decimal("110"), "USD", "EUR", date(2026, 1, 15))

    assert de_eur_para_usd == Decimal("110")
    assert de_usd_para_eur == Decimal("100")


@pytest.mark.asyncio
async def test_converter_entre_duas_moedas_que_nao_sao_o_eur_passa_pelo_pivot(db_session):
    # 1 EUR = 1.10 USD; 1 EUR = 0.85 GBP. Sem nenhuma linha USD->GBP
    # directa — a conversão tem de passar pelo EUR nos bastidores (ver a
    # nota "PORQUÊ RELATIVO A UM SÓ PIVOT" em app/models/taxa_cambio.py).
    await _semear_taxa(db_session, "USD", date(2026, 1, 15), "1.10")
    await _semear_taxa(db_session, "GBP", date(2026, 1, 15), "0.85")

    valor = await converter(db_session, Decimal("110"), "USD", "GBP", date(2026, 1, 15))

    # 110 USD -> 100 EUR -> 85 GBP.
    assert valor == Decimal("85.00")


@pytest.mark.asyncio
async def test_converter_usa_a_taxa_do_dia_do_movimento_nao_a_mais_recente(db_session):
    # O caso central desta funcionalidade (ver a nota "PORQUÊ A DATA É
    # UMA COLUNA" em app/models/taxa_cambio.py): o câmbio mudou entre a
    # data do movimento e hoje — a conversão de um movimento ANTIGO tem
    # de usar a taxa QUE ESTAVA EM VIGOR nesse dia, não a mais recente.
    await _semear_taxa(db_session, "USD", date(2026, 1, 15), "1.10")  # em vigor no passado
    await _semear_taxa(db_session, "USD", date(2026, 9, 1), "1.05")  # em vigor hoje

    valor_no_passado = await converter(
        db_session, Decimal("110"), "USD", "EUR", date(2026, 1, 15)
    )
    valor_hoje = await converter(db_session, Decimal("110"), "USD", "EUR", date(2026, 9, 1))

    assert valor_no_passado == Decimal("100")
    assert valor_hoje != valor_no_passado


@pytest.mark.asyncio
async def test_converter_propaga_sem_taxa_cambio_se_faltar_a_taxa_de_qualquer_das_duas_moedas(
    db_session,
):
    # converter() chama obter_taxa() duas vezes (origem e destino) — este
    # teste confirma que a excepção de QUALQUER uma das duas chega
    # mesmo a quem chamou converter(), em vez de ser engolida ou só
    # verificada indirectamente através de obter_taxa() sozinho.
    await _semear_taxa(db_session, "USD", date(2026, 1, 15), "1.10")
    # Sem nenhuma taxa "GBP" semeada.

    with pytest.raises(SemTaxaCambio):
        await converter(db_session, Decimal("100"), "USD", "GBP", date(2026, 1, 15))

    with pytest.raises(SemTaxaCambio):
        await converter(db_session, Decimal("100"), "GBP", "USD", date(2026, 1, 15))


@pytest.mark.asyncio
async def test_guardar_taxas_grava_uma_linha_por_moeda(db_session):
    await guardar_taxas(
        db_session,
        date(2026, 1, 15),
        {"USD": Decimal("1.10"), "GBP": Decimal("0.85")},
    )
    await db_session.flush()

    resultado = await db_session.execute(
        select(TaxaCambio).where(TaxaCambio.data == date(2026, 1, 15))
    )
    linhas = {linha.moeda: linha.por_1_eur for linha in resultado.scalars()}

    assert linhas == {"USD": Decimal("1.10"), "GBP": Decimal("0.85")}


@pytest.mark.asyncio
async def test_guardar_taxas_e_idempotente_actualiza_em_vez_de_duplicar(db_session):
    # Regressão: correr o script duas vezes no mesmo dia (ex.: por
    # engano) não deve criar uma segunda linha para a mesma (data, moeda)
    # — deve só actualizar o valor.
    await guardar_taxas(db_session, date(2026, 1, 15), {"USD": Decimal("1.10")})
    await db_session.flush()

    await guardar_taxas(db_session, date(2026, 1, 15), {"USD": Decimal("1.12")})
    await db_session.flush()

    resultado = await db_session.execute(
        select(TaxaCambio).where(TaxaCambio.data == date(2026, 1, 15), TaxaCambio.moeda == "USD")
    )
    linhas = resultado.scalars().all()

    assert len(linhas) == 1
    assert linhas[0].por_1_eur == Decimal("1.12")


@pytest.mark.asyncio
async def test_guardar_taxas_nao_toca_em_linhas_de_outras_datas_ou_moedas(db_session):
    await guardar_taxas(db_session, date(2026, 1, 14), {"USD": Decimal("1.09")})
    await db_session.flush()

    await guardar_taxas(db_session, date(2026, 1, 15), {"USD": Decimal("1.10"), "GBP": Decimal("0.85")})
    await db_session.flush()

    # A taxa do dia anterior continua lá, inalterada.
    taxa_anterior = await obter_taxa(db_session, "USD", date(2026, 1, 14))
    assert taxa_anterior == Decimal("1.09")


@pytest.mark.asyncio
async def test_ultima_data_guardada_com_a_tabela_vazia_devolve_none(db_session):
    assert await ultima_data_guardada(db_session) is None


@pytest.mark.asyncio
async def test_ultima_data_guardada_devolve_a_mais_recente_entre_varias_moedas_e_dias(db_session):
    await _semear_taxa(db_session, "USD", date(2026, 1, 10), "1.09")
    await _semear_taxa(db_session, "GBP", date(2026, 1, 15), "0.85")  # a mais recente
    await _semear_taxa(db_session, "USD", date(2026, 1, 12), "1.10")

    assert await ultima_data_guardada(db_session) == date(2026, 1, 15)


@pytest.mark.asyncio
async def test_primeira_data_guardada_com_a_tabela_vazia_devolve_none(db_session):
    assert await primeira_data_guardada(db_session) is None


@pytest.mark.asyncio
async def test_primeira_data_guardada_devolve_a_mais_antiga(db_session):
    await _semear_taxa(db_session, "USD", date(2026, 1, 15), "1.10")
    await _semear_taxa(db_session, "GBP", date(2026, 1, 10), "0.85")  # a mais antiga
    await _semear_taxa(db_session, "USD", date(2026, 1, 20), "1.12")

    assert await primeira_data_guardada(db_session) == date(2026, 1, 10)


@pytest.mark.asyncio
async def test_proxima_data_a_pedir_sem_contas_e_sem_taxas_devolve_none(db_session):
    # None significa "pede-se só a mais recente" (/latest) — sem nenhuma
    # conta, não há nada para recuar.
    assert await proxima_data_a_pedir(db_session) is None


@pytest.mark.asyncio
async def test_proxima_data_a_pedir_primeira_execucao_recua_ate_a_ancora_mais_antiga(
    cliente_autenticado, db_session
):
    # Tabela ainda vazia, mas já existe uma conta — recua até à sua âncora,
    # não fica pela data de hoje.
    await cliente_autenticado.post(
        "/contas",
        json={"nome": "Conta antiga", "moeda": "EUR", "data_ancora": "2020-03-10", "saldo_ancora": "0"},
    )

    assert await proxima_data_a_pedir(db_session) == date(2020, 3, 10)


@pytest.mark.asyncio
async def test_proxima_data_a_pedir_caso_normal_devolve_a_ultima_data_guardada(
    cliente_autenticado, db_session
):
    # Já há histórico, e nenhuma conta é mais antiga do que ele — o caso
    # do dia-a-dia: só avançar desde a última vez que o script correu.
    await cliente_autenticado.post(
        "/contas",
        json={"nome": "Conta", "moeda": "EUR", "data_ancora": "2026-01-01", "saldo_ancora": "0"},
    )
    await _semear_taxa(db_session, "USD", date(2026, 1, 1), "1.10")
    await _semear_taxa(db_session, "USD", date(2026, 1, 15), "1.12")  # a mais recente

    assert await proxima_data_a_pedir(db_session) == date(2026, 1, 15)


@pytest.mark.asyncio
async def test_proxima_data_a_pedir_recua_quando_aparece_uma_conta_mais_antiga_depois(
    cliente_autenticado, db_session
):
    # Regressão do caso central desta pergunta: já havia histórico
    # (começado em Junho), mas uma segunda conta com âncora de Janeiro foi
    # criada DEPOIS — a próxima execução do script tem de recuar até lá,
    # sozinha, sem correcção manual nenhuma.
    await _semear_taxa(db_session, "USD", date(2026, 6, 1), "1.09")
    await _semear_taxa(db_session, "USD", date(2026, 9, 1), "1.05")  # a mais recente guardada

    await cliente_autenticado.post(
        "/contas",
        json={"nome": "Conta recente", "moeda": "EUR", "data_ancora": "2026-06-01", "saldo_ancora": "0"},
    )
    await cliente_autenticado.post(
        "/contas",
        json={"nome": "Conta antiga", "moeda": "USD", "data_ancora": "2026-01-10", "saldo_ancora": "0"},
    )

    assert await proxima_data_a_pedir(db_session) == date(2026, 1, 10)


def test_normalizar_resposta_frankfurter_de_um_unico_dia():
    # A forma devolvida por GET /latest ou GET /{data}: um "date" ao nível
    # de topo, e "rates" é directamente moeda -> taxa.
    corpo = {"amount": 1.0, "base": "EUR", "date": "2026-01-15", "rates": {"USD": 1.1, "GBP": 0.85}}

    resultado = normalizar_resposta_frankfurter(corpo)

    assert resultado == {
        date(2026, 1, 15): {"USD": Decimal("1.1"), "GBP": Decimal("0.85")},
    }


def test_normalizar_resposta_frankfurter_de_um_intervalo_de_dias():
    # A forma devolvida por GET /{data_inicio}..: sem "date" ao nível de
    # topo; "rates" é dia -> (moeda -> taxa).
    corpo = {
        "amount": 1.0,
        "base": "EUR",
        "start_date": "2026-01-15",
        "end_date": "2026-01-16",
        "rates": {
            "2026-01-15": {"USD": 1.1, "GBP": 0.85},
            "2026-01-16": {"USD": 1.12, "GBP": 0.86},
        },
    }

    resultado = normalizar_resposta_frankfurter(corpo)

    assert resultado == {
        date(2026, 1, 15): {"USD": Decimal("1.1"), "GBP": Decimal("0.85")},
        date(2026, 1, 16): {"USD": Decimal("1.12"), "GBP": Decimal("0.86")},
    }


@pytest.mark.asyncio
async def test_data_inicio_do_historico_sem_nenhuma_conta_devolve_none(db_session):
    assert await data_inicio_do_historico(db_session) is None


@pytest.mark.asyncio
async def test_data_inicio_do_historico_devolve_a_ancora_mais_antiga(cliente_autenticado, db_session):
    # Duas contas do mesmo utilizador, com âncoras diferentes — a função
    # não filtra por utilizador (a tabela taxas_cambio é partilhada por
    # todos, não por conta), só procura a mais antiga entre TODAS.
    await cliente_autenticado.post(
        "/contas",
        json={
            "nome": "Conta recente",
            "moeda": "EUR",
            "data_ancora": "2026-06-01",
            "saldo_ancora": "100.00",
        },
    )
    await cliente_autenticado.post(
        "/contas",
        json={
            "nome": "Conta antiga",
            "moeda": "USD",
            "data_ancora": "2020-03-10",
            "saldo_ancora": "500.00",
        },
    )

    assert await data_inicio_do_historico(db_session) == date(2020, 3, 10)


def test_normalizar_resposta_frankfurter_converte_o_float_sem_imprecisao_binaria():
    # Regressão: Decimal(0.1 + 0.2) directamente a partir de um float dá
    # "0.3000000000000000444089..." — passar por "str" primeiro evita
    # herdar essa imprecisão binária.
    corpo = {"date": "2026-01-15", "rates": {"USD": 1.1}}

    resultado = normalizar_resposta_frankfurter(corpo)

    assert resultado[date(2026, 1, 15)]["USD"] == Decimal("1.1")
    assert str(resultado[date(2026, 1, 15)]["USD"]) == "1.1"
