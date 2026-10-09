"""
MODELO DA TABELA "contas_bancarias"
======================================

Uma CONTA BANCÁRIA é uma conta real de um banco (à ordem, poupança,
cartão…), tal como chega dentro de uma AUTORIZAÇÃO — o consentimento que
o utilizador dá ao banco para esta aplicação ler os dados das contas que
escolheu partilhar, durante um prazo. Uma autorização pode trazer várias
contas bancárias de uma vez, por isso cada uma vive numa linha própria
desta tabela, e não na linha da autorização.

Uma conta bancária NÃO é uma segunda tabela de contas a duplicar a tabela
"contas". A CONTA (desta aplicação) continua a ser a única coisa que o
utilizador acompanha, com a sua âncora (data e saldo iniciais) e os seus
movimentos, seja alimentada à mão ou pelo banco. Esta tabela guarda só o
que o banco diz sobre a conta real (o identificador para pedir saldos e
movimentos, o IBAN, a moeda…).

O VÍNCULO (qual a Conta que esta conta bancária alimenta) vive numa
tabela própria, "vinculos". Nunca se cria sozinho para uma conta bancária
nova: só quando o utilizador confirma a que Conta ela corresponde. A
única exceção é a RENOVAÇÃO: se esta conta bancária é a mesma conta real
que já alimenta uma Conta, o vínculo passa para esta linha nova — não é
uma associação nova, é a continuação de uma que o utilizador já
confirmou. Sem vínculo, a conta bancária está LIVRE.

A MESMA CONTA REAL, AUTORIZADA DUAS VEZES, DÁ DUAS LINHAS (uma por
autorização). As duas reconhecem-se pela mesma identificação estável (o
"identification_hash" ou, na falta dele, o IBAN e a moeda).
"""

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.session import Base


class ContaBancaria(Base):
    """Uma conta real de um banco, trazida por uma autorização, que pode alimentar uma Conta desta aplicação."""

    __tablename__ = "contas_bancarias"
    __table_args__ = (
        # Cada conta bancária aparece uma só vez em cada autorização: o
        # identificador que a Enable Banking lhe dá ("uid") é único dentro
        # da autorização. Garantido pela base de dados, para uma mesma
        # resposta do banco nunca dar duas linhas.
        UniqueConstraint("autorizacao_id", "uid", name="uq_contas_bancarias_autorizacao_id_uid"),
        # O código da moeda tem sempre três letras maiúsculas (ex.: "EUR").
        CheckConstraint("moeda ~ '^[A-Z]{3}$'", name="ck_contas_bancarias_moeda_formato"),
    )

    # Chave primária. UUID (um identificador aleatório de 128 bits), para
    # não revelar quantas linhas existem nem ser fácil de adivinhar.
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # Chave estrangeira para a autorização que trouxe esta conta bancária.
    # index=True: "as contas bancárias desta autorização" é uma consulta
    # frequente (é o que se mostra depois de autorizar).
    #
    # ondelete="CASCADE": apagar a autorização apaga as suas contas
    # bancárias, porque o identificador "uid" (abaixo) só é válido dentro
    # dessa autorização. Nunca apaga a Conta que uma delas alimentava, nem
    # os movimentos dessa Conta: só esta linha desaparece.
    autorizacao_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("autorizacoes.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # O identificador que a Enable Banking dá a esta conta DENTRO desta
    # autorização, usado nos pedidos de saldos e de movimentos. Confirmado
    # em testes reais (a mesma conta da CGD autorizada duas vezes): MUDA a
    # cada autorização. Por isso não serve para reconhecer a mesma conta
    # real entre autorizações — para isso serve "identification_hash".
    uid: Mapped[str] = mapped_column(String, nullable=False)

    # Um código que a Enable Banking calcula a partir dos dados da conta
    # (pelo observado, o IBAN e a moeda) e que é IGUAL em todas as
    # autorizações da mesma conta real. É a base da identificação estável
    # que reconhece uma conta já conhecida. Pode vir vazio: nem todos os
    # bancos o garantem.
    identification_hash: Mapped[str | None] = mapped_column(String, nullable=True)

    # O IBAN (o número internacional de conta bancária, até 34 caracteres)
    # tal como o banco o envia — mostrado ao utilizador para ele reconhecer
    # a conta. Os cartões, por exemplo, podem não ter.
    iban: Mapped[str | None] = mapped_column(String(34), nullable=True)

    # O nome do titular, tal como o banco o envia, para ajudar a reconhecer
    # a conta. Nem todos os bancos o enviam.
    nome_titular: Mapped[str | None] = mapped_column(String(200), nullable=True)

    # O código ISO 4217 da moeda da conta ("EUR", "USD"…), o mesmo formato
    # da moeda de uma Conta. Uma conta bancária só alimenta uma Conta na
    # mesma moeda.
    moeda: Mapped[str] = mapped_column(String(3), nullable=False)

    # O nome do produto, tal como o banco o dá (ex.: "Conta Caixa"). Usado
    # para sugerir o nome de uma Conta nova. Nem todos os bancos o enviam.
    produto: Mapped[str | None] = mapped_column(String(120), nullable=True)

    # O tipo de conta, num código da norma bancária ISO 20022 (a norma
    # internacional das mensagens bancárias): "CACC" conta à ordem, "SVGS"
    # poupança, "CARD" cartão, "LOAN" empréstimo… Usado para sugerir o tipo
    # de uma Conta nova. Nem todos os bancos o enviam.
    tipo_conta_banco: Mapped[str | None] = mapped_column(String(4), nullable=True)

    # Quando o banco respondeu que esta conta não existe ou deixou de ser
    # partilhada (por exemplo, foi fechada, ou o utilizador tirou-a do
    # consentimento). Vazio enquanto estiver disponível. Uma conta bancária
    # indisponível não se vincula, e a Conta que alimentava fica Suspensa.
    indisponivel_em: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Momento de criação da linha, preenchido pela própria base de dados.
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
