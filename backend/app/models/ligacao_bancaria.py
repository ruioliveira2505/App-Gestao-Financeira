"""
MODELO DA TABELA "ligacoes_bancarias"
========================================

Representa UMA autenticação e consentimento dados junto de um banco, para
efeitos de importação automática de movimentos via Open Banking (a
integração com a Enable Banking, enablebanking.com — o intermediário
regulado ao abrigo da directiva europeia PSD2 usado neste projecto; ver
app/services/enable_banking.py para o desenho completo do fluxo).

NÃO é uma conta — é o CONSENTIMENTO em si. Um único consentimento pode
abranger mais do que uma conta ao mesmo tempo (por exemplo, a conta à
ordem e uma poupança do mesmo banco, autorizadas na mesma autenticação);
por isso, cada conta trazida por uma ligação vive numa linha à parte, na
tabela "contas_ligadas" (ver app/models/conta_ligada.py), que aponta de
volta para a linha aqui através de ligacao_id.

O PARALELO mais próximo já existente neste projecto é a relação entre
User e UserSession (app/models/user.py e app/models/session.py): User
representa uma identidade estável e permanente; UserSession representa um
início de sessão concreto, que expira e é renovado, sem que isso mude
quem o utilizador é. Aqui, Conta (app/models/conta.py, sem qualquer
alteração) é o equivalente estável — a conta bancária continua a ser a
mesma conta, quer o consentimento tenha sido dado ontem ou há 89 dias, e
mesmo que seja preciso religar (dar consentimento outra vez) quando este
expirar. LigacaoBancaria é o equivalente de UserSession: representa uma
autorização concreta, com prazo, sujeita a expirar e ser substituída por
uma nova sem que a Conta subjacente tenha de mudar de identidade.
"""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.session import Base


class LigacaoBancaria(Base):
    """Um consentimento dado junto de um banco, através da Enable Banking, para importar dados."""

    __tablename__ = "ligacoes_bancarias"

    # Chave primária. UUID, pela mesma razão de todas as outras tabelas
    # deste projecto (users, sessions, contas, movimentos): um id
    # sequencial exporia quantas ligações existem e seria fácil de
    # adivinhar.
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # Chave estrangeira para o dono desta ligação. index=True porque toda
    # e qualquer consulta a ligações filtra por este campo ("as ligações
    # deste utilizador"). SEM "ondelete", pela mesma razão já explicada em
    # user_id de app/models/conta.py e app/models/session.py: não existe,
    # por agora, nenhum endpoint que apague um User — quando existir, esta
    # relação precisa de uma decisão explícita, não o "sem política
    # nenhuma" que isto é hoje.
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )

    # O identificador que a própria Enable Banking atribui a esta sessão
    # de autorização (devolvido na troca do "code" por uma sessão — ver
    # trocar_codigo_por_sessao, em app/services/enable_banking.py).
    # unique=True: cada sessão da Enable Banking só devia corresponder a
    # uma única ligação nossa.
    session_id: Mapped[str] = mapped_column(String, unique=True, nullable=False)

    # Nome e país (código ISO 3166 de duas letras) do banco autorizado,
    # tal como devolvidos pela Enable Banking (campo "aspsp" da resposta —
    # "Account Servicing Payment Service Provider", o nome técnico da API
    # para um banco em concreto). Guardados aqui para se poder mostrar
    # "as tuas ligações: Caixa Geral de Depósitos, Revolut..." sem ter de
    # voltar a perguntar à Enable Banking.
    aspsp_nome: Mapped[str] = mapped_column(String(120), nullable=False)
    aspsp_pais: Mapped[str] = mapped_column(String(2), nullable=False)

    # Até quando este consentimento é válido (campo "access.valid_until"
    # da resposta da Enable Banking — normalmente 90 dias a partir da
    # autorização, o período habitual associado ao PSD2 para este tipo de
    # consentimento). Permite calcular se uma ligação está "activa" ou
    # "expirada" comparando este valor com o momento actual, em vez de
    # guardar esse estado numa coluna à parte que poderia ficar
    # desactualizada.
    valido_ate: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    # Momento de criação da linha, preenchido pela própria base de dados.
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
