"""
FORMATO DOS PEDIDOS E RESPOSTAS DA API DE CONTAS
================================================

Estas classes (baseadas em BaseModel, do Pydantic) descrevem o formato dos
dados que entram e saem dos endpoints de contas — são diferentes do modelo
em app/models/conta.py, que descreve a tabela da base de dados.

Duas notas de desenho:

  - Valores monetários (saldo_ancora, saldo) são texto na API ("1234.56"),
    não números. O formato JSON não tem um tipo decimal; um número em
    vírgula flutuante poderia perder precisão em cêntimos.

  - A "data de início de movimentos" que o utilizador vê É a data_ancora —
    não há conversão de +1/-1 dia. O saldo_ancora é o saldo no início desse
    dia, antes de qualquer movimento.

Os campos DESCRITIVOS de uma conta (nome, banco, tipo, moeda) são comuns à
criação e à edição — vivem numa classe-base (_CamposDescritivos) para as
regras de validação serem escritas uma só vez. A criação acrescenta a
âncora (data_ancora, saldo_ancora); a edição nunca lhe toca.
"""

import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, Field, field_validator

from app.core.moedas import LIMITE_DE_VALOR, MOEDA_OMISSAO, moeda_suportada


class _CamposDescritivos(BaseModel):
    """Campos comuns à criação e à edição de uma conta."""

    nome: str = Field(min_length=1, max_length=120)
    # Opcionais: "Dinheiro" não tem banco nem, necessariamente, tipo.
    banco: str | None = Field(default=None, max_length=120)
    tipo: str | None = Field(default=None, max_length=40)
    # Sem valor por omissão aqui — na edição, a moeda tem de vir sempre
    # explícita, para não ser trocada por engano. A criação (abaixo)
    # acrescenta o valor por omissão.
    moeda: str

    @field_validator("nome")
    @classmethod
    def _nome_sem_espacos_e_nao_vazio(cls, valor: str) -> str:
        valor = valor.strip()
        if not valor:
            raise ValueError("O nome não pode ser vazio.")
        return valor

    @field_validator("banco", "tipo")
    @classmethod
    def _limpar_opcional(cls, valor: str | None) -> str | None:
        if valor is None:
            return None
        valor = valor.strip()
        # Uma string só com espaços equivale a "não indicado".
        return valor or None

    # Função partilhada com app/schemas/auth.py (UserPreferencias) — ver
    # a nota em app/core/moedas.py, moeda_suportada, sobre porquê não é
    # um validador escrito aqui à parte.
    _moeda_suportada = field_validator("moeda")(moeda_suportada)


class ContaCriar(_CamposDescritivos):
    """Dados recebidos no pedido de criação de uma conta (POST /contas)."""

    # Redeclarada só para acrescentar o valor por omissão; a validação
    # herdada de _CamposDescritivos continua a aplicar-se.
    moeda: str = MOEDA_OMISSAO

    data_ancora: date
    # Aceita uma string ("1234.56"), um inteiro ou um número; o Pydantic
    # converte para Decimal. Pode ser negativo (ex.: um cartão de crédito).
    # Field(ge=..., le=...): o valor tem de caber na coluna da base de
    # dados (Numeric(14, 2): até 12 algarismos antes da vírgula e 2 depois).
    # Um valor maior é recusado aqui com 422, em vez de rebentar mais à
    # frente com um erro da base de dados. As casas a mais não se recusam:
    # o serviço arredonda o valor aos cêntimos.
    saldo_ancora: Decimal = Field(ge=-LIMITE_DE_VALOR, le=LIMITE_DE_VALOR)


class ContaEditar(_CamposDescritivos):
    """
    Dados recebidos no pedido de edição de uma conta (PATCH /contas/{id}).

    Só os campos descritivos — a âncora (data_ancora, saldo_ancora) muda-se
    num pedido próprio (PATCH /contas/{id}/ancora, ver AncoraEditar), com
    as suas regras: só numa conta manual, nunca depois do primeiro
    movimento nem da primeira reconciliação.
    """


class AncoraEditar(BaseModel):
    """
    A âncora nova de uma conta (PATCH /contas/{id}/ancora, ou a sua
    pré-visualização): a data e o saldo iniciais — o ponto a partir do qual
    a aplicação acompanha a conta, e o saldo no início desse dia.
    """

    data_ancora: date
    # Aceita uma string ("1234.56") ou um número; o Pydantic converte para
    # Decimal. Pode ser negativo (ex.: um cartão de crédito).
    # Field(ge=..., le=...): o valor tem de caber na coluna da base de
    # dados (Numeric(14, 2): até 12 algarismos antes da vírgula e 2 depois).
    # Um valor maior é recusado aqui com 422, em vez de rebentar mais à
    # frente com um erro da base de dados. As casas a mais não se recusam:
    # o serviço arredonda o valor aos cêntimos.
    saldo_ancora: Decimal = Field(ge=-LIMITE_DE_VALOR, le=LIMITE_DE_VALOR)


class AncoraSimuladaOut(BaseModel):
    """
    O efeito de mudar a âncora, sem gravar nada: o saldo atual que a conta
    passaria a ter e, se houver reconciliações, o acerto que a primeira
    passaria a ter (None se não houver nenhuma). Valores como texto.
    """

    saldo_atual: str
    acerto_primeira_reconciliacao: str | None


class VinculoOut(BaseModel):
    """
    O VÍNCULO de uma Conta, quando existe: a conta bancária real que a
    alimenta através do Open Banking (ver ContaOut.vinculo, abaixo).
    "conta_bancaria_id" é o que o frontend precisa para sincronizar e para
    desvincular.
    """

    conta_bancaria_id: uuid.UUID
    # O nome do banco da autorização que trouxe a conta bancária.
    banco: str
    # O nome do TITULAR da conta bancária, tal como o banco o envia (None se
    # o banco não o enviar). Uma autorização é um banco com um titular: com
    # o banco, identifica a autorização para quem a lê (por exemplo, nos
    # avisos da lista de contas, quando a mesma pessoa tem duas autorizações
    # no mesmo banco, a sua e a de um familiar).
    titular: str | None = None
    # Até quando vale a AUTORIZAÇÃO (o consentimento dado pelo utilizador
    # ao banco): o máximo que o banco aceita, até 180 dias depois da
    # autenticação pela regra europeia (90 se o banco não o indicar).
    # Passada esta data, o banco deixa de responder e a Conta deixa de
    # receber movimentos novos até o utilizador voltar a autorizar. O
    # frontend usa-a para mostrar, na lista de contas, se a autorização
    # está ativa, prestes a terminar ou já terminada.
    valido_ate: datetime
    # A autorização da conta bancária (para a renovar, por exemplo).
    autorizacao_id: uuid.UUID
    # O IBAN da conta bancária, tal como o banco o envia (None se não o
    # enviar: um cartão, por exemplo). A página da conta mostra-o, com um
    # botão para o copiar.
    iban: str | None = None
    # A última sincronização que correu bem (None se ainda não houve
    # nenhuma): «Sincronizada · há 2 horas».
    sincronizado_em: datetime | None = None
    # Desde quando a Conta está suspensa (None se estiver vinculada): o fim
    # do prazo, o momento em que a autorização terminou, ou em que o banco
    # deixou de partilhar a conta. «Suspensa · desde 2 set».
    suspensa_desde: datetime | None = None
    # Quando terminou a AUTORIZAÇÃO (None se ainda está ativa): o fim
    # antecipado ou o fim do prazo, o que chegar primeiro. À parte do
    # estado da Conta, porque uma Conta suspensa por o banco ter deixado de
    # partilhar a conta («indisponivel») pode ter a autorização ativa ou já
    # terminada — e a interface mostra o estado da autorização.
    autorizacao_terminada_em: datetime | None = None
    # A última falha de sincronização POR CAUSA DO BANCO, se for mais
    # recente do que a última que correu bem (senão, ambas None): quando, e
    # o motivo — "sem-ligacao" ou "limite". A página da conta mostra
    # «Falhou · sem ligação» / «Falhou · limite do banco».
    falha_em: datetime | None = None
    falha_motivo: str | None = None
    # O ESTADO da Conta, deduzido (nunca guardado): "vinculada" (sincroniza)
    # ou "suspensa" (a autorização terminou, ou o banco deixou de partilhar
    # a conta: continua bloqueada, mas não sincroniza).
    estado: str
    # Porque está suspensa: "expirada" (o prazo passou), "revogada" (na
    # aplicação), "banco" (o banco disse que a autorização já não vale) ou
    # "indisponivel" (o banco deixou de partilhar a conta). None se estiver
    # vinculada.
    motivo: str | None = None


class ContaOut(BaseModel):
    """Dados de uma conta devolvidos pela API."""

    id: uuid.UUID
    nome: str
    banco: str | None
    tipo: str | None
    moeda: str
    data_ancora: date

    # Valores monetários como texto (ver a nota no topo do ficheiro).
    saldo_ancora: str
    # Saldo actual da conta: saldo_ancora mais a soma (com sinal) de todos
    # os movimentos desta conta (ver app/routers/contas.py, _para_saida).
    # Sem movimentos ainda, é igual ao saldo da âncora — a soma de zero
    # movimentos é zero.
    saldo: str

    # "saldo" convertido para a moeda principal do utilizador autenticado
    # (User.moeda_principal — ver app/models/user.py), à taxa de câmbio de
    # HOJE (nunca a data-âncora: isto é sempre "quanto vale isto agora",
    # não um registo histórico — ver a nota "PORQUÊ A DATA É UMA COLUNA"
    # em app/models/taxa_cambio.py). "None" só na falta genuína de taxas
    # de câmbio para converter (SemTaxaCambio, em app/services/cambio.py)
    # — nunca por a moeda da conta já ser a principal, caso em que
    # converter() devolve o mesmo valor sem precisar de taxa nenhuma.
    saldo_convertido: str | None

    # "None" numa Conta sem vínculo (uma Conta manual, que nunca teve
    # vínculo ou foi desvinculada): comporta-se em tudo como uma conta
    # manual normal.
    vinculo: VinculoOut | None = None

    created_at: datetime
    updated_at: datetime
