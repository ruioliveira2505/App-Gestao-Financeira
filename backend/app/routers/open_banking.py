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
   recebido por uma sessão (POST /sessions) e grava-a (LigacaoBancaria e
   uma ContaLigada por cada conta trazida).
3. "/contas-ligadas/{id}/associar-nova-conta" — cria uma Conta desta
   aplicação a partir de uma ContaLigada ainda por associar, e importa a
   primeira leva de movimentos.
4. "/contas-ligadas/{id}/sincronizar" — para uma ContaLigada JÁ associada,
   importa só os movimentos novos desde a sincronização anterior.
5. "/contas-ligadas/{id}" (DELETE) — "desvincula": pára a sincronização,
   sem apagar nada da Conta nem dos Movimento já importados.

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

import html
import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

# HTMLResponse permite devolver HTML directamente (em vez do JSON que o
# resto da API devolve) — só para o endpoint de callback ser confortável
# de ler a olho nu, já que é precisamente no browser, depois de um
# reencaminhamento, que esse pedido chega. RedirectResponse é o que faz o
# browser saltar de imediato para outro URL (usado em "/ligar", para
# enviar o utilizador directamente para o ecrã de login do banco).
from fastapi.responses import HTMLResponse, RedirectResponse

from app.core.deps import obter_utilizador_atual
from app.db.session import get_db
from app.models.autorizacao_pendente import AutorizacaoPendente
from app.models.movimento import Movimento
from app.models.user import User
from app.services.enable_banking import (
    iniciar_autorizacao,
    listar_bancos,
    obter_movimentos,
    obter_saldos,
    trocar_codigo_por_sessao,
)
from app.services.importacao_movimentos import criar_conta_a_partir_de_ligacao, sincronizar_movimentos
from app.services.ligacoes_bancarias import (
    desvincular_conta,
    gravar_ligacao,
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


@router.get("/ligar")
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
    return RedirectResponse(url)


@router.get("/callback", response_class=HTMLResponse)
async def callback(request: Request, db: AsyncSession = Depends(get_db)) -> str:
    """
    Recebe o reencaminhamento do browser feito pela Enable Banking, depois
    de o utilizador autenticar junto do seu banco (ou recusar/cancelar o
    consentimento). NUNCA autenticada (não pode ser — ver a nota
    IDENTIFICAÇÃO DO UTILIZADOR NO CALLBACK, no topo do ficheiro): o
    utilizador é recuperado a partir do "state", não de um cookie.

    Não presume nomes de parâmetros concretos (como "code" ou "error") —
    lê e mostra TODOS os parâmetros da query string tal como chegam.

    Quando um "code" está presente, troca-o de imediato por uma sessão
    (POST /sessions — ver trocar_codigo_por_sessao, em
    app/services/enable_banking.py), recupera o utilizador pelo "state"
    (apagando a AutorizacaoPendente correspondente — já serviu o
    propósito), e grava a ligação (LigacaoBancaria e uma ContaLigada por
    cada conta — ver gravar_ligacao, em
    app/services/ligacoes_bancarias.py).
    """
    parametros = dict(request.query_params)

    # Também fica registado na consola onde o uvicorn está a correr — para
    # o caso de o utilizador fechar a aba do browser antes de copiar o que
    # viu no ecrã.
    print(f"[open-banking/callback] parâmetros recebidos: {parametros}")

    linhas = "".join(
        f"<li><strong>{html.escape(chave)}</strong>: {html.escape(valor)}</li>"
        for chave, valor in parametros.items()
    )

    sessao_html = ""
    code = parametros.get("code")
    if code is not None:
        # O "state" é validado ANTES de gastar o "code" (que só pode ser
        # trocado por sessão UMA VEZ — ver trocar_codigo_por_sessao, em
        # app/services/enable_banking.py). Fazer ao contrário desperdiçaria
        # um consentimento bancário REAL sempre que este pedido falhasse
        # por um "state" desconhecido (ex.: um recarregar da página, ou um
        # banco que não devolva o "state" tal como foi enviado) — o
        # utilizador teria de repetir toda a autenticação no banco outra
        # vez, sem sequer saber que o motivo foi um "state" inválido, e
        # não algo na troca do "code" em si.
        estado = parametros.get("state")
        pendente = await db.get(AutorizacaoPendente, estado) if estado else None
        if pendente is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Pedido de autorização desconhecido ou já usado.",
            )
        user_id = pendente.user_id
        await db.delete(pendente)

        sessao = await trocar_codigo_por_sessao(code)
        print(f"[open-banking/callback] sessão obtida: {sessao}")

        ligacao = await gravar_ligacao(db, user_id, sessao)
        print(
            f"[open-banking/callback] ligação {ligacao.id} gravada, "
            f"{len(sessao['accounts'])} conta(s)"
        )

        sessao_html = (
            f"<h2>Ligação gravada</h2>"
            f"<p>LigacaoBancaria {html.escape(str(ligacao.id))}, "
            f"{len(sessao['accounts'])} conta(s) ligada(s), por associar a uma Conta.</p>"
            f"<h2>Sessão devolvida pela Enable Banking</h2>"
            f"<pre>{html.escape(str(sessao))}</pre>"
        )

    return f"""
    <html>
      <body style="font-family: sans-serif; padding: 2rem;">
        <h1>Callback da Enable Banking recebido</h1>
        <p>Parâmetros da query string:</p>
        <ul>{linhas or "<li>(nenhum)</li>"}</ul>
        {sessao_html}
      </body>
    </html>
    """


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


@router.post("/contas-ligadas/{conta_ligada_id}/associar-nova-conta")
async def associar_nova_conta(
    conta_ligada_id: uuid.UUID,
    nome: str,
    utilizador: User = Depends(obter_utilizador_atual),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    Cria uma Conta nova a partir de uma ContaLigada ainda por associar, e
    importa de imediato a primeira leva de movimentos disponível (ver
    criar_conta_a_partir_de_ligacao, em
    app/services/importacao_movimentos.py).

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

    conta = await criar_conta_a_partir_de_ligacao(db, utilizador.id, conta_ligada, nome)

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
    Importa os movimentos NOVOS de uma ContaLigada JÁ associada a uma
    Conta (ver sincronizar_movimentos, em
    app/services/importacao_movimentos.py) — disparado manualmente por
    agora; uma sincronização periódica automática fica para mais tarde.
    """
    conta_ligada = await obter_conta_ligada_do_utilizador(db, utilizador.id, conta_ligada_id)
    if conta_ligada.conta_id is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Esta conta ainda não está associada a nenhuma Conta.",
        )

    total_novos = await sincronizar_movimentos(db, conta_ligada)
    return {"movimentos_novos": total_novos}


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
