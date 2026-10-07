"""
MODELO DA TABELA "contas_ligadas"
=====================================

Representa UMA conta bancária externa, tal como devolvida pela Enable
Banking dentro de uma ligação (ver app/models/ligacao_bancaria.py) — uma
ligação pode trazer várias contas de uma vez (por exemplo, a conta à
ordem e uma poupança do mesmo banco, autorizadas na mesma autenticação),
por isso cada conta vive na sua própria linha aqui, em vez de estarem
todas juntas na tabela da ligação.

NÃO é uma segunda tabela de contas a duplicar app/models/conta.py — Conta
continua a ser a ÚNICA tabela que representa "uma conta que o utilizador
acompanha na aplicação", com o seu saldo-âncora e os seus movimentos, quer
seja alimentada manualmente ou por Open Banking. Esta tabela aqui é só a
PONTE: guarda os identificadores que a Enable Banking usa para esta conta
em concreto (o "uid", usado nas chamadas de saldo/movimentos), e associa-a
a uma Conta desta aplicação — através de conta_id, que fica vazio até o
utilizador confirmar explicitamente a que Conta sua corresponde esta conta
externa (nunca uma associação NOVA automática e silenciosa — o mesmo
princípio já adoptado para a futura categorização por modelo de
linguagem: qualquer sugestão passa sempre por aprovação explícita antes de
mexer em dados reais).

Exceção: se a conta bancária já alimenta uma Conta com uma ligação ativa,
a ponte nova herda essa Conta ao ser gravada. Não é uma associação nova,
é a continuação de uma que o utilizador já confirmou (o caso de voltar a
autorizar o banco quando o prazo do consentimento acaba).
"""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.session import Base


class ContaLigada(Base):
    """Uma conta bancária externa (Enable Banking), associável a uma Conta desta aplicação."""

    __tablename__ = "contas_ligadas"

    # Chave primária. UUID, pela mesma razão de todas as outras tabelas
    # deste projecto.
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # Chave estrangeira para a ligação (o consentimento) que trouxe esta
    # conta. index=True: consultar "todas as contas desta ligação" é a
    # forma natural de mostrar o que uma autenticação trouxe.
    #
    # ondelete="CASCADE": ao apagar uma LigacaoBancaria (por exemplo, ao
    # remover uma ligação expirada e não renovada), as contas que essa
    # ligação tinha trazido deixam de fazer sentido por si só — os seus
    # identificadores (uid, mais abaixo) são válidos apenas no âmbito
    # dessa ligação específica. Note-se que isto NUNCA apaga a Conta
    # associada (campo conta_id, mais abaixo) nem os seus movimentos — só
    # esta linha-ponte desaparece.
    ligacao_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("ligacoes_bancarias.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # O identificador que a Enable Banking atribui a ESTA conta em
    # concreto, usado nas chamadas seguintes para consultar saldos e
    # movimentos (ver app/services/enable_banking.py). Ao contrário de
    # identification_hash (abaixo), este valor está associado à ligação
    # concreta — CONFIRMADO, em testes reais desta integração (religando
    # o mesmo banco, a mesma conta, duas vezes), que MUDA a cada
    # religação: duas ligações independentes à mesma conta real da CGD
    # devolveram dois "uid" diferentes, com o mesmo identification_hash.
    uid: Mapped[str] = mapped_column(String, nullable=False)

    # Um hash fornecido pela Enable Banking que parece identificar a
    # MESMA conta real de forma estável entre diferentes ligações (ao
    # contrário de uid, acima) — pelo conteúdo observado, é calculado a
    # partir do IBAN e da moeda da conta. Usado (através de
    # identificacao_bancaria, em app/services/ligacoes_bancarias.py) para
    # reconhecer a mesma conta real numa ligação nova, por exemplo ao
    # voltar a autorizar o banco quando o consentimento acaba.
    # Nullable porque ainda não se confirmou que todos os bancos o
    # devolvem sempre.
    identification_hash: Mapped[str | None] = mapped_column(String, nullable=True)

    # O IBAN real da conta, tal como devolvido pela Enable Banking —
    # mostrado ao utilizador para ele confirmar a que Conta sua isto
    # corresponde ("encontrámos a conta PT50...037 — é a tua conta X?").
    iban: Mapped[str | None] = mapped_column(String(34), nullable=True)

    # O nome do titular da conta, tal como devolvido pelo banco — mais
    # informação para ajudar o utilizador a reconhecer a conta ao
    # confirmar a associação. Nem todos os bancos o devolvem.
    nome_titular: Mapped[str | None] = mapped_column(String(200), nullable=True)

    # Código ISO da moeda desta conta ("EUR", "USD"...) — mesmo formato
    # já usado em Conta.moeda (app/models/conta.py).
    moeda: Mapped[str] = mapped_column(String(3), nullable=False)

    # O nome do produto, tal como o banco o dá (ex.: "Conta Caixa", "Conta
    # Poupança Mais") — campo "product" da Enable Banking. Usado para
    # sugerir um nome à conta nova (ver nome_sugerido, em
    # app/services/ligacoes_bancarias.py). Nem todos os bancos o devolvem.
    produto: Mapped[str | None] = mapped_column(String(120), nullable=True)

    # O tipo de conta, num código da norma bancária ISO 20022 (campo
    # "cash_account_type" da Enable Banking): "CACC" conta à ordem, "SVGS"
    # poupança, "CARD" cartão, "LOAN" empréstimo… Usado para preencher o
    # "Tipo" sugerido da conta nova (ver tipo_sugerido, em
    # app/services/ligacoes_bancarias.py). Nem todos os bancos o devolvem.
    tipo_conta_banco: Mapped[str | None] = mapped_column(String(4), nullable=True)

    # A Conta desta aplicação a que esta conta externa corresponde.
    # NULLABLE de propósito: fica vazio assim que a conta externa é
    # descoberta, e só passa a ter valor quando o utilizador confirmar
    # explicitamente a associação (ver a nota no topo do ficheiro sobre
    # nunca associar automaticamente e em silêncio).
    #
    # ondelete="CASCADE": ao apagar a Conta associada, esta linha-ponte
    # deixa de ter razão de existir — mesma política já usada para
    # Movimento.conta_id (app/models/movimento.py), que documenta que
    # apagar uma Conta já promete, na interface, apagar tudo o que
    # depende dela.
    conta_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("contas.id", ondelete="CASCADE"), nullable=True
    )

    # Momento de criação da linha, preenchido pela própria base de dados.
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
