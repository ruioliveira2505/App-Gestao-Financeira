# Frontend
Interface da aplicação, escrita em React com TypeScript, construída e servida com o Vite.

## Índice
- [Estrutura](#estrutura)
- [Requisitos](#requisitos)
- [Instalação](#instalação)
- [Correr em desenvolvimento](#correr-em-desenvolvimento)
- [Correr os testes](#correr-os-testes)
- [Estado actual](#estado-actual)

## Estrutura
- `src/` — código-fonte da aplicação:
  - `main.tsx` — ponto de arranque: liga o React ao `index.html` e envolve a aplicação em `<BrowserRouter>` (rotas) e `<AuthProvider>` (estado de sessão).
  - `App.tsx` — tabela de rotas: que componente é mostrado para cada endereço (`/registo`, `/login`; e, dentro da moldura da aplicação, `/` e `/contas`).
  - `lib/api.ts` — cliente HTTP: o único ponto que fala com a API do backend (registar, login, logout, obter utilizador atual).
  - `auth/` — autenticação no cliente:
    - `contexto.ts` — definição do contexto e dos tipos do estado de autenticação.
    - `AuthProvider.tsx` — mantém o estado "há sessão iniciada?"; verifica-o no arranque com `GET /auth/me`.
    - `useAuth.ts` — hook que dá a qualquer componente acesso a esse estado e às acções de registo/login/logout.
    - `RotaProtegida.tsx` — guarda de rota: mostra o conteúdo só se houver sessão, senão reencaminha para `/login`.
  - `paginas/` — os ecrãs (`Login.tsx`, `Registo.tsx` com a moldura `LayoutAutenticacao.tsx`; `Resumo.tsx`, `Contas.tsx`). Cada um com o seu `.module.css` ao lado.
  - `componentes/` — peças de interface reutilizáveis, cada uma com o seu `.module.css`:
    - `LayoutApp.tsx` + `BarraLateral.tsx` — a moldura das páginas autenticadas: barra lateral de navegação (recolhível em ecrã largo, gaveta em ecrã estreito) mais a área de conteúdo.
    - `ItemNav.tsx` — uma ligação da barra lateral (ícone + rótulo, com estado activo).
    - `Menu.tsx` — menu flutuante reutilizável (`Menu` / `MenuItem` / `MenuCabecalho`), usado no perfil.
    - `icones.tsx` — ícones da aplicação como componentes `<svg>` (estilo "Feather"/"Lucide"), sem biblioteca.
    - `Botao`, `CampoTexto`, `CaixaErro`, `Formulario` — primitivas de formulário.
  - `test/` — apoio aos testes: `setup.ts` (extensões comuns a todos os testes) e `servidor-msw.ts` (servidor de simulação de rede).
  - `index.css` — carregado uma vez, vale para toda a aplicação: os *tokens* de design (cores, espaçamentos, tamanhos de texto, raios — como "custom properties" do CSS), o reset e os estilos base dos elementos HTML. O estilo específico de cada componente vive no `Componente.module.css` ao lado dele (CSS Modules — classes com âmbito limitado a esse componente).
- `public/` — ficheiros servidos tal como estão, sem passar pelo processo de build (hoje só o `favicon.svg`).
- `index.html` — a única página HTML real; o React monta tudo dentro dela.
- `vite.config.ts` — configuração do Vite: plugin de React, proxy de desenvolvimento (`/api` → backend) e bloco de configuração dos testes (Vitest).
- `package.json` / `package-lock.json` — dependências do projecto e lockfile.
- `node_modules/` — dependências instaladas (local, não fica no repositório).
- `tsconfig*.json`, `eslint.config.js` — configuração do TypeScript e do ESLint.

## Requisitos
- Node.js (traz o `npm` incluído).
- Para o desenvolvimento e para a verificação manual, o backend a correr em paralelo (ver `../backend/README.md`) — o proxy do Vite reencaminha os pedidos a `/api` para lá.

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
Arranca um servidor local (por omissão em `http://localhost:5173`) que recarrega a página automaticamente sempre que um ficheiro é alterado. Os pedidos a `/api/...` são reencaminhados para o backend em `http://127.0.0.1:8000` — ou seja, o backend tem de estar também a correr para a autenticação funcionar.

O `vite.config.ts` tem `server.host: true`, por isso o `npm run dev` imprime também um endereço de rede (ex.: `http://192.168.1.x:5173`) que outro dispositivo no mesmo Wi-Fi — um telemóvel — pode abrir, para ver o aspecto responsivo em ecrãs reais.

Nesse acesso pela rede (HTTP simples, endereço que não é `localhost`), o cookie de sessão só é guardado se o backend estiver a correr com `COOKIE_SECURE=false` no seu `.env` — ver `../backend/README.md`. Sem isso, as páginas continuam a abrir, mas a sessão não sobrevive a um refresh.

## Correr os testes
```bash
npm run test            # modo de vigília: reexecuta ao guardar um ficheiro
npm run test -- --run   # corre a suite uma vez e termina
```
Os testes usam o Vitest com o ambiente `jsdom` (APIs de browser em JavaScript, sem abrir um browser real) e o MSW, que intercepta os pedidos HTTP e responde com dados controlados — nenhum teste contacta a rede nem precisa do backend a correr.

## Estado actual
Autenticação completa de ponta a ponta, com testes automáticos:
- `/registo` — cria a conta e inicia logo a sessão; valida no cliente o comprimento mínimo da password e mostra as mensagens de erro do servidor (ex.: email já registado).
- `/login` — autentica um utilizador existente; mostra a mensagem de erro do servidor para credenciais inválidas.
- A sessão persiste entre recarregamentos da página, através de um pedido a `GET /auth/me` feito no arranque; `RotaProtegida` reencaminha para `/login` quem não tenha sessão.

A moldura das páginas autenticadas está montada: barra lateral de navegação (Resumo, Contas), recolhível em ecrã largo (a preferência fica guardada no browser) e em gaveta em ecrã estreito, com menu de perfil e terminar sessão. As páginas `Resumo` e `Contas` são marcadores de posição.

Existe uma fundação de design mínima: paleta minimalista dominada por neutros com acento monocromático, tema claro e escuro (segue o do sistema operativo), e componentes de interface reutilizáveis. A primeira funcionalidade do domínio financeiro — as contas — é o passo seguinte.
