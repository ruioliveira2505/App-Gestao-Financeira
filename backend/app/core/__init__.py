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
"""
