# Gestão Financeira

## O que é
Aplicação de gestão de finanças pessoais que centraliza movimentos de várias contas bancárias e simplifica a análise de receitas e despesas.

## Porque existe
Acompanhar finanças espalhadas por várias contas bancárias, e categorizar cada movimento à mão, é lento e propenso a erros. Este projecto centraliza essa informação numa única plataforma e automatiza a categorização.

## Funcionalidades
- Integração com Open Banking para importar movimentos de múltiplas contas bancárias.
- Categorização automática de transacções com recurso a modelos de linguagem (LLMs).
- Análise consolidada de receitas e despesas.

## Como está organizado
- `backend/` — API em Python (FastAPI). Ver [`backend/README.md`](backend/README.md).
- `frontend/` — interface em React (TypeScript). Ver [`frontend/README.md`](frontend/README.md).

## Instalação
Pré-requisitos: [uv](https://docs.astral.sh/uv/) e Node.js (com `npm`). Depois, seguir as instruções específicas em `backend/README.md` e `frontend/README.md`.

## Estado actual
Autenticação completa de ponta a ponta e testada automaticamente (registo, login, logout, "quem sou eu"; sessão que persiste entre recarregamentos).

A primeira entidade do domínio — as **contas** (bancária, cartão, dinheiro, poupança) — está feita de ponta a ponta:
- Backend: modelo, migração e endpoints CRUD, com o saldo actual calculado a partir de um saldo-âncora numa data (ver [`backend/README.md`](backend/README.md)).
- Frontend: listar, ver, criar e editar contas, dentro de uma moldura própria para telemóvel (barra de topo + menu ☰) e para desktop (barra lateral); e uma página de Perfil com os dados da conta e o terminar sessão (ver [`frontend/README.md`](frontend/README.md)).

A segunda — os **movimentos** (entradas e saídas de dinheiro numa conta) — está feita de ponta a ponta:
- Backend: modelo, migração e endpoints CRUD, mais dois endpoints em lote (eliminar e recategorizar vários de uma vez, atómicos); o saldo de cada conta passa a somar os movimentos reais (ver [`backend/README.md`](backend/README.md)).
- Frontend: uma lista global tipo extrato (agrupada por dia, mais recente primeiro, com scroll infinito), com procura, filtros (conta, categoria, tipo, datas), criar/editar/eliminar num modal, e um modo de seleção múltipla para eliminar/recategorizar vários movimentos de uma vez (ver [`frontend/README.md`](frontend/README.md)).

A terceira — as **categorias** (o "porquê" de um movimento) — está feita de ponta a ponta:
- Backend: uma árvore de dois níveis (grupo → subcategoria), semeada por omissão para cada utilizador novo, com CRUD completo e uma regra central — apagar uma categoria com movimentos associados exige indicar para onde migram, nunca automaticamente (ver [`backend/README.md`](backend/README.md)).
- Frontend: o seletor de categoria no formulário de movimento, o ponto colorido na linha da lista, a linha de filtro "Categorias", e a página `/categorias` para gerir a árvore — criar, renomear, mover e eliminar grupos e subcategorias (ver [`frontend/README.md`](frontend/README.md)).

A **conversão de moeda** entre contas está feita, backend e frontend: taxas de câmbio diárias desde o Banco Central Europeu, convertidas para a moeda principal que cada utilizador escolhe em Perfil → Preferências (ver [`backend/README.md`](backend/README.md) e [`frontend/README.md`](frontend/README.md)) — a lista e o detalhe de uma conta já mostram o saldo convertido em destaque, com o valor original (na moeda da própria conta) por baixo, sempre que os dois diferem. A página **Início** já usa essa conversão para uma primeira análise entre contas: Saldo Total (soma de todas as contas, na moeda principal) e Entradas/Saídas/Líquido do mês atual. A seguir: filtros (contas, categorias, período) e gráficos sobre esses mesmos números.

A integração com **Open Banking** (via [Enable Banking](https://enablebanking.com), um agregador regulado ao abrigo da directiva europeia PSD2) está feita e testada contra um banco real, de ponta a ponta — ligar uma conta ao criá-la (todo o histórico disponível, ou só desde uma data escolhida), sincronizar movimentos novos manualmente, e desvincular (ver "Open Banking", em [`backend/README.md`](backend/README.md) e em [`frontend/README.md`](frontend/README.md)) — para o cenário de uma conta que nasce já ligada. Mais tarde: sincronização automática/periódica, ligar uma conta manual já existente, e a atribuição automática de categorias com um modelo de linguagem (LLM).
