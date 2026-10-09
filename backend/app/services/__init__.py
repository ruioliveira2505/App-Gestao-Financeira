"""
PACOTE DE SERVIÇOS
=====================

Os SERVIÇOS têm as regras de negócio da aplicação, separadas das ROTAS
(app/routers). As rotas tratam do HTTP: recebem o pedido já validado no
formato, chamam um serviço, tornam as alterações definitivas (um único
commit por pedido) e devolvem a resposta. Os serviços aplicam as regras,
nunca fazem commit (só flush: as alterações seguem para a base de dados
dentro da transação em curso, ainda não definitivas, para várias
operações poderem gravar-se juntas, tudo ou nada) e, quando uma regra é
violada, lançam um ERRO DE DOMÍNIO (um erro da lógica de negócio, com uma
mensagem para o utilizador), que a API traduz no código HTTP certo.

Contém:
  - contas.py — as regras das contas (criar, editar, apagar), a
    verificação de posse, o nome único e a soma dos movimentos;
  - movimentos.py — as regras dos movimentos (criar, editar, apagar, e
    as operações em lote);
  - categorias.py — as regras da árvore de categorias (posse, criar,
    editar, eliminar com migração dos movimentos);
  - categorias_seed.py — a árvore de categorias por omissão, criada para
    cada utilizador novo no registo;
  - nomes.py — a forma de um nome usada para comparar (sem acentos nem
    maiúsculas);
  - contas_bancarias.py — as autorizações (consentimentos dados no banco)
    e as suas contas bancárias: gravar, reconhecer contas já conhecidas,
    vínculos, sugestões de nome e tipo;
  - importacao_movimentos.py — criar uma Conta a partir de uma conta
    bancária e sincronizar, transformando o que o banco devolve em Contas
    e Movimentos;
  - enable_banking.py — o cliente da API da Enable Banking (o
    intermediário de Open Banking): pedidos assinados, tempo limite e
    classificação dos erros do banco;
  - cambio.py — conversão entre moedas, a partir das taxas guardadas;
  - sessions.py — apagar as sessões de início de sessão cujo prazo já
    passou.
"""
