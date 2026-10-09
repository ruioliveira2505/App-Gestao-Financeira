"""
SERVIÇO DE AUTORIZAÇÕES: LISTAR, REVOGAR, ESQUECER, TERMINAR
===============================================================

Uma AUTORIZAÇÃO é o consentimento que o utilizador dá no banco para a
aplicação ler as contas que escolheu partilhar, durante um prazo. Cada
conta partilhada é uma CONTA BANCÁRIA; o VÍNCULO é o facto de uma conta
bancária alimentar uma CONTA da aplicação.

O estado de uma autorização (ativa ou terminada) nunca se guarda: deduz-se
dos factos (ver app/services/estados.py). Este serviço trata das ações que
MUDAM esses factos:
  - REVOGAR: terminar uma autorização ativa antes do prazo. Avisa a Enable
    Banking (o intermediário que fala com o banco) para terminar a sessão;
    se isso falhar por um problema de rede ou do serviço, a autorização
    continua ativa e o erro chega ao utilizador, para tentar outra vez;
  - ESQUECER: apagar uma autorização TERMINADA (uma ativa revoga-se
    primeiro). Apaga as suas contas bancárias e, com elas, os vínculos: as
    Contas que estavam suspensas passam a manuais, com os movimentos e a
    memória (a identificação da conta real, que permite reconhecê-la numa
    autorização futura);
  - MARCAR O QUE O BANCO RESPONDEU: quando o banco diz que a sessão já não
    vale, a autorização fica terminada logo aí (motivo "banco"); quando diz
    que uma conta já não existe, a conta bancária fica indisponível;
  - TERMINAR A ANTIGA AO RENOVAR: quando uma autorização nova renova uma
    que ainda estava ativa, a antiga é revogada, para nunca haver duas
    ativas no mesmo acesso;
  - APAGAR OS PEDIDOS EXPIRADOS: um pedido de autorização (a linha que
    guarda o "state" enquanto o utilizador está no site do banco) expira
    ao fim de 15 minutos e deixa de servir para alguma coisa.

TRANSAÇÕES: QUEM GRAVA É QUEM CHAMA. Estas funções nunca fazem commit
(tornar as alterações definitivas): enviam-nas com flush() e deixam o
commit para a rota que as chamou, uma vez, no fim do pedido.
"""

import logging
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.erros import Conflito, ErroDeDominio, NaoEncontrado
from app.models.autorizacao import Autorizacao
from app.models.autorizacao_pendente import AutorizacaoPendente
from app.models.conta_bancaria import ContaBancaria
from app.models.vinculo import Vinculo
from app.services.bloqueios import bloquear_conta
from app.services.enable_banking import revogar_sessao
from app.services.estados import estado_autorizacao
from app.services.reconciliacoes import recalcular_acertos
from app.services.vinculacao import passar_reconciliacoes_a_do_utilizador

# O registo (log) deste ficheiro: mensagens para quem opera o servidor.
_registo = logging.getLogger(__name__)

# Quanto tempo um pedido de autorização espera pelo regresso do banco.
# Depois disso, o regresso é recusado e o pedido pode ser apagado.
VALIDADE_DO_PEDIDO = timedelta(minutes=15)


def _agora() -> datetime:
    return datetime.now(timezone.utc)


async def obter_autorizacao_do_utilizador(
    db: AsyncSession, user_id: uuid.UUID, autorizacao_id: uuid.UUID
) -> Autorizacao:
    """
    A autorização com este id, se pertencer ao utilizador. NaoEncontrado
    (404) nos dois casos juntos (não existe, ou é de outra pessoa): a
    resposta não deve revelar qual dos dois se aplica.
    """
    autorizacao = await db.get(Autorizacao, autorizacao_id)
    if autorizacao is None or autorizacao.user_id != user_id:
        raise NaoEncontrado("Autorização não encontrada.")
    return autorizacao


async def listar_autorizacoes(
    db: AsyncSession, user_id: uuid.UUID
) -> list[tuple[Autorizacao, int]]:
    """
    As autorizações do utilizador, da mais recente para a mais antiga, cada
    uma com o número de contas bancárias vinculadas (as que alimentam uma
    Conta). Uma só consulta: as autorizações e, por junção, a contagem dos
    vínculos das suas contas bancárias.
    """
    resultado = await db.execute(
        select(Autorizacao, func.count(Vinculo.id))
        .outerjoin(ContaBancaria, ContaBancaria.autorizacao_id == Autorizacao.id)
        .outerjoin(Vinculo, Vinculo.conta_bancaria_id == ContaBancaria.id)
        .where(Autorizacao.user_id == user_id)
        .group_by(Autorizacao.id)
        .order_by(Autorizacao.created_at.desc())
    )
    return [(autorizacao, contagem) for autorizacao, contagem in resultado.all()]


async def revogar(db: AsyncSession, autorizacao: Autorizacao) -> None:
    """
    Termina uma autorização ATIVA antes do prazo. Conflito (409) se já
    estiver terminada. Primeiro pede à Enable Banking para terminar a
    sessão (uma sessão que já não existia conta como feita); se esse pedido
    falhar, o erro propaga-se e nada muda aqui.
    """
    if estado_autorizacao(autorizacao) == "terminada":
        raise Conflito("Esta autorização já terminou.")
    await revogar_sessao(autorizacao.session_id)
    autorizacao.terminada_em = _agora()
    autorizacao.motivo = "revogada"
    await db.flush()


async def esquecer(db: AsyncSession, autorizacao: Autorizacao) -> None:
    """
    Apaga uma autorização TERMINADA, com as suas contas bancárias e os
    vínculos delas. Conflito (409) se ainda estiver ativa: revoga-se
    primeiro. As Contas que estes vínculos alimentavam ficam manuais, com
    todos os movimentos (os do banco continuam com origem "banco") e com a
    memória. Cada uma dessas Contas fica bloqueada durante a operação (uma
    operação de cada vez por Conta).
    """
    if estado_autorizacao(autorizacao) == "ativa":
        raise Conflito("Revoga esta autorização antes de a esquecer.")
    contas_afetadas = (
        await db.scalars(
            select(Vinculo.conta_id)
            .join(ContaBancaria, ContaBancaria.id == Vinculo.conta_bancaria_id)
            .where(ContaBancaria.autorizacao_id == autorizacao.id)
        )
    ).all()
    for conta_id in contas_afetadas:
        await bloquear_conta(db, conta_id)
    # Esquecer equivale a desvincular com "manter tudo" cada Conta suspensa:
    # as reconciliações do banco passam a ser do utilizador (senão ficariam
    # bloqueadas para sempre, sem vínculo que o justificasse).
    vinculos = (
        await db.scalars(
            select(Vinculo.id)
            .join(ContaBancaria, ContaBancaria.id == Vinculo.conta_bancaria_id)
            .where(ContaBancaria.autorizacao_id == autorizacao.id)
        )
    ).all()
    await passar_reconciliacoes_a_do_utilizador(db, list(vinculos))
    # Apagar a autorização apaga em cascata as suas contas bancárias e, com
    # elas, os vínculos (chaves estrangeiras com ON DELETE CASCADE). Os
    # movimentos ficam: o seu vinculo_id passa a vazio (ON DELETE SET NULL).
    await db.delete(autorizacao)
    await db.flush()
    for conta_id in contas_afetadas:
        await recalcular_acertos(db, conta_id)


async def marcar_terminada_pelo_banco(db: AsyncSession, autorizacao: Autorizacao) -> None:
    """
    Regista que o banco respondeu que esta autorização já não vale (regra
    A7): fica terminada logo aí, com o motivo "banco". As Contas que ela
    alimentava passam a suspensas (deduzido, nada mais se escreve).
    """
    if autorizacao.terminada_em is None:
        autorizacao.terminada_em = _agora()
        autorizacao.motivo = "banco"
        await db.flush()


async def marcar_indisponivel(db: AsyncSession, conta_bancaria: ContaBancaria) -> None:
    """
    Regista que o banco respondeu que esta conta já não existe ou deixou de
    ser partilhada: fica indisponível, e a Conta que alimentava passa a
    suspensa (deduzido).
    """
    if conta_bancaria.indisponivel_em is None:
        conta_bancaria.indisponivel_em = _agora()
        await db.flush()


async def terminar_a_renovada(db: AsyncSession, nova: Autorizacao) -> str | None:
    """
    Se a autorização "nova" renova outra que ainda está ATIVA, dá a antiga
    como terminada (revogada): nunca há duas autorizações ativas no mesmo
    acesso. Chamada quando a nova já está gravada.

    Devolve o identificador da sessão antiga no banco, para quem chama a
    revogar na Enable Banking DEPOIS do commit (ver
    revogar_sessao_sem_falhar); None se não houver nada a revogar.

    PORQUÊ DEPOIS DO COMMIT: revogar no banco não tem volta atrás. Se se
    revogasse primeiro e o commit falhasse a seguir, o consentimento
    antigo perdia-se no banco e o novo não ficava gravado na aplicação.
    Ao contrário, se o commit correr bem e a revogação falhar, a
    aplicação já trata a antiga como terminada, e a sessão no banco
    expira sozinha no fim do prazo.
    """
    if nova.renova_id is None:
        return None
    antiga = await db.get(Autorizacao, nova.renova_id)
    if antiga is None or estado_autorizacao(antiga) == "terminada":
        return None
    antiga.terminada_em = _agora()
    antiga.motivo = "revogada"
    await db.flush()
    return antiga.session_id


async def revogar_sessao_sem_falhar(session_id: str) -> None:
    """
    Pede à Enable Banking para terminar uma sessão, sem deixar uma falha
    estragar o que já correu bem (a renovação, já gravada): a falha fica
    só no registo do servidor.
    """
    try:
        await revogar_sessao(session_id)
    except ErroDeDominio as erro:
        _registo.warning("Não foi possível revogar a sessão antiga ao renovar: %s", erro.mensagem)


async def apagar_pedidos_expirados(db: AsyncSession) -> int:
    """
    Apaga os pedidos de autorização (de qualquer utilizador) com mais de
    15 minutos: o utilizador começou uma autorização e não voltou do
    banco, ou voltou tarde demais. Devolve quantos apagou.

    Corre sempre que uma autorização nova começa e na rotina de
    manutenção diária (app/services/manutencao.py), para os pedidos não
    se acumularem quando ninguém autoriza nada durante muito tempo.
    """
    resultado = await db.execute(
        delete(AutorizacaoPendente).where(AutorizacaoPendente.created_at < _agora() - VALIDADE_DO_PEDIDO)
    )
    return resultado.rowcount
