/*
 * PONTO DE ARRANQUE DO FRONTEND
 * =============================
 *
 * Este ficheiro liga a aplicação React ao elemento <div id="root"> do
 * index.html e monta a árvore de componentes dentro de três "camadas"
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
 */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'

import './index.css'
import App from './App.tsx'
import { AuthProvider } from './auth/AuthProvider.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
