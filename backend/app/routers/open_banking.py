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
6. "/contas-bancarias/{id}/vinculo" (DELETE): desvincula, mantendo os
   movimentos e as reconciliações do banco (modo "manter") ou tirando o que
   veio do banco (modo "tirar").
7. "/contas-bancarias/{id}/vincular/simular" e "/vincular" (POST): vincula
   uma Conta manual que já existe, em "continuar" (com os pares e, se o
   saldo não bater no dia de corte, uma reconciliação do banco) ou em
   "substituir"; a primeira só mostra o efeito, sem gravar.

Não há «comparar» nem «acertar» numa conta vinculada: o saldo da aplicação
é o contabilístico do banco, e a comparação dos dois é só interna, a cada
sincronização (uma diferença fica no registo do servidor).

E A GESTÃO DAS AUTORIZAÇÕES:
  - "/autorizacoes" (GET): as autorizações, com o estado deduzido (ativa
    ou terminada) e o motivo do fim;
  - "/autorizacoes/{id}/revogar" (POST): termina uma autorização ativa,
    avisando a Enable Banking;
  - "/autorizacoes/{id}" (DELETE): esquece uma autorização terminada;
  - "/autorizar?renova={id}": renova uma autorização (o banco e o país vêm
    dela; no regresso, a antiga é revogada se ainda estiver ativa).

OS ESTADOS NUNCA SE GUARDAM: a autorização, a conta bancária e a Conta têm
estados (ativa/terminada; livre/vinculada/suspensa; manual/vinculada/
suspensa) que se deduzem dos factos guardados — o prazo, se e porque a
autorização terminou antes dele, se a conta bancária ficou indisponível,
se há vínculo. Quando o banco responde que a autorização já não vale, ou
que uma conta já não existe, isso fica registado mesmo que o pedido falhe.

CONTAS JÁ CONHECIDAS: ao gravar uma autorização ("/callback"), cada conta
bancária é reconhecida pela sua identificação estável (um código que não
muda entre autorizações). Se a mesma conta real já alimenta uma Conta, o
vínculo renova-se sozinho; se alimentou uma Conta entretanto desvinculada,
aparece sem vínculo, com a indicação «Já foi a "X"».

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
from datetime import date, datetime, timezone
from typing import Literal
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
from app.core.erros import (
    AutorizacaoTerminadaNoBanco,
    BancoIndisponivel,
    BancoLento,
    ErroDeDominio,
    InexistenteNoBanco,
    LimiteDoBanco,
)
from app.db.session import get_db
from app.models.autorizacao import Autorizacao
from app.models.autorizacao_pendente import AutorizacaoPendente
from app.models.conta import Conta
from app.models.conta_bancaria import ContaBancaria
from app.models.movimento import Movimento
from app.models.user import User
from app.models.vinculo import Vinculo
from app.schemas.vinculacao import VincularConfirmar, VincularSimular
from app.services.autorizacoes import (
    VALIDADE_DO_PEDIDO,
    apagar_pedidos_expirados,
    esquecer,
    listar_autorizacoes,
    marcar_indisponivel,
    marcar_terminada_pelo_banco,
    obter_autorizacao_do_utilizador,
    revogar,
    revogar_sessao_sem_falhar,
    terminar_a_renovada,
)
from app.services.contas import obter_conta_do_utilizador
from app.services.contas_bancarias import (
    conta_antiga_de,
    gravar_autorizacao,
    listar_contas_bancarias,
    nome_sugerido,
    obter_conta_bancaria_do_utilizador,
    registar_falha_de_sincronizacao,
    tipo_sugerido,
    vinculada_noutra_linha,
)
from app.services.enable_banking import (
    dias_de_validade,
    iniciar_autorizacao,
    listar_bancos,
    trocar_codigo_por_sessao,
)
from app.services.estados import estado_autorizacao, estado_conta_bancaria, motivo_do_fim
from app.services.importacao_movimentos import (
    criar_conta_a_partir_de_conta_bancaria,
    sincronizar_conta_bancaria,
)
from app.services.vinculacao import (
    simular_vinculacao,
    vincular_conta_existente,
)
from app.services.vinculacao import desvincular_conta_bancaria as desvincular_com_modo

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
    banco: str | None = None,
    pais: str = "PT",
    renova: uuid.UUID | None = None,
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

    RENOVAR: com "renova" (o id de uma autorização do utilizador), o banco
    e o país vêm dessa autorização, e a nova fica a saber que a renova (no
    regresso do banco, a antiga é revogada se ainda estiver ativa, e as
    contas reconhecidas voltam a sincronizar).

    Cada pedido de autorização EXPIRA ao fim de 15 minutos; os expirados
    (de qualquer utilizador) apagam-se aqui, sempre que um novo começa.
    """
    await apagar_pedidos_expirados(db)
    renova_id = None
    if renova is not None:
        anterior = await obter_autorizacao_do_utilizador(db, utilizador.id, renova)
        banco, pais, renova_id = anterior.banco, anterior.pais, anterior.id
    if not banco:
        return _erro_para_frontend("Escolhe um banco para autorizar.")

    state = str(uuid.uuid4())
    db.add(AutorizacaoPendente(state=state, user_id=utilizador.id, renova_id=renova_id))

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
    pendente = None
    if estado:
        pendente = (
            await db.execute(
                delete(AutorizacaoPendente)
                .where(AutorizacaoPendente.state == estado)
                .returning(
                    AutorizacaoPendente.user_id,
                    AutorizacaoPendente.renova_id,
                    AutorizacaoPendente.created_at,
                )
            )
        ).one_or_none()
    if pendente is None:
        return _erro_para_frontend("Pedido de autorização desconhecido ou já usado.")
    user_id, renova_id, criado_em = pendente
    if criado_em < datetime.now(timezone.utc) - VALIDADE_DO_PEDIDO:
        await db.commit()
        return _erro_para_frontend("O pedido de autorização expirou. Começa outra vez.")
    # O "state" fica consumido mesmo que a troca falhe a seguir: já não
    # serve para mais nada, e uma nova tentativa desde "/autorizar" gera um
    # "state" novo.
    await db.commit()

    try:
        sessao = await trocar_codigo_por_sessao(code)
    except ErroDeDominio as excepcao:
        return _erro_para_frontend(excepcao.mensagem)

    autorizacao = await gravar_autorizacao(db, user_id, sessao, renova_id=renova_id)
    # Se renovou uma autorização ainda ativa, a antiga dá-se como terminada:
    # nunca duas ativas no mesmo acesso.
    sessao_antiga = await terminar_a_renovada(db, autorizacao)
    # O serviço só prepara as alterações; a rota torna-as definitivas, de
    # uma vez.
    await db.commit()
    # Só depois do commit se revoga a sessão antiga no banco: revogar não
    # tem volta atrás, e não pode acontecer se a gravação falhar.
    if sessao_antiga is not None:
        await revogar_sessao_sem_falhar(sessao_antiga)
    return RedirectResponse(
        f"{settings.frontend_url}/contas/nova?autorizacao={autorizacao.id}"
    )


async def _registar_resposta_do_banco(
    db: AsyncSession, erro: ErroDeDominio, conta_bancaria: ContaBancaria
) -> None:
    """
    Quando o banco responde que a autorização já não vale, ou que a conta
    já não existe, isso fica REGISTADO (regra A7), mesmo que o pedido falhe:
    a autorização passa a terminada, ou a conta bancária a indisponível, e
    a Conta que ela alimentava passa a suspensa.

    Desfaz-se primeiro o que o pedido tenha deixado a meio (rollback), para
    o commit seguinte gravar SÓ este registo. Depois do rollback, os
    objetos em memória ficam desatualizados, por isso voltam a ler-se pelo
    id, guardado antes.
    """
    conta_bancaria_id, autorizacao_id = conta_bancaria.id, conta_bancaria.autorizacao_id
    await db.rollback()
    if isinstance(erro, AutorizacaoTerminadaNoBanco):
        await marcar_terminada_pelo_banco(db, await db.get(Autorizacao, autorizacao_id))
    else:
        await marcar_indisponivel(db, await db.get(ContaBancaria, conta_bancaria_id))
    await db.commit()


@router.get("/autorizacoes")
async def autorizacoes(
    utilizador: User = Depends(obter_utilizador_atual),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """
    As autorizações do utilizador, da mais recente para a mais antiga, com
    o ESTADO deduzido ("ativa" ou "terminada"), o motivo do fim
    ("expirada", "revogada", "banco", ou None se ainda ativa), o prazo e o
    número de contas bancárias vinculadas. Para a página das autorizações.
    """
    return [
        {
            "id": str(autorizacao.id),
            "banco": autorizacao.banco,
            "pais": autorizacao.pais,
            "valido_ate": autorizacao.valido_ate.isoformat(),
            "estado": estado_autorizacao(autorizacao),
            "motivo": motivo_do_fim(autorizacao),
            "renova_id": str(autorizacao.renova_id) if autorizacao.renova_id else None,
            "contas_vinculadas": contagem,
            "criada_em": autorizacao.created_at.isoformat(),
        }
        for autorizacao, contagem in await listar_autorizacoes(db, utilizador.id)
    ]


@router.post("/autorizacoes/{autorizacao_id}/revogar", status_code=status.HTTP_204_NO_CONTENT)
async def revogar_autorizacao(
    autorizacao_id: uuid.UUID,
    utilizador: User = Depends(obter_utilizador_atual),
    db: AsyncSession = Depends(get_db),
) -> None:
    """
    Revoga uma autorização ativa (regra A8): pede à Enable Banking para
    terminar a sessão e, se isso correr bem (ou a sessão já não existir),
    a autorização fica terminada, e as Contas que alimentava passam a
    suspensas. 409 se já estiver terminada; se o pedido ao banco falhar, o
    erro chega ao utilizador e a autorização continua ativa.
    """
    autorizacao = await obter_autorizacao_do_utilizador(db, utilizador.id, autorizacao_id)
    await revogar(db, autorizacao)
    await db.commit()


@router.delete("/autorizacoes/{autorizacao_id}", status_code=status.HTTP_204_NO_CONTENT)
async def esquecer_autorizacao(
    autorizacao_id: uuid.UUID,
    utilizador: User = Depends(obter_utilizador_atual),
    db: AsyncSession = Depends(get_db),
) -> None:
    """
    Esquece (apaga) uma autorização terminada, com as suas contas
    bancárias. As Contas que estavam suspensas passam a manuais, com os
    movimentos e a memória. 409 se ainda estiver ativa (revoga-se
    primeiro).
    """
    autorizacao = await obter_autorizacao_do_utilizador(db, utilizador.id, autorizacao_id)
    await esquecer(db, autorizacao)
    await db.commit()


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

    # Os vínculos destas contas bancárias, de uma só vez: a Conta que cada
    # uma alimenta, se alimentar alguma.
    conta_por_conta_bancaria = dict(
        (
            await db.execute(
                select(Vinculo.conta_bancaria_id, Vinculo.conta_id).where(
                    Vinculo.conta_bancaria_id.in_([c.id for c in contas])
                )
            )
        ).all()
    )

    saida = []
    for conta in contas:
        antiga = await conta_antiga_de(db, utilizador.id, conta)
        conta_id = conta_por_conta_bancaria.get(conta.id)
        # O ESTADO da conta bancária, deduzido dos factos (ver
        # app/services/estados.py): livre, livre_bloqueada, vinculada ou
        # suspensa. E, se estiver livre, a ETIQUETA: "vinculada_noutra" (a
        # mesma conta real já alimenta uma Conta através de outra
        # autorização — não se pode vincular), "ja_foi" (uma Conta manual
        # lembra-se dela) ou "nova".
        estado = estado_conta_bancaria(conta, autorizacao, tem_vinculo=conta_id is not None)
        etiqueta = None
        if conta_id is None:
            if await vinculada_noutra_linha(db, utilizador.id, conta) is not None:
                etiqueta = "vinculada_noutra"
            elif antiga is not None:
                etiqueta = "ja_foi"
            else:
                etiqueta = "nova"
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
                "conta_id": str(conta_id) if conta_id else None,
                "conta_nome": nome_por_id.get(conta_id) if conta_id else None,
                # Até quando vale esta autorização.
                "valido_ate": autorizacao.valido_ate.isoformat(),
                # Sugestões para uma Conta nova.
                "tipo_sugerido": tipo_sugerido(conta.tipo_conta_banco),
                "nome_sugerido": nome_sugerido(conta, autorizacao.banco, nomes),
                # A Conta desvinculada que esta conta bancária já alimentou
                # («Já foi a "X"»), ou None.
                "conta_antiga": {"id": str(antiga.id), "nome": antiga.nome} if antiga else None,
                "estado": estado,
                "etiqueta": etiqueta,
                "estado_autorizacao": estado_autorizacao(autorizacao),
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
    try:
        conta = await criar_conta_a_partir_de_conta_bancaria(
            db, utilizador.id, conta_bancaria, nome, data_de, tipo
        )
    except (AutorizacaoTerminadaNoBanco, InexistenteNoBanco) as erro:
        await _registar_resposta_do_banco(db, erro, conta_bancaria)
        raise
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

    Uma falha POR CAUSA DO BANCO (não respondeu, demorou demasiado, ou o
    limite de acessos do dia) fica guardada no vínculo, com o motivo, para
    a página da conta a continuar a mostrar ao ser reaberta — mesmo que o
    pedido falhe (desfaz-se o que ficou a meio, grava-se só a falha, e o
    erro segue para o cliente como antes).
    """
    conta_bancaria = await obter_conta_bancaria_do_utilizador(db, utilizador.id, conta_bancaria_id)
    try:
        total_novos = await sincronizar_conta_bancaria(db, utilizador, conta_bancaria)
    except (AutorizacaoTerminadaNoBanco, InexistenteNoBanco) as erro:
        await _registar_resposta_do_banco(db, erro, conta_bancaria)
        raise
    except (BancoIndisponivel, BancoLento) as erro:
        # O id guarda-se antes do rollback: depois dele, o objeto em memória
        # fica desatualizado.
        conta_bancaria_id = conta_bancaria.id
        await db.rollback()
        motivo = "limite" if isinstance(erro, LimiteDoBanco) else "sem-ligacao"
        await registar_falha_de_sincronizacao(db, conta_bancaria_id, motivo)
        await db.commit()
        raise
    await db.commit()
    return {"movimentos_importados": total_novos}


@router.delete(
    "/contas-bancarias/{conta_bancaria_id}/vinculo", status_code=status.HTTP_204_NO_CONTENT
)
async def desvincular_conta_bancaria(
    conta_bancaria_id: uuid.UUID,
    modo: Literal["manter", "tirar"] = "manter",
    utilizador: User = Depends(obter_utilizador_atual),
    db: AsyncSession = Depends(get_db),
) -> None:
    """
    Desfaz o vínculo de uma conta bancária: a sincronização para, mas a
    Conta e os movimentos já importados ficam. O caminho termina em
    "/vinculo" porque o que se apaga é o vínculo, não a conta bancária nem
    a Conta. Para apagar tudo, elimina-se a Conta (DELETE /contas/{id}).

    "modo": "manter" (por omissão — os movimentos do banco ficam e as
    reconciliações do banco passam a ser do utilizador) ou "tirar" (saem os
    movimentos e as reconciliações criados por este vínculo).
    """
    conta_bancaria = await obter_conta_bancaria_do_utilizador(db, utilizador.id, conta_bancaria_id)
    await desvincular_com_modo(db, conta_bancaria, modo)
    await db.commit()


def _texto(valor) -> str | None:
    """Um valor em dinheiro como texto com 2 casas ("1234.50"), ou None."""
    return f"{valor:.2f}" if valor is not None else None


@router.post("/contas-bancarias/{conta_bancaria_id}/vincular/simular")
async def simular_vinculacao_de_conta(
    conta_bancaria_id: uuid.UUID,
    dados: VincularSimular,
    utilizador: User = Depends(obter_utilizador_atual),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    O "antes → depois" de vincular uma Conta que já existe a esta conta
    bancária, sem gravar nada (regra A4): em "continuar", a data de corte, o
    saldo da aplicação e o do banco, o acerto que entraria (com e sem os
    pares propostos) e os pares; em "substituir", o que se perderia.
    """
    conta_bancaria = await obter_conta_bancaria_do_utilizador(db, utilizador.id, conta_bancaria_id)
    conta = await obter_conta_do_utilizador(db, utilizador, dados.conta_id)
    try:
        efeito = await simular_vinculacao(db, utilizador, conta, conta_bancaria, dados.modo)
    except (AutorizacaoTerminadaNoBanco, InexistenteNoBanco) as erro:
        await _registar_resposta_do_banco(db, erro, conta_bancaria)
        raise
    dinheiro = {"saldo_aplicacao", "saldo_banco", "acerto_sem_pares", "acerto_com_pares"}
    saida = {chave: (_texto(valor) if chave in dinheiro else valor) for chave, valor in efeito.items()}
    if "pares" in saida:
        saida["pares"] = [{**par, "valor": _texto(par["valor"])} for par in saida["pares"]]
    return saida


@router.post("/contas-bancarias/{conta_bancaria_id}/vincular")
async def vincular_conta(
    conta_bancaria_id: uuid.UUID,
    dados: VincularConfirmar,
    utilizador: User = Depends(obter_utilizador_atual),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    Vincula uma Conta manual que já existe a esta conta bancária (regra A4),
    em "continuar" (com os pares aceites) ou "substituir". Tudo numa só
    transação: se o banco falhar a meio, nada fica gravado.
    """
    conta_bancaria = await obter_conta_bancaria_do_utilizador(db, utilizador.id, conta_bancaria_id)
    conta = await obter_conta_do_utilizador(db, utilizador, dados.conta_id)
    try:
        resultado = await vincular_conta_existente(
            db, utilizador, conta, conta_bancaria, dados.modo, dados.pares_aceites
        )
    except (AutorizacaoTerminadaNoBanco, InexistenteNoBanco) as erro:
        await _registar_resposta_do_banco(db, erro, conta_bancaria)
        raise
    await db.commit()
    return {**resultado, "acerto": _texto(resultado["acerto"])}
