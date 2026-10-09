"""
PACOTE "core"
================

Ficheiro vazio de propósito — só para o Python reconhecer esta pasta como
um pacote importável (para se poder escrever, por exemplo,
"from app.core.config import settings"). Reúne o que é transversal à
aplicação, sem pertencer a uma área de negócio específica (contas,
categorias, movimentos):
  - config.py — leitura da configuração a partir do ficheiro .env.
  - security.py — hash e verificação de passwords (Argon2id).
  - sessions.py — geração e hash de tokens de sessão, e a duração da
    sessão deslizante.
  - deps.py — as dependências do FastAPI partilhadas pelas rotas, em
    particular obter_utilizador_atual ("quem é o utilizador autenticado
    neste pedido?").
  - moedas.py — a lista de moedas suportadas pela aplicação.
  - params.py — a leitura de parâmetros de pedido com vários ids
    separados por vírgulas ("id1,id2").
  - erros.py — os erros de domínio (os erros da lógica de negócio, com
    uma mensagem para o utilizador) e o tradutor que os transforma em
    respostas HTTP.
  - tempo.py — hoje(): a data civil em Lisboa, e não a do relógio do
    servidor.
"""
