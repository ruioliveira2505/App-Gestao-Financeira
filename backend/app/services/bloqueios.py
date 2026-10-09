"""
UMA OPERAÇÃO DE CADA VEZ POR CONTA
=====================================

Algumas operações sobre uma Conta não podem correr ao mesmo tempo:
sincronizar com o banco, vincular, desvincular, renovar, reconciliar,
editar a data e o saldo iniciais. Por exemplo, duas sincronizações em
simultâneo pediriam ao banco os mesmos movimentos e tentariam gravá-los
as duas; desvincular a meio de uma sincronização deixaria movimentos
importados sem vínculo.

COMO SE GARANTE: com um "advisory lock" do PostgreSQL (um bloqueio
"consultivo": a base de dados não o associa a nenhuma linha, é a
aplicação que decide o que ele protege). pg_try_advisory_xact_lock(n)
tenta ficar com o bloqueio número n:
  - se ninguém o tiver, fica com ele e devolve verdadeiro;
  - se outra transação já o tiver, devolve falso de imediato, sem esperar.
O bloqueio é largado sozinho no fim da transação (no commit ou no
rollback), por isso nunca fica preso por esquecimento.

Cada Conta tem o seu número de bloqueio, calculado a partir do seu id. Se
a Conta já estiver ocupada, a operação recebe um Conflito (409, "já está a
decorrer outra operação"), em vez de ficar à espera — o utilizador vê logo
o que se passa e pode tentar outra vez.

Dentro da MESMA transação, pedir o mesmo bloqueio outra vez funciona
sempre (o PostgreSQL deixa quem já tem o bloqueio voltar a pedi-lo), por
isso uma operação composta pode chamar várias funções que bloqueiam a
mesma Conta.
"""

import uuid

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.erros import Conflito


def _numero_do_bloqueio(conta_id: uuid.UUID) -> int:
    """
    O número do bloqueio de uma Conta: os primeiros 64 bits do seu id (um
    UUID tem 128), na forma de um inteiro com sinal, que é o que o
    PostgreSQL aceita (o tipo "bigint"). Duas Contas diferentes com os
    mesmos 64 primeiros bits são tão improváveis que não contam; e, mesmo
    nesse caso, o efeito seria só uma das duas esperar pela outra.
    """
    sem_sinal = conta_id.int >> 64
    return sem_sinal - (1 << 64) if sem_sinal >= (1 << 63) else sem_sinal


async def bloquear_conta(db: AsyncSession, conta_id: uuid.UUID) -> None:
    """
    Fica com o bloqueio da Conta até ao fim da transação, ou lança
    Conflito se outra operação já o tiver.
    """
    conseguiu = await db.scalar(
        text("SELECT pg_try_advisory_xact_lock(:numero)"),
        {"numero": _numero_do_bloqueio(conta_id)},
    )
    if not conseguiu:
        raise Conflito("Já está a decorrer outra operação nesta conta. Tenta outra vez daqui a pouco.")
