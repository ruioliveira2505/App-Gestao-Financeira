"""
SERVIÇO DE CATEGORIAS
========================

As regras de negócio da árvore de CATEGORIAS do utilizador. A árvore tem
dois níveis na mesma tabela: GRUPOS (ex.: "Habitação") e SUBCATEGORIAS
dentro deles (ex.: "Renda"). Cada categoria tem uma direção, "entrada" ou
"saida"; uma subcategoria herda a do seu grupo. Algumas categorias são
PROTEGIDAS: as categorias-refúgio ("Outros", em "Outras Entradas" e
"Outras Saídas") para onde vão os movimentos sem categoria escolhida, por
exemplo os importados do banco. Uma categoria protegida não se edita nem
se elimina.

AS REGRAS, em resumo:
  - uma categoria só é acessível ao seu dono (caso contrário, "não
    encontrada");
  - não há subcategorias dentro de subcategorias (só dois níveis);
  - o nome de uma subcategoria é único dentro do seu grupo; o de um grupo
    é único dentro da sua direção (pode haver um grupo "Transferências"
    de entrada e outro de saída);
  - mover uma subcategoria só para outro grupo da mesma direção — um
    movimento nunca pode ficar numa categoria de sentido contrário ao seu
    valor;
  - ELIMINAR nunca deixa um movimento sem categoria: se houver movimentos
    na categoria (ou nas subcategorias que caem com o grupo), o pedido tem
    de dizer para onde migram. Nunca há uma reatribuição silenciosa, nem
    uma cascata que apague os próprios movimentos.

Quando uma regra é violada, estas funções lançam um ERRO DE DOMÍNIO (um
erro da lógica de negócio, com uma mensagem para o utilizador), que a API
traduz no código HTTP certo.

TRANSAÇÕES: QUEM GRAVA É QUEM CHAMA. Estas funções nunca fazem commit
(tornar as alterações definitivas): enviam-nas com flush() (visíveis
dentro da transação em curso, ainda não definitivas) e deixam o commit
para quem as chamou, uma vez, no fim. Na eliminação, migrar os movimentos
e apagar a categoria ficam assim na mesma transação: ou acontecem os dois,
ou nenhum.
"""

import uuid

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.erros import Conflito, NaoEncontrado, RegraViolada
from app.models.categoria import Categoria
from app.models.movimento import Movimento
from app.models.user import User

_MENSAGEM_NOME_REPETIDO = "Já existe uma categoria com este nome no mesmo grupo."


async def obter_categoria_do_utilizador(
    db: AsyncSession, utilizador: User, categoria_id: uuid.UUID
) -> Categoria:
    """
    Devolve a categoria com este id, se pertencer ao utilizador. Caso
    contrário — não existe, ou é de outro utilizador — lança NaoEncontrado
    (que a API traduz em 404), nunca uma recusa de acesso (403): para este
    utilizador, uma categoria que não é sua é, para todos os efeitos,
    inexistente, e a resposta não deve sequer revelar que o id corresponde
    a alguma categoria (de outra pessoa).
    """
    resultado = await db.execute(
        select(Categoria).where(Categoria.id == categoria_id, Categoria.user_id == utilizador.id)
    )
    categoria = resultado.scalar_one_or_none()
    if categoria is None:
        raise NaoEncontrado("Categoria não encontrada.")
    return categoria


async def _nome_duplicado(
    db: AsyncSession,
    user_id: uuid.UUID,
    parent_id: uuid.UUID | None,
    direcao: str,
    nome: str,
    ignorar_id: uuid.UUID | None = None,
) -> bool:
    """
    True se já existir, para este utilizador, uma categoria com este nome
    no mesmo sítio da árvore:
      - uma SUBCATEGORIA (com parent_id): dentro do mesmo grupo;
      - um GRUPO (sem parent_id): entre os grupos da MESMA DIREÇÃO. Um
        grupo identifica-se pelo nome e pela direção: a árvore por omissão
        tem dois grupos "Transferências", um de entrada e outro de saída,
        e não colidem.

    Os grupos têm de ser verificados aqui: o PostgreSQL trata cada valor
    vazio (NULL, o parent_id de um grupo) como diferente de qualquer outro,
    por isso uma restrição UNIQUE sobre (utilizador, parent_id, nome) não
    os apanharia.

    ignorar_id exclui da comparação a própria categoria a editar — senão
    "guardar com o nome que já tem" seria recusado como duplicado de si
    própria.
    """
    if parent_id is None:
        condicao_lugar = (Categoria.parent_id.is_(None)) & (Categoria.direcao == direcao)
    else:
        condicao_lugar = Categoria.parent_id == parent_id
    query = select(Categoria.id).where(
        Categoria.user_id == user_id, condicao_lugar, Categoria.nome == nome
    )
    if ignorar_id is not None:
        query = query.where(Categoria.id != ignorar_id)
    resultado = await db.execute(query.limit(1))
    return resultado.first() is not None


async def _proxima_ordem(db: AsyncSession, user_id: uuid.UUID, parent_id: uuid.UUID | None) -> int:
    """
    A posição livre a seguir à última entre as irmãs (mesmo parent_id): uma
    categoria criada ou movida entra sempre no FIM. Ainda não há forma de o
    utilizador escolher outra posição (arrastar e largar).
    """
    condicao_parent = (
        Categoria.parent_id.is_(None) if parent_id is None else Categoria.parent_id == parent_id
    )
    maior = await db.scalar(
        select(func.max(Categoria.ordem)).where(Categoria.user_id == user_id, condicao_parent)
    )
    return (maior + 1) if maior is not None else 0


async def criar_categoria(
    db: AsyncSession,
    utilizador: User,
    *,
    nome: str,
    parent_id: uuid.UUID | None,
    direcao: str | None,
) -> Categoria:
    """
    Cria um GRUPO (sem parent_id; a direção vem do pedido, e o formato do
    pedido já garante que vem) ou uma SUBCATEGORIA (com parent_id; a
    direção herda-se do grupo, e a enviada é ignorada).

    Regras: o grupo de destino tem de ser do utilizador e tem de ser um
    grupo (não há subcategorias de subcategorias); o nome não pode repetir
    outro no mesmo grupo.
    """
    if parent_id is None:
        direcao_final = direcao
        parent_final = None
    else:
        grupo = await obter_categoria_do_utilizador(db, utilizador, parent_id)
        if grupo.parent_id is not None:
            raise RegraViolada(
                "Não é possível criar uma subcategoria dentro de outra subcategoria."
            )
        direcao_final = grupo.direcao
        parent_final = grupo.id

    if await _nome_duplicado(db, utilizador.id, parent_final, direcao_final, nome):
        raise Conflito(_MENSAGEM_NOME_REPETIDO)

    ordem = await _proxima_ordem(db, utilizador.id, parent_final)
    categoria = Categoria(
        user_id=utilizador.id,
        parent_id=parent_final,
        nome=nome,
        direcao=direcao_final,
        ordem=ordem,
    )
    db.add(categoria)
    await db.flush()
    await db.refresh(categoria)
    return categoria


async def editar_categoria(
    db: AsyncSession,
    utilizador: User,
    categoria: Categoria,
    *,
    nome: str,
    parent_id: uuid.UUID | None,
) -> Categoria:
    """
    Renomeia uma categoria e, se for uma subcategoria, permite movê-la para
    outro grupo — sempre dentro da mesma direção: o destino tem de ser um
    grupo (não outra subcategoria) e da mesma direção, para nunca deixar um
    movimento numa categoria cujo sentido (entrada ou saída) já não
    corresponde ao seu valor.

    Um grupo só se renomeia (nunca passa a subcategoria), e uma
    subcategoria nunca sobe a grupo. Uma categoria protegida não se edita.
    """
    if categoria.protegida:
        raise RegraViolada(
            "Esta categoria é necessária para o funcionamento da aplicação e não pode ser editada."
        )

    if categoria.parent_id is None:
        if parent_id is not None:
            raise RegraViolada("Um grupo não pode tornar-se subcategoria de outro grupo.")
        novo_parent_id = None
    else:
        if parent_id is None:
            raise RegraViolada("Uma subcategoria não pode deixar de pertencer a um grupo.")
        novo_grupo = await obter_categoria_do_utilizador(db, utilizador, parent_id)
        if novo_grupo.parent_id is not None:
            raise RegraViolada("O destino tem de ser um grupo, não outra subcategoria.")
        if novo_grupo.direcao != categoria.direcao:
            raise RegraViolada(
                "Não é possível mover uma subcategoria para um grupo de direção diferente."
            )
        novo_parent_id = novo_grupo.id

    if await _nome_duplicado(
        db, utilizador.id, novo_parent_id, categoria.direcao, nome, ignorar_id=categoria.id
    ):
        raise Conflito(_MENSAGEM_NOME_REPETIDO)

    # Só recalcula a ordem se o grupo mudou de facto: um simples renomear
    # (o caso mais comum) mantém a posição que já tinha entre as irmãs.
    if novo_parent_id != categoria.parent_id:
        categoria.ordem = await _proxima_ordem(db, utilizador.id, novo_parent_id)
    categoria.nome = nome
    categoria.parent_id = novo_parent_id
    await db.flush()
    await db.refresh(categoria)
    return categoria


async def eliminar_categoria(
    db: AsyncSession,
    utilizador: User,
    categoria: Categoria,
    migrar_para_id: uuid.UUID | None,
) -> None:
    """
    Elimina um grupo (e, em cascata, as suas subcategorias: a chave
    estrangeira parent_id tem "ON DELETE CASCADE", apagar em cascata) ou
    uma subcategoria.

    Todo o movimento tem categoria obrigatória. Por isso, se algum
    movimento ficasse sem categoria (porque aponta para esta categoria ou
    para uma subcategoria que cai com ela), "migrar_para_id" tem de dizer
    para onde esses movimentos passam ANTES de a categoria ser apagada.
    Sem ele, e havendo movimentos, o pedido é recusado (Conflito) em vez
    de escolher um destino sozinho — mesmo a categoria-refúgio seria uma
    reatribuição que o utilizador nunca viu acontecer.

    "migrar_para_id", se indicado, é sempre validado (do utilizador, não é
    uma das categorias a desaparecer, mesma direção), mesmo que não haja
    nenhum movimento a migrar: um valor inválido nunca é aceite em
    silêncio só porque, por acaso, não fazia falta.
    """
    if categoria.protegida:
        raise RegraViolada(
            "Esta categoria é necessária para o funcionamento da aplicação e não pode ser eliminada."
        )

    # As subcategorias que caem em cascata com este grupo (lista vazia se a
    # categoria for, ela própria, uma subcategoria).
    subcategorias = list(
        (await db.scalars(select(Categoria).where(Categoria.parent_id == categoria.id))).all()
    )

    # Um grupo não se apaga se levar consigo, em cascata, uma subcategoria
    # protegida: a verificação acima só cobre a categoria pedida. Sem esta,
    # apagar o grupo "Outras Entradas" levaria o seu "Outros" protegido.
    if any(sub.protegida for sub in subcategorias):
        raise RegraViolada(
            "Este grupo tem uma subcategoria necessária para o funcionamento da "
            "aplicação e não pode ser eliminado."
        )

    ids_a_desaparecer = [categoria.id, *[sub.id for sub in subcategorias]]

    destino: Categoria | None = None
    if migrar_para_id is not None:
        destino = await obter_categoria_do_utilizador(db, utilizador, migrar_para_id)
        if destino.id in ids_a_desaparecer:
            raise RegraViolada(
                "O destino da migração não pode ser a própria categoria a eliminar "
                "(nem uma das suas subcategorias)."
            )
        if destino.direcao != categoria.direcao:
            raise RegraViolada(
                "O destino da migração tem de ser da mesma direção (entrada ou saída)."
            )

    n_movimentos = await db.scalar(
        select(func.count())
        .select_from(Movimento)
        .where(Movimento.categoria_id.in_(ids_a_desaparecer))
    )

    if n_movimentos > 0:
        if destino is None:
            raise Conflito(
                f"{n_movimentos} movimento(s) usam esta categoria (ou uma das suas "
                "subcategorias). Escolhe para onde os mover antes de eliminar."
            )
        await db.execute(
            update(Movimento)
            .where(Movimento.categoria_id.in_(ids_a_desaparecer))
            .values(categoria_id=destino.id)
        )

    await db.delete(categoria)
    await db.flush()
