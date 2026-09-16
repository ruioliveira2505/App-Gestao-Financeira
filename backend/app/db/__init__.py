"""
PACOTE "db"
==============

Ficheiro vazio de propósito — só para o Python reconhecer esta pasta como
um pacote importável (para se poder escrever, por exemplo,
"from app.db.session import get_db"). Contém um único ficheiro,
session.py: a classe base de que todos os modelos herdam, o "engine"
assíncrono que sabe comunicar com a PostgreSQL, e a função get_db, que
entrega uma sessão de trabalho a cada pedido da API e garante o seu
encerramento no final.
"""
