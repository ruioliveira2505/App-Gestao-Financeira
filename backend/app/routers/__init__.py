"""
PACOTE DE ROUTERS
====================

Este pacote reúne os routers da aplicação — cada ficheiro agrupa as rotas
de uma área funcional (ex.: auth.py para autenticação). Cada router é
importado directamente em app/main.py e ligado à aplicação através de
app.include_router(...); este ficheiro não precisa de os reunir a todos,
ao contrário do que acontece em app/models/__init__.py.
"""
