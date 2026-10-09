"""
SERVIÇO DE CONTAS
====================

As regras de negócio das CONTAS (as contas que o utilizador acompanha na
aplicação) e as consultas que mais do que um ficheiro precisa:

- obter_conta_do_utilizador: confirma que uma conta pertence ao
  utilizador autenticado antes de a mostrar, editar, apagar, ou de lhe
  associar um movimento.

- criar_conta, editar_conta, apagar_conta: as três operações sobre uma
  conta, com as suas regras (a data inicial nunca no futuro, o nome único,
  o que pode mudar numa conta com movimentos ou com vínculo ao banco).

- garantir_nome_livre e gravar_conta: o nome de uma conta é único por
  utilizador, comparado sem acentos nem maiúsculas (verificado no código,
  para a mensagem certa, e garantido pela base de dados).

- soma_movimentos / somas_de_movimentos: a soma dos movimentos de uma ou
  de várias contas, base do saldo atual.

- editar_ancora e simular_ancora: mudar a data e o saldo iniciais de uma
  conta manual (a "âncora"), e ver o efeito antes de gravar.

AS ROTAS NÃO TÊM REGRAS. Uma rota (o código que responde a um pedido
HTTP) recebe os dados já validados no formato, chama uma destas funções e
devolve o resultado. As regras ficam aqui, num só sítio, para valerem da
mesma forma seja quem for que as chame (uma rota, um script, um teste).
Quando uma regra é violada, estas funções lançam um ERRO DE DOMÍNIO (um
erro da lógica de negócio, com uma mensagem para o utilizador), que a API
traduz no código HTTP certo.

TRANSAÇÕES: QUEM GRAVA É QUEM CHAMA. Uma transação é um conjunto de
alterações à base de dados que ficam todas definitivas juntas (commit) ou
são todas desfeitas. Estas funções nunca fazem commit: enviam as
alterações com flush() (visíveis dentro da transação, ainda não
definitivas) e deixam o commit para quem as chamou, uma vez, no fim.
"""

import uuid
from datetime import date
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.erros import Conflito, NaoEncontrado, RegraViolada
from app.core.tempo import hoje
from app.models.conta import Conta
from app.models.movimento import Movimento
from app.models.reconciliacao import Reconciliacao
from app.models.user import User
from app.services.bloqueios import bloquear_conta
from app.services.contas_bancarias import conta_tem_vinculo
from app.services.nomes import normalizar_nome
from app.services.reconciliacoes import recalcular_acertos


async def obter_conta_do_utilizador(
    db: AsyncSession, utilizador: User, conta_id: uuid.UUID
) -> Conta:
    """
    Devolve a conta com este id, se pertencer ao utilizador. Caso
    contrário — não existe, ou é de outro utilizador — lança NaoEncontrado
    (que a API traduz em 404), nunca uma recusa de acesso (403): para este utilizador, uma conta que não é sua é, para todos os
    efeitos, inexistente, e a resposta não deve sequer revelar que o id
    corresponde a alguma conta (de outra pessoa).
    """
    resultado = await db.execute(
        select(Conta).where(Conta.id == conta_id, Conta.user_id == utilizador.id)
    )
    conta = resultado.scalar_one_or_none()
    if conta is None:
        raise NaoEncontrado("Conta não encontrada.")
    return conta


async def garantir_nome_livre(
    db: AsyncSession,
    user_id: uuid.UUID,
    nome: str,
    ignorar_conta_id: uuid.UUID | None = None,
) -> None:
    """
    Lança Conflito (que a API traduz em 409) se o utilizador já tiver
    outra conta com este nome — comparado sem acentos nem maiúsculas (ver
    normalizar_nome, em app/services/nomes.py).

    PORQUÊ: o nome é a única coisa que distingue as contas em todo o lado
    — na lista, no seletor de conta de um movimento, nos filtros. Duas
    contas chamadas "Carteira" seriam indistinguíveis em todos esses
    sítios.

    "ignorar_conta_id": ao EDITAR, a própria conta não conta como conflito
    (guardar sem mudar o nome tem de continuar a funcionar).

    Compara pela coluna nome_normalizado (o nome já reduzido à forma de
    comparar). Esta verificação dá a mensagem certa ("Já tens uma conta
    chamada «X»") no caso comum; a GARANTIA é o índice único sobre
    (utilizador, nome_normalizado) na base de dados, que apanha também dois
    pedidos ao mesmo tempo (ver gravar_conta, abaixo).
    """
    consulta = select(Conta.nome).where(
        Conta.user_id == user_id, Conta.nome_normalizado == normalizar_nome(nome)
    )
    if ignorar_conta_id is not None:
        consulta = consulta.where(Conta.id != ignorar_conta_id)
    nome_existente = (await db.execute(consulta.limit(1))).scalar_one_or_none()
    if nome_existente is not None:
        raise Conflito(f"Já tens uma conta chamada «{nome_existente}».")


async def gravar_conta(db: AsyncSession) -> None:
    """
    Envia as alterações a uma conta para a base de dados (flush), e
    traduz a recusa do índice único do nome num Conflito (409).

    PORQUÊ É PRECISO, SE garantir_nome_livre JÁ VERIFICOU: entre verificar
    e gravar há um intervalo. Dois pedidos ao mesmo tempo (por exemplo, um
    duplo clique em "Guardar") podem verificar os dois antes de qualquer
    um gravar, e passar os dois. O índice único sobre (utilizador,
    nome_normalizado) recusa o segundo, com um IntegrityError (o erro do
    SQLAlchemy para uma restrição da base de dados violada). Sem esta
    tradução, o utilizador veria um erro genérico "500"; com ela, vê a
    mesma mensagem de nome repetido. Qualquer outra violação continua a
    ser lançada tal como é: seria um erro de programação, não do
    utilizador.
    """
    try:
        await db.flush()
    except IntegrityError as erro:
        if "ux_contas_user_id_nome_normalizado" in str(erro.orig):
            raise Conflito("Já tens uma conta com este nome.") from erro
        raise


async def soma_movimentos(db: AsyncSession, conta_id: uuid.UUID) -> Decimal:
    """
    Soma o "valor" (com sinal) de todos os movimentos de uma conta. 0 se
    não houver nenhum.

    SEM filtro por data aqui, mesmo sabendo que um movimento nunca pode
    ser anterior à data-âncora da conta (ver app/models/conta.py): essa
    regra já é imposta ao criar e ao editar um movimento, incluindo ao "mover" um movimento de uma conta para outra.
    Como nenhum movimento anterior à âncora chega a existir na base de
    dados, somar sem filtro de data dá exactamente o mesmo resultado que
    somar só os posteriores à âncora — mas sem repetir aqui uma
    verificação que já está garantida noutro lado.
    """
    resultado = await db.execute(
        select(func.coalesce(func.sum(Movimento.valor), 0)).where(
            Movimento.conta_id == conta_id
        )
    )
    return resultado.scalar_one()


async def somas_de_movimentos(
    db: AsyncSession, conta_ids: list[uuid.UUID]
) -> dict[uuid.UUID, Decimal]:
    """
    A mesma soma que soma_movimentos, mas para várias contas de uma vez
    (uma query, agrupada por conta_id) — usada nas listagens, para não
    repetir uma query por conta (problema "N+1").
    """
    if not conta_ids:
        return {}
    resultado = await db.execute(
        select(Movimento.conta_id, func.sum(Movimento.valor))
        .where(Movimento.conta_id.in_(conta_ids))
        .group_by(Movimento.conta_id)
    )
    return dict(resultado.all())


# Usado para normalizar os valores monetários a 2 casas decimais, coerente
# com a coluna Numeric(14, 2).
_DUAS_CASAS = Decimal("0.01")


async def _tem_movimentos(db: AsyncSession, conta_id: uuid.UUID) -> bool:
    """
    True se a conta tiver pelo menos um movimento. Não é o mesmo que "a
    soma dos movimentos é diferente de 0": uma conta pode ter movimentos
    cujo total dá exatamente 0 (ex.: +50 e -50). limit(1): só interessa
    saber se existe algum, não quantos.
    """
    resultado = await db.execute(
        select(Movimento.id).where(Movimento.conta_id == conta_id).limit(1)
    )
    return resultado.first() is not None


async def _tem_reconciliacoes(db: AsyncSession, conta_id: uuid.UUID) -> bool:
    """True se a conta tiver pelo menos uma reconciliação."""
    return (
        await db.scalar(select(Reconciliacao.id).where(Reconciliacao.conta_id == conta_id).limit(1))
    ) is not None


async def criar_conta(
    db: AsyncSession,
    utilizador: User,
    *,
    nome: str,
    banco: str | None,
    tipo: str | None,
    moeda: str,
    data_ancora: date,
    saldo_ancora: Decimal,
) -> Conta:
    """
    Cria uma conta manual para o utilizador. Os dados já chegam validados
    no formato (nome não vazio, moeda suportada, comprimentos máximos);
    aqui aplicam-se as regras de negócio:
      - a data inicial (a "âncora", o dia a partir do qual a aplicação
        acompanha a conta) não pode ser no futuro — "hoje" é a data em
        Lisboa, não a do relógio do servidor;
      - o nome não pode repetir o de outra conta do utilizador.

    O "*" na lista de parâmetros obriga a passar os dados pelo nome
    (nome=..., moeda=...), para nunca se trocarem dois valores do mesmo
    tipo por engano.
    """
    if data_ancora > hoje():
        raise RegraViolada("A data de início não pode ser no futuro.")
    await garantir_nome_livre(db, utilizador.id, nome)

    conta = Conta(
        user_id=utilizador.id,
        nome=nome,
        banco=banco,
        tipo=tipo,
        moeda=moeda,
        data_ancora=data_ancora,
        # quantize garante exatamente 2 casas decimais antes de gravar.
        saldo_ancora=saldo_ancora.quantize(_DUAS_CASAS),
    )
    db.add(conta)
    await gravar_conta(db)
    # Volta a ler a linha para preencher os campos que só a base de dados
    # sabe (created_at, updated_at).
    await db.refresh(conta)
    return conta


async def editar_conta(
    db: AsyncSession,
    conta: Conta,
    *,
    nome: str,
    banco: str | None,
    tipo: str | None,
    moeda: str,
) -> Conta:
    """
    Atualiza os campos descritivos de uma conta (nome, banco, tipo,
    moeda). Nunca toca na âncora.

    Regras:
      - o nome não pode repetir o de OUTRA conta do utilizador (a própria
        não conta, para guardar sem mudar o nome continuar a funcionar);
      - CONTA VINCULADA (alimentada por uma conta bancária através do Open
        Banking): banco e moeda ficam bloqueados, mesmo sem movimentos —
        vêm sempre do banco, e uma sincronização continuaria a trazer
        dados nessa moeda e desse banco. Nome e tipo continuam livres;
      - CONTA MANUAL: a moeda só muda se a conta não tiver movimentos nem
        reconciliações — foram lançados a pensar na moeda antiga, e mudá-la
        por baixo deles mudaria em silêncio o que os seus valores
        significam.
    """
    await garantir_nome_livre(db, conta.user_id, nome, ignorar_conta_id=conta.id)

    if await conta_tem_vinculo(db, conta.id):
        if banco != conta.banco or moeda != conta.moeda:
            raise RegraViolada(
                "Banco e moeda não podem ser alterados numa conta vinculada ao banco."
            )
    elif moeda != conta.moeda and await _tem_movimentos(db, conta.id):
        raise RegraViolada("Não é possível mudar a moeda de uma conta com movimentos.")
    elif moeda != conta.moeda and await _tem_reconciliacoes(db, conta.id):
        raise RegraViolada("Não é possível mudar a moeda de uma conta com reconciliações.")

    conta.nome = nome
    conta.banco = banco
    conta.tipo = tipo
    conta.moeda = moeda
    await gravar_conta(db)
    await db.refresh(conta)
    return conta


async def apagar_conta(db: AsyncSession, conta: Conta) -> None:
    """
    Elimina uma conta e, com ela, todos os seus movimentos: a própria base
    de dados apaga-os (a chave estrangeira dos movimentos para a conta tem
    "ON DELETE CASCADE", apagar em cascata). A interface pede confirmação
    antes e avisa que os movimentos vão com a conta.

    Se a conta tiver vínculo, a conta bancária que a alimenta é apagada da
    mesma forma, sem precisar de desvincular primeiro.

    A conta fica bloqueada durante a operação (uma de cada vez por conta):
    apagá-la a meio de uma sincronização deixaria essa sincronização a
    gravar movimentos numa conta que já não existe.
    """
    await bloquear_conta(db, conta.id)
    await db.delete(conta)
    await db.flush()


async def _limites_da_ancora(db: AsyncSession, conta_id: uuid.UUID) -> tuple[date | None, date | None]:
    """A data do primeiro movimento e a da primeira reconciliação da conta (None se não houver)."""
    primeiro_movimento = await db.scalar(
        select(func.min(Movimento.data)).where(Movimento.conta_id == conta_id)
    )
    primeira_reconciliacao = await db.scalar(
        select(func.min(Reconciliacao.data)).where(Reconciliacao.conta_id == conta_id)
    )
    return primeiro_movimento, primeira_reconciliacao


async def _validar_ancora(db: AsyncSession, conta: Conta, data_ancora: date) -> None:
    """
    As regras da âncora (C4) — a data e o saldo iniciais, o ponto a partir
    do qual a aplicação acompanha a conta:
      - só numa conta MANUAL: numa conta vinculada, a âncora vem do banco;
      - a data nunca é depois de hoje;
      - a data nunca passa do primeiro movimento nem da primeira
        reconciliação (pode ser igual: a âncora conta-se no INÍCIO do dia,
        e uma reconciliação no FIM, por isso não colidem).
    """
    if await conta_tem_vinculo(db, conta.id):
        raise RegraViolada("Numa conta vinculada ao banco, a data e o saldo iniciais vêm do banco.")
    if data_ancora > hoje():
        raise RegraViolada("A data de início não pode ser no futuro.")
    primeiro_movimento, primeira_reconciliacao = await _limites_da_ancora(db, conta.id)
    if primeiro_movimento is not None and data_ancora > primeiro_movimento:
        raise RegraViolada("A data de início não pode ser depois do primeiro movimento.")
    if primeira_reconciliacao is not None and data_ancora > primeira_reconciliacao:
        raise RegraViolada("A data de início não pode ser depois da primeira reconciliação.")


async def simular_ancora(
    db: AsyncSession, conta: Conta, data_ancora: date, saldo_ancora: Decimal
) -> dict:
    """
    O efeito de mudar a âncora, sem gravar nada (para mostrar ANTES de
    gravar): o saldo atual que a conta passaria a ter e, se houver
    reconciliações, o acerto que a primeira passaria a ter. Aplica as
    mesmas regras que editar_ancora (erro se a data não for permitida).

    Com reconciliações, o saldo atual NÃO muda: a partir da primeira
    reconciliação o saldo é sempre o afirmado, e é o acerto da primeira que
    absorve a diferença.
    """
    await _validar_ancora(db, conta, data_ancora)
    diferenca = saldo_ancora.quantize(_DUAS_CASAS) - conta.saldo_ancora
    saldo_atual = conta.saldo_ancora + await soma_movimentos(db, conta.id)
    primeira = await db.scalar(
        select(Reconciliacao)
        .where(Reconciliacao.conta_id == conta.id)
        .order_by(Reconciliacao.data)
        .limit(1)
    )
    if primeira is None:
        return {"saldo_atual": saldo_atual + diferenca, "acerto_primeira_reconciliacao": None}
    acerto_atual = await db.scalar(
        select(func.coalesce(func.sum(Movimento.valor), 0)).where(
            Movimento.reconciliacao_id == primeira.id
        )
    )
    return {
        "saldo_atual": saldo_atual,
        "acerto_primeira_reconciliacao": Decimal(acerto_atual) - diferenca,
    }


async def editar_ancora(
    db: AsyncSession, conta: Conta, data_ancora: date, saldo_ancora: Decimal
) -> Conta:
    """
    Muda a data e o saldo iniciais de uma conta manual (regra C4), e
    recalcula os acertos das reconciliações (dependem do saldo inicial).
    A conta fica bloqueada durante a operação (uma de cada vez por conta).
    """
    # Primeiro o bloqueio, depois as verificações (nenhuma outra operação
    # pode mudar a conta entre uma e outra).
    await bloquear_conta(db, conta.id)
    await _validar_ancora(db, conta, data_ancora)
    conta.data_ancora = data_ancora
    conta.saldo_ancora = saldo_ancora.quantize(_DUAS_CASAS)
    await db.flush()
    await recalcular_acertos(db, conta.id)
    await db.refresh(conta)
    return conta
