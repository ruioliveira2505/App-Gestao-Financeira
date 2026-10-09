"""
MODELO DA TABELA "reconciliacoes"
====================================

Uma RECONCILIAÇÃO é a afirmação «no FIM do dia D, o saldo desta conta era
S» — por exemplo, o saldo que o utilizador vê no extrato do banco, ou o
dinheiro que tem na carteira. Serve para corrigir a diferença entre o
saldo que a aplicação calcula e o saldo real (um movimento esquecido, um
erro de digitação, uma comissão que não se registou).

O ACERTO: a aplicação calcula o saldo no fim do dia D (o saldo da
reconciliação anterior, ou o saldo inicial da conta se for a primeira,
mais os movimentos até D). Se for diferente de S, cria um movimento de
ACERTO pela diferença, no dia D, que fecha a conta: a partir de D, o
saldo é sempre o afirmado. O acerto é um movimento como os outros (entra
no saldo e nas análises), com a origem "acerto", na categoria reservada
"Acerto de saldo" de entrada ou de saída, e aponta para a sua
reconciliação (Movimento.reconciliacao_id). Se a diferença for zero, não
há acerto, mas a reconciliação fica (como "confirmado").

O acerto RECALCULA-SE SOZINHO sempre que muda alguma coisa de que depende:
a data ou o saldo inicial da conta, um movimento entre a reconciliação
anterior e D, ou a própria reconciliação (ou a anterior).

ORIGEM:
  - "utilizador": criada pelo utilizador, numa conta manual. Edita-se e
    apaga-se;
  - "banco": criada pela aplicação a partir do saldo que o banco informa,
    sempre com a confirmação do utilizador (ao vincular uma conta que já
    tem histórico, ou quando o utilizador aceita "Acertar" depois de
    comparar o saldo da aplicação com o do banco). Não se edita nem se
    apaga enquanto houver vínculo; ao desvincular, ou sai ("tirar o que
    veio do banco") ou passa a "utilizador" ("manter tudo").

O SALDO DE UMA RECONCILIAÇÃO DO BANCO É DERIVADO, NÃO FIXO (regra R7). O
banco diz o saldo contabilístico num INSTANTE T (saldo_banco, lido_em), e
não "no fim do dia D". O saldo afirmado deduz-se:
    S = saldo do banco em T
        − movimentos do banco com data depois de D, já importados em T
        + movimentos do banco com data até D, importados DEPOIS de T
        − transações com data FUTURA que o banco já contava em T, mas que
          ainda não se podiam importar
O terceiro termo trata dos movimentos ATRASADOS: o banco lança às vezes
uma transação dias depois, com a data antiga. Ela não estava no saldo lido
em T; quando chega, soma-se a S, e o acerto mantém-se — em vez de a
reconciliação a "comer" com um acerto falso. O último termo trata do caso
contrário: uma transação já lançada com uma data futura (por exemplo, um
débito agendado) já está no saldo do banco, mas um movimento nunca fica no
futuro, por isso só se importa quando a data chegar. Sem este termo,
contaria duas vezes: uma dentro do saldo do banco e outra quando
entrasse. Como não se importou em T, a soma dessas transações guarda-se
com a reconciliação (futuros_no_banco).

Para isto funcionar, a reconciliação do banco cria-se sempre na MESMA
transação que uma importação completa até T: tudo o que o banco já tinha
lançado em T, e que se podia importar, entra nessa operação, e "importado
até T" deduz-se da hora de importação de cada movimento (o seu
created_at). A coluna "saldo" guarda o último valor derivado, para se
poder mostrar.

QUANDO UMA RECONCILIAÇÃO DO UTILIZADOR PASSA A SER DO BANCO: só pode haver
uma reconciliação por dia. Se o banco precisa de uma num dia em que o
utilizador já tinha a sua, essa passa a ser do banco, e o saldo que o
utilizador tinha afirmado guarda-se (saldo_do_utilizador). Ao desvincular
com "tirar o que veio do banco", volta a ser do utilizador, com esse
saldo: só sai o que veio do banco.

O QUE A BASE DE DADOS GARANTE: no máximo uma reconciliação por dia em cada
conta (índice único), a origem é sempre uma das duas, e uma reconciliação
do banco tem sempre a leitura (o saldo, o instante e os futuros).
"""

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import CheckConstraint, Date, DateTime, ForeignKey, Numeric, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.session import Base


class Reconciliacao(Base):
    """A afirmação de que, no fim de um dia, o saldo de uma conta era um certo valor."""

    __tablename__ = "reconciliacoes"
    __table_args__ = (
        UniqueConstraint("conta_id", "data", name="uq_reconciliacoes_conta_id_data"),
        CheckConstraint("origem IN ('utilizador', 'banco')", name="ck_reconciliacoes_origem"),
        # Uma reconciliação do banco tem sempre o saldo lido e o instante.
        CheckConstraint(
            "origem <> 'banco' OR (saldo_banco IS NOT NULL AND lido_em IS NOT NULL)",
            name="ck_reconciliacoes_banco_tem_leitura",
        ),
        CheckConstraint(
            "origem <> 'banco' OR futuros_no_banco IS NOT NULL",
            name="ck_reconciliacoes_banco_tem_futuros",
        ),
    )

    # Chave primária. UUID (um identificador aleatório de 128 bits), para
    # não revelar quantas linhas existem nem ser fácil de adivinhar.
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # A conta reconciliada. ondelete="CASCADE": eliminar a conta apaga as
    # suas reconciliações (e, com elas, os acertos).
    conta_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("contas.id", ondelete="CASCADE"), nullable=False, index=True
    )

    # O dia D: o saldo afirmado é o do FIM deste dia.
    data: Mapped[date] = mapped_column(Date, nullable=False)

    # O saldo S afirmado, na moeda da conta. Numeric(14, 2): um valor
    # decimal exato com 2 casas, nunca um número de vírgula flutuante (que
    # introduziria erros de arredondamento em dinheiro).
    saldo: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)

    # "utilizador" ou "banco" (ver ORIGEM, no topo do ficheiro).
    origem: Mapped[str] = mapped_column(String(10), nullable=False, default="utilizador")

    # Só nas do banco: o saldo contabilístico que o banco informou, e o
    # instante em que foi lido (ver O SALDO … É DERIVADO, no topo).
    saldo_banco: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    lido_em: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Só nas do banco: a soma das transações de data futura que o banco já
    # contava no saldo lido em T, e que por isso ainda não se importaram
    # (ver O SALDO … É DERIVADO, no topo). Zero quando não há nenhuma.
    futuros_no_banco: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)

    # Só quando uma reconciliação do UTILIZADOR passou a ser do banco: o
    # saldo que o utilizador tinha afirmado, para voltar a ser dele ao
    # "tirar o que veio do banco" (ver QUANDO UMA RECONCILIAÇÃO DO
    # UTILIZADOR PASSA A SER DO BANCO, no topo).
    saldo_do_utilizador: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)

    # Só nas do banco: o vínculo que a criou. ondelete="SET NULL": ao
    # desvincular com "manter tudo", a reconciliação fica (passa a ser do
    # utilizador). "Tirar o que veio do banco" apaga as do vínculo atual.
    vinculo_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("vinculos.id", ondelete="SET NULL"), nullable=True
    )

    # Momento de criação da linha, preenchido pela própria base de dados.
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
