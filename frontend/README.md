# Frontend
Interface da aplicação, escrita em React com TypeScript, construída e servida com o Vite.

## Estrutura
- `src/` — código-fonte da aplicação: `App.tsx` (o único ecrã, hoje vazio), `main.tsx` (liga o React ao HTML), e `App.css`/`index.css` (estilos, ainda por definir).
- `public/` — ficheiros servidos tal como estão, sem passar pelo processo de build (hoje só o `favicon.svg`).
- `index.html` — a única página HTML real; o React monta tudo dentro dela.
- `package.json` / `package-lock.json` — dependências do projecto e lockfile.
- `node_modules/` — dependências instaladas (local, não fica no repositório).
- `vite.config.ts`, `tsconfig*.json`, `eslint.config.js` — configuração das ferramentas (Vite, TypeScript, ESLint).

## Requisitos
- Node.js (traz o `npm` incluído).

## Instalação
1. Entrar na pasta:
   ```bash
   cd frontend
   ```
2. Instalar as dependências:
   ```bash
   npm install
   ```
   Lê o `package.json` e o `package-lock.json`, e instala tudo dentro da pasta `node_modules/`.

## Correr em desenvolvimento
```bash
npm run dev
```
Arranca um servidor local (por omissão em `http://localhost:5173`) que recarrega a página automaticamente sempre que um ficheiro é alterado.

## Estado actual
Isto já funciona hoje: abre uma página só com o título "App Gestão Financeira", sem mais nenhum ecrã — foi removido o conteúdo de demonstração que o Vite cria por defeito.

Testes automáticos (Vitest e React Testing Library) foram escolhidos como ferramenta, mas ainda não estão instalados. Serão acrescentados quando começarmos a escrever a primeira funcionalidade real da aplicação — autenticação (registo e início de sessão de utilizadores) —, altura em que passa a haver componentes concretos para testar.
