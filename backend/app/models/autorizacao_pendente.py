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

A SOLUÇÃO: quando "/ligar" (a rota que INICIA o pedido de autorização, essa
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
    # este o valor que queremos recuperar no callback. SEM "ondelete",
    # pela mesma razão já explicada em user_id de app/models/conta.py: não
    # existe, por agora, nenhum endpoint que apague um User.
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )

    # Momento de criação — não há, por agora, nenhuma limpeza automática de
    # linhas antigas (de pedidos de autorização começados e nunca
    # terminados); ficam a ocupar uma linha cada, sem consequência
    # prática à escala desta aplicação. Guardado para, se um dia isso
    # importar, ser possível apagar as mais antigas do que X horas.
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
