"""
APAGAR A CONTA DE UM UTILIZADOR (DIREITO AO APAGAMENTO)
==========================================================

O RGPD (o Regulamento Geral sobre a Proteção de Dados, da União Europeia)
dá a cada pessoa o direito de pedir que os seus dados pessoais sejam
apagados. Nesta aplicação, apagar a conta de utilizador apaga TODOS os
seus dados: contas, movimentos, categorias, reconciliações, autorizações
bancárias, vínculos e sessões (regra D2).

COMO: a própria base de dados apaga tudo em cascata a partir do
utilizador (as chaves estrangeiras para a tabela "users" têm ON DELETE
CASCADE). Este serviço só tem de:
  1. confirmar a password (apagar não tem volta atrás; uma sessão aberta,
     sozinha, não deve bastar);
  2. REVOGAR no banco as autorizações ainda ativas — os consentimentos
     dados ao banco para a aplicação ler as contas —, para a aplicação
     deixar de as poder usar depois de os dados desaparecerem. Se algum
     desses pedidos à Enable Banking (o intermediário que fala com os
     bancos) falhar, o apagamento continua na mesma, e a falha fica no
     registo do servidor: o direito ao apagamento não pode ficar refém de
     um serviço externo em baixo (e o consentimento expira sozinho no
     prazo);
  3. apagar o utilizador.

Nada aqui faz commit: quem chama (a rota) torna tudo definitivo, uma vez,
no fim.
"""

import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.erros import ErroDeDominio, Proibido
from app.core.security import verify_password
from app.models.autorizacao import Autorizacao
from app.models.user import User
from app.services.enable_banking import revogar_sessao
from app.services.estados import estado_autorizacao

# O registo (log) deste ficheiro: mensagens para quem opera o servidor.
_registo = logging.getLogger(__name__)


async def apagar_utilizador(db: AsyncSession, utilizador: User, password: str) -> None:
    """
    Apaga o utilizador e todos os seus dados, depois de confirmar a
    password (Proibido, 403, se não estiver certa) e de revogar no banco as
    autorizações ativas.
    """
    if not verify_password(password, utilizador.password_hash):
        raise Proibido("A password não está certa.")

    autorizacoes = (
        await db.scalars(select(Autorizacao).where(Autorizacao.user_id == utilizador.id))
    ).all()
    for autorizacao in autorizacoes:
        if estado_autorizacao(autorizacao) != "ativa":
            continue
        try:
            await revogar_sessao(autorizacao.session_id)
        except ErroDeDominio as erro:
            _registo.warning(
                "Ao apagar um utilizador, não foi possível revogar uma autorização no banco: %s",
                erro.mensagem,
            )

    await db.delete(utilizador)
    await db.flush()
