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
- Backend: modelo, migração e endpoints CRUD; o saldo de cada conta passa a somar os movimentos reais (ver [`backend/README.md`](backend/README.md)).
- Frontend: uma lista global tipo extrato (agrupada por dia, mais recente primeiro), com procura, filtros (conta, tipo, datas) e criar/editar/eliminar num modal (ver [`frontend/README.md`](frontend/README.md)).

A terceira — as **categorias** (o "porquê" de um movimento) — está feita de ponta a ponta:
- Backend: uma árvore de dois níveis (grupo → subcategoria), semeada por omissão para cada utilizador novo, com CRUD completo e uma regra central — apagar uma categoria com movimentos associados exige indicar para onde migram, nunca automaticamente (ver [`backend/README.md`](backend/README.md)).
- Frontend: o seletor de categoria no formulário de movimento, o ponto colorido na linha da lista, a linha de filtro "Categorias", e a página `/categorias` para gerir a árvore — criar, renomear, mover e eliminar grupos e subcategorias (ver [`frontend/README.md`](frontend/README.md)).

A seguir: a atribuição automática de categorias com um modelo de linguagem; e, mais tarde, a importação por **Open Banking** e o scroll infinito no histórico.
