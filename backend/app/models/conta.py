"""
MODELO DA TABELA "contas"
===========================

Representa uma conta que o utilizador acompanha na aplicação — uma conta
bancária, um cartão, dinheiro em numerário, uma poupança. É a raiz do
domínio financeiro: cada movimento (ver app/models/movimento.py — uma
entrada ou saída de dinheiro, numa data) pertence sempre a uma conta.

Conceito central — a ÂNCORA. A aplicação não conhece o histórico completo
de uma conta; começa a acompanhá-la a partir de um certo ponto. Guarda-se
então um saldo conhecido (saldo_ancora) numa data conhecida (data_ancora),
e todos os movimentos a partir dessa data ajustam esse valor. O saldo
actual de uma conta é, portanto, saldo_ancora + soma dos movimentos com
data igual ou posterior a data_ancora. Enquanto não houver movimentos, o
saldo actual é simplesmente o saldo_ancora.
"""

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import CheckConstraint, Date, DateTime, ForeignKey, Index, Numeric, String
from sqlalchemy.orm import validates
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.session import Base


class Conta(Base):
    """Uma conta acompanhada pelo utilizador (bancária, cartão, dinheiro, poupança...)."""

    __tablename__ = "contas"

    # Uma conta bancária real alimenta no máximo UMA Conta de cada
    # utilizador: dois utilizadores podem ter a mesma (uma conta conjunta),
    # mas o mesmo utilizador não. É a base de dados a garanti-lo, não só o
    # código, para nunca haver duas Contas com a mesma identificação (o
    # reconhecimento ficaria ambíguo, e a mesma conta bancária podia
    # alimentar as duas, duplicando os movimentos). unique=True numa
    # coluna que aceita NULL não impede vários NULL (as contas manuais): o
    # PostgreSQL trata cada NULL como diferente de qualquer outro.
    #
    # O NOME de uma conta também é único por utilizador, comparado sem
    # acentos nem maiúsculas: o índice único é sobre "nome_normalizado"
    # (ver essa coluna, abaixo), não sobre o nome tal como foi escrito.
    #
    # O formato do código de moeda (três letras maiúsculas, ex.: "EUR") é
    # garantido pela base de dados (restrição CHECK; "~" é o operador do
    # PostgreSQL que testa uma expressão regular, um padrão de texto).
    __table_args__ = (
        Index(
            "ux_contas_user_id_identificacao_bancaria",
            "user_id",
            "identificacao_bancaria",
            unique=True,
        ),
        Index("ux_contas_user_id_nome_normalizado", "user_id", "nome_normalizado", unique=True),
        CheckConstraint("moeda ~ '^[A-Z]{3}$'", name="ck_contas_moeda_formato"),
    )

    # Chave primária. UUID (aleatório e imprevisível), não um número a
    # incrementar — pela mesma razão já adoptada nas tabelas users e
    # sessions: um id sequencial expõe quantas contas existem e é fácil de
    # adivinhar. default=uuid.uuid4 gera o valor no lado do Python, antes
    # de o comando de inserção ser enviado à base de dados.
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # Chave estrangeira para o dono da conta. A base de dados recusa uma
    # conta associada a um utilizador inexistente. index=True porque toda e
    # qualquer consulta a contas filtra por este campo ("as contas deste
    # utilizador").
    #
    # ondelete="CASCADE": apagar um utilizador apaga as suas contas (e, com
    # elas, os movimentos), ao nível da própria base de dados — o direito
    # ao apagamento do RGPD (o regulamento europeu de proteção de dados):
    # apagar a conta de um utilizador apaga todos os seus dados.
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )

    # Nome dado pelo utilizador ("Conta à ordem BPI", "Revolut", "Dinheiro").
    # Limite de comprimento para evitar valores absurdos; a exigência de não
    # ser vazio é feita no schema da API (Pydantic), não aqui.
    nome: Mapped[str] = mapped_column(String(120), nullable=False)

    # O nome na forma usada para COMPARAR: sem espaços nas pontas, sem
    # acentos e sem distinção entre maiúsculas e minúsculas ("Poupança" e
    # " poupanca" dão o mesmo valor). Preenchido sozinho sempre que o nome
    # muda (ver _normalizar_o_nome, abaixo), e nunca escrito à mão. É sobre
    # ele que está o índice único: dois pedidos ao mesmo tempo a criar
    # contas com o "mesmo" nome nunca passam os dois — a base de dados
    # recusa o segundo, mesmo que a verificação no código tenha deixado
    # passar ambos no mesmo instante.
    nome_normalizado: Mapped[str] = mapped_column(String(120), nullable=False)

    # Banco/instituição. Texto livre (o utilizador escolhe de sugestões mas
    # pode escrever outro valor), opcional — "Dinheiro" não tem banco.
    banco: Mapped[str | None] = mapped_column(String(120), nullable=True)

    # Tipo de conta ("Conta corrente", "Poupança", "Cartão de crédito"...).
    # Também texto livre com sugestões, opcional.
    tipo: Mapped[str | None] = mapped_column(String(40), nullable=True)

    # Código ISO da moeda ("EUR", "USD"...). Guardado como texto de 3
    # letras maiúsculas (o formato é garantido pela base de dados, ver
    # __table_args__); o conjunto de moedas permitidas é fechado, mas essa
    # lista — e o símbolo de cada moeda — vive na aplicação. "EUR" por
    # omissão.
    moeda: Mapped[str] = mapped_column(String(3), nullable=False, default="EUR")

    # A data da âncora: o dia para o qual o saldo_ancora é afirmado. A
    # partir daqui (inclusive) os movimentos são válidos.
    data_ancora: Mapped[date] = mapped_column(Date, nullable=False)

    # O saldo da conta no início de data_ancora. Numeric(14, 2) = valor
    # decimal exacto com 12 dígitos inteiros e 2 casas decimais — nunca
    # float, que introduziria erros de arredondamento em valores
    # monetários. Corresponde ao tipo Decimal do Python.
    saldo_ancora: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)

    # A MEMÓRIA: a identificação estável da conta bancária real que
    # alimenta (ou alimentou por último) esta Conta através do Open
    # Banking. É o "identification_hash" da Enable Banking (um código igual
    # em todas as autorizações da mesma conta real) ou, na falta dele,
    # "iban:" seguido do IBAN e da moeda. Vazia numa Conta que nunca teve
    # vínculo. Única por utilizador (ver o índice em __table_args__,
    # acima): duas Contas do mesmo utilizador nunca se lembram da mesma
    # conta bancária.
    #
    # PORQUÊ NA CONTA, E NÃO NA CONTA BANCÁRIA: a linha da conta bancária
    # desaparece quando se desvincula ou quando a autorização é esquecida.
    # Guardada na Conta, a memória sobrevive a isso, e é o que permite, ao
    # autorizar outra vez o mesmo banco, reconhecer "esta conta bancária
    # já foi a tua Conta X". Serve só para sugerir; nunca bloqueia nada.
    identificacao_bancaria: Mapped[str | None] = mapped_column(String, nullable=True)

    # Momento de criação da linha, preenchido pela própria base de dados.
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # Momento da última alteração. server_default preenche na criação;
    # onupdate faz o SQLAlchemy actualizar este valor sempre que a linha é
    # modificada e gravada.
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    @validates("nome")
    def _normalizar_o_nome(self, _chave: str, nome: str) -> str:
        """
        Sempre que o nome é atribuído (ao criar ou ao editar a conta),
        preenche também nome_normalizado. "@validates" é um mecanismo do
        SQLAlchemy: chama esta função em cada atribuição a conta.nome, seja
        qual for o código que a faça, por isso as duas colunas nunca
        divergem. A função de normalização é importada aqui dentro, e não no
        topo do ficheiro, para o modelo não depender da camada de serviços
        ao ser carregado.
        """
        from app.services.nomes import normalizar_nome

        self.nome_normalizado = normalizar_nome(nome)
        return nome
