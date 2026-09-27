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
"""

import uuid
from datetime import datetime

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.conta_ligada import ContaLigada
from app.models.ligacao_bancaria import LigacaoBancaria


async def gravar_ligacao(db: AsyncSession, user_id: uuid.UUID, sessao: dict) -> LigacaoBancaria:
    """
    Grava uma LigacaoBancaria e uma ContaLigada por cada conta trazida por
    "sessao" — o dicionário devolvido por trocar_codigo_por_sessao (ver
    app/services/enable_banking.py), com a forma real confirmada nos
    testes desta integração: {"session_id": ..., "aspsp": {"name":...,
    "country": ...}, "access": {"valid_until": ...}, "accounts": [...]}.

    conta_id fica sempre vazio nas ContaLigada criadas aqui — a associação
    a uma Conta desta aplicação é sempre um passo posterior, confirmado
    explicitamente pelo utilizador (ver a nota em
    app/models/conta_ligada.py sobre nunca associar automaticamente).
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
        db.add(
            ContaLigada(
                ligacao_id=ligacao.id,
                uid=conta["uid"],
                identification_hash=conta.get("identification_hash"),
                # "account_id" pode, em teoria, não vir preenchido; .get()
                # em cadeia evita um erro caso algum banco não o devolva.
                iban=(conta.get("account_id") or {}).get("iban"),
                nome_titular=conta.get("name"),
                moeda=conta["currency"],
            )
        )

    await db.commit()
    await db.refresh(ligacao)
    return ligacao


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
