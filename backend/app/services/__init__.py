"""
PACOTE DE SERVIÇOS
=====================

Reúne lógica de domínio que é partilhada por mais do que uma rota — ao
contrário de app/routers, onde cada ficheiro só trata das SUAS próprias
rotas. Contém, por agora:
  - contas.py — obter_conta_do_utilizador: verificar que uma conta
    pertence ao utilizador autenticado, antes de a mostrar, editar,
    apagar, ou de lhe associar um movimento.
  - categorias.py — obter_categoria_do_utilizador: a mesma verificação de
    posse, para categorias.
  - categorias_seed.py — a árvore de categorias por omissão, criada para
    cada utilizador novo no momento do registo.
  - sessions.py — apagar_sessoes_expiradas: a limpeza periódica de
    sessões cujo prazo já passou (ver scripts/limpar_sessoes.py, o ponto
    de entrada que a chama a partir da linha de comandos).
  - cambio.py — obter_taxa/converter: conversão entre moedas, a partir das
    taxas guardadas em taxas_cambio (ver app/models/taxa_cambio.py).
"""
