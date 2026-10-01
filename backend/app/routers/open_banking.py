"""
ROTAS DE OPEN BANKING
========================

Este ficheiro define os endpoints relacionados com a integração de Open
Banking — a importação de contas e movimentos bancários reais através de
um intermediário regulado ao abrigo da directiva europeia PSD2 (Enable
Banking, neste projecto: enablebanking.com). "PSD2" é a directiva europeia
que obriga os bancos a expor os dados de uma conta, mediante consentimento
explícito do seu dono, a aplicações terceiras como esta.

O FLUXO COMPLETO, pela ordem em que acontece:
1. "/ligar" (autenticado) — o utilizador escolhe um banco; esta rota
   inicia um pedido de autorização real junto da Enable Banking (POST
   /auth — ver iniciar_autorizacao, em app/services/enable_banking.py) e
   reencaminha o browser para o ecrã de login desse banco.
2. "/callback" — para onde a Enable Banking reencaminha o browser depois
   de o utilizador autenticar (login e confirmação fortes, SCA —
   "Strong Customer Authentication") e dar consentimento. Troca o "code"
   recebido por uma sessão (POST /sessions), grava-a (LigacaoBancaria e
   uma ContaLigada por cada conta trazida), e reencaminha de volta para o
   frontend (nunca devolve dados brutos ao browser).
3. "/contas-ligadas/{id}/associar-nova-conta" — cria uma Conta desta
   aplicação a partir de uma ContaLigada ainda por associar, e importa os
   movimentos disponíveis (todo o histórico, ou só desde uma data — ver o
   parâmetro "data_de", abaixo).
4. "/contas-ligadas/{id}/sincronizar" — importa os movimentos NOVOS de
   uma conta JÁ ligada e já associada, desde a última sincronização.
5. "/contas-ligadas/{id}" (DELETE) — "desvincula": remove só a ligação,
   sem apagar nada da Conta nem dos Movimento já importados.

DELIBERADAMENTE FORA DESTA FATIA (ver o caderno): associar uma
ContaLigada a uma Conta MANUAL já existente ("Cenário 1", precisa de um
passo de reconciliação de saldo próprio), e reconhecer automaticamente a
mesma conta real numa religação futura (via identification_hash — só
relevante quando o consentimento de 90 dias expirar, um problema
diferente de sincronizar uma ligação ainda válida).

IDENTIFICAÇÃO DO UTILIZADOR NO CALLBACK — O PROBLEMA E A SOLUÇÃO: o
"/callback" chega SEM o cookie de sessão desta aplicação (mesmo com
autenticação normal em "/ligar"), porque tipicamente vive noutro
endereço/origem do login normal (nesta app, em desenvolvimento: o
callback em "https://127.0.0.1:8000", o login em
"http://localhost:5173"; em produção, mesmo com os dois no mesmo domínio,
o reencaminhamento atravessa o site do banco pelo meio). A solução: "/
ligar" (essa sim autenticada) grava, antes de reencaminhar, uma linha
"state → user_id" (ver app/models/autorizacao_pendente.py); a Enable
Banking devolve esse mesmo "state" no callback final, inalterado — é por
ele que "/callback" recupera o utilizador certo, sem precisar de cookie
nenhum.

ACHADO IMPORTANTE de quando este fluxo foi testado pela primeira vez: o
botão "Activate by linking accounts" do painel da Enable Banking (usado
para activar o modo Restricted Production) NUNCA devolve um "code" no
callback — só o fluxo iniciado por "/ligar" (POST /auth, chamado por nós)
o faz. Confirmado pela documentação oficial: aquele botão é uma acção do
próprio painel deles, não corresponde ao fluxo real de autorização.
"""

import uuid
from datetime import date
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

# RedirectResponse é o que faz o browser saltar de imediato para outro
# URL — usado em "/ligar" (para enviar o utilizador para o ecrã de login
# do banco) e em "/callback" (para o trazer de volta à interface, já
# dentro da aplicação React, nunca mostrando dados brutos).
from fastapi.responses import RedirectResponse

from app.core.config import settings
from app.core.deps import obter_utilizador_atual
from app.db.session import get_db
from app.models.autorizacao_pendente import AutorizacaoPendente
from app.models.ligacao_bancaria import LigacaoBancaria
from app.models.movimento import Movimento
from app.models.user import User
from app.services.enable_banking import (
    iniciar_autorizacao,
    listar_bancos,
    obter_movimentos,
    obter_saldos,
    trocar_codigo_por_sessao,
)
from app.services.contas import obter_conta_do_utilizador
from app.services.importacao_movimentos import criar_conta_a_partir_de_ligacao, sincronizar_movimentos
from app.services.ligacoes_bancarias import (
    desvincular_conta,
    gravar_ligacao,
    listar_contas_ligadas,
    obter_conta_ligada_do_utilizador,
    obter_conta_ligada_por_uid_do_utilizador,
)

router = APIRouter(prefix="/open-banking", tags=["open-banking"])


@router.get("/bancos")
async def bancos(
    pais: str = "PT", utilizador: User = Depends(obter_utilizador_atual)
) -> list[dict]:
    """
    Lista os bancos (ASPSPs, no vocabulário desta API) suportados pela
    Enable Banking num dado país — por omissão, Portugal.

    Não tem qualquer efeito secundário (só lê uma lista pública) — exige
    autenticação, tal como todas as rotas deste ficheiro, apenas por
    coerência com o resto da aplicação (nenhuma rota devia ficar acessível
    sem sessão iniciada), não porque haja aqui dados sensíveis de alguém.
    """
    return await listar_bancos(pais)


@router.post("/ligar")
async def ligar(
    request: Request,
    banco: str,
    pais: str = "PT",
    utilizador: User = Depends(obter_utilizador_atual),
    db: AsyncSession = Depends(get_db),
) -> RedirectResponse:
    """
    Inicia uma autorização REAL junto de um banco concreto (POST /auth —
    ver iniciar_autorizacao, em app/services/enable_banking.py) e
    reencaminha de imediato o browser para o URL devolvido: o ecrã de
    login e autenticação forte (SCA) desse banco.

    "banco" tem de corresponder exactamente ao campo "name" devolvido por
    "/bancos" (ex.: "BPI", "Millennium BCP", "Caixa Geral de Depósitos").

    POST, NÃO GET, apesar de não ler nenhum corpo (banco/pais continuam
    parâmetros de query) — um GET com este efeito lateral (grava uma
    AutorizacaoPendente e desencadeia um pedido real à Enable Banking)
    seria vulnerável a CSRF por navegação de topo: o cookie de sessão
    desta aplicação usa "SameSite=Lax" (app/routers/auth.py), que PROTEGE
    contra POST vindo de outro site, mas deixa passar um GET vindo de um
    simples link ou "window.location" nesse site — um atacante conseguiria
    assim forçar uma vítima autenticada a iniciar uma autorização bancária
    escolhida por ele. Não daria acesso à conta de outro utilizador (o
    "state" continua ligado ao utilizador certo), mas é evitável.
    frontend/src/lib/openBanking.ts:iniciarLigacao já chama isto com um
    formulário submetido por JavaScript (method="POST"), não com
    "window.location.href" — a única forma de continuar a SAIR da SPA de
    propósito (ver a nota nessa função) sem voltar a ser um GET.

    Antes de reencaminhar, grava uma AutorizacaoPendente (state → o
    utilizador autenticado agora, ver a nota IDENTIFICAÇÃO DO UTILIZADOR
    NO CALLBACK, no topo do ficheiro) — é o que permite a "/callback",
    mais abaixo, recuperar o utilizador certo mesmo sem cookie de sessão.

    request.url_for("callback") constrói o URL desta própria aplicação
    para a função "callback", em vez de o escrever à mão — aproveita o
    facto de o FastAPI já saber por onde este pedido chegou (aqui, sempre
    "https://127.0.0.1:8000/open-banking/callback", o único registado no
    painel da Enable Banking).
    """
    state = str(uuid.uuid4())
    db.add(AutorizacaoPendente(state=state, user_id=utilizador.id))
    await db.commit()

    redirect_url = str(request.url_for("callback"))
    url = await iniciar_autorizacao(banco, pais, redirect_url, state)
    # 303 (See Other), não a omissão (307): um 307 diz ao browser para
    # REPETIR o mesmo método (POST) no novo URL — aqui teria de ser SEMPRE
    # um GET, é um ecrã de login a sério, não um endpoint desta API.
    return RedirectResponse(url, status_code=status.HTTP_303_SEE_OTHER)


def _erro_para_frontend(mensagem: str) -> RedirectResponse:
    """
    Reencaminha para o mesmo passo do frontend onde este fluxo começou
    (o formulário "Nova conta", opção "Através do teu banco" — ver
    frontend/src/paginas/ContaNova.tsx), com a mensagem de erro na query
    string. Usada em todos os pontos de falha de "callback", abaixo, para
    o utilizador NUNCA ficar preso numa página fora da aplicação.
    """
    return RedirectResponse(f"{settings.frontend_url}/contas/nova?erro={quote(mensagem)}")


@router.get("/callback")
async def callback(request: Request, db: AsyncSession = Depends(get_db)) -> RedirectResponse:
    """
    Recebe o reencaminhamento do browser feito pela Enable Banking, depois
    de o utilizador autenticar junto do seu banco (ou recusar/cancelar o
    consentimento). NUNCA autenticada (não pode ser — ver a nota
    IDENTIFICAÇÃO DO UTILIZADOR NO CALLBACK, no topo do ficheiro): o
    utilizador é recuperado a partir do "state", não de um cookie.

    Devolve sempre um REENCAMINHAMENTO de volta para o frontend (nunca
    dados brutos) — em caso de sucesso, para "/contas/nova?ligacao=<id>",
    onde o frontend continua o fluxo (lista as contas descobertas, pede um
    nome, cria a Conta); em caso de erro, para "/contas/nova?erro=<
    mensagem>" (ver _erro_para_frontend, acima).

    Troca o "code" recebido por uma sessão (POST /sessions — ver
    trocar_codigo_por_sessao, em app/services/enable_banking.py), recupera
    o utilizador pelo "state" (apagando a AutorizacaoPendente
    correspondente — já serviu o propósito), e grava a ligação
    (LigacaoBancaria e uma ContaLigada por cada conta — ver
    gravar_ligacao, em app/services/ligacoes_bancarias.py).
    """
    parametros = dict(request.query_params)

    # Também fica registado na consola onde o uvicorn está a correr — para
    # o caso de o utilizador fechar a aba do browser antes de a
    # reencaminhamento para o frontend completar.
    print(f"[open-banking/callback] parâmetros recebidos: {parametros}")

    code = parametros.get("code")
    if code is None:
        return _erro_para_frontend(parametros.get("error", "Autorização não concluída."))

    # O "state" é validado ANTES de gastar o "code" (que só pode ser
    # trocado por sessão UMA VEZ — ver trocar_codigo_por_sessao, em
    # app/services/enable_banking.py). Fazer ao contrário desperdiçaria um
    # consentimento bancário REAL sempre que este pedido falhasse por um
    # "state" desconhecido (ex.: um recarregar da página, ou um banco que
    # não devolva o "state" tal como foi enviado) — o utilizador teria de
    # repetir toda a autenticação no banco outra vez, sem sequer saber que
    # o motivo foi um "state" inválido, e não algo na troca do "code" em
    # si.
    estado = parametros.get("state")
    pendente = await db.get(AutorizacaoPendente, estado) if estado else None
    if pendente is None:
        return _erro_para_frontend("Pedido de autorização desconhecido ou já usado.")
    user_id = pendente.user_id
    await db.delete(pendente)

    try:
        sessao = await trocar_codigo_por_sessao(code)
    except HTTPException as excepcao:
        # A AutorizacaoPendente já apagada, acima, ainda não foi
        # confirmada (nenhum commit até aqui) — persiste-se na mesma: se a
        # troca por sessão falhou, este "state" já não serve para mais
        # nada, e uma nova tentativa desde "/ligar" gera um "state" novo.
        # Reencaminha para o frontend com o motivo (nunca deixa o
        # utilizador preso numa resposta JSON crua, fora da aplicação).
        await db.commit()
        return _erro_para_frontend(str(excepcao.detail))

    print(f"[open-banking/callback] sessão obtida: {sessao}")

    ligacao = await gravar_ligacao(db, user_id, sessao)
    print(
        f"[open-banking/callback] ligação {ligacao.id} gravada, "
        f"{len(sessao['accounts'])} conta(s)"
    )

    return RedirectResponse(f"{settings.frontend_url}/contas/nova?ligacao={ligacao.id}")


@router.get("/contas/{uid}/saldos")
async def saldos(
    uid: str,
    utilizador: User = Depends(obter_utilizador_atual),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    Consulta os saldos de uma conta já ligada (ver obter_saldos, em
    app/services/enable_banking.py). "uid" é o identificador atribuído
    pela Enable Banking a esta conta (ContaLigada.uid).

    Confirma primeiro que esta conta ligada é mesmo do utilizador
    autenticado (obter_conta_ligada_por_uid_do_utilizador, em
    app/services/ligacoes_bancarias.py) — sem isto, qualquer utilizador
    autenticado conseguiria ler saldos de OUTRO, só por adivinhar ou
    obter um "uid" alheio.
    """
    await obter_conta_ligada_por_uid_do_utilizador(db, utilizador.id, uid)
    return await obter_saldos(uid)


@router.get("/contas/{uid}/movimentos")
async def movimentos(
    uid: str,
    data_de: date | None = None,
    utilizador: User = Depends(obter_utilizador_atual),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    Consulta as transacções de uma conta já ligada (ver obter_movimentos,
    em app/services/enable_banking.py). "data_de" (formato AAAA-MM-DD),
    quando indicada, filtra transacções a partir dessa data.

    A mesma verificação de dono de "saldos", acima — ver essa nota.
    """
    await obter_conta_ligada_por_uid_do_utilizador(db, utilizador.id, uid)
    return await obter_movimentos(uid, data_de)


@router.get("/ligacoes/{ligacao_id}/contas-ligadas")
async def contas_ligadas(
    ligacao_id: uuid.UUID,
    utilizador: User = Depends(obter_utilizador_atual),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """
    Lista as contas trazidas por uma ligação (ver listar_contas_ligadas,
    em app/services/ligacoes_bancarias.py) — usada pelo frontend logo
    depois de voltar do "/callback" (que reencaminha para
    "/contas/nova?ligacao=<id>"), para mostrar a(s) conta(s) descobertas
    e deixar escolher um nome antes de as associar
    (POST .../associar-nova-conta, abaixo).
    """
    contas = await listar_contas_ligadas(db, utilizador.id, ligacao_id)
    # O nome do banco vem da LigacaoBancaria (todas as contas de uma
    # ligação são do mesmo banco) — o frontend mostra-o no formulário de
    # configurar cada conta (campo "Banco", bloqueado) e usa-o como nome
    # sugerido, tal como o formulário manual mostra o banco escolhido.
    # listar_contas_ligadas já confirmou que a ligação existe e é deste
    # utilizador (404 caso contrário), por isso aqui nunca vem None.
    ligacao = await db.get(LigacaoBancaria, ligacao_id)
    return [
        {
            "id": str(conta.id),
            "banco": ligacao.aspsp_nome,
            "iban": conta.iban,
            "moeda": conta.moeda,
            "nome_titular": conta.nome_titular,
            "conta_id": str(conta.conta_id) if conta.conta_id else None,
        }
        for conta in contas
    ]


@router.post("/contas-ligadas/{conta_ligada_id}/associar-nova-conta")
async def associar_nova_conta(
    conta_ligada_id: uuid.UUID,
    nome: str,
    data_de: date | None = None,
    # O mesmo limite da coluna Conta.tipo (String(40), app/models/conta.py)
    # — validado aqui (422 por omissão do FastAPI) em vez de deixar a base
    # de dados recusar um texto demasiado longo com um erro genérico.
    tipo: str | None = Query(default=None, max_length=40),
    utilizador: User = Depends(obter_utilizador_atual),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    Cria uma Conta nova a partir de uma ContaLigada ainda por associar, e
    importa de imediato os movimentos disponíveis (ver
    criar_conta_a_partir_de_ligacao, em
    app/services/importacao_movimentos.py).

    "data_de", quando indicada, limita a importação a partir dessa data —
    a escolha ("todo o histórico" vs. "desde uma data") é feita no
    frontend (ContaNova.tsx, passo "confirmar"), por cada conta
    descoberta.

    "tipo" (ex.: "Conta corrente", "Poupança") é o mesmo campo livre que o
    formulário manual já pede — a Enable Banking não diz, de forma que esta
    app use, que tipo de conta é, por isso é sempre o utilizador a dizê-lo.
    Antes desta mudança, uma conta ligada ficava SEMPRE sem tipo.

    Cobre só o cenário de uma conta SEM histórico manual anterior —
    associar a uma Conta JÁ EXISTENTE, com movimentos manuais, fica para
    uma iteração futura (ver a nota no topo de
    app/services/importacao_movimentos.py).
    """
    conta_ligada = await obter_conta_ligada_do_utilizador(db, utilizador.id, conta_ligada_id)
    if conta_ligada.conta_id is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Esta conta já está associada."
        )

    conta = await criar_conta_a_partir_de_ligacao(
        db, utilizador.id, conta_ligada, nome, data_de, tipo
    )

    resultado = await db.execute(select(Movimento).where(Movimento.conta_id == conta.id))
    total_importado = len(resultado.scalars().all())

    return {
        "conta_id": str(conta.id),
        "nome": conta.nome,
        "banco": conta.banco,
        "moeda": conta.moeda,
        "data_ancora": conta.data_ancora.isoformat(),
        "saldo_ancora": str(conta.saldo_ancora),
        "movimentos_importados": total_importado,
    }


@router.post("/contas-ligadas/{conta_ligada_id}/sincronizar")
async def sincronizar(
    conta_ligada_id: uuid.UUID,
    utilizador: User = Depends(obter_utilizador_atual),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    Importa os movimentos NOVOS de uma conta JÁ ligada e já associada
    (ver sincronizar_movimentos, em app/services/importacao_movimentos.py)
    — o botão "Sincronizar agora" em frontend/src/paginas/ContaDetalhe.tsx.

    409 se a ContaLigada ainda não estiver associada a nenhuma Conta desta
    aplicação — não há para onde sincronizar (esse passo é
    "associar-nova-conta", acima, feito uma única vez).
    """
    conta_ligada = await obter_conta_ligada_do_utilizador(db, utilizador.id, conta_ligada_id)
    if conta_ligada.conta_id is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Esta conta ainda não está associada a nenhuma conta da aplicação.",
        )
    conta = await obter_conta_do_utilizador(db, utilizador, conta_ligada.conta_id)

    total_novos = await sincronizar_movimentos(db, conta, conta_ligada)
    return {"movimentos_importados": total_novos}


@router.delete("/contas-ligadas/{conta_ligada_id}", status_code=status.HTTP_204_NO_CONTENT)
async def desvincular(
    conta_ligada_id: uuid.UUID,
    utilizador: User = Depends(obter_utilizador_atual),
    db: AsyncSession = Depends(get_db),
) -> None:
    """
    "Desvincula" uma conta do Open Banking (ver desvincular_conta, em
    app/services/ligacoes_bancarias.py) — pára a sincronização, mas nunca
    apaga a Conta nem os Movimento já importados. Para apagar tudo, usa-se
    o DELETE /contas/{id} já existente (app/routers/contas.py), que já
    remove a ContaLigada em cascata.
    """
    conta_ligada = await obter_conta_ligada_do_utilizador(db, utilizador.id, conta_ligada_id)
    await desvincular_conta(db, conta_ligada)
