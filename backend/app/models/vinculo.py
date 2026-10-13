"""
MODELO DA TABELA "vinculos"
==============================

Um VÍNCULO é o facto de uma CONTA BANCÁRIA (uma conta real de um banco,
trazida por uma autorização de Open Banking) alimentar uma CONTA desta
aplicação: os movimentos dessa Conta passam a vir do banco.

PORQUÊ UMA TABELA PRÓPRIA, E NÃO UMA COLUNA NA CONTA BANCÁRIA. O vínculo
tem vida própria:
  - RENOVAR uma autorização (dar um consentimento novo ao banco quando o
    prazo acaba) traz uma linha NOVA para a mesma conta real. O vínculo
    passa para essa linha nova, mas é o MESMO vínculo: mantém o seu id, e
    os movimentos que importou continuam a apontar para ele (ver
    Movimento.vinculo_id). Com uma coluna na conta bancária, renovar teria
    de "copiar" o vínculo, e perder-se-ia que movimentos vieram dele;
  - DESVINCULAR apaga só o vínculo: a conta bancária fica livre, na mesma
    autorização, e pode voltar a ser vinculada sem autorizar outra vez;
  - ELIMINAR a Conta apaga o vínculo (em cascata), e a conta bancária
    fica livre, sem código extra.

O QUE A BASE DE DADOS GARANTE (índices únicos):
  - uma Conta tem no máximo um vínculo;
  - uma conta bancária tem no máximo um vínculo;
  - a mesma conta REAL (a mesma identificação estável — ver a coluna
    "identificacao") alimenta no máximo uma Conta de cada utilizador,
    mesmo que chegue por duas autorizações diferentes. Sem isto, o mesmo
    dinheiro contaria duas vezes.

O ESTADO de uma Conta (manual, vinculada ou suspensa) não se guarda:
deduz-se de haver vínculo e do estado da autorização da conta bancária.
"""

import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Index, String, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.session import Base


class Vinculo(Base):
    """O facto de uma conta bancária alimentar uma Conta desta aplicação."""

    __tablename__ = "vinculos"
    __table_args__ = (
        # A mesma conta real alimenta no máximo uma Conta por utilizador.
        # Índice PARCIAL (só sobre as linhas com identificação): uma conta
        # bancária sem identificação (nem hash nem IBAN, como alguns
        # cartões) não se consegue reconhecer, e fica de fora.
        Index(
            "ux_vinculos_user_id_identificacao",
            "user_id",
            "identificacao",
            unique=True,
            postgresql_where=text("identificacao IS NOT NULL"),
        ),
    )

    # Chave primária. UUID (um identificador aleatório de 128 bits), para
    # não revelar quantas linhas existem nem ser fácil de adivinhar.
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # O dono, repetido aqui (também se chega a ele pela Conta) para o
    # índice único da identificação poder ser "por utilizador".
    # ondelete="CASCADE": apagar o utilizador apaga os seus vínculos.
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )

    # A Conta alimentada. unique=True: no máximo um vínculo por Conta.
    # ondelete="CASCADE": eliminar a Conta apaga o vínculo, e a conta
    # bancária fica livre.
    conta_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("contas.id", ondelete="CASCADE"), nullable=False, unique=True
    )

    # A conta bancária que alimenta a Conta. unique=True: no máximo um
    # vínculo por conta bancária. ondelete="CASCADE": se a linha da conta
    # bancária desaparecer (quando a sua autorização é esquecida), o
    # vínculo desaparece com ela e a Conta passa a manual — ficando com os
    # movimentos e a memória.
    conta_bancaria_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("contas_bancarias.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )

    # A identificação estável da conta real (o "identification_hash" da
    # Enable Banking ou, na falta dele, "iban:" seguido do IBAN e da
    # moeda), igual em todas as autorizações da mesma conta. Vazia se o
    # banco não der nem hash nem IBAN.
    identificacao: Mapped[str | None] = mapped_column(String, nullable=True)

    # A DATA DE CORTE: o último dia cujos movimentos NÃO vêm do banco. A
    # sincronização nunca importa nada com data igual ou anterior a ela,
    # para o histórico do banco nunca entrar por cima de movimentos que já
    # estão na Conta. Numa Conta criada a partir do banco, é a véspera da
    # data inicial (tudo vem do banco).
    data_corte: Mapped[date] = mapped_column(Date, nullable=False)

    # A ÚLTIMA SINCRONIZAÇÃO que correu bem: o momento em que se importaram
    # (ou se confirmou que não havia) movimentos novos do banco. A página da
    # conta mostra-a («Sincronizada · há 2 horas»). Fica no vínculo, e não
    # na conta bancária, porque ao renovar uma autorização o vínculo é o
    # mesmo (só passa para a conta bancária da autorização nova), e a data
    # não se deve perder. Vazia enquanto não houver nenhuma («Ainda não
    # sincronizada»).
    sincronizado_em: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # A ÚLTIMA FALHA de sincronização POR CAUSA DO BANCO, e o motivo:
    # "sem-ligacao" (o banco falhou, não respondeu ou demorou demasiado) ou
    # "limite" (o banco recusou: atingiu-se o limite de acessos do dia).
    # Guardam-se para a página da conta continuar a dizer «Falhou · …» ao
    # ser reaberta, e não só na visita em que aconteceu. Uma sincronização
    # que corra bem apaga-as. Não se guardam as recusas que não são do banco
    # (uma conta suspensa, outra operação a decorrer na conta): essas
    # explicam-se de outra maneira, ou passam sozinhas.
    falha_em: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    falha_motivo: Mapped[str | None] = mapped_column(String(12), nullable=True)

    # Momento de criação da linha, preenchido pela própria base de dados.
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
