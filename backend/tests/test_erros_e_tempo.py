"""
TESTES DOS ERROS DE DOMÍNIO E DA DATA DE HOJE
================================================

Dois pedaços pequenos da base da aplicação:

- Os ERROS DE DOMÍNIO (app/core/erros.py) são os erros que a lógica de
  negócio lança ("conta não encontrada", "nome repetido"…), sem saber nada
  de HTTP. Um único tradutor, registado na aplicação, transforma-os numa
  resposta HTTP com o código certo e o corpo {"detail": mensagem} — o
  mesmo formato de sempre, para o frontend não notar diferença.

- hoje() (app/core/tempo.py) é a data civil em Lisboa, e não a do relógio
  do servidor: um servidor em UTC (o tempo universal coordenado) ainda
  está no dia anterior entre a meia-noite e a uma da manhã de Lisboa, no
  horário de verão.

FERRAMENTAS USADAS:
  - "monkeypatch", uma ferramenta do pytest que troca um valor só durante
    um teste e o repõe no fim — aqui, para fixar o relógio num instante
    escolhido;
  - "cliente_autenticado", um cliente HTTP já com sessão iniciada,
    preparado em tests/conftest.py (o ficheiro de preparação partilhado
    pelos testes), que chama a aplicação em memória;
  - para o tradutor, monta-se uma aplicação FastAPI mínima, só com uma
    rota que lança o erro escolhido, para testar o tradutor sem depender
    de nenhuma rota real.
"""

import uuid
from datetime import datetime, timezone

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.core import tempo
from app.core.erros import (
    AutorizacaoTerminadaNoBanco,
    BancoIndisponivel,
    BancoLento,
    Conflito,
    DadosInvalidos,
    NaoEncontrado,
    RegraViolada,
    registar_tradutor,
)


def _fixar_relogio(monkeypatch, instante: datetime) -> None:
    """
    Substitui o "datetime" usado dentro de app.core.tempo por uma versão
    cujo "now" devolve sempre "instante", convertido para o fuso que lhe
    pedirem — tal como o verdadeiro faria nesse momento.
    """

    class DatetimeFixo(datetime):
        @classmethod
        def now(cls, tz=None):
            return instante.astimezone(tz)

    monkeypatch.setattr(tempo, "datetime", DatetimeFixo)


@pytest.mark.parametrize(
    ("classe", "codigo"),
    [
        (RegraViolada, 400),
        (NaoEncontrado, 404),
        (Conflito, 409),
        (AutorizacaoTerminadaNoBanco, 409),
        (DadosInvalidos, 422),
        (BancoIndisponivel, 502),
        (BancoLento, 504),
    ],
)
@pytest.mark.asyncio
async def test_tradutor_da_a_cada_erro_o_seu_codigo_e_a_mensagem(classe, codigo):
    aplicacao = FastAPI()
    registar_tradutor(aplicacao)

    @aplicacao.get("/x")
    async def lancar():
        raise classe("mensagem com acentos: é ç")

    async with AsyncClient(transport=ASGITransport(app=aplicacao), base_url="https://t") as cliente:
        resposta = await cliente.get("/x")

    assert resposta.status_code == codigo
    assert resposta.json() == {"detail": "mensagem com acentos: é ç"}


@pytest.mark.asyncio
async def test_erro_de_dominio_numa_rota_real(cliente_autenticado):
    # Uma conta que não existe: o serviço lança NaoEncontrado, e a API
    # responde 404 com a mensagem no campo "detail".
    resposta = await cliente_autenticado.get(f"/contas/{uuid.uuid4()}")

    assert resposta.status_code == 404
    assert resposta.json() == {"detail": "Conta não encontrada."}


@pytest.mark.parametrize(
    ("instante_utc", "data_em_lisboa"),
    [
        # Verão (Lisboa = UTC+1): às 23h59 UTC já é o dia seguinte em Lisboa.
        (datetime(2026, 7, 2, 22, 59, tzinfo=timezone.utc), "2026-07-02"),
        (datetime(2026, 7, 2, 23, 30, tzinfo=timezone.utc), "2026-07-03"),
        # Inverno (Lisboa = UTC+0): a data é a mesma.
        (datetime(2026, 1, 15, 23, 30, tzinfo=timezone.utc), "2026-01-15"),
        # Passagem de ano, no inverno: ainda é 31 de dezembro.
        (datetime(2026, 12, 31, 23, 59, tzinfo=timezone.utc), "2026-12-31"),
        # A hora de verão acaba às 01h00 UTC de 25 de outubro de 2026: na
        # véspera ainda é verão (UTC+1); depois, já é inverno (UTC+0).
        (datetime(2026, 10, 24, 23, 30, tzinfo=timezone.utc), "2026-10-25"),
        (datetime(2026, 10, 25, 23, 30, tzinfo=timezone.utc), "2026-10-25"),
    ],
)
def test_hoje_e_a_data_em_lisboa_e_nao_a_do_servidor(monkeypatch, instante_utc, data_em_lisboa):
    _fixar_relogio(monkeypatch, instante_utc)

    assert tempo.hoje().isoformat() == data_em_lisboa


@pytest.mark.asyncio
async def test_criar_conta_aceita_hoje_em_lisboa_quando_o_utc_ainda_e_ontem(
    cliente_autenticado, monkeypatch
):
    """
    2 de julho, 23h30 UTC = 3 de julho, 00h30 em Lisboa. Uma conta com data
    inicial 3 de julho é aceite (com a data do servidor em UTC, seria
    recusada como "no futuro"); 4 de julho continua a ser o futuro.
    """
    _fixar_relogio(monkeypatch, datetime(2026, 7, 2, 23, 30, tzinfo=timezone.utc))
    base = {"nome": "Carteira", "moeda": "EUR", "saldo_ancora": "0"}

    aceite = await cliente_autenticado.post("/contas", json={**base, "data_ancora": "2026-07-03"})
    futuro = await cliente_autenticado.post(
        "/contas", json={**base, "nome": "Outra", "data_ancora": "2026-07-04"}
    )

    assert aceite.status_code == 201
    assert futuro.status_code == 400
    assert futuro.json()["detail"] == "A data de início não pode ser no futuro."
