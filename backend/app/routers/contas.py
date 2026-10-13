"""
ROTAS DE CONTAS
================

Endpoints para gerir as contas do utilizador autenticado. Cada rota exige
autenticação (via obter_utilizador_atual, app/core/deps.py) e trabalha
sempre no âmbito do utilizador do pedido — uma conta de outro utilizador
é, para todos os efeitos, inexistente.

AS REGRAS DE NEGÓCIO NÃO VIVEM AQUI, mas no serviço de contas
(app/services/contas.py). Cada rota recebe o pedido já validado no
formato, chama o serviço, torna as alterações definitivas (commit, uma vez
por pedido) e devolve a resposta. Se uma regra for violada, o serviço
lança um erro de domínio, que a API traduz no código HTTP certo.
"""

import uuid
from decimal import Decimal

# APIRouter agrupa rotas relacionadas; Depends injeta dependências
# (utilizador autenticado, sessão de base de dados); status fornece os
# códigos HTTP como constantes com nome.
from fastapi import APIRouter, Depends, status

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import obter_utilizador_atual
from app.core.tempo import hoje
from app.db.session import get_db
from app.models.conta import Conta
from app.models.user import User
from app.models.autorizacao import Autorizacao
from app.models.vinculo import Vinculo
from app.models.conta_bancaria import ContaBancaria
from app.schemas.contas import AncoraEditar, AncoraSimuladaOut, ContaCriar, ContaEditar, ContaOut, VinculoOut
from app.services.cambio import SemTaxaCambio, converter
from app.services.contas import (
    apagar_conta as apagar_conta_servico,
    criar_conta as criar_conta_servico,
    editar_ancora,
    editar_conta as editar_conta_servico,
    obter_conta_do_utilizador,
    simular_ancora,
    soma_movimentos,
    somas_de_movimentos,
)
from app.services.contas_bancarias import vinculos_das_contas
from app.services.estados import estado_autorizacao, estado_conta, motivo_do_fim

# prefix="/contas": todas as rotas aqui ficam sob "/contas". tags=["contas"]
# agrupa-as com esse nome na documentação automática do FastAPI.
router = APIRouter(prefix="/contas", tags=["contas"])

# Usado para arredondar/normalizar os valores monetários a 2 casas
# decimais, coerente com a coluna Numeric(14, 2).
_DUAS_CASAS = Decimal("0.01")


async def _para_saida(
    db: AsyncSession,
    conta: Conta,
    soma: Decimal,
    moeda_principal: str,
    vinculos: dict[uuid.UUID, tuple[Vinculo, ContaBancaria, Autorizacao]] | None = None,
) -> ContaOut:
    """
    Converte uma linha da tabela "contas" na forma devolvida pela API.

    É aqui que os valores decimais passam a texto e que o "saldo actual" é
    determinado: saldo_ancora + a soma (com sinal) dos movimentos da
    conta, já calculada por quem chama (soma_movimentos /
    somas_de_movimentos, em app/services/contas.py — o parâmetro chama-se
    aqui só "soma", não "soma_movimentos" como antes, para não sombrear o
    nome dessas funções importadas neste ficheiro). Ao contrário do que o
    nome sugere, já não é só formatação: também converte esse saldo para
    "moeda_principal" (a escolhida pelo utilizador — ver PATCH /auth/me),
    o que exige consultar a tabela de taxas de câmbio
    (app/services/cambio.py) — daí ser "async" e receber "db".

    SemTaxaCambio (falta genuína de taxas — ex.: moeda acabada de
    acrescentar, sem histórico ainda) é apanhada aqui: fica
    saldo_convertido=None em vez de a rota inteira falhar com 500 só
    porque uma conversão de apresentação não foi possível. A lista/o
    detalhe da conta continuam a mostrar o essencial (o saldo na sua
    própria moeda), mesmo sem conversão.
    """
    saldo_ancora_texto = f"{conta.saldo_ancora:.2f}"
    saldo_atual = conta.saldo_ancora + soma
    saldo_texto = f"{saldo_atual:.2f}"

    try:
        saldo_convertido = await converter(
            db, saldo_atual, conta.moeda, moeda_principal, hoje()
        )
        saldo_convertido_texto: str | None = str(saldo_convertido.quantize(_DUAS_CASAS))
    except SemTaxaCambio:
        saldo_convertido_texto = None

    # Se uma conta bancária alimentar esta Conta (se tiver VÍNCULO), o
    # frontend precisa do id da conta bancária (para sincronizar e
    # desvincular), do nome do banco e do titular, do prazo da autorização e do ESTADO
    # da Conta (vinculada ou suspensa), deduzido dos factos.
    #
    # "vinculos": os vínculos já lidos de várias contas de uma vez (a lista
    # passa-os, para não fazer três consultas por conta — ver
    # vinculos_das_contas); sem eles (uma só conta), lêem-se aqui.
    vinculo_out = None
    if vinculos is None:
        vinculos = await vinculos_das_contas(db, [conta.id])
    dados_vinculo = vinculos.get(conta.id)
    if dados_vinculo is not None:
        vinculo, conta_bancaria, autorizacao = dados_vinculo
        estado = estado_conta(conta_bancaria, autorizacao)
        # Quando terminou a AUTORIZAÇÃO (None se ainda está ativa): o que
        # chegar primeiro, o fim antecipado (revogada, ou o banco deu-a por
        # terminada — pode ser registado já depois do prazo) ou o fim do
        # prazo. Vai à parte do estado da Conta: uma Conta suspensa porque o
        # banco deixou de partilhar a conta pode ter a autorização ativa ou
        # já terminada, e a interface tem de saber qual.
        autorizacao_terminada_em = None
        if estado_autorizacao(autorizacao) == "terminada":
            autorizacao_terminada_em = (
                min(autorizacao.terminada_em, autorizacao.valido_ate)
                if autorizacao.terminada_em is not None
                else autorizacao.valido_ate
            )
        motivo = None
        suspensa_desde = None
        if estado == "suspensa":
            motivo = (
                "indisponivel"
                if conta_bancaria.indisponivel_em is not None
                else motivo_do_fim(autorizacao)
            )
            # Desde quando: o banco deixou de partilhar a conta, ou a
            # autorização terminou.
            suspensa_desde = (
                conta_bancaria.indisponivel_em if motivo == "indisponivel" else autorizacao_terminada_em
            )
        vinculo_out = VinculoOut(
            conta_bancaria_id=conta_bancaria.id,
            banco=autorizacao.banco,
            titular=conta_bancaria.nome_titular,
            iban=conta_bancaria.iban,
            sincronizado_em=vinculo.sincronizado_em,
            suspensa_desde=suspensa_desde,
            autorizacao_terminada_em=autorizacao_terminada_em,
            # Uma sincronização boa apaga a falha, por isso a que está guardada
            # é sempre mais recente do que a última que correu bem.
            falha_em=vinculo.falha_em,
            falha_motivo=vinculo.falha_motivo,
            valido_ate=autorizacao.valido_ate,
            autorizacao_id=autorizacao.id,
            estado=estado,
            motivo=motivo,
        )

    return ContaOut(
        id=conta.id,
        nome=conta.nome,
        banco=conta.banco,
        tipo=conta.tipo,
        moeda=conta.moeda,
        data_ancora=conta.data_ancora,
        saldo_ancora=saldo_ancora_texto,
        saldo=saldo_texto,
        saldo_convertido=saldo_convertido_texto,
        vinculo=vinculo_out,
        created_at=conta.created_at,
        updated_at=conta.updated_at,
    )


@router.post("", response_model=ContaOut, status_code=status.HTTP_201_CREATED)
async def criar_conta(
    dados: ContaCriar,
    utilizador: User = Depends(obter_utilizador_atual),
    db: AsyncSession = Depends(get_db),
) -> ContaOut:
    """
    Cria uma conta manual para o utilizador autenticado. O corpo do pedido
    já chega validado pelo schema ContaCriar (nome não vazio, moeda
    suportada, comprimentos máximos); as regras de negócio (data inicial
    nunca no futuro, nome único) aplica-as o serviço.
    """
    conta = await criar_conta_servico(
        db,
        utilizador,
        nome=dados.nome,
        banco=dados.banco,
        tipo=dados.tipo,
        moeda=dados.moeda,
        data_ancora=dados.data_ancora,
        saldo_ancora=dados.saldo_ancora,
    )
    await db.commit()

    # Uma conta recém-criada nunca tem movimentos ainda — soma 0, sem
    # precisar de consultar a tabela de movimentos.
    return await _para_saida(db, conta, Decimal(0), utilizador.moeda_principal)


@router.get("", response_model=list[ContaOut])
async def listar_contas(
    utilizador: User = Depends(obter_utilizador_atual),
    db: AsyncSession = Depends(get_db),
) -> list[ContaOut]:
    """Lista as contas do utilizador autenticado, por ordem alfabética do nome."""
    resultado = await db.execute(
        select(Conta).where(Conta.user_id == utilizador.id).order_by(Conta.nome)
    )
    contas = list(resultado.scalars())
    somas = await somas_de_movimentos(db, [conta.id for conta in contas])
    # Os vínculos de todas as contas numa só consulta (ver vinculos_das_contas).
    vinculos = await vinculos_das_contas(db, [conta.id for conta in contas])
    return [
        await _para_saida(db, conta, somas.get(conta.id, Decimal(0)), utilizador.moeda_principal, vinculos)
        for conta in contas
    ]


@router.get("/{conta_id}", response_model=ContaOut)
async def obter_conta(
    conta_id: uuid.UUID,
    utilizador: User = Depends(obter_utilizador_atual),
    db: AsyncSession = Depends(get_db),
) -> ContaOut:
    """Devolve uma conta do utilizador autenticado. 404 se não for sua ou não existir."""
    conta = await obter_conta_do_utilizador(db, utilizador, conta_id)
    soma = await soma_movimentos(db, conta.id)
    return await _para_saida(db, conta, soma, utilizador.moeda_principal)


@router.patch("/{conta_id}", response_model=ContaOut)
async def editar_conta(
    conta_id: uuid.UUID,
    dados: ContaEditar,
    utilizador: User = Depends(obter_utilizador_atual),
    db: AsyncSession = Depends(get_db),
) -> ContaOut:
    """
    Atualiza os campos descritivos de uma conta (nome, banco, tipo,
    moeda). As regras (nome único; numa conta vinculada ao banco, banco e
    moeda bloqueados; numa manual, a moeda só muda sem movimentos)
    aplica-as o serviço.
    """
    conta = await obter_conta_do_utilizador(db, utilizador, conta_id)
    conta = await editar_conta_servico(
        db, conta, nome=dados.nome, banco=dados.banco, tipo=dados.tipo, moeda=dados.moeda
    )
    await db.commit()

    soma = await soma_movimentos(db, conta.id)
    return await _para_saida(db, conta, soma, utilizador.moeda_principal)


@router.patch("/{conta_id}/ancora", response_model=ContaOut)
async def editar_ancora_da_conta(
    conta_id: uuid.UUID,
    dados: AncoraEditar,
    utilizador: User = Depends(obter_utilizador_atual),
    db: AsyncSession = Depends(get_db),
) -> ContaOut:
    """
    Muda a âncora (a data e o saldo iniciais) de uma conta manual. Nunca
    depois do primeiro movimento nem da primeira reconciliação; os acertos
    das reconciliações recalculam-se. As regras vivem no serviço.
    """
    conta = await obter_conta_do_utilizador(db, utilizador, conta_id)
    conta = await editar_ancora(db, conta, dados.data_ancora, dados.saldo_ancora)
    await db.commit()
    soma = await soma_movimentos(db, conta.id)
    return await _para_saida(db, conta, soma, utilizador.moeda_principal)


@router.post("/{conta_id}/ancora/simular", response_model=AncoraSimuladaOut)
async def simular_ancora_da_conta(
    conta_id: uuid.UUID,
    dados: AncoraEditar,
    utilizador: User = Depends(obter_utilizador_atual),
    db: AsyncSession = Depends(get_db),
) -> AncoraSimuladaOut:
    """
    O efeito de mudar a âncora, sem gravar: o saldo atual novo e, havendo
    reconciliações, o acerto novo da primeira (para mostrar antes de gravar).
    """
    conta = await obter_conta_do_utilizador(db, utilizador, conta_id)
    efeito = await simular_ancora(db, conta, dados.data_ancora, dados.saldo_ancora)
    acerto = efeito["acerto_primeira_reconciliacao"]
    return AncoraSimuladaOut(
        saldo_atual=f"{efeito['saldo_atual']:.2f}",
        acerto_primeira_reconciliacao=f"{acerto:.2f}" if acerto is not None else None,
    )


@router.delete("/{conta_id}", status_code=status.HTTP_204_NO_CONTENT)
async def apagar_conta(
    conta_id: uuid.UUID,
    utilizador: User = Depends(obter_utilizador_atual),
    db: AsyncSession = Depends(get_db),
) -> None:
    """
    Elimina uma conta do utilizador autenticado, e com ela todos os seus
    movimentos (ver ondelete="CASCADE" em app/models/movimento.py — a
    própria base de dados apaga-os, num só comando). Sem confirmação nem
    parâmetro "forçar": a interface já pede confirmação antes de chamar
    este endpoint, e já avisa que os movimentos são apagados com a conta.

    Se a Conta tiver vínculo, a conta bancária que a alimenta é removida
    da mesma forma (ondelete="CASCADE"), sem precisar de desvincular
    primeiro. Ao contrário de desvincular, que mantém a Conta e os
    movimentos, eliminar apaga tudo, vínculo incluído.
    """
    conta = await obter_conta_do_utilizador(db, utilizador, conta_id)
    await apagar_conta_servico(db, conta)
    await db.commit()
