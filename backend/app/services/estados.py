"""
ESTADOS DEDUZIDOS: AUTORIZAÇÃO, CONTA BANCÁRIA E CONTA
=========================================================

Vocabulário: uma AUTORIZAÇÃO é o consentimento dado no banco para a
aplicação ler as contas partilhadas, durante um prazo; cada conta
partilhada é uma CONTA BANCÁRIA; o VÍNCULO é o facto de uma conta
bancária alimentar uma CONTA da aplicação.

O PRINCÍPIO: GUARDAM-SE FACTOS, DEDUZEM-SE ESTADOS. Nenhum destes estados
está numa coluna da base de dados. Guardam-se só os factos — o prazo de
uma autorização, se e porque terminou antes dele, se uma conta bancária
ficou indisponível, se há vínculo — e o estado calcula-se sempre que é
preciso, com as funções deste ficheiro. Assim um estado nunca fica
desatualizado: uma autorização cujo prazo acabou de passar já é
"terminada", sem ninguém ter de o escrever. É como a idade de uma pessoa:
guarda-se a data de nascimento, e a idade calcula-se.

As funções são PURAS: recebem os factos e o momento atual ("agora") e
devolvem o estado, sem consultar a base de dados. "agora" é um parâmetro
para os testes poderem fixar o momento.

AUTORIZAÇÃO:
  - "ativa": não terminou antes do prazo, e o prazo ainda não passou;
  - "terminada": terminou antes do prazo (revogada, ou o banco disse que
    já não vale), ou o prazo passou.

CONTA BANCÁRIA:
  - "livre": sem vínculo, numa autorização ativa, disponível — pode ser
    vinculada a uma Conta;
  - "livre_bloqueada": sem vínculo, mas a autorização terminou ou o banco
    deixou de a partilhar — não se pode vincular (só renovar ou esquecer
    a autorização);
  - "vinculada": com vínculo, autorização ativa, disponível;
  - "suspensa": com vínculo, mas a autorização terminou ou o banco deixou
    de a partilhar — a Conta continua bloqueada como uma vinculada, mas
    não sincroniza.

CONTA (da aplicação):
  - "manual": sem vínculo — tudo editável;
  - "vinculada": com vínculo, a conta bancária está "vinculada";
  - "suspensa": com vínculo, a conta bancária está "suspensa".
"""

from datetime import datetime, timezone

from app.models.autorizacao import Autorizacao
from app.models.conta_bancaria import ContaBancaria


def _agora(agora: datetime | None) -> datetime:
    """O momento atual, com fuso horário (UTC), se não for indicado."""
    return agora or datetime.now(timezone.utc)


def estado_autorizacao(autorizacao: Autorizacao, agora: datetime | None = None) -> str:
    """ "ativa" ou "terminada" (ver AUTORIZAÇÃO, no topo do ficheiro)."""
    if autorizacao.terminada_em is not None or _agora(agora) >= autorizacao.valido_ate:
        return "terminada"
    return "ativa"


def motivo_do_fim(autorizacao: Autorizacao, agora: datetime | None = None) -> str | None:
    """
    Porque terminou a autorização: "revogada" (na aplicação), "banco" (o
    banco disse que já não vale) ou "expirada" (o prazo passou). None se
    ainda estiver ativa.
    """
    if autorizacao.motivo is not None:
        return autorizacao.motivo
    if estado_autorizacao(autorizacao, agora) == "terminada":
        return "expirada"
    return None


def estado_conta_bancaria(
    conta_bancaria: ContaBancaria,
    autorizacao: Autorizacao,
    tem_vinculo: bool,
    agora: datetime | None = None,
) -> str:
    """ "livre", "livre_bloqueada", "vinculada" ou "suspensa" (ver CONTA BANCÁRIA, no topo)."""
    utilizavel = (
        estado_autorizacao(autorizacao, agora) == "ativa" and conta_bancaria.indisponivel_em is None
    )
    if tem_vinculo:
        return "vinculada" if utilizavel else "suspensa"
    return "livre" if utilizavel else "livre_bloqueada"


def estado_conta(
    conta_bancaria: ContaBancaria | None,
    autorizacao: Autorizacao | None,
    agora: datetime | None = None,
) -> str:
    """
    "manual", "vinculada" ou "suspensa" (ver CONTA, no topo). Recebe a conta
    bancária que alimenta a Conta (e a sua autorização), ou None se a Conta
    não tiver vínculo.
    """
    if conta_bancaria is None or autorizacao is None:
        return "manual"
    return estado_conta_bancaria(conta_bancaria, autorizacao, tem_vinculo=True, agora=agora)
