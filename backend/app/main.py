"""
PONTO DE ENTRADA DA APLICAÇÃO
================================

Este ficheiro cria a instância da aplicação FastAPI e liga-lhe as rotas
definidas nos routers (autenticação e contas). É este ficheiro que o
servidor (Uvicorn) corre para pôr a API no ar.
"""

# FastAPI é a classe principal da biblioteca: uma instância dela representa
# a aplicação web como um todo.
from fastapi import FastAPI

# app.routers é o pacote onde vivem os ficheiros de rotas. Importa-se cada
# módulo inteiro, e não directamente o "router" lá definido, só por
# preferência de estilo — ambas as formas funcionariam.
from app.routers import auth, contas

# Cria a aplicação. O parâmetro title aparece na documentação interactiva
# gerada automaticamente pelo FastAPI (acessível, quando o servidor está a
# correr, em /docs).
app = FastAPI(title="Gestão Financeira")

# include_router regista todas as rotas definidas em cada router dentro
# desta aplicação. Sem estas linhas, essas rotas existiriam no código mas
# nunca seriam alcançáveis por um pedido HTTP real — o FastAPI só sabe
# responder a rotas que tenham sido explicitamente incluídas.
app.include_router(auth.router)
app.include_router(contas.router)
