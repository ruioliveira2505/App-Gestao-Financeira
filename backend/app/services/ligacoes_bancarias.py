"""
GESTÃO DE LIGAÇÕES BANCÁRIAS
================================

Este ficheiro trata da parte que pertence à NOSSA base de dados da
integração de Open Banking — gravar, a partir de uma sessão devolvida
pela Enable Banking (ver trocar_codigo_por_sessao, em
app/services/enable_banking.py), uma LigacaoBancaria e as respectivas
ContaLigada (ver app/models/ligacao_bancaria.py e
app/models/conta_ligada.py para o desenho completo destas duas tabelas —
uma ligação/consentimento, várias contas trazidas por ela).

Este ficheiro NUNCA fala directamente com a API da Enable Banking (isso
fica em app/services/enable_banking.py) — só grava, na nossa própria base
de dados, o que essa API já devolveu.

RECONHECER CONTAS JÁ CONHECIDAS. Ao gravar uma ligação nova, cada conta
bancária trazida é comparada com as Conta do utilizador pela sua
IDENTIFICAÇÃO ESTÁVEL (ver identificacao_bancaria, abaixo — guardada na
própria Conta, em Conta.identificacao_bancaria, única por utilizador), e
só na mesma moeda:
  - a Conta existe e ainda está LIGADA (tem uma ContaLigada activa, de uma
    ligação anterior): a ligação RENOVA-SE — a ponte antiga é apagada e a
    nova passa a apontar para a mesma Conta, com a validade nova. O
    utilizador não tem de fazer nada (é o caso de voltar a autorizar o
    banco quando o prazo do consentimento acaba);
  - a Conta existe mas foi DESVINCULADA: nada se associa sozinho. A conta
    bancária aparece como nova, e o frontend diz «Já foi a «X»» (ver
    conta_antiga_de, abaixo). Religar à Conta antiga precisa de uma
    reconciliação de saldo (o buraco entre desvincular e religar), que
    ainda não existe na aplicação;
  - não existe: é uma conta nova.

SUGESTÕES PARA UMA CONTA NOVA. tipo_sugerido traduz o código de tipo de
conta que o banco envia; nome_sugerido junta-lhe o nome do banco (ex.:
"Conta à ordem CGD"). O frontend mostra o nome como EXEMPLO no campo, e o
tipo já preenchido.
"""

import uuid
from datetime import datetime

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.conta import Conta
from app.models.conta_ligada import ContaLigada
from app.models.ligacao_bancaria import LigacaoBancaria
from app.services.contas import normalizar_nome

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
    não deve fazer falhar a ligação inteira.
    """
    return texto[:limite] if texto else None


def identificacao_bancaria(
    identification_hash: str | None, iban: str | None, moeda: str | None = None
) -> str | None:
    """
    A identificação ESTÁVEL de uma conta bancária real, que não muda entre
    ligações (ao contrário do "uid", que a Enable Banking gera de novo em
    cada ligação):
      - o "identification_hash" da Enable Banking, se o banco o der (um
        código calculado pela Enable Banking a partir dos dados da conta,
        igual em todas as ligações à mesma conta);
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
    conta_ligada: ContaLigada, banco: str, nomes_existentes: list[str]
) -> str:
    """
    Um nome para a conta nova: o tipo (ou, na falta dele, o produto que o
    banco envia, ou só "Conta") seguido do banco abreviado — "Conta à ordem
    CGD". Se o utilizador já tiver uma conta com esse nome (comparado sem
    acentos nem maiúsculas — ver normalizar_nome, em app/services/
    contas.py), junta o fim do IBAN ("Conta à ordem CGD ••2084"), para a
    sugestão nunca chocar com a regra do nome único.
    """
    base = tipo_sugerido(conta_ligada.tipo_conta_banco) or conta_ligada.produto or "Conta"
    nome = f"{base} {abreviar_banco(banco)}"
    existentes = {normalizar_nome(n) for n in nomes_existentes}
    if normalizar_nome(nome) in existentes and conta_ligada.iban:
        nome = f"{nome} ••{conta_ligada.iban.replace(' ', '')[-4:]}"
    return nome


async def gravar_ligacao(db: AsyncSession, user_id: uuid.UUID, sessao: dict) -> LigacaoBancaria:
    """
    Grava uma LigacaoBancaria e uma ContaLigada por cada conta trazida por
    "sessao" — o dicionário devolvido por trocar_codigo_por_sessao (ver
    app/services/enable_banking.py), com a forma real confirmada nos
    testes desta integração: {"session_id": ..., "aspsp": {"name":...,
    "country": ...}, "access": {"valid_until": ...}, "accounts": [...]}.

    conta_id fica vazio nas ContaLigada criadas aqui, com UMA exceção: se
    a conta bancária já alimenta uma Conta do utilizador, com uma ligação
    ativa, a ponte nova herda essa Conta (é uma renovação, a continuação de
    uma associação que o utilizador já confirmou — ver
    _renovar_se_ja_ligada, abaixo). Associar uma conta bancária NOVA a uma
    Conta é sempre um passo posterior, confirmado pelo utilizador.
    """
    ligacao = LigacaoBancaria(
        user_id=user_id,
        session_id=sessao["session_id"],
        aspsp_nome=sessao["aspsp"]["name"],
        aspsp_pais=sessao["aspsp"]["country"],
        # "valid_until" vem em formato ISO 8601 (ex.:
        # "2026-12-26T13:44:51.529151Z") — fromisoformat entende
        # directamente o sufixo "Z" desde o Python 3.11, e este projecto
        # exige Python 3.14 (ver requires-python em pyproject.toml).
        valido_ate=datetime.fromisoformat(sessao["access"]["valid_until"]),
    )
    db.add(ligacao)

    # flush() envia o INSERT da ligação à base de dados sem terminar a
    # transacção, só para resolver o seu id (gerado por omissão — ver
    # app/models/ligacao_bancaria.py) — necessário porque cada ContaLigada
    # criada a seguir precisa desse id para o seu ligacao_id.
    await db.flush()

    for conta in sessao["accounts"]:
        nova = ContaLigada(
            ligacao_id=ligacao.id,
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
        await _renovar_se_ja_ligada(db, user_id, nova)

    await db.commit()
    await db.refresh(ligacao)
    return ligacao


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


async def _renovar_se_ja_ligada(db: AsyncSession, user_id: uuid.UUID, nova: ContaLigada) -> None:
    """
    Se a conta bancária de "nova" já alimenta uma Conta do utilizador, com
    uma ligação ACTIVA, renova essa ligação: apaga a ponte antiga e associa
    "nova" à mesma Conta (ver RECONHECER CONTAS JÁ CONHECIDAS, no topo do
    ficheiro). Uma Conta desvinculada (sem ponte activa) fica como está —
    não se religa sozinha.
    """
    conta = await conta_com_identificacao(
        db, user_id, identificacao_bancaria(nova.identification_hash, nova.iban, nova.moeda)
    )
    if conta is None:
        return
    # Uma conta bancária só alimenta uma Conta na mesma moeda: uma conta em
    # USD nunca renova a ligação de uma Conta em EUR.
    if conta.moeda != nova.moeda:
        return
    antiga = await obter_ligacao_de_conta(db, conta.id)
    if antiga is None:
        return
    await db.delete(antiga)
    # flush entre os dois passos: a ponte antiga sai da base de dados
    # ANTES de a nova passar a apontar para a mesma Conta — nunca há,
    # nem por um instante, duas pontes activas para a mesma Conta (o
    # resto da aplicação assume que há no máximo uma — ver
    # obter_ligacao_de_conta, abaixo).
    await db.flush()
    nova.conta_id = conta.id


async def conta_antiga_de(
    db: AsyncSession, user_id: uuid.UUID, conta_ligada: ContaLigada
) -> Conta | None:
    """
    A Conta DESVINCULADA que esta conta bancária já alimentou, se houver —
    o «Já foi a «X»» do frontend. None se a conta bancária nunca esteve na
    aplicação, ou se a Conta que a tem ainda está ligada (nesse caso a
    ligação renovou-se — ver _renovar_se_ja_ligada, acima).
    """
    if conta_ligada.conta_id is not None:
        return None
    conta = await conta_com_identificacao(
        db,
        user_id,
        identificacao_bancaria(
            conta_ligada.identification_hash, conta_ligada.iban, conta_ligada.moeda
        ),
    )
    if conta is None or await obter_ligacao_de_conta(db, conta.id) is not None:
        return None
    return conta


async def conta_esta_ligada(db: AsyncSession, conta_id: uuid.UUID) -> bool:
    """
    True se existir uma ContaLigada, ACTIVA (com conta_id preenchido),
    a apontar para esta Conta — usada pelas rotas de contas e movimentos
    (app/routers/contas.py, app/routers/movimentos.py) para aplicar as
    regras próprias de uma conta alimentada por Open Banking: banco/moeda
    fixos, e movimentos só editáveis na categoria (ver a nota
    correspondente em app/models/conta_ligada.py).

    Não confundir com "este movimento tem id_transacao_externa" — uma
    conta pode ter sido DESVINCULADA (a ContaLigada apagada, ver
    desvincular_conta, abaixo) depois de ter recebido movimentos
    importados; esses movimentos continuam a ter id_transacao_externa
    preenchido para sempre, mas deixam de estar sujeitos a estas regras,
    porque já não há nenhuma ContaLigada activa a apontar para a conta
    deles.
    """
    resultado = await db.execute(
        select(ContaLigada.id).where(ContaLigada.conta_id == conta_id).limit(1)
    )
    return resultado.first() is not None


async def listar_contas_ligadas(
    db: AsyncSession, user_id: uuid.UUID, ligacao_id: uuid.UUID
) -> list[ContaLigada]:
    """
    Lista as ContaLigada trazidas por uma LigacaoBancaria concreta, se
    esta pertencer a "user_id" (404 caso contrário — mesma razão de
    obter_conta_ligada_do_utilizador, abaixo). Usada pelo frontend
    (frontend/src/paginas/ContaNova.tsx) mesmo depois de voltar do
    "/callback": uma única ligação pode ter trazido mais do que uma conta
    de uma vez (ver a nota em app/models/ligacao_bancaria.py), por isso a
    interface precisa de as listar todas, não só assumir uma.
    """
    ligacao = await db.get(LigacaoBancaria, ligacao_id)
    if ligacao is None or ligacao.user_id != user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ligação não encontrada.")

    resultado = await db.execute(
        select(ContaLigada).where(ContaLigada.ligacao_id == ligacao_id)
    )
    return list(resultado.scalars().all())


async def obter_ligacao_de_conta(db: AsyncSession, conta_id: uuid.UUID) -> ContaLigada | None:
    """
    A ContaLigada ACTIVA desta Conta, se existir — a mesma pergunta de
    conta_esta_ligada (acima), mas devolvendo a linha inteira, não só um
    booleano. Usada por app/routers/contas.py para mostrar, no detalhe de
    uma conta, a que banco está ligada (para o botão "Sincronizar agora"/
    "Desvincular" — ver frontend/src/paginas/ContaDetalhe.tsx). Devolve só
    a ContaLigada, não a LigacaoBancaria (ex.: para o "aspsp_nome") — quem
    chamar e precisar disso vai buscá-la à parte por "ligacao_id", tal
    como já se faz em app/services/importacao_movimentos.py.
    """
    resultado = await db.execute(
        select(ContaLigada).where(ContaLigada.conta_id == conta_id)
    )
    return resultado.scalar_one_or_none()


async def obter_conta_ligada_do_utilizador(
    db: AsyncSession, user_id: uuid.UUID, conta_ligada_id: uuid.UUID
) -> ContaLigada:
    """
    Devolve a ContaLigada com este id, se a respectiva LigacaoBancaria
    pertencer a "user_id". 404 nos dois casos que se juntam num só (não
    existe, ou não é deste utilizador) — pela mesma razão já usada em
    app/services/contas.py:obter_conta_do_utilizador: a resposta não deve
    revelar qual dos dois motivos se aplica.
    """
    resultado = await db.execute(
        select(ContaLigada)
        .join(LigacaoBancaria, ContaLigada.ligacao_id == LigacaoBancaria.id)
        .where(ContaLigada.id == conta_ligada_id, LigacaoBancaria.user_id == user_id)
    )
    conta_ligada = resultado.scalar_one_or_none()
    if conta_ligada is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Ligação não encontrada."
        )
    return conta_ligada


async def obter_conta_ligada_por_uid_do_utilizador(
    db: AsyncSession, user_id: uuid.UUID, uid: str
) -> ContaLigada:
    """
    A mesma verificação de obter_conta_ligada_do_utilizador, mas
    procurando pelo "uid" atribuído pela Enable Banking (usado nos
    endpoints de saldos/movimentos — app/routers/open_banking.py), não
    pelo id interno da linha em "contas_ligadas".
    """
    resultado = await db.execute(
        select(ContaLigada)
        .join(LigacaoBancaria, ContaLigada.ligacao_id == LigacaoBancaria.id)
        .where(ContaLigada.uid == uid, LigacaoBancaria.user_id == user_id)
    )
    conta_ligada = resultado.scalar_one_or_none()
    if conta_ligada is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Conta ligada não encontrada."
        )
    return conta_ligada


async def desvincular_conta(db: AsyncSession, conta_ligada: ContaLigada) -> None:
    """
    "Desvincula" uma conta do Open Banking: apaga só a linha ContaLigada
    (a ponte) — a Conta e todos os seus Movimento ficam completamente
    intactos, só deixam de estar sujeitos às regras de conta_esta_ligada
    (acima) e de receber novas sincronizações. Ver a nota "PORQUÊ NÃO
    APAGAR A LIGACAOBANCARIA" — não é isto que se apaga aqui, de propósito.

    PORQUÊ NÃO APAGAR A LIGACAOBANCARIA (o consentimento em si): uma
    LigacaoBancaria pode ter trazido VÁRIAS contas de uma vez (ver a nota
    em app/models/ligacao_bancaria.py); desvincular uma delas não deve
    afectar as outras, que podem continuar ligadas a outras Conta desta
    aplicação.
    """
    await db.delete(conta_ligada)
    await db.commit()
