"""
SERVIÇO DE RECONCILIAÇÕES E ACERTOS
======================================

Uma RECONCILIAÇÃO é a afirmação «no FIM do dia D, o saldo desta conta era
S». O ACERTO é o movimento que a aplicação cria, no dia D, pela diferença
entre S e o saldo que ela própria calcula para o fim desse dia; com ele, a
partir de D, o saldo é sempre o afirmado.

COMO SE CALCULA O ACERTO (regra R2). Para cada reconciliação, por ordem de
data:
    saldo calculado no fim de D = saldo inicial da conta
                                  + movimentos (que não sejam acertos) até D
                                  + acertos das reconciliações anteriores
    acerto = S − saldo calculado
É o mesmo que partir do saldo da reconciliação anterior (que, com o seu
acerto, é exatamente o afirmado) e somar os movimentos até D. O acerto fica
na categoria reservada "Acerto de saldo" de entrada (se positivo) ou de
saída (se negativo).

SÓ SE CRIA COM ACERTO. Criar ou editar uma reconciliação cujo saldo já bate
certo com o calculado é recusado: não haveria nada a acertar. Mas o acerto
pode passar a zero DEPOIS (por exemplo, quando se regista o movimento que
explicava a diferença): nesse caso a reconciliação fica, sem movimento de
acerto (0,00 €). Continua a guardar o saldo confirmado, e se a diferença
voltar, o acerto volta; eliminá-la é decisão do utilizador.

RECONCILIAÇÕES DO BANCO (regra R7): o saldo afirmado não é fixo — deduz-se
do saldo que o banco informou num instante T, corrigido pelos movimentos
que chegaram depois de T com data antiga (ver _saldo_derivado). Fora isso,
contam como as outras no cálculo dos acertos.

RECALCULAR SOZINHO (regra R4): recalcular_acertos refaz todos os acertos
de uma conta. É chamada sempre que muda alguma coisa de que eles dependem
— um movimento criado, editado, movido ou apagado, a data ou o saldo
inicial da conta, uma reconciliação criada, editada ou apagada, uma
sincronização com o banco. Refazer todos (e não só os afetados) mantém a
regra simples e sempre certa; uma conta tem poucas reconciliações.

AS REGRAS DAS RECONCILIAÇÕES DO UTILIZADOR (R5, R6):
  - só numa conta MANUAL (sem vínculo ao banco): numa conta vinculada, as
    reconciliações vêm do banco;
  - a data é igual ou posterior à data inicial da conta e nunca depois de
    hoje ("hoje" é permitido mesmo com o dia a decorrer: se entrar mais
    algum movimento nesse dia, o acerto recalcula-se);
  - no máximo uma por dia; ao editar, a data fica estritamente entre a
    reconciliação anterior e a seguinte (uma reconciliação não "salta"
    por cima de outra).

Uma operação de cada vez por conta: criar, editar e apagar uma
reconciliação bloqueiam a conta até ao fim da transação.

TRANSAÇÕES: QUEM GRAVA É QUEM CHAMA. Estas funções nunca fazem commit
(tornar as alterações definitivas): enviam-nas com flush() e deixam o
commit para a rota que as chamou, uma vez, no fim do pedido.
"""

import uuid
from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.erros import Conflito, NaoEncontrado, RegraViolada
from app.core.tempo import hoje
from app.models.categoria import Categoria
from app.models.conta import Conta
from app.models.movimento import Movimento
from app.models.reconciliacao import Reconciliacao
from app.models.user import User
from app.models.vinculo import Vinculo
from app.services.bloqueios import bloquear_conta

_DUAS_CASAS = Decimal("0.01")
DESCRICAO_DO_ACERTO = "Acerto de saldo"


@dataclass
class ReconciliacaoComAcerto:
    """Uma reconciliação e o valor do seu acerto (0 se o saldo calculado já batia certo)."""

    reconciliacao: Reconciliacao
    acerto: Decimal


async def _categoria_de_acerto(db: AsyncSession, user_id: uuid.UUID, direcao: str) -> Categoria:
    """
    A categoria reservada "Acerto de saldo" da direção pedida ("entrada" ou
    "saida"). Cada utilizador tem exatamente uma por direção: a árvore por
    omissão cria-as, e um índice único na base de dados impede uma segunda.
    """
    categoria = await db.scalar(
        select(Categoria).where(
            Categoria.user_id == user_id,
            Categoria.papel == "acerto",
            Categoria.direcao == direcao,
        )
    )
    # Só falta se os dados estiverem estragados (a árvore por omissão e a
    # migração das reconciliações criam-na sempre). Mesmo assim, uma
    # mensagem clara em vez de um erro interno (500).
    if categoria is None:
        raise RegraViolada(
            "Falta a categoria «Acerto de saldo» nas tuas categorias, por isso não é possível reconciliar."
        )
    return categoria


async def _somas_por_dia(db: AsyncSession, conta_id: uuid.UUID) -> list[tuple[date, Decimal]]:
    """
    A soma dos movimentos que NÃO são acertos, dia a dia, por ordem de data
    — a base do saldo calculado. Uma só consulta, agrupada por dia.
    """
    resultado = await db.execute(
        select(Movimento.data, func.sum(Movimento.valor))
        .where(Movimento.conta_id == conta_id, Movimento.origem != "acerto")
        .group_by(Movimento.data)
        .order_by(Movimento.data)
    )
    return list(resultado.all())


def _soma_ate(somas: list[tuple[date, Decimal]], dia: date) -> Decimal:
    """A soma dos movimentos (sem acertos) com data igual ou anterior a "dia"."""
    return sum((valor for data, valor in somas if data <= dia), Decimal("0"))


async def _saldo_derivado(db: AsyncSession, reconciliacao: Reconciliacao) -> Decimal:
    """
    O saldo afirmado por uma reconciliação do BANCO, deduzido do saldo que
    o banco informou num instante T (e não fixo):
        S = saldo do banco em T
            − movimentos do banco com data depois de D, importados até T
            + movimentos do banco com data até D, importados depois de T
            − transações de data futura que o banco já contava em T
    O terceiro termo trata dos movimentos ATRASADOS (lançados pelo banco
    dias depois, com a data antiga): não estavam no saldo lido em T, e
    quando chegam somam-se a S, para o acerto não os "comer". O último
    trata das transações já lançadas com uma data FUTURA (um débito
    agendado, por exemplo): estão no saldo do banco, mas só se importam
    quando a data chegar; a sua soma guardou-se em T (futuros_no_banco),
    para não contarem duas vezes. "Importado até T"
    deduz-se da hora de importação de cada movimento (created_at): a
    reconciliação do banco cria-se na mesma transação que uma importação
    completa até T.
    """
    def soma(*condicoes):
        return select(func.coalesce(func.sum(Movimento.valor), 0)).where(
            Movimento.conta_id == reconciliacao.conta_id, Movimento.origem == "banco", *condicoes
        )

    depois_ja_contados = await db.scalar(
        soma(Movimento.data > reconciliacao.data, Movimento.created_at <= reconciliacao.lido_em)
    )
    atrasados = await db.scalar(
        soma(Movimento.data <= reconciliacao.data, Movimento.created_at > reconciliacao.lido_em)
    )
    return (
        reconciliacao.saldo_banco
        - Decimal(depois_ja_contados)
        + Decimal(atrasados)
        - (reconciliacao.futuros_no_banco or Decimal("0"))
    ).quantize(_DUAS_CASAS)


async def recalcular_acertos(db: AsyncSession, conta_id: uuid.UUID) -> None:
    """
    Refaz os acertos de todas as reconciliações da conta, por ordem de data
    (ver COMO SE CALCULA O ACERTO, no topo do ficheiro): cria o movimento de
    acerto que falte, atualiza o que mudou de valor ou de dia, e apaga o
    que deixou de ser preciso (acerto zero).
    """
    conta = await db.get(Conta, conta_id)
    reconciliacoes = (
        await db.scalars(
            select(Reconciliacao).where(Reconciliacao.conta_id == conta_id).order_by(Reconciliacao.data)
        )
    ).all()
    acertos_existentes = {
        movimento.reconciliacao_id: movimento
        for movimento in (
            await db.scalars(
                select(Movimento).where(Movimento.conta_id == conta_id, Movimento.origem == "acerto")
            )
        ).all()
    }
    if not reconciliacoes and not acertos_existentes:
        return

    somas = await _somas_por_dia(db, conta_id)
    acertos_anteriores = Decimal("0")
    for reconciliacao in reconciliacoes:
        # O saldo de uma reconciliação do banco deriva-se de novo, para
        # contar movimentos que tenham chegado atrasados.
        if reconciliacao.origem == "banco":
            reconciliacao.saldo = await _saldo_derivado(db, reconciliacao)
        calculado = conta.saldo_ancora + _soma_ate(somas, reconciliacao.data) + acertos_anteriores
        acerto = (reconciliacao.saldo - calculado).quantize(_DUAS_CASAS)
        existente = acertos_existentes.pop(reconciliacao.id, None)
        if acerto == 0:
            if existente is not None:
                await db.delete(existente)
            continue
        direcao = "entrada" if acerto > 0 else "saida"
        categoria = await _categoria_de_acerto(db, conta.user_id, direcao)
        if existente is None:
            db.add(
                Movimento(
                    conta_id=conta_id,
                    data=reconciliacao.data,
                    descricao=DESCRICAO_DO_ACERTO,
                    valor=acerto,
                    categoria_id=categoria.id,
                    origem="acerto",
                    reconciliacao_id=reconciliacao.id,
                )
            )
        else:
            existente.data = reconciliacao.data
            existente.valor = acerto
            existente.categoria_id = categoria.id
        acertos_anteriores += acerto

    # Acertos sem reconciliação (não deveria acontecer: apagar uma
    # reconciliação apaga o acerto em cascata) — apagam-se por segurança.
    for orfao in acertos_existentes.values():
        await db.delete(orfao)
    await db.flush()


async def simular_acerto(
    db: AsyncSession,
    conta: Conta,
    data: date,
    saldo: Decimal,
    ignorar_reconciliacao_id: uuid.UUID | None = None,
) -> Decimal:
    """
    O acerto que resultaria de afirmar o saldo "saldo" no fim do dia "data",
    sem gravar nada — para mostrar o efeito ANTES de gravar (regra R10: «vai
    entrar um acerto de −32,00 € a 4 set»). "ignorar_reconciliacao_id": ao
    editar uma reconciliação, ela própria não conta.
    """
    somas = await _somas_por_dia(db, conta.id)
    acertos_anteriores = await db.scalar(
        select(func.coalesce(func.sum(Movimento.valor), 0))
        .join(Reconciliacao, Reconciliacao.id == Movimento.reconciliacao_id)
        .where(
            Movimento.conta_id == conta.id,
            Reconciliacao.data < data,
            Reconciliacao.id != (ignorar_reconciliacao_id or uuid.UUID(int=0)),
        )
    )
    calculado = conta.saldo_ancora + _soma_ate(somas, data) + Decimal(acertos_anteriores)
    return (saldo - calculado).quantize(_DUAS_CASAS)


async def _garantir_diferenca(
    db: AsyncSession, conta: Conta, data: date, saldo: Decimal, ignorar_reconciliacao_id: uuid.UUID | None = None
) -> None:
    """
    Uma reconciliação só se cria (ou edita) quando há diferença a acertar:
    se o saldo afirmado já bate certo com o calculado, é recusada (regra R2).
    """
    acerto = await simular_acerto(db, conta, data, saldo.quantize(_DUAS_CASAS), ignorar_reconciliacao_id)
    if acerto == 0:
        raise RegraViolada("O saldo já bate certo neste dia: não há nada a acertar.")


async def _garantir_conta_manual(db: AsyncSession, conta: Conta) -> None:
    """As reconciliações do utilizador só existem numa conta manual (sem vínculo ao banco)."""
    if await db.scalar(select(Vinculo.id).where(Vinculo.conta_id == conta.id)) is not None:
        raise RegraViolada(
            "Numa conta vinculada ao banco, as reconciliações vêm do banco. Desvincula-a para reconciliar à mão."
        )


async def _validar_data(
    db: AsyncSession, conta: Conta, data: date, reconciliacao: Reconciliacao | None = None
) -> None:
    """
    As regras de datas (R5): igual ou depois da data inicial, nunca depois
    de hoje, no máximo uma por dia e, ao editar, estritamente entre a
    reconciliação anterior e a seguinte.
    """
    if data < conta.data_ancora:
        raise RegraViolada("A data da reconciliação não pode ser anterior à data de início da conta.")
    if data > hoje():
        raise RegraViolada("A data da reconciliação não pode ser no futuro.")
    outras = select(Reconciliacao).where(Reconciliacao.conta_id == conta.id)
    if reconciliacao is not None:
        outras = outras.where(Reconciliacao.id != reconciliacao.id)
    if await db.scalar(outras.where(Reconciliacao.data == data)) is not None:
        raise Conflito("Já há uma reconciliação nesse dia.")
    if reconciliacao is not None:
        anterior = await db.scalar(
            select(func.max(Reconciliacao.data)).where(
                Reconciliacao.conta_id == conta.id, Reconciliacao.data < reconciliacao.data
            )
        )
        seguinte = await db.scalar(
            select(func.min(Reconciliacao.data)).where(
                Reconciliacao.conta_id == conta.id, Reconciliacao.data > reconciliacao.data
            )
        )
        if (anterior is not None and data <= anterior) or (seguinte is not None and data >= seguinte):
            raise RegraViolada(
                "A data tem de ficar entre a reconciliação anterior e a seguinte."
            )


async def obter_reconciliacao_do_utilizador(
    db: AsyncSession, utilizador: User, reconciliacao_id: uuid.UUID
) -> tuple[Reconciliacao, Conta]:
    """
    A reconciliação com este id e a sua conta, se a conta for do
    utilizador. NaoEncontrado (404) nos dois casos juntos (não existe, ou é
    de outra pessoa): a resposta não deve revelar qual se aplica.
    """
    resultado = (
        await db.execute(
            select(Reconciliacao, Conta)
            .join(Conta, Conta.id == Reconciliacao.conta_id)
            .where(Reconciliacao.id == reconciliacao_id, Conta.user_id == utilizador.id)
        )
    ).one_or_none()
    if resultado is None:
        raise NaoEncontrado("Reconciliação não encontrada.")
    return resultado[0], resultado[1]


async def listar(db: AsyncSession, conta: Conta) -> list[ReconciliacaoComAcerto]:
    """As reconciliações da conta, por ordem de data, cada uma com o valor do seu acerto."""
    linhas = (
        await db.execute(
            select(Reconciliacao, Movimento.valor)
            .outerjoin(Movimento, Movimento.reconciliacao_id == Reconciliacao.id)
            .where(Reconciliacao.conta_id == conta.id)
            .order_by(Reconciliacao.data)
        )
    ).all()
    return [ReconciliacaoComAcerto(r, valor if valor is not None else Decimal("0")) for r, valor in linhas]


async def criar(db: AsyncSession, conta: Conta, data: date, saldo: Decimal) -> Reconciliacao:
    """Cria uma reconciliação do utilizador numa conta manual e calcula o seu acerto."""
    # Primeiro o bloqueio, depois as verificações: assim, nenhuma outra
    # operação (por exemplo, vincular a conta) pode mudar o que se
    # verificou entre a verificação e a gravação.
    await bloquear_conta(db, conta.id)
    await _garantir_conta_manual(db, conta)
    await _validar_data(db, conta, data)
    await _garantir_diferenca(db, conta, data, saldo)
    reconciliacao = Reconciliacao(
        conta_id=conta.id, data=data, saldo=saldo.quantize(_DUAS_CASAS), origem="utilizador"
    )
    db.add(reconciliacao)
    await db.flush()
    await recalcular_acertos(db, conta.id)
    await db.refresh(reconciliacao)
    return reconciliacao


async def editar(
    db: AsyncSession, reconciliacao: Reconciliacao, conta: Conta, data: date, saldo: Decimal
) -> Reconciliacao:
    """
    Muda a data e o saldo de uma reconciliação do utilizador (numa conta
    manual), e recalcula os acertos. As reconciliações do banco não se
    editam: só existem com o vínculo, e passam a do utilizador ao
    desvincular.
    """
    # Primeiro o bloqueio, e só depois se lê e verifica: outra operação
    # (vincular a conta, por exemplo) pode ter mudado esta reconciliação
    # entretanto. refresh() volta a ler a linha da base de dados.
    await bloquear_conta(db, conta.id)
    await db.refresh(reconciliacao)
    if reconciliacao.origem != "utilizador":
        raise RegraViolada("Uma reconciliação do banco não se edita.")
    await _garantir_conta_manual(db, conta)
    await _validar_data(db, conta, data, reconciliacao)
    await _garantir_diferenca(db, conta, data, saldo, reconciliacao.id)
    reconciliacao.data = data
    reconciliacao.saldo = saldo.quantize(_DUAS_CASAS)
    await db.flush()
    await recalcular_acertos(db, conta.id)
    await db.refresh(reconciliacao)
    return reconciliacao


async def apagar(db: AsyncSession, reconciliacao: Reconciliacao, conta: Conta) -> None:
    """
    Apaga uma reconciliação do utilizador (numa conta manual): o seu acerto
    vai com ela (em cascata), e os acertos seguintes recalculam-se.
    """
    # Primeiro o bloqueio, e só depois se lê e verifica: outra operação
    # (vincular a conta, por exemplo) pode ter mudado esta reconciliação
    # entretanto. refresh() volta a ler a linha da base de dados.
    await bloquear_conta(db, conta.id)
    await db.refresh(reconciliacao)
    if reconciliacao.origem != "utilizador":
        raise RegraViolada("Uma reconciliação do banco não se apaga.")
    await _garantir_conta_manual(db, conta)
    await db.delete(reconciliacao)
    await db.flush()
    await recalcular_acertos(db, conta.id)
