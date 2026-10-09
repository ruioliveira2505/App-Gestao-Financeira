"""
PONTO DE ENTRADA DA APLICAÇÃO
================================

Este ficheiro cria a instância da aplicação FastAPI e liga-lhe as rotas
definidas nos routers (autenticação, contas, movimentos, categorias,
resumo, Open Banking e reconciliações). É este ficheiro que o servidor
(Uvicorn) corre para pôr a API no ar.

Define também o CICLO DE VIDA da aplicação: o que acontece quando o
servidor arranca e quando desliga. Aqui, ao arrancar, lança-se a rotina
de manutenção da base de dados (apagar sessões e pedidos de autorização
expirados, atualizar as taxas de câmbio), que depois corre uma vez por
dia enquanto o servidor estiver ligado.
"""

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress

# FastAPI é a classe principal da biblioteca: uma instância dela representa
# a aplicação web como um todo.
from fastapi import FastAPI

# registar_tradutor ensina a aplicação a transformar os erros de domínio
# (os erros que a lógica de negócio lança, como "conta não encontrada")
# em respostas HTTP, num único sítio.
from app.core.config import settings
from app.core.erros import registar_tradutor

# app.routers é o pacote onde vivem os ficheiros de rotas. Importa-se cada
# módulo inteiro, e não directamente o "router" lá definido, só por
# preferência de estilo — ambas as formas funcionariam.
from app.routers import auth, categorias, contas, movimentos, open_banking, reconciliacoes, resumo
from app.services.manutencao import manutencao_periodica


@asynccontextmanager
async def ciclo_de_vida(_app: FastAPI) -> AsyncIterator[None]:
    """
    O ciclo de vida da aplicação. O FastAPI corre o código antes do
    "yield" quando o servidor arranca, e o código depois do "yield"
    quando desliga ("asynccontextmanager" é o que permite escrever as
    duas metades numa só função).

    Ao arrancar, lança a rotina de manutenção como uma TAREFA DE FUNDO
    (asyncio.create_task): corre ao lado dos pedidos, sem atrasar o
    arranque nem bloquear nenhum pedido. Ao desligar, cancela-a e espera
    que termine; o cancelamento chega à tarefa como uma exceção
    CancelledError, que aqui se ignora (suppress) porque é o fim
    esperado.

    Os testes não passam por aqui: o cliente de testes (httpx, com
    ASGITransport) fala diretamente com a aplicação sem a "arrancar",
    por isso a rotina nunca corre durante os testes.
    """
    tarefa = asyncio.create_task(manutencao_periodica()) if settings.manutencao_automatica else None
    yield
    if tarefa is not None:
        tarefa.cancel()
        with suppress(asyncio.CancelledError):
            await tarefa

# Cria a aplicação. O parâmetro title aparece na documentação interactiva
# gerada automaticamente pelo FastAPI (acessível, quando o servidor está a
# correr, em /docs); lifespan liga o ciclo de vida definido acima.
app = FastAPI(title="Gestão Financeira", lifespan=ciclo_de_vida)

# Os serviços (a lógica de negócio) lançam erros de domínio, que não sabem
# nada de HTTP; é aqui, à saída, que cada um ganha o seu código HTTP e a
# resposta {"detail": mensagem}.
registar_tradutor(app)

# include_router regista todas as rotas definidas em cada router dentro
# desta aplicação. Sem estas linhas, essas rotas existiriam no código mas
# nunca seriam alcançáveis por um pedido HTTP real — o FastAPI só sabe
# responder a rotas que tenham sido explicitamente incluídas.
app.include_router(auth.router)
app.include_router(contas.router)
app.include_router(movimentos.router)
app.include_router(categorias.router)
app.include_router(resumo.router)
app.include_router(open_banking.router)
app.include_router(reconciliacoes.router)
