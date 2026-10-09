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

- garantir_nome_livre: o nome de uma conta é único por utilizador,
  comparado sem acentos nem maiúsculas.

- soma_movimentos / somas_de_movimentos: a soma dos movimentos de uma ou
  de várias contas, base do saldo atual.

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
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.erros import Conflito, NaoEncontrado, RegraViolada
from app.core.tempo import hoje
from app.models.conta import Conta
from app.models.movimento import Movimento
from app.models.user import User
from app.services.contas_bancarias import conta_tem_vinculo
from app.services.nomes import normalizar_nome


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
    Lança Conflito (que a API traduz em 409) se o utilizador já tiver outra conta com este
    nome — comparado sem acentos nem maiúsculas (ver normalizar_nome, em
    app/services/nomes.py).

    PORQUÊ: o nome é a única coisa que distingue as contas em todo o lado
    — na lista, no seletor de conta de um movimento, nos filtros. Duas
    contas chamadas "Carteira" seriam indistinguíveis em todos esses
    sítios. (A app não tenta adivinhar se duas contas MANUAIS são a mesma
    conta real — não há IBAN nem identificador do banco para isso; só
    garante que se distinguem.)

    "ignorar_conta_id": ao EDITAR, a própria conta não conta como conflito
    (guardar sem mudar o nome tem de continuar a funcionar).

    A comparação faz-se em Python, sobre os nomes das contas do
    utilizador, e não com uma restrição na base de dados: uma restrição
    "UNIQUE" compararia o texto exacto, e "Poupança"/"poupanca" passariam
    como diferentes. Um utilizador tem poucas contas — ler os nomes todos
    é imediato.
    """
    resultado = await db.execute(
        select(Conta.id, Conta.nome).where(Conta.user_id == user_id)
    )
    alvo = normalizar_nome(nome)
    for conta_id, nome_existente in resultado:
        if conta_id != ignorar_conta_id and normalizar_nome(nome_existente) == alvo:
            raise Conflito(f"Já tens uma conta chamada «{nome_existente}».")


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
    await db.flush()
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
      - CONTA MANUAL: a moeda só muda se a conta não tiver movimentos —
        foram lançados a pensar na moeda antiga, e mudá-la por baixo deles
        mudaria em silêncio o que os seus valores significam.
    """
    await garantir_nome_livre(db, conta.user_id, nome, ignorar_conta_id=conta.id)

    if await conta_tem_vinculo(db, conta.id):
        if banco != conta.banco or moeda != conta.moeda:
            raise RegraViolada(
                "Banco e moeda não podem ser alterados numa conta vinculada ao banco."
            )
    elif moeda != conta.moeda and await _tem_movimentos(db, conta.id):
        raise RegraViolada("Não é possível mudar a moeda de uma conta com movimentos.")

    conta.nome = nome
    conta.banco = banco
    conta.tipo = tipo
    conta.moeda = moeda
    await db.flush()
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
    """
    await db.delete(conta)
    await db.flush()
