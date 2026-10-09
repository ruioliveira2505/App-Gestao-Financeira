"""
CONTAS BANCÁRIAS E AUTORIZAÇÕES (NA NOSSA BASE DE DADOS)
==========================================================

Uma AUTORIZAÇÃO é o consentimento que o utilizador dá ao seu banco para
esta aplicação ler os dados das contas que escolheu partilhar, durante um
prazo. Cada conta partilhada chega como uma CONTA BANCÁRIA, que pode
alimentar uma CONTA desta aplicação: essa relação chama-se VÍNCULO.

Este ficheiro trata da parte que vive na NOSSA base de dados: gravar uma
autorização e as suas contas bancárias a partir da sessão que a Enable
Banking (o intermediário regulado que fala com os bancos) devolveu,
reconhecer contas já conhecidas, consultar e desfazer vínculos. Nunca fala
diretamente com a API da Enable Banking; só grava o que ela já devolveu.

RECONHECER CONTAS JÁ CONHECIDAS. Ao gravar uma autorização nova, cada conta
bancária é comparada com as Contas do utilizador pela sua IDENTIFICAÇÃO
ESTÁVEL (ver identificacao_bancaria, abaixo), guardada em cada Conta como
memória, e só na mesma moeda:
  - a Conta existe e ainda tem VÍNCULO (através de uma autorização
    anterior): o vínculo RENOVA-SE — a linha antiga da conta bancária é
    apagada, e a nova passa a alimentar a mesma Conta. É o caso de voltar
    a autorizar o banco quando o prazo acaba;
  - a Conta existe mas foi DESVINCULADA: nada se vincula sozinho. A conta
    bancária aparece livre, e o frontend mostra «Já foi a "X"» (ver
    conta_antiga_de, abaixo);
  - não existe: é uma conta bancária nova.

TRANSAÇÕES: QUEM GRAVA É QUEM CHAMA. Uma transação é um conjunto de
alterações à base de dados que ficam todas definitivas juntas (commit) ou
são todas desfeitas (rollback). As funções deste ficheiro nunca fazem
commit: enviam as alterações com flush() (ficam visíveis dentro da
transação, mas ainda não são definitivas) e deixam o commit para a rota
que as chamou, uma vez, no fim do pedido. Assim, uma operação composta
(por exemplo, criar a Conta, o vínculo e os movimentos importados) grava tudo ou
nada: se um passo falhar a meio, nenhum dos anteriores fica gravado.

SUGESTÕES PARA UMA CONTA NOVA. tipo_sugerido traduz o código de tipo de
conta que o banco envia; nome_sugerido junta-lhe o nome do banco (ex.:
"Conta à ordem CGD").
"""

import uuid
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.erros import NaoEncontrado
from app.models.autorizacao import Autorizacao
from app.models.conta import Conta
from app.models.conta_bancaria import ContaBancaria
from app.services.nomes import normalizar_nome

# Tipo de conta, a partir do código ISO 20022 que o banco envia em
# "cash_account_type". Só os tipos que fazem sentido nesta aplicação; um
# código desconhecido fica sem sugestão (o utilizador escolhe).
TIPOS_POR_CODIGO = {
    "CACC": "Conta à ordem",
    "SVGS": "Poupança",
    "CARD": "Cartão de crédito",
    "LOAN": "Empréstimo",
}

# Palavras que não entram na sigla de um banco ("Caixa Geral de
# Depósitos" → "CGD", não "CGDD").
_PALAVRAS_SEM_SIGLA = {"de", "do", "da", "dos", "das", "e"}


def _cortar(texto: str | None, limite: int) -> str | None:
    """
    O texto cortado ao limite da coluna onde vai ser gravado, ou None se
    vier vazio — um banco que envie um texto mais longo do que o previsto
    não deve fazer falhar a autorização inteira.
    """
    return texto[:limite] if texto else None


def identificacao_bancaria(
    identification_hash: str | None, iban: str | None, moeda: str | None = None
) -> str | None:
    """
    A identificação ESTÁVEL de uma conta bancária real, que não muda entre
    autorizações (ao contrário do "uid", que a Enable Banking gera de novo
    em cada autorização):
      - o "identification_hash" da Enable Banking, se o banco o der (um
        código calculado pela Enable Banking a partir dos dados da conta,
        igual em todas as autorizações da mesma conta);
      - senão, "iban:" seguido do IBAN sem espaços e em maiúsculas e, se a
        moeda for indicada, ":" e a moeda (ex.: "iban:PT50…2084:EUR"). O
        prefixo impede que um IBAN alguma vez coincida com um hash. A moeda
        distingue as contas de bancos com várias moedas no MESMO IBAN (ex.:
        Revolut, Wise: uma conta em EUR e outra em USD com o mesmo IBAN),
        que sem ela teriam a mesma identificação.
    Texto vazio (ou só espaços) conta como ausente. None se não houver nem
    hash nem IBAN: essa conta não se consegue reconhecer.

    A migração b7d4e2a1c9f3 (alembic/versions) aplica exatamente esta
    regra, em SQL, às contas que já existiam.
    """
    hash_limpo = (identification_hash or "").strip()
    if hash_limpo:
        return hash_limpo
    iban_limpo = (iban or "").replace(" ", "").upper()
    if iban_limpo:
        return "iban:" + iban_limpo + (":" + moeda.upper() if moeda else "")
    return None


def tipo_sugerido(codigo: str | None) -> str | None:
    """O tipo de conta, a partir do código ISO 20022 (ver TIPOS_POR_CODIGO)."""
    return TIPOS_POR_CODIGO.get((codigo or "").upper())


def abreviar_banco(nome: str) -> str:
    """
    O nome do banco, curto para caber num nome de conta: nomes de três ou
    mais palavras viram sigla ("Caixa Geral de Depósitos" → "CGD", "Banco
    Comercial Português" → "BCP"); os mais curtos ficam como estão
    ("Santander Totta", "Banco BPI").
    """
    palavras = [p for p in nome.split() if p.lower() not in _PALAVRAS_SEM_SIGLA]
    if len(palavras) >= 3:
        return "".join(p[0].upper() for p in palavras)
    return nome


def nome_sugerido(
    conta_bancaria: ContaBancaria, banco: str, nomes_existentes: list[str]
) -> str:
    """
    Um nome para a conta nova: o tipo (ou, na falta dele, o produto que o
    banco envia, ou só "Conta") seguido do banco abreviado — "Conta à ordem
    CGD". Se o utilizador já tiver uma conta com esse nome (comparado sem
    acentos nem maiúsculas — ver normalizar_nome, em app/services/
    nomes.py), junta o fim do IBAN ("Conta à ordem CGD ••2084"), para a
    sugestão nunca chocar com a regra do nome único.
    """
    base = tipo_sugerido(conta_bancaria.tipo_conta_banco) or conta_bancaria.produto or "Conta"
    nome = f"{base} {abreviar_banco(banco)}"
    existentes = {normalizar_nome(n) for n in nomes_existentes}
    if normalizar_nome(nome) in existentes and conta_bancaria.iban:
        nome = f"{nome} ••{conta_bancaria.iban.replace(' ', '')[-4:]}"
    return nome


async def gravar_autorizacao(db: AsyncSession, user_id: uuid.UUID, sessao: dict) -> Autorizacao:
    """
    Grava uma Autorizacao e uma ContaBancaria por cada conta trazida por
    "sessao" — o dicionário que a Enable Banking devolve quando o código
    da autenticação é trocado por uma sessão, com a forma real confirmada
    nos testes desta integração: {"session_id": ..., "aspsp": {"name": ...,
    "country": ...}, "access": {"valid_until": ...}, "accounts": [...]}
    ("aspsp" é o nome técnico da API para um banco).

    As contas bancárias criadas aqui ficam sem vínculo, com UMA exceção: se
    a mesma conta real já alimenta uma Conta do utilizador, a linha nova
    herda esse vínculo (é uma renovação, a continuação de uma associação
    que o utilizador já confirmou — ver _renovar_se_ja_vinculada, abaixo).
    Vincular uma conta bancária NOVA a uma Conta é sempre um passo
    posterior, confirmado pelo utilizador.
    """
    autorizacao = Autorizacao(
        user_id=user_id,
        session_id=sessao["session_id"],
        banco=sessao["aspsp"]["name"],
        pais=sessao["aspsp"]["country"],
        # "valid_until" vem no formato ISO 8601 (ex.:
        # "2026-12-26T13:44:51.529151Z"); fromisoformat entende
        # diretamente o sufixo "Z" (que quer dizer UTC) desde o Python 3.11.
        valido_ate=datetime.fromisoformat(sessao["access"]["valid_until"]),
    )
    db.add(autorizacao)

    # flush() envia o INSERT à base de dados sem terminar a transação, só
    # para o id da autorização ficar conhecido: cada ContaBancaria criada a
    # seguir precisa dele para o seu autorizacao_id.
    await db.flush()

    for conta in sessao["accounts"]:
        nova = ContaBancaria(
            autorizacao_id=autorizacao.id,
            uid=conta["uid"],
            identification_hash=conta.get("identification_hash"),
            # "account_id" pode, em teoria, não vir preenchido; .get()
            # em cadeia evita um erro caso algum banco não o devolva.
            iban=(conta.get("account_id") or {}).get("iban"),
            nome_titular=conta.get("name"),
            moeda=conta["currency"],
            produto=_cortar(conta.get("product"), 120),
            tipo_conta_banco=_cortar(conta.get("cash_account_type"), 4),
        )
        db.add(nova)
        await _renovar_se_ja_vinculada(db, user_id, nova)

    # flush() envia as alterações à base de dados, dentro da transação em
    # curso, mas NÃO as torna definitivas: isso é o commit(), que só a rota
    # (ou o script) que chamou este serviço faz, uma vez, no fim. Assim,
    # várias operações chamadas pelo mesmo pedido gravam-se todas juntas
    # ou nenhuma (ver a nota no topo do ficheiro).
    await db.flush()
    await db.refresh(autorizacao)
    return autorizacao


async def conta_com_identificacao(
    db: AsyncSession, user_id: uuid.UUID, identificacao: str | None
) -> Conta | None:
    """
    A Conta DESTE utilizador com esta identificação bancária, se houver.
    Filtra sempre por user_id: duas pessoas com a mesma conta bancária
    (ex.: uma conta conjunta) nunca se cruzam. Há no máximo uma, garantido
    pelo índice único (user_id, identificacao_bancaria) da tabela contas
    (app/models/conta.py). None se a identificação for None: uma conta
    bancária sem identificação nunca corresponde a nenhuma Conta, nem às
    manuais, cuja identificação também é vazia (sem esta guarda, o SQL
    "identificacao_bancaria = NULL" passaria a "IS NULL" e apanharia todas
    as contas manuais).
    """
    if identificacao is None:
        return None
    resultado = await db.execute(
        select(Conta).where(
            Conta.user_id == user_id, Conta.identificacao_bancaria == identificacao
        )
    )
    return resultado.scalars().first()


async def _renovar_se_ja_vinculada(
    db: AsyncSession, user_id: uuid.UUID, nova: ContaBancaria
) -> None:
    """
    Se a conta real de "nova" já alimenta uma Conta do utilizador (tem
    vínculo através de uma autorização anterior), renova esse vínculo:
    apaga a linha antiga da conta bancária e vincula "nova" à mesma Conta
    (ver RECONHECER CONTAS JÁ CONHECIDAS, no topo do ficheiro). Uma Conta
    desvinculada fica como está: nunca volta a ter vínculo sozinha.
    """
    conta = await conta_com_identificacao(
        db, user_id, identificacao_bancaria(nova.identification_hash, nova.iban, nova.moeda)
    )
    if conta is None:
        return
    # Uma conta bancária só alimenta uma Conta na mesma moeda: uma conta em
    # USD nunca renova o vínculo de uma Conta em EUR.
    if conta.moeda != nova.moeda:
        return
    antiga = await obter_conta_bancaria_de_conta(db, conta.id)
    if antiga is None:
        return
    await db.delete(antiga)
    # flush entre os dois passos: a linha antiga sai da base de dados ANTES
    # de a nova passar a alimentar a mesma Conta. Nunca há, nem por um
    # instante, duas contas bancárias vinculadas à mesma Conta (o resto da
    # aplicação assume que há no máximo uma — ver
    # obter_conta_bancaria_de_conta, abaixo).
    await db.flush()
    nova.conta_id = conta.id


async def conta_antiga_de(
    db: AsyncSession, user_id: uuid.UUID, conta_bancaria: ContaBancaria
) -> Conta | None:
    """
    A Conta DESVINCULADA que esta conta bancária já alimentou, se houver —
    o «Já foi a "X"» do frontend. None se a conta bancária nunca esteve na
    aplicação, ou se a Conta que se lembra dela ainda tem vínculo (nesse
    caso o vínculo renovou-se — ver _renovar_se_ja_vinculada, acima).
    """
    if conta_bancaria.conta_id is not None:
        return None
    conta = await conta_com_identificacao(
        db,
        user_id,
        identificacao_bancaria(
            conta_bancaria.identification_hash, conta_bancaria.iban, conta_bancaria.moeda
        ),
    )
    if conta is None or await obter_conta_bancaria_de_conta(db, conta.id) is not None:
        return None
    return conta


async def conta_tem_vinculo(db: AsyncSession, conta_id: uuid.UUID) -> bool:
    """
    True se alguma conta bancária alimentar esta Conta (se a Conta tiver
    VÍNCULO). Usada pelos serviços de contas e de movimentos para aplicar as
    regras de uma Conta alimentada pelo banco: banco e moeda fixos, e
    movimentos só editáveis na categoria.

    Não confundir com "este movimento veio do banco": uma Conta pode ter
    sido DESVINCULADA depois de ter recebido movimentos importados. Esses
    movimentos continuam a existir, mas a Conta deixa de estar sujeita a
    estas regras, porque já nenhuma conta bancária a alimenta.
    """
    resultado = await db.execute(
        select(ContaBancaria.id).where(ContaBancaria.conta_id == conta_id).limit(1)
    )
    return resultado.first() is not None


async def listar_contas_bancarias(
    db: AsyncSession, user_id: uuid.UUID, autorizacao_id: uuid.UUID
) -> list[ContaBancaria]:
    """
    As contas bancárias trazidas por uma autorização, se esta pertencer a
    "user_id". Caso contrário lança NaoEncontrado (que a API traduz em
    404), sem dizer se não existe ou se é de outra pessoa: a resposta não
    deve revelar qual dos dois casos se aplica. Uma só autorização pode trazer várias contas bancárias, por
    isso o frontend lista-as todas depois de voltar do banco.
    """
    autorizacao = await db.get(Autorizacao, autorizacao_id)
    if autorizacao is None or autorizacao.user_id != user_id:
        raise NaoEncontrado("Autorização não encontrada.")

    resultado = await db.execute(
        select(ContaBancaria).where(ContaBancaria.autorizacao_id == autorizacao_id)
    )
    return list(resultado.scalars().all())


async def obter_conta_bancaria_de_conta(
    db: AsyncSession, conta_id: uuid.UUID
) -> ContaBancaria | None:
    """
    A conta bancária que alimenta esta Conta, se houver — a mesma pergunta
    de conta_tem_vinculo (acima), mas devolvendo a linha inteira. Usada,
    por exemplo, para mostrar no detalhe de uma Conta de que banco vem e
    até quando vale a autorização.
    """
    resultado = await db.execute(
        select(ContaBancaria).where(ContaBancaria.conta_id == conta_id)
    )
    return resultado.scalar_one_or_none()


async def obter_conta_bancaria_do_utilizador(
    db: AsyncSession, user_id: uuid.UUID, conta_bancaria_id: uuid.UUID
) -> ContaBancaria:
    """
    A conta bancária com este id, se a sua autorização pertencer a
    "user_id". NaoEncontrado (404) nos dois casos juntos (não existe, ou não é deste
    utilizador): a resposta não deve revelar qual dos dois se aplica,
    senão daria para descobrir ids de outras pessoas.
    """
    resultado = await db.execute(
        select(ContaBancaria)
        .join(Autorizacao, ContaBancaria.autorizacao_id == Autorizacao.id)
        .where(ContaBancaria.id == conta_bancaria_id, Autorizacao.user_id == user_id)
    )
    conta_bancaria = resultado.scalar_one_or_none()
    if conta_bancaria is None:
        raise NaoEncontrado("Conta bancária não encontrada.")
    return conta_bancaria


async def desvincular(db: AsyncSession, conta_bancaria: ContaBancaria) -> None:
    """
    Desfaz o vínculo de uma conta bancária. Hoje apaga a linha da conta
    bancária (e com ela o vínculo); a Conta e todos os seus movimentos
    ficam intactos, só deixam de estar sujeitos às regras de uma Conta
    vinculada e de receber sincronizações. A memória da Conta (a
    identificação da conta bancária) também fica.

    A AUTORIZAÇÃO não se apaga: pode ter trazido várias contas bancárias,
    e desvincular uma não deve afetar as outras.
    """
    await db.delete(conta_bancaria)
    # flush() envia as alterações à base de dados, dentro da transação em
    # curso, mas NÃO as torna definitivas: isso é o commit(), que só a rota
    # (ou o script) que chamou este serviço faz, uma vez, no fim. Assim,
    # várias operações chamadas pelo mesmo pedido gravam-se todas juntas
    # ou nenhuma (ver a nota no topo do ficheiro).
    await db.flush()
