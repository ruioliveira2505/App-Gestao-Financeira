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

A próxima fatia vertical é **Movimentos** — registar e, mais tarde, importar transacções de uma conta.
