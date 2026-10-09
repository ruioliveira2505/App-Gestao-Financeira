"""
TESTES DA ROTINA DE MANUTENÇÃO (app/services/manutencao.py)
==============================================================

A rotina de manutenção é o que o servidor corre sozinho, ao arrancar e
uma vez por dia, para manter a base de dados em dia:
  - apaga as sessões de login expiradas e os pedidos de autorização ao
    banco expirados (com mais de 15 minutos);
  - atualiza as taxas de câmbio com os dias em falta.

O que se verifica aqui:
  - só se apaga o que expirou (o que ainda vale fica);
  - as taxas recebidas gravam-se, pedidas a partir da data certa;
  - uma falha da fonte das taxas não impede a limpeza (cada tarefa corre
    na sua transação);
  - uma tarefa que outra execução já está a fazer é saltada (o bloqueio
    "advisory lock" do PostgreSQL, um bloqueio que a aplicação usa para
    garantir que só uma execução faz cada tarefa de cada vez);
  - a rotina está ligada ao arranque do servidor (o "ciclo de vida" da
    aplicação, em app/main.py): lança-se ao arrancar, cancela-se ao
    desligar, e não se lança com MANUTENCAO_AUTOMATICA=false.

A Frankfurter API (a fonte real das taxas) nunca é chamada: cada teste
passa uma função falsa no lugar da que faz o pedido de rede.
"""

import asyncio
import uuid
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import httpx
import pytest
from sqlalchemy import func, select, text

from app import main as principal
from app.core.config import settings
from app.db.session import engine
from app.models.autorizacao_pendente import AutorizacaoPendente
from app.models.session import UserSession
from app.models.taxa_cambio import TaxaCambio
from app.models.user import User
from app.services.manutencao import (
    _BLOQUEIO_LIMPEZA,
    _BLOQUEIO_MANUTENCAO,
    atualizar_taxas,
    correr_manutencao,
    limpar_expirados,
)


async def _utilizador(db_session) -> User:
    return await db_session.scalar(select(User).where(User.email == "teste@example.com"))


async def _semear_expirados_e_validos(db_session, user_id: uuid.UUID) -> None:
    """Uma sessão e um pedido expirados, e um pedido ainda válido."""
    agora = datetime.now(timezone.utc)
    db_session.add(
        UserSession(token_hash=f"expirada-{uuid.uuid4()}", user_id=user_id, expires_at=agora - timedelta(minutes=1))
    )
    velho = AutorizacaoPendente(state="velho", user_id=user_id)
    db_session.add_all([velho, AutorizacaoPendente(state="recente", user_id=user_id)])
    await db_session.flush()
    velho.created_at = agora - timedelta(minutes=16)
    await db_session.commit()


def _fabrica_de_teste(db_session):
    """
    Uma "fábrica" de sessões que entrega sempre a sessão de teste (e não a
    fecha no fim), para a rotina trabalhar dentro da transação do teste,
    que é desfeita no fim.
    """

    @asynccontextmanager
    async def fabrica():
        yield db_session

    return fabrica


async def _contar(db_session, modelo, *condicoes) -> int:
    return await db_session.scalar(select(func.count()).select_from(modelo).where(*condicoes))


@pytest.mark.asyncio
async def test_limpeza_apaga_so_o_que_expirou(cliente_autenticado, db_session):
    utilizador = await _utilizador(db_session)
    await _semear_expirados_e_validos(db_session, utilizador.id)

    resultado = await limpar_expirados(db_session)

    # 1 sessão expirada (a do login de teste ainda vale), 1 pedido velho.
    assert resultado == (1, 1)
    assert await _contar(db_session, UserSession, UserSession.user_id == utilizador.id) == 1
    estados = (await db_session.scalars(select(AutorizacaoPendente.state))).all()
    assert estados == ["recente"]


@pytest.mark.asyncio
async def test_taxas_pedidas_desde_a_ultima_guardada_e_gravadas(db_session):
    db_session.add(TaxaCambio(data=date(2026, 9, 17), moeda="USD", por_1_eur=Decimal("1.1")))
    await db_session.commit()
    pedidos: list[date | None] = []

    async def obter_falso(data_inicio):
        pedidos.append(data_inicio)
        return {
            date(2026, 9, 18): {"USD": Decimal("1.12")},
            date(2026, 9, 17): {"USD": Decimal("1.11")},
        }

    dias = await atualizar_taxas(db_session, obter_falso)

    assert pedidos == [date(2026, 9, 17)]
    assert dias == [date(2026, 9, 17), date(2026, 9, 18)]  # por ordem
    # O dia que já existia foi atualizado, não duplicado.
    assert await db_session.scalar(
        select(TaxaCambio.por_1_eur).where(TaxaCambio.data == date(2026, 9, 17))
    ) == Decimal("1.11")
    assert await _contar(db_session, TaxaCambio) == 2


@pytest.mark.asyncio
async def test_falha_das_taxas_nao_impede_a_limpeza(cliente_autenticado, db_session):
    utilizador = await _utilizador(db_session)
    await _semear_expirados_e_validos(db_session, utilizador.id)

    async def obter_em_baixo(_data_inicio):
        raise httpx.ConnectError("sem rede")

    resumo = await correr_manutencao(_fabrica_de_teste(db_session), obter_em_baixo)

    assert resumo.sessoes_apagadas == 1
    assert resumo.pedidos_apagados == 1
    assert resumo.dias_de_taxas is None
    assert resumo.erros == ["Taxas de câmbio: sem rede"]
    assert await _contar(db_session, AutorizacaoPendente, AutorizacaoPendente.state == "velho") == 0


@pytest.mark.asyncio
async def test_execucao_completa_sem_falhas(db_session):
    async def obter_falso(_data_inicio):
        return {date(2026, 10, 9): {"USD": Decimal("1.1")}}

    resumo = await correr_manutencao(_fabrica_de_teste(db_session), obter_falso)

    assert resumo.erros == []
    assert resumo.saltadas == []
    assert resumo.sessoes_apagadas == 0
    assert resumo.dias_de_taxas == [date(2026, 10, 9)]


@pytest.mark.asyncio
async def test_tarefa_ja_em_curso_noutra_execucao_e_saltada(db_session):
    # Outra ligação à base de dados (como outro processo do servidor) fica
    # com o bloqueio da limpeza; esta execução tem de a saltar.
    async with engine.connect() as outra_ligacao:
        transacao = await outra_ligacao.begin()
        await outra_ligacao.execute(
            text("SELECT pg_advisory_xact_lock(:manutencao, :tarefa)"),
            {"manutencao": _BLOQUEIO_MANUTENCAO, "tarefa": _BLOQUEIO_LIMPEZA},
        )

        async def obter_falso(_data_inicio):
            return {}

        resumo = await correr_manutencao(_fabrica_de_teste(db_session), obter_falso)
        await transacao.rollback()

    assert resumo.saltadas == ["limpeza"]
    assert resumo.sessoes_apagadas is None
    assert resumo.dias_de_taxas == []  # a outra tarefa correu na mesma


# Os testes do ciclo de vida usam este contador em vez da rotina real: o que
# interessa é se o servidor a lança e a cancela, não o que ela faz (já
# coberto acima).
class _RotinaFalsa:
    def __init__(self):
        self.arrancou = False
        self.cancelada = False

    async def __call__(self):
        self.arrancou = True
        try:
            await asyncio.Event().wait()  # fica à espera para sempre, como a real
        except asyncio.CancelledError:
            self.cancelada = True
            raise


@pytest.mark.asyncio
async def test_servidor_lanca_a_rotina_ao_arrancar_e_cancela_ao_desligar(monkeypatch):
    rotina = _RotinaFalsa()
    monkeypatch.setattr(principal, "manutencao_periodica", rotina)
    monkeypatch.setattr(settings, "manutencao_automatica", True)

    # ciclo_de_vida(app) é o que o servidor corre: a parte antes do "yield"
    # ao arrancar, a parte depois ao desligar. Aqui corre-se à mão, porque
    # o cliente de testes fala com a aplicação sem a "arrancar".
    async with principal.ciclo_de_vida(principal.app):
        await asyncio.sleep(0)  # dá à tarefa de fundo a vez de começar
        assert rotina.arrancou
        assert not rotina.cancelada

    assert rotina.cancelada


@pytest.mark.asyncio
async def test_com_a_manutencao_automatica_desligada_nada_e_lancado(monkeypatch):
    rotina = _RotinaFalsa()
    monkeypatch.setattr(principal, "manutencao_periodica", rotina)
    monkeypatch.setattr(settings, "manutencao_automatica", False)

    async with principal.ciclo_de_vida(principal.app):
        await asyncio.sleep(0)

    assert not rotina.arrancou


@pytest.mark.asyncio
async def test_uma_falha_inesperada_nao_termina_o_ciclo_da_manutencao(monkeypatch):
    """
    Se correr_manutencao rebentar com uma exceção que não apanhou (por
    exemplo, a ligação à base de dados cair), o ciclo regista-a e volta a
    correr no intervalo seguinte, em vez de terminar para sempre.
    """
    from app.services import manutencao

    chamadas = 0

    async def correr_e_falhar():
        nonlocal chamadas
        chamadas += 1
        if chamadas == 1:
            raise RuntimeError("a ligação caiu")
        if chamadas == 3:
            raise asyncio.CancelledError  # o servidor a desligar: o ciclo termina

    monkeypatch.setattr(manutencao, "correr_manutencao", correr_e_falhar)
    monkeypatch.setattr(manutencao, "ATRASO_INICIAL", timedelta(0))
    monkeypatch.setattr(manutencao, "INTERVALO", timedelta(0))

    with pytest.raises(asyncio.CancelledError):
        await manutencao.manutencao_periodica()

    assert chamadas == 3
