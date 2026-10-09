"""
SERVIÇO DE MOVIMENTOS
========================

As regras de negócio dos MOVIMENTOS (as entradas e saídas de dinheiro das
contas): criar, editar, eliminar, e as operações em lote (eliminar ou
recategorizar vários de uma vez).

AS REGRAS, em resumo:
  - um movimento só existe numa conta do utilizador, e a sua categoria
    também tem de ser do utilizador (caso contrário, "não encontrado");
  - a data nunca é anterior à data inicial da conta (a "âncora", o dia a
    partir do qual a aplicação acompanha a conta);
  - a categoria tem de ser coerente com o sinal do valor (uma categoria
    de entrada só num valor positivo, uma de saída só num negativo);
  - numa conta VINCULADA (alimentada por uma conta bancária através do
    Open Banking), os movimentos vêm do banco: só a categoria pode mudar.
    Não se criam, não se movem de nem para essa conta, e não se eliminam
    — qualquer uma dessas mudanças desalinharia o saldo da aplicação do
    saldo real do banco;
  - uma operação em lote é válida por inteiro ou recusada por inteiro:
    tudo é verificado ANTES de se mexer em qualquer linha.

Quando uma regra é violada, estas funções lançam um ERRO DE DOMÍNIO (um
erro da lógica de negócio, com uma mensagem para o utilizador), que a API
traduz no código HTTP certo.

TRANSAÇÕES: QUEM GRAVA É QUEM CHAMA. Estas funções nunca fazem commit
(tornar as alterações definitivas): enviam-nas com flush() (visíveis
dentro da transação em curso, ainda não definitivas) e deixam o commit
para a rota que as chamou, uma vez, no fim do pedido.
"""

import uuid
from datetime import date
from decimal import Decimal

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.erros import NaoEncontrado, RegraViolada
from app.models.categoria import Categoria
from app.models.conta import Conta
from app.models.movimento import Movimento
from app.models.user import User
from app.services.categorias import obter_categoria_do_utilizador
from app.services.contas import obter_conta_do_utilizador
from app.services.contas_bancarias import conta_tem_vinculo

# Usado para normalizar os valores monetários a 2 casas decimais, coerente
# com a coluna Numeric(14, 2).
_DUAS_CASAS = Decimal("0.01")

_MENSAGEM_ELIMINAR_VINCULADA = "Não é possível eliminar movimentos de uma conta vinculada ao banco."


async def obter_movimento_do_utilizador(
    db: AsyncSession, utilizador: User, movimento_id: uuid.UUID
) -> Movimento:
    """
    Devolve o movimento com este id, se a sua conta pertencer ao
    utilizador. NaoEncontrado (404) nos dois casos juntos (não existe, ou
    não é do utilizador): a resposta não deve revelar qual dos dois se
    aplica, senão daria para descobrir ids de outras pessoas.

    Um único JOIN (Movimento → Conta), em vez de duas consultas, porque é
    a mesma pergunta — "este movimento é meu?" — numa só ida à base de
    dados.
    """
    resultado = await db.execute(
        select(Movimento)
        .join(Conta, Movimento.conta_id == Conta.id)
        .where(Movimento.id == movimento_id, Conta.user_id == utilizador.id)
    )
    movimento = resultado.scalar_one_or_none()
    if movimento is None:
        raise NaoEncontrado("Movimento não encontrado.")
    return movimento


async def _obter_movimentos_do_utilizador(
    db: AsyncSession, utilizador: User, ids: list[uuid.UUID]
) -> list[Movimento]:
    """
    A versão em lote de obter_movimento_do_utilizador: os movimentos com
    estes ids, e só se TODOS pertencerem ao utilizador. Se faltar algum,
    NaoEncontrado sem dizer qual (nem quantos), pela mesma razão. Chamada
    sempre ANTES de qualquer alteração: um lote só começa a mexer numa
    linha depois de se confirmar que é válido por inteiro.
    """
    resultado = await db.execute(
        select(Movimento)
        .join(Conta, Movimento.conta_id == Conta.id)
        .where(Movimento.id.in_(ids), Conta.user_id == utilizador.id)
    )
    movimentos = list(resultado.scalars().all())
    if len(movimentos) != len(set(ids)):
        raise NaoEncontrado("Um ou mais movimentos não foram encontrados.")
    return movimentos


def _validar_data(data_movimento: date, conta: Conta) -> None:
    """
    A data de um movimento nunca pode ser anterior à data inicial (a
    âncora) da sua conta: é o ponto a partir do qual a aplicação acompanha
    a conta, e um movimento mais antigo não tem onde entrar no cálculo do
    saldo.
    """
    if data_movimento < conta.data_ancora:
        raise RegraViolada("A data do movimento não pode ser anterior à data de início da conta.")


async def _recusar_se_conta_vinculada(db: AsyncSession, conta_id: uuid.UUID, mensagem: str) -> None:
    """
    Lança RegraViolada se a conta for VINCULADA (alimentada por uma conta
    bancária através do Open Banking): nessa conta, nada se cria nem se
    elimina à mão. A única forma de o fazer é desvincular a conta primeiro,
    ou eliminá-la por inteiro.
    """
    if await conta_tem_vinculo(db, conta_id):
        raise RegraViolada(mensagem)


def _validar_direcao(valor: Decimal, categoria: Categoria) -> None:
    """
    A direção da categoria ("entrada" ou "saida") tem de corresponder ao
    sinal do valor: uma categoria de entrada (ex.: "Salário") não faz
    sentido num movimento negativo, e vice-versa. Sem esta verificação,
    nada impediria uma incoerência que passaria despercebida em qualquer
    soma ou gráfico organizado por categoria.
    """
    direcao_esperada = "entrada" if valor > 0 else "saida"
    if categoria.direcao != direcao_esperada:
        raise RegraViolada(
            "A categoria escolhida não corresponde ao tipo do movimento (entrada/saída)."
        )


async def criar_movimento(
    db: AsyncSession,
    utilizador: User,
    *,
    conta_id: uuid.UUID,
    categoria_id: uuid.UUID,
    data: date,
    descricao: str,
    valor: Decimal,
) -> Movimento:
    """
    Cria um movimento manual. Os dados já chegam validados no formato
    (descrição não vazia, valor diferente de 0). Aqui: a conta e a
    categoria têm de ser do utilizador; a conta não pode ser vinculada (um
    movimento manual novo desalinharia o saldo do banco); a data não pode
    ser anterior à âncora; a categoria tem de ser coerente com o sinal.

    O "*" obriga a passar os dados pelo nome, para nunca se trocarem dois
    valores do mesmo tipo por engano.
    """
    conta = await obter_conta_do_utilizador(db, utilizador, conta_id)
    await _recusar_se_conta_vinculada(
        db, conta.id, "Não é possível criar movimentos manuais numa conta vinculada ao banco."
    )
    _validar_data(data, conta)
    categoria = await obter_categoria_do_utilizador(db, utilizador, categoria_id)
    _validar_direcao(valor, categoria)

    movimento = Movimento(
        conta_id=conta.id,
        categoria_id=categoria.id,
        data=data,
        descricao=descricao,
        valor=valor.quantize(_DUAS_CASAS),
    )
    db.add(movimento)
    await db.flush()
    # Volta a ler a linha para preencher os campos que só a base de dados
    # sabe (created_at, updated_at).
    await db.refresh(movimento)
    return movimento


async def editar_movimento(
    db: AsyncSession,
    utilizador: User,
    movimento: Movimento,
    *,
    conta_id: uuid.UUID,
    categoria_id: uuid.UUID,
    data: date,
    descricao: str,
    valor: Decimal,
) -> Movimento:
    """
    Atualiza um movimento por completo — incluindo, se for o caso, a conta
    ("mover" o movimento para outra conta) ou a categoria. A conta e a
    categoria de destino têm de ser do utilizador.

    CONTA VINCULADA: verifica-se a conta ATUAL do movimento e a de
    DESTINO (são diferentes quando se tenta mover o movimento). Se
    qualquer uma tiver vínculo, só a categoria pode mudar: mover um
    movimento PARA uma conta vinculada desalinhá-la-ia tal como criá-lo lá.
    Qualquer diferença noutro campo é recusada ANTES de se aplicar o que
    quer que seja — nunca uma alteração parcial e silenciosa.
    """
    conta = await obter_conta_do_utilizador(db, utilizador, conta_id)

    if await conta_tem_vinculo(db, movimento.conta_id) or await conta_tem_vinculo(db, conta.id):
        mudou_algo_alem_da_categoria = (
            conta_id != movimento.conta_id
            or data != movimento.data
            or descricao != movimento.descricao
            or valor.quantize(_DUAS_CASAS) != movimento.valor
        )
        if mudou_algo_alem_da_categoria:
            raise RegraViolada(
                "Um movimento de uma conta vinculada ao banco só permite alterar a categoria."
            )

    _validar_data(data, conta)
    categoria = await obter_categoria_do_utilizador(db, utilizador, categoria_id)
    _validar_direcao(valor, categoria)

    movimento.conta_id = conta.id
    movimento.categoria_id = categoria.id
    movimento.data = data
    movimento.descricao = descricao
    movimento.valor = valor.quantize(_DUAS_CASAS)
    await db.flush()
    await db.refresh(movimento)
    return movimento


async def apagar_movimento(db: AsyncSession, movimento: Movimento) -> None:
    """
    Elimina um movimento. Recusado numa conta vinculada: a única forma de
    remover um movimento importado é desvincular a conta (o que liberta
    todos os seus movimentos para edição normal) ou eliminar a conta.
    """
    await _recusar_se_conta_vinculada(db, movimento.conta_id, _MENSAGEM_ELIMINAR_VINCULADA)
    await db.delete(movimento)
    await db.flush()


async def eliminar_em_lote(db: AsyncSession, utilizador: User, ids: list[uuid.UUID]) -> None:
    """
    Elimina vários movimentos de uma vez. Confirma primeiro que todos são
    do utilizador e que nenhum pertence a uma conta vinculada; só então
    apaga, num único DELETE. Nunca uma eliminação parcial.

    Eliminar um movimento não tem consequências em cascata (nada na
    aplicação aponta para um movimento), por isso não há aqui um passo de
    confirmação ou migração como ao eliminar uma categoria.
    """
    movimentos = await _obter_movimentos_do_utilizador(db, utilizador, ids)
    for id_conta in {m.conta_id for m in movimentos}:
        await _recusar_se_conta_vinculada(db, id_conta, _MENSAGEM_ELIMINAR_VINCULADA)
    await db.execute(delete(Movimento).where(Movimento.id.in_([m.id for m in movimentos])))
    await db.flush()


async def recategorizar_em_lote(
    db: AsyncSession, utilizador: User, ids: list[uuid.UUID], categoria_id: uuid.UUID
) -> None:
    """
    Muda a categoria de vários movimentos de uma vez. A categoria tem de
    ser do utilizador e coerente com o valor de CADA movimento do lote; se
    um só falhar, o lote inteiro é recusado ANTES de qualquer alteração.
    (Mudar a categoria é permitido mesmo numa conta vinculada.)
    """
    movimentos = await _obter_movimentos_do_utilizador(db, utilizador, ids)
    categoria = await obter_categoria_do_utilizador(db, utilizador, categoria_id)
    for movimento in movimentos:
        _validar_direcao(movimento.valor, categoria)

    await db.execute(
        update(Movimento)
        .where(Movimento.id.in_([m.id for m in movimentos]))
        .values(categoria_id=categoria.id)
    )
    await db.flush()
