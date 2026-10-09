"""
MODELO DA TABELA "autorizacoes"
==================================

Uma AUTORIZAÇÃO é o consentimento que o utilizador dá, junto do seu banco,
para esta aplicação ler os dados das contas bancárias que escolheu
partilhar, durante um prazo. É dada num ACESSO: as credenciais de uma
pessoa num banco (o banco e o titular que se autentica).

O acesso ao banco faz-se através da Enable Banking (enablebanking.com),
um intermediário regulado ao abrigo da PSD2 — a diretiva europeia que
obriga os bancos a dar acesso aos dados de uma conta, com consentimento
explícito do seu dono, a aplicações terceiras como esta. Na API da Enable
Banking, uma autorização chama-se "sessão".

Uma autorização NÃO é uma conta. Uma só autorização pode abranger várias
contas bancárias ao mesmo tempo (por exemplo, a conta à ordem e uma
poupança do mesmo banco, partilhadas na mesma autenticação). Por isso,
cada conta bancária vive numa linha própria da tabela "contas_bancarias",
que aponta para a autorização que a trouxe através de "autorizacao_id".

UM PARALELO ÚTIL: a relação entre um utilizador e as suas sessões de
autenticação. O utilizador é uma identidade estável; cada sessão é
concreta, expira e é substituída por outra, sem que o utilizador mude. Do
mesmo modo, uma Conta desta aplicação é estável, e cada autorização é um
consentimento concreto, com prazo, que um dia termina e é renovado por
outro.

O ESTADO de uma autorização (ativa ou terminada) NÃO se guarda numa
coluna: calcula-se a partir dos factos guardados (o prazo, "valido_ate").
Um estado guardado ficaria errado no instante em que o prazo passasse, até
alguém o reescrever; um estado calculado está sempre certo.
"""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.session import Base


class Autorizacao(Base):
    """Um consentimento dado num banco, através da Enable Banking, para ler dados de contas bancárias."""

    __tablename__ = "autorizacoes"

    # Chave primária. UUID (um identificador aleatório de 128 bits) em vez
    # de um número sequencial: um número sequencial revelaria quantas
    # autorizações existem e seria fácil de adivinhar.
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # Chave estrangeira para o dono desta autorização. index=True porque
    # todas as consultas a autorizações filtram por este campo ("as
    # autorizações deste utilizador"), e um índice torna essa procura
    # rápida. Sem "ondelete" por agora: ainda não existe forma de apagar um
    # utilizador, e essa decisão (o que acontece aos dados dele) fica para
    # quando existir.
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )

    # O identificador que a própria Enable Banking dá a esta sessão,
    # devolvido quando o código da autenticação é trocado por uma sessão.
    # unique=True: cada sessão da Enable Banking corresponde a uma só
    # autorização desta aplicação.
    session_id: Mapped[str] = mapped_column(String, unique=True, nullable=False)

    # Nome e país (código de duas letras da norma ISO 3166, ex.: "PT") do
    # banco autorizado, tal como a Enable Banking os devolve. Guardados aqui
    # para se poder mostrar "Caixa Geral de Depósitos" sem voltar a
    # perguntar à Enable Banking.
    banco: Mapped[str] = mapped_column(String(120), nullable=False)
    pais: Mapped[str] = mapped_column(String(2), nullable=False)

    # Até quando o consentimento é válido ("access.valid_until" na resposta
    # da Enable Banking): o máximo que o banco aceita, até 180 dias, ou 90
    # se o banco não o indicar. Data e hora com fuso horário, porque o fim
    # de um prazo é um instante, não um dia. É um FACTO: o estado ativa ou
    # terminada calcula-se comparando-o com o momento atual.
    valido_ate: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    # Momento de criação da linha, preenchido pela própria base de dados.
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
