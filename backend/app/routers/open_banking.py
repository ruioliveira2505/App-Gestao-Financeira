"""
ROTAS DE OPEN BANKING
========================

Este ficheiro define os endpoints da integração de Open Banking: a
importação de contas e movimentos bancários reais através de um
intermediário regulado, a Enable Banking (enablebanking.com). Funciona ao
abrigo da PSD2, a diretiva europeia que obriga os bancos a dar acesso aos
dados de uma conta, com consentimento explícito do seu dono, a aplicações
terceiras como esta.

VOCABULÁRIO:
  - AUTORIZAÇÃO: o consentimento que o utilizador dá no banco para esta
    aplicação ler as contas que escolheu partilhar, durante um prazo (na
    API da Enable Banking chama-se "sessão");
  - CONTA BANCÁRIA: cada conta real partilhada numa autorização;
  - VÍNCULO: o facto de uma conta bancária alimentar uma Conta desta
    aplicação. Vincular cria-o; desvincular desfá-lo.

O FLUXO COMPLETO, pela ordem em que acontece:
1. "/autorizar" (autenticado): o utilizador escolhe um banco; esta rota
   inicia um pedido de autorização real junto da Enable Banking e
   reencaminha o browser para o ecrã de login desse banco.
2. "/callback": para onde a Enable Banking reencaminha o browser depois de
   o utilizador se autenticar no banco (autenticação forte, SCA — "Strong
   Customer Authentication") e dar consentimento. Troca o "code" recebido
   por uma sessão, grava a autorização e as suas contas bancárias, e
   reencaminha de volta para o frontend (nunca devolve dados em bruto ao
   browser).
3. "/autorizacoes/{id}/contas-bancarias": lista as contas bancárias que
   uma autorização trouxe, para o utilizador escolher o que fazer com cada
   uma.
4. "/contas-bancarias/{id}/criar-conta": cria uma Conta desta aplicação a
   partir de uma conta bancária ainda sem vínculo, vincula-as e importa os
   movimentos disponíveis.
5. "/contas-bancarias/{id}/sincronizar": importa os movimentos NOVOS de
   uma conta bancária já vinculada.
6. "/contas-bancarias/{id}/vinculo" (DELETE): desvincula, sem apagar nada
   da Conta nem dos movimentos já importados.

CONTAS JÁ CONHECIDAS: ao gravar uma autorização ("/callback"), cada conta
bancária é reconhecida pela sua identificação estável (um código que não
muda entre autorizações). Se a mesma conta real já alimenta uma Conta, o
vínculo renova-se sozinho; se alimentou uma Conta entretanto desvinculada,
aparece sem vínculo, com a indicação «Já foi a "X"».

AINDA NÃO IMPLEMENTADO: vincular uma conta bancária a uma Conta que já
existe (desvinculada, ou manual). Precisa de uma reconciliação de saldo
para o período sem movimentos do banco, que a aplicação ainda não tem.

IDENTIFICAÇÃO DO UTILIZADOR NO CALLBACK — O PROBLEMA E A SOLUÇÃO: o
"/callback" chega SEM o cookie de sessão desta aplicação, porque o browser
volta do site do banco, e por isso não se sabe, pelo cookie, quem é o
utilizador. A solução: "/autorizar" (essa sim autenticada) grava, antes de
reencaminhar, uma linha "state → utilizador" (uma AutorizacaoPendente). O
"state" é um valor aleatório que a Enable Banking devolve, inalterado, no
callback; é por ele que "/callback" recupera o utilizador certo.

ACHADO de quando este fluxo foi testado pela primeira vez: o botão
"Activate by linking accounts" do painel da Enable Banking NUNCA devolve um
"code" no callback. Só o fluxo iniciado por nós ("/autorizar") o faz;
aquele botão é uma ação do próprio painel, não o fluxo real.
"""

import uuid
from datetime import date
from urllib.parse import quote

from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

# RedirectResponse faz o browser saltar de imediato para outro URL — usado
# em "/autorizar" (para enviar o utilizador para o login do banco) e em
# "/callback" (para o trazer de volta à interface).
from fastapi.responses import RedirectResponse

from app.core.config import settings
from app.core.deps import obter_utilizador_atual
from app.core.erros import ErroDeDominio
from app.db.session import get_db
from app.models.autorizacao import Autorizacao
from app.models.autorizacao_pendente import AutorizacaoPendente
from app.models.conta import Conta
from app.models.movimento import Movimento
from app.models.user import User
from app.services.contas_bancarias import (
    conta_antiga_de,
    desvincular,
    gravar_autorizacao,
    listar_contas_bancarias,
    nome_sugerido,
    obter_conta_bancaria_do_utilizador,
    tipo_sugerido,
)
from app.services.enable_banking import (
    dias_de_validade,
    iniciar_autorizacao,
    listar_bancos,
    trocar_codigo_por_sessao,
)
from app.services.importacao_movimentos import (
    criar_conta_a_partir_de_conta_bancaria,
    sincronizar_conta_bancaria,
)

router = APIRouter(prefix="/open-banking", tags=["open-banking"])


@router.get("/bancos")
async def bancos(
    pais: str = "PT", utilizador: User = Depends(obter_utilizador_atual)
) -> list[dict]:
    """
    Lista os bancos suportados pela Enable Banking num país (por omissão,
    Portugal).

    Não tem efeitos secundários (só lê uma lista pública), mas exige sessão
    iniciada, como todas as rotas da aplicação.

    A cada banco junta-se "validade_dias": quanto tempo vai durar a
    autorização pedida a esse banco (o máximo que ele aceita, até 180
    dias). O frontend mostra-o antes de o utilizador sair para o banco.
    """
    bancos = await listar_bancos(pais)
    return [{**banco, "validade_dias": dias_de_validade(banco)} for banco in bancos]


@router.post("/autorizar")
async def autorizar(
    request: Request,
    banco: str,
    pais: str = "PT",
    utilizador: User = Depends(obter_utilizador_atual),
    db: AsyncSession = Depends(get_db),
) -> RedirectResponse:
    """
    Inicia uma autorização REAL junto de um banco e reencaminha de imediato
    o browser para o URL que a Enable Banking devolve: o ecrã de login e
    autenticação forte desse banco.

    "banco" tem de corresponder exatamente ao campo "name" devolvido por
    "/bancos" (ex.: "Caixa Geral de Depósitos").

    POST, E NÃO GET, apesar de não ter corpo: um GET com este efeito
    (grava uma AutorizacaoPendente e faz um pedido real à Enable Banking)
    ficaria exposto a CSRF ("Cross-Site Request Forgery": outro site levar
    o browser de uma vítima com sessão iniciada a fazer um pedido sem ela
    saber). O cookie de sessão desta aplicação usa "SameSite=Lax", que
    bloqueia um POST vindo de outro site, mas deixa passar um GET vindo de
    um simples link. O frontend chama esta rota com um formulário
    submetido por JavaScript (method="POST").

    Antes de reencaminhar, grava uma AutorizacaoPendente (state →
    utilizador), que permite a "/callback" recuperar o utilizador certo
    sem cookie de sessão. Só fica gravada se a Enable Banking aceitar o
    pedido: se falhar (banco em baixo, demasiado lento…), a transação é
    desfeita (não fica uma AutorizacaoPendente órfã) e o browser volta à
    aplicação com a mensagem do erro, em vez de ficar numa página com uma
    resposta JSON em bruto, fora da aplicação — esta rota é uma NAVEGAÇÃO
    do browser (um formulário submetido), não um pedido feito pelo
    JavaScript da aplicação.

    request.url_for("callback") constrói o URL da função "callback" desta
    aplicação em vez de o escrever à mão: o FastAPI já sabe por onde o
    pedido chegou.
    """
    state = str(uuid.uuid4())
    db.add(AutorizacaoPendente(state=state, user_id=utilizador.id))

    redirect_url = str(request.url_for("callback"))
    try:
        url = await iniciar_autorizacao(banco, pais, redirect_url, state)
    except ErroDeDominio as erro:
        # Sem commit: a AutorizacaoPendente acima é desfeita quando a
        # sessão fecha.
        return _erro_para_frontend(erro.mensagem)
    # Confirmada só agora, ANTES de enviar o browser para o banco: quando
    # o utilizador voltar ao "/callback", ela já tem de existir.
    await db.commit()
    # 303 (See Other), e não o 307 por omissão: um 307 diz ao browser para
    # REPETIR o mesmo método (POST) no novo URL; aqui tem de ser um GET,
    # porque o destino é um ecrã de login.
    return RedirectResponse(url, status_code=status.HTTP_303_SEE_OTHER)


def _erro_para_frontend(mensagem: str) -> RedirectResponse:
    """
    Reencaminha para o passo do frontend onde este fluxo começou (o
    formulário "Nova conta", opção "Através do teu banco"), com a mensagem
    de erro no URL. Usada em todos os pontos de falha de "callback", para
    o utilizador NUNCA ficar preso numa página fora da aplicação.
    """
    return RedirectResponse(f"{settings.frontend_url}/contas/nova?erro={quote(mensagem)}")


@router.get("/callback")
async def callback(request: Request, db: AsyncSession = Depends(get_db)) -> RedirectResponse:
    """
    Recebe o regresso do browser vindo da Enable Banking, depois de o
    utilizador se autenticar no banco (ou recusar ou cancelar). NUNCA
    exige sessão (não pode: ver IDENTIFICAÇÃO DO UTILIZADOR NO CALLBACK, no
    topo do ficheiro): o utilizador é recuperado pelo "state".

    Devolve sempre um REENCAMINHAMENTO para o frontend, nunca dados em
    bruto: em caso de sucesso, para "/contas/nova?autorizacao=<id>", onde
    o frontend continua o fluxo; em caso de erro, para
    "/contas/nova?erro=<mensagem>".
    """
    parametros = dict(request.query_params)

    code = parametros.get("code")
    if code is None:
        return _erro_para_frontend(parametros.get("error", "Autorização não concluída."))

    # O "state" é validado ANTES de gastar o "code", que só pode ser trocado
    # por uma sessão UMA VEZ. Fazer ao contrário desperdiçaria um
    # consentimento bancário real sempre que o "state" fosse desconhecido
    # (por exemplo, ao recarregar a página): o utilizador teria de repetir
    # toda a autenticação no banco sem perceber porquê.
    #
    # RECLAMAR O STATE DE FORMA ATÓMICA: um só DELETE ... RETURNING apaga a
    # AutorizacaoPendente e devolve o seu dono na mesma instrução, e o
    # commit confirma-o logo, ANTES de falar com o banco. Se dois pedidos
    # chegarem ao mesmo tempo com o mesmo "state" (o browser a repetir o
    # pedido, ou um recarregar muito rápido), a base de dados só deixa um
    # deles apagar a linha; o outro não encontra nada e recebe "já usado",
    # em vez de tentar trocar o mesmo "code" uma segunda vez.
    estado = parametros.get("state")
    user_id = None
    if estado:
        user_id = (
            await db.execute(
                delete(AutorizacaoPendente)
                .where(AutorizacaoPendente.state == estado)
                .returning(AutorizacaoPendente.user_id)
            )
        ).scalar_one_or_none()
    if user_id is None:
        return _erro_para_frontend("Pedido de autorização desconhecido ou já usado.")
    # O "state" fica consumido mesmo que a troca falhe a seguir: já não
    # serve para mais nada, e uma nova tentativa desde "/autorizar" gera um
    # "state" novo.
    await db.commit()

    try:
        sessao = await trocar_codigo_por_sessao(code)
    except ErroDeDominio as excepcao:
        return _erro_para_frontend(excepcao.mensagem)

    autorizacao = await gravar_autorizacao(db, user_id, sessao)
    # O serviço só prepara as alterações; a rota torna-as definitivas, de
    # uma vez.
    await db.commit()
    return RedirectResponse(
        f"{settings.frontend_url}/contas/nova?autorizacao={autorizacao.id}"
    )


@router.get("/autorizacoes/{autorizacao_id}/contas-bancarias")
async def contas_bancarias(
    autorizacao_id: uuid.UUID,
    utilizador: User = Depends(obter_utilizador_atual),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """
    As contas bancárias trazidas por uma autorização, usada pelo frontend
    logo depois de voltar do banco, para mostrar as contas encontradas e
    deixar escolher o que fazer com cada uma (ver criar-conta, abaixo).
    """
    contas = await listar_contas_bancarias(db, utilizador.id, autorizacao_id)
    # O nome do banco vem da autorização (todas as contas bancárias de uma
    # autorização são do mesmo banco). listar_contas_bancarias já confirmou
    # que a autorização existe e é deste utilizador (404 caso contrário),
    # por isso aqui nunca vem None.
    autorizacao = await db.get(Autorizacao, autorizacao_id)

    # As Contas do utilizador: os nomes (para a sugestão nunca repetir um)
    # e, pelo id, o nome da Conta que uma conta bancária já alimenta.
    resultado = await db.execute(select(Conta).where(Conta.user_id == utilizador.id))
    contas_utilizador = list(resultado.scalars().all())
    nomes = [c.nome for c in contas_utilizador]
    nome_por_id = {c.id: c.nome for c in contas_utilizador}

    saida = []
    for conta in contas:
        antiga = await conta_antiga_de(db, utilizador.id, conta)
        saida.append(
            {
                "id": str(conta.id),
                "banco": autorizacao.banco,
                "iban": conta.iban,
                "moeda": conta.moeda,
                "nome_titular": conta.nome_titular,
                # Já vinculada: ou foi vinculada antes, ou o vínculo
                # renovou-se sozinho ao autorizar. "conta_nome" é o nome
                # dessa Conta, para o frontend a mostrar.
                "conta_id": str(conta.conta_id) if conta.conta_id else None,
                "conta_nome": nome_por_id.get(conta.conta_id) if conta.conta_id else None,
                # Até quando vale esta autorização.
                "valido_ate": autorizacao.valido_ate.isoformat(),
                # Sugestões para uma Conta nova.
                "tipo_sugerido": tipo_sugerido(conta.tipo_conta_banco),
                "nome_sugerido": nome_sugerido(conta, autorizacao.banco, nomes),
                # A Conta desvinculada que esta conta bancária já alimentou
                # («Já foi a "X"»), ou None.
                "conta_antiga": {"id": str(antiga.id), "nome": antiga.nome} if antiga else None,
            }
        )
    return saida


@router.post("/contas-bancarias/{conta_bancaria_id}/criar-conta")
async def criar_conta(
    conta_bancaria_id: uuid.UUID,
    # O mesmo limite da coluna Conta.nome (120 caracteres) e do formulário
    # manual. Validar logo à entrada é importante: sem isto, um nome
    # demasiado longo só falhava ao gravar, DEPOIS de já se terem feito os
    # pedidos ao banco (saldos e movimentos), que a PSD2 limita a poucos
    # por dia.
    nome: str = Query(min_length=1, max_length=120),
    data_de: date | None = None,
    # O mesmo limite da coluna Conta.tipo (40 caracteres), validado aqui
    # (422) em vez de deixar a base de dados recusar com um erro genérico.
    tipo: str | None = Query(default=None, max_length=40),
    utilizador: User = Depends(obter_utilizador_atual),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    Cria uma Conta nova a partir de uma conta bancária ainda sem vínculo,
    vincula-as, e importa de imediato os movimentos disponíveis.

    "data_de", quando indicada, limita a importação a partir dessa data (o
    utilizador escolhe entre "todo o histórico" e "desde uma data").

    "tipo" (ex.: "Conta à ordem") é o mesmo campo livre do formulário
    manual; o frontend propõe-no a partir do código que o banco envia, mas
    a escolha final é do utilizador.

    "nome" chega sem espaços nas pontas e não pode ficar vazio (422), nem
    repetir o de outra Conta do utilizador (409, comparado sem acentos nem
    maiúsculas).
    """
    conta_bancaria = await obter_conta_bancaria_do_utilizador(db, utilizador.id, conta_bancaria_id)
    conta = await criar_conta_a_partir_de_conta_bancaria(
        db, utilizador.id, conta_bancaria, nome, data_de, tipo
    )
    # A Conta, o vínculo e os movimentos importados gravam-se juntos: se
    # algo tivesse falhado a meio, nada ficaria gravado.
    await db.commit()

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


@router.post("/contas-bancarias/{conta_bancaria_id}/sincronizar")
async def sincronizar(
    conta_bancaria_id: uuid.UUID,
    utilizador: User = Depends(obter_utilizador_atual),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    Importa os movimentos NOVOS de uma conta bancária já vinculada — o
    botão "Sincronizar" no detalhe de uma Conta (uma conta) e no menu da
    lista de Contas (todas, uma a uma).

    409 se a conta bancária ainda não tiver vínculo: não há para onde
    sincronizar (a regra vive no serviço).
    """
    conta_bancaria = await obter_conta_bancaria_do_utilizador(db, utilizador.id, conta_bancaria_id)
    total_novos = await sincronizar_conta_bancaria(db, utilizador, conta_bancaria)
    await db.commit()
    return {"movimentos_importados": total_novos}


@router.delete(
    "/contas-bancarias/{conta_bancaria_id}/vinculo", status_code=status.HTTP_204_NO_CONTENT
)
async def desvincular_conta_bancaria(
    conta_bancaria_id: uuid.UUID,
    utilizador: User = Depends(obter_utilizador_atual),
    db: AsyncSession = Depends(get_db),
) -> None:
    """
    Desfaz o vínculo de uma conta bancária: a sincronização para, mas a
    Conta e os movimentos já importados ficam. O caminho termina em
    "/vinculo" porque o que se apaga é o vínculo, não a conta bancária nem
    a Conta. Para apagar tudo, elimina-se a Conta (DELETE /contas/{id}).
    """
    conta_bancaria = await obter_conta_bancaria_do_utilizador(db, utilizador.id, conta_bancaria_id)
    await desvincular(db, conta_bancaria)
    await db.commit()
