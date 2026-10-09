"""
PONTO DE ENTRADA DA APLICAÇÃO
================================

Este ficheiro cria a instância da aplicação FastAPI e liga-lhe as rotas
definidas nos routers (autenticação, contas, movimentos, categorias,
resumo e Open Banking). É este ficheiro que o servidor (Uvicorn) corre
para pôr a API no ar.
"""

# FastAPI é a classe principal da biblioteca: uma instância dela representa
# a aplicação web como um todo.
from fastapi import FastAPI

# registar_tradutor ensina a aplicação a transformar os erros de domínio
# (os erros que a lógica de negócio lança, como "conta não encontrada")
# em respostas HTTP, num único sítio.
from app.core.erros import registar_tradutor

# app.routers é o pacote onde vivem os ficheiros de rotas. Importa-se cada
# módulo inteiro, e não directamente o "router" lá definido, só por
# preferência de estilo — ambas as formas funcionariam.
from app.routers import auth, categorias, contas, movimentos, open_banking, resumo

# Cria a aplicação. O parâmetro title aparece na documentação interactiva
# gerada automaticamente pelo FastAPI (acessível, quando o servidor está a
# correr, em /docs).
app = FastAPI(title="Gestão Financeira")

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
