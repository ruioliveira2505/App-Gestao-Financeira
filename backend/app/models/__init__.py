"""
PACOTE DE MODELOS
===================

Este pacote reúne todas as tabelas (modelos) da aplicação. Um modelo só fica
registado em Base.metadata (a lista interna que o SQLAlchemy mantém de
todas as tabelas conhecidas) no momento em que a sua classe é definida —
ou seja, no momento em que o ficheiro onde vive é importado. Importar aqui
cada modelo, mesmo que nenhum nome seja usado directamente neste ficheiro,
garante que basta importar o pacote "app.models" (uma única linha) para que
todos os modelos existentes fiquem registados de uma vez. É nesta lista
(Base.metadata) que o Alembic se baseia para saber que tabelas deveriam
existir, ao comparar com o que realmente existe na base de dados.
"""

from app.models.session import UserSession  # noqa: F401
from app.models.user import User  # noqa: F401
