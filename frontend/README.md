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
  - `App.tsx` — tabela de rotas: que componente é mostrado para cada endereço (`/registo`, `/login`; e, dentro da moldura da aplicação, `/`, `/movimentos`, `/contas` e as suas sub-rotas, `/perfil` e as suas).
  - `auth/` — autenticação no cliente:
    - `contexto.ts` — definição do contexto e dos tipos do estado de autenticação.
    - `AuthProvider.tsx` — mantém o estado "há sessão iniciada?"; verifica-o no arranque com `GET /auth/me`.
    - `useAuth.ts` — hook que dá a qualquer componente acesso a esse estado e às acções de registo/login/logout.
    - `RotaProtegida.tsx` — guarda de rota: mostra o conteúdo só se houver sessão, senão reencaminha para `/login`.
  - `lib/` — lógica sem interface: `api.ts` (cliente HTTP: registar/login/logout/utilizador), `http.ts` (o `fetch` envolvido e a excepção `ErroApi`), `contas.ts` (chamadas ao CRUD de contas e utilitários de sugestões), `moedas.ts` (conjunto de moedas, símbolos e formatação de dinheiro — espelha o backend), `datas.ts` (formatação de datas), `seccoes.ts` (a lista única das secções de navegação), `nomeUtilizador.ts` (o "nome" derivado do email).
  - `hooks/` — `useMediaQuery.ts` (responder a uma media query em JavaScript, para montar molduras diferentes em mobile e desktop).
  - `paginas/` — os ecrãs, cada um com o seu `.module.css` ao lado:
    - `Login.tsx`, `Registo.tsx` — dentro da moldura `LayoutAutenticacao.tsx`.
    - `Inicio.tsx`, `Movimentos.tsx` — marcadores de posição, por agora.
    - `Contas.tsx` — lista de contas, com procura e um menu de ordenar/agrupar (preferências guardadas no browser).
    - `ContaDetalhe.tsx` — o detalhe de uma conta (`/contas/:id`).
    - `ContaNova.tsx` / `ContaEditar.tsx` — criar e editar, como folha (modal) sobre a página de trás; `ContaFormulario.tsx` é o formulário partilhado pelas duas.
    - `Perfil.tsx` — a conta do utilizador: identidade, secções de definições e terminar sessão; `PerfilSeccao.tsx` é o sub-ecrã ("Em breve") de cada secção.
  - `componentes/` — peças de interface reutilizáveis, cada uma com o seu `.module.css`:
    - `LayoutApp.tsx` — a moldura das páginas autenticadas; escolhe, por `useMediaQuery`, entre a barra lateral (desktop) e a barra de topo + menu ☰ (mobile).
    - `BarraLateral.tsx` + `ItemNav.tsx` — a navegação em desktop (recolhível, com preferência guardada).
    - `BarraTopoMobile.tsx` + `MenuMobile.tsx` — a navegação em mobile: barra de topo fixa e o menu ☰ a ecrã inteiro.
    - `CabecalhoPagina.tsx` + `CabecalhoProvider.tsx` / `useCabecalho.ts` — cada página declara o seu título/acção/"voltar"; a barra de topo (mobile) ou o conteúdo (desktop) mostram-nos.
    - `Folha.tsx` (+ `contextoFolha.ts`) — a base de todos os modais: folha que sobe de baixo em mobile, diálogo centrado em desktop.
    - `Confirmacao.tsx` — *action sheet* para confirmar acções destrutivas.
    - `CampoSelecao.tsx` / `PainelDeEscolha.tsx` / `ListaDeOpcoes.tsx` — o seletor (moeda, banco, tipo): folha em mobile, lista em linha em desktop.
    - `Avatar.tsx` — círculo com a inicial, cor determinística a partir do nome.
    - `Menu.tsx` — menu flutuante reutilizável (`Menu` / `MenuItem` / `MenuCabecalho`), usado no "⋯" da lista de contas.
    - `icones.tsx` — ícones da aplicação como componentes `<svg>` (estilo "Feather"/"Lucide"), sem biblioteca.
    - `Botao`, `CampoTexto`, `CampoDinheiro`, `CaixaErro`, `Formulario`, `LinkBotao`, `LinkVoltar` — primitivas de formulário e de navegação.
  - `test/` — apoio aos testes: `setup.ts` (extensões comuns e a simulação de `matchMedia`) e `servidor-msw.ts` (servidor de simulação de rede).
  - `index.css` — carregado uma vez, vale para toda a aplicação: os *tokens* de design (cores, espaçamentos, tamanhos de texto, raios — como "custom properties" do CSS), o reset e os estilos base dos elementos HTML. O estilo específico de cada componente vive no `Componente.module.css` ao lado dele (CSS Modules — classes com âmbito limitado a esse componente).
- `public/` — ficheiros servidos tal como estão, sem passar pelo processo de build: `favicon.svg` e `manifest.json` (o manifesto que torna a aplicação "instalável" no telemóvel — abre sem a interface do browser).
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
Tudo o que se segue tem testes automáticos.

**Autenticação:**
- `/registo` — cria a conta e inicia logo a sessão; valida no cliente o comprimento mínimo da password e mostra as mensagens de erro do servidor (ex.: email já registado).
- `/login` — autentica um utilizador existente; mostra a mensagem de erro do servidor para credenciais inválidas.
- A sessão persiste entre recarregamentos, através de um `GET /auth/me` feito no arranque; `RotaProtegida` reencaminha para `/login` quem não tenha sessão.

**Moldura:** adapta-se ao ecrã. Em desktop, barra lateral de navegação (Início · Movimentos · Contas), recolhível, com a preferência guardada no browser. Em mobile, uma barra de topo fixa (☰ ou "‹ voltar", título, acção) e o menu ☰ a ecrã inteiro. A navegação é só navegação; "terminar sessão" vive na página de Perfil.

**Contas** (primeira entidade do domínio, de ponta a ponta):
- `/contas` — lista com procura e um menu de ordenar/agrupar (preferências guardadas no browser).
- `/contas/:id` — detalhe: identidade, saldo actual e os campos da conta.
- `/contas/nova` e `/contas/:id/editar` — criar e editar num modal (folha em mobile, diálogo em desktop); é no fim do formulário de edição que se elimina a conta, com confirmação em *action sheet*.

**Perfil** (`/perfil`) — identidade (avatar, nome, email), as secções Conta · Segurança · Preferências (ainda marcadores "Em breve") e o terminar sessão.

**Início** e **Movimentos** são marcadores de posição. **Movimentos** é a próxima fatia.

Sobre a base: fundação de design minimalista (neutros com acento monocromático, tema claro/escuro pelo sistema operativo, tokens em `index.css` + CSS Modules por componente).
