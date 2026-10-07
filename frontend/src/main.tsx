/*
 * PONTO DE ARRANQUE DO FRONTEND
 * =============================
 *
 * Este ficheiro liga a aplicação React ao elemento <div id="root"> do
 * index.html e monta a árvore de componentes dentro de quatro "camadas"
 * que envolvem tudo o resto:
 *
 *   1. StrictMode — ajuda do React, ativa apenas em desenvolvimento, que
 *      corre certas funções duas vezes para expor efeitos secundários mal
 *      isolados. Não tem qualquer efeito na versão de produção.
 *
 *   2. BrowserRouter — dá à aplicação o sistema de rotas do React Router,
 *      usando o endereço real do browser (ex.: /login, /registo). Tem de
 *      estar acima de qualquer componente que use rotas ou navegação.
 *
 *   3. AuthProvider — mantém o estado "há sessão iniciada?" e disponibiliza
 *      as ações de registo/login/logout a toda a aplicação, através do
 *      hook useAuth. Está dentro do BrowserRouter para que, no futuro,
 *      possa ele próprio usar navegação se for necessário.
 *
 *   4. QueryClientProvider — dá a toda a aplicação a CACHE dos dados do
 *      servidor (TanStack Query — ver lib/consultas.ts): as páginas que
 *      pedem os mesmos dados partilham-nos, e alterar alguma coisa
 *      actualiza todas as que a mostram. Dentro dele,
 *      LimparCacheAoMudarDeUtilizador esvazia a cache quando muda quem
 *      está autenticado, para os dados de um utilizador nunca aparecerem
 *      a outro.
 *
 * O cliente da cache é criado UMA vez, aqui, fora de qualquer componente
 * — se fosse criado dentro de um, cada nova renderização criaria uma
 * cache nova, vazia.
 */

import { QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'

import './index.css'
import App from './App.tsx'
import { AuthProvider } from './auth/AuthProvider.tsx'
import { LimparCacheAoMudarDeUtilizador } from './auth/LimparCacheAoMudarDeUtilizador.tsx'
import { criarClienteConsultas } from './lib/consultas.ts'

const clienteConsultas = criarClienteConsultas()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <QueryClientProvider client={clienteConsultas}>
          <LimparCacheAoMudarDeUtilizador>
            <App />
          </LimparCacheAoMudarDeUtilizador>
        </QueryClientProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
