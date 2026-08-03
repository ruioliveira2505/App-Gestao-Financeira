"""
PACOTE DE SCHEMAS
====================

Este pacote reúne os schemas (classes baseadas em BaseModel, do Pydantic)
que descrevem o formato dos pedidos e das respostas da API — diferentes
dos modelos em app/models/, que descrevem as tabelas da base de dados. Ao
contrário do pacote app/models/, este ficheiro não precisa de importar os
schemas individuais: cada router importa directamente do ficheiro que
precisar (ex.: app.schemas.auth), porque os schemas não têm equivalente ao
Base.metadata dos modelos — não existe nenhum mecanismo que precise de os
"descobrir" todos de uma vez.
"""
