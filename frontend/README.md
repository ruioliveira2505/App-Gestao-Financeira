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
  - `lib/` — lógica sem interface: `api.ts` (cliente HTTP: registar/login/logout/utilizador), `http.ts` (o `fetch` envolvido e a excepção `ErroApi`), `contas.ts` (chamadas ao CRUD de contas e utilitários de sugestões), `movimentos.ts` (chamadas ao CRUD de movimentos), `categorias.ts` (CRUD de categorias — ler a árvore, criar/editar/eliminar um grupo ou subcategoria — e auxiliares: `categoriaRefugio`, `direcaoDaCategoria`), `filtrosMovimentos.ts` (o modelo dos filtros da lista de movimentos: ler/escrever no URL, aplicar no cliente, atalhos de datas), `moedas.ts` (conjunto de moedas, símbolos e formatação de dinheiro — espelha o backend), `datas.ts` (formatação de datas: "Hoje"/"Ontem", mês por extenso, intervalos), `corDeterministica.ts` (cor a partir de um nome — usada pelo `Avatar` e pelo `PontoCategoria`), `seccoes.ts` (a lista única das secções de navegação), `nomeUtilizador.ts` (o "nome" derivado do email).
  - `hooks/` — `useMediaQuery.ts` (responder a uma media query em JavaScript, para montar molduras diferentes em mobile e desktop).
  - `paginas/` — os ecrãs, cada um com o seu `.module.css` ao lado:
    - `Login.tsx`, `Registo.tsx` — dentro da moldura `LayoutAutenticacao.tsx`.
    - `Inicio.tsx` — marcador de posição, por agora.
    - `Contas.tsx` — lista de contas, com procura e um menu de ordenar/agrupar (preferências guardadas no browser).
    - `ContaDetalhe.tsx` — o detalhe de uma conta (`/contas/:id`); em mobile, entra/sai a deslizar lateralmente (`PaginaDeslizante.tsx`).
    - `ContaNova.tsx` / `ContaEditar.tsx` — criar e editar, como folha (modal) sobre a página de trás; `ContaFormulario.tsx` é o formulário partilhado pelas duas.
    - `Movimentos.tsx` — lista global de movimentos, agrupada por dia (vista fixa — é um extrato, não uma lista a configurar); com procura, filtros (o botão funil) e o saldo remanescente de cada conta por linha.
    - `MovimentoNovo.tsx` / `MovimentoEditar.tsx` — criar e editar, como folha sobre a lista (um movimento não tem página de detalhe); `MovimentoFormulario.tsx` é o formulário partilhado.
    - `Categorias.tsx` — lista dos GRUPOS de categorias, em duas secções fixas (Entradas / Saídas).
    - `CategoriaNova.tsx` — criar um grupo, como folha sobre a lista (`/categorias/novo`); é a única vez que se escolhe a direção (entrada/saída) — uma subcategoria herda-a sempre do grupo onde nasce.
    - `CategoriaGrupo.tsx` — o modal de um grupo (`/categorias/:grupoId`), como folha sobre a lista (tal como "Novo movimento"): as suas subcategorias e todas as ações (renomear, mover para outro grupo, eliminar) — sem detalhe e edição separados, ao contrário de Contas (um grupo não tem "perfil" para só consultar, nem página de detalhe própria).
    - `Perfil.tsx` — a conta do utilizador: identidade, secções de definições e terminar sessão; `PerfilSeccao.tsx` é o sub-ecrã ("Em breve") de cada secção.
  - `componentes/` — peças de interface reutilizáveis, cada uma com o seu `.module.css`:
    - `LayoutApp.tsx` — a moldura das páginas autenticadas; escolhe, por `useMediaQuery`, entre a barra lateral (desktop) e a barra de topo + menu ☰ (mobile).
    - `BarraLateral.tsx` + `ItemNav.tsx` — a navegação em desktop (recolhível, com preferência guardada).
    - `BarraTopoMobile.tsx` + `MenuMobile.tsx` — a navegação em mobile: barra de topo fixa e o menu ☰ a ecrã inteiro.
    - `CabecalhoPagina.tsx` + `CabecalhoProvider.tsx` / `useCabecalho.ts` — cada página declara o seu título/acção/"voltar"; a barra de topo (mobile) ou o conteúdo (desktop) mostram-nos. Aceita também um "aoRecuar" opcional (ver `PaginaDeslizante.tsx`).
    - `PaginaDeslizante.tsx` — envolve uma página "de detalhe" para, só em mobile, entrar a deslizar da direita e sair de volta para lá (o "push"/"pop" do iOS); usada pelas quatro secções do Perfil e por `ContaDetalhe.tsx`. Em desktop não faz nada.
    - `Folha.tsx` (+ `contextoFolha.ts`) — a base de todos os modais: folha que sobe de baixo em mobile, diálogo centrado em desktop.
    - `Confirmacao.tsx` — *action sheet* para confirmar acções destrutivas.
    - `CampoSelecao.tsx` / `PainelDeEscolha.tsx` / `ListaDeOpcoes.tsx` — o seletor (moeda, banco, tipo da conta, conta e tipo de um movimento): folha em mobile, lista em linha em desktop.
    - `FiltroMovimentos.tsx` — o botão funil e a folha de filtros da lista de movimentos (linhas-seletor Contas · Tipo · Categorias · Datas, cada uma a abrir a sua folha da direita; estado no URL).
    - `CampoPesquisa.tsx` — a pílula de procura (lupa + campo + "✕" para limpar), partilhada por Contas e Movimentos.
    - `Avatar.tsx` — círculo com a inicial, cor determinística a partir do nome (contas).
    - `PontoCategoria.tsx` — ponto colorido de uma categoria, cor determinística a partir do nome do grupo (o mesmo princípio do `Avatar`, sem letra); usado no seletor de categoria e na linha da lista de movimentos.
    - `Menu.tsx` — menu flutuante reutilizável (`Menu` / `MenuItem` / `MenuCabecalho`), usado no "⋯" de ordenar/agrupar em Contas e, em `/categorias/:grupoId`, tanto no "⋯" do grupo (reticências na vertical, para se distinguir) como no de cada subcategoria (reticências na horizontal).
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

**Movimentos** (segunda entidade do domínio, de ponta a ponta):
- `/movimentos` — lista global (todas as contas), vista fixa: agrupada por dia, da data mais recente para a mais antiga (é um extrato, não uma lista a configurar). Cada linha tem um ponto colorido (a cor do grupo da categoria do movimento — `PontoCategoria`), a descrição e a conta, o valor a cores (verde entrada, vermelho saída) e o saldo da conta logo a seguir a esse movimento. Por cima: uma barra de procura (por descrição/conta) e o botão **funil**.
- **Filtros** (o funil) — uma folha com quatro linhas-seletor: Contas (multi-escolha, com "Todas"), Tipo (Todos / Entradas / Saídas), Categorias (multi-escolha, com "Todas" e um cabeçalho por grupo — como o seletor de categoria do formulário) e Datas (atalhos de janela — 7/30/90 dias —, mês específico ou intervalo à medida). Cada linha abre a sua folha da direita; o estado vive no URL e aplica-se no cliente. Sem filtro de valor por agora (as contas podem estar em moedas diferentes).
- `/movimentos/novo` e `/movimentos/:id/editar` — criar e editar num modal (folha). A conta, o tipo (Saída / Entrada) e a categoria escolhem-se no mesmo tipo de seletor — a categoria mostra só as opções da direção escolhida, agrupadas pelo nome do grupo, e começa sempre pré-preenchida na categoria-refúgio dessa direção; o valor é sempre positivo e o sinal resolve-se ao guardar. Tocar numa linha da lista abre diretamente a edição (sem página de detalhe); o "eliminar" está no fim do formulário de edição, com confirmação em *action sheet*.

**Categorias** (terceira entidade do domínio, de ponta a ponta) — alcançada a partir de `/perfil` (uma linha "Categorias", não a navegação principal: é uma classificação sobre contas/movimentos, não uma entidade real como eles — ver `src/lib/seccoes.ts`):
- `/categorias` — lista dos grupos, em duas secções fixas (Entradas / Saídas); cada linha mostra o ponto colorido do grupo e a contagem de subcategorias.
- `/categorias/novo` — criar um grupo (nome + direção), como folha sobre a lista.
- `/categorias/:grupoId` — um grupo abre como MODAL sobre a lista (folha que sobe de baixo, tal como "Novo movimento"), não como página própria: as suas subcategorias, cada uma com um menu "⋯" (Renomear — em linha, Mover para outro grupo, Eliminar); uma linha "Adicionar subcategoria" no fundo, também em linha. O grupo tem o seu próprio "⋯" no cabeçalho — com reticências NA VERTICAL, para se distinguir do "⋯" horizontal da subcategoria logo por baixo — com Renomear (numa folha pequena) e Eliminar (leva as subcategorias; não aparece nos dois refúgios "Outras Entradas"/"Outras Saídas"). Uma subcategoria protegida ("Outros" dos dois refúgios) não tem "⋯". Eliminar tenta sempre primeiro sem mais nada; só se o backend pedir (há movimentos a usar a categoria) é que aparece um seletor "Para onde migram os movimentos?", antes de repetir a eliminação — os erros de "Mover para" e de "Renomear grupo" aparecem dentro da própria folha, não escondidos atrás dela. Arrastar qualquer uma das três folhas aninhadas (Renomear grupo, Mover para, Migração) para baixo faz a folha do grupo descer com ela, tal como acontece com o seletor de moeda dentro de "Editar conta".

**Perfil** (`/perfil`) — identidade (avatar, nome, email), as secções Conta · Segurança · Preferências (ainda marcadores "Em breve"), **Categorias** (esta já real — leva à gestão da árvore, ver acima) e o terminar sessão. Em mobile, cada secção entra e sai a deslizar lateralmente (o "push"/"pop" do iOS — `PaginaDeslizante.tsx`); em desktop não muda nada.

**Início** é um marcador de posição.

Sobre a base: fundação de design minimalista (neutros com acento monocromático, tema claro/escuro pelo sistema operativo, tokens em `index.css` + CSS Modules por componente).
