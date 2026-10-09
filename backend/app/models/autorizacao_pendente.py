"""
MODELO DA TABELA "autorizacoes_pendentes"
=============================================

Resolve um problema específico do fluxo de Open Banking (ver
app/routers/open_banking.py e app/services/enable_banking.py): o
"callback" para onde a Enable Banking reencaminha o browser, depois de o
utilizador autenticar junto do seu banco, chega SEM o cookie de sessão
desta aplicação — porque, tipicamente, esse callback vive noutro
endereço/origem daquele onde o login normal acontece (nesta app, em
desenvolvimento: o callback em "https://127.0.0.1:8000", o login em
"http://localhost:5173"; em produção, mesmo com os dois no mesmo domínio,
um reencaminhamento destes atravessa o site do banco pelo meio, o que por
si só já é motivo para não confiar em cookies chegarem intactos). Sem
cookie, não há forma de saber, só a partir do pedido em si, QUEM iniciou
aquele pedido de autorização.

A SOLUÇÃO: quando "/autorizar" (a rota que INICIA o pedido de autorização, essa
sim com o cookie de sessão normal, porque é chamada a partir da própria
aplicação) começa o processo, grava aqui uma linha (state → user_id) antes
de reencaminhar o utilizador para o banco. A Enable Banking devolve esse
mesmo "state" no callback final, inalterado — é o que permite, nessa
altura, sem cookie nenhum, ir buscar aqui o user_id certo. A linha é
apagada logo a seguir a ser usada (ver app/routers/open_banking.py) — só
existe durante o tempo que o utilizador demora a autenticar-se no banco.
"""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.session import Base


class AutorizacaoPendente(Base):
    """Liga um "state" de um pedido de autorização Open Banking ainda a decorrer ao seu utilizador."""

    __tablename__ = "autorizacoes_pendentes"

    # A CHAVE PRIMÁRIA é o próprio "state" (não um UUID à parte) — é
    # exactamente o valor que a Enable Banking devolve no callback, e é
    # por ele que vamos procurar esta linha; não há razão para um id
    # adicional que nunca seria usado para nada.
    state: Mapped[str] = mapped_column(String, primary_key=True)

    # Chave estrangeira para quem iniciou este pedido de autorização — é
    # este o valor que queremos recuperar no callback.
    #
    # ondelete="CASCADE": apagar um utilizador apaga também estas linhas,
    # ao nível da própria base de dados — o direito ao apagamento do RGPD
    # (o regulamento europeu de proteção de dados): apagar a conta de um
    # utilizador apaga todos os seus dados.
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )

    # A autorização que este pedido RENOVA, quando o utilizador pediu para
    # renovar uma autorização existente (em vez de autorizar um banco de
    # novo). Passa para a autorização nova, no regresso do banco.
    # ondelete="CASCADE": se a autorização a renovar for apagada entretanto,
    # o pedido deixa de fazer sentido.
    renova_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("autorizacoes.id", ondelete="CASCADE"), nullable=True
    )

    # Momento de criação. Um pedido de autorização EXPIRA ao fim de 15
    # minutos (o utilizador começou e não voltou do banco): o regresso
    # depois disso é recusado, e os pedidos expirados apagam-se sempre que
    # um novo começa.
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
