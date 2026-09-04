"""
PACOTE DE SERVIÇOS
=====================

Reúne lógica de domínio que é partilhada por mais do que uma rota — ao
contrário de app/routers, onde cada ficheiro só trata das SUAS próprias
rotas. Nasceu com uma única função (obter_conta_do_utilizador, em
app/services/contas.py), que tanto as rotas de contas como as de
movimentos precisam: verificar que uma conta pertence ao utilizador
autenticado antes de a mostrar, editar, apagar, ou de lhe associar um
movimento.
"""
