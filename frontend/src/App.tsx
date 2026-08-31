/*
 * App — TABELA DE ROTAS DA APLICAÇÃO
 * ==================================
 *
 * Define que componente é mostrado para cada endereço:
 *
 *   /registo         → ecrã de criação de conta        (público)
 *   /login           → ecrã de início de sessão        (público)
 *   /        (Resumo) ┐
 *   /contas  (Contas) ┘ área autenticada, dentro da moldura da aplicação
 *   qualquer outro   → redireciona para /
 *
 * As rotas autenticadas são filhas de uma "rota de layout" sem caminho
 * próprio: essa rota renderiza <RotaProtegida><LayoutApp /></RotaProtegida>,
 * e cada rota-filha aparece dentro do <Outlet /> do LayoutApp — ou seja,
 * com a barra lateral sempre à volta. A RotaProtegida reencaminha para
 * /login quem não tenha sessão, antes de o layout sequer aparecer.
 */

import { Navigate, Route, Routes } from 'react-router-dom'

import { RotaProtegida } from './auth/RotaProtegida'
import { LayoutApp } from './componentes/LayoutApp'
import { Contas } from './paginas/Contas'
import { Login } from './paginas/Login'
import { Registo } from './paginas/Registo'
import { Resumo } from './paginas/Resumo'

function App() {
  return (
    <Routes>
      <Route path="/registo" element={<Registo />} />
      <Route path="/login" element={<Login />} />

      {/* Rota de layout: sem "path", só fornece o elemento que envolve as
          filhas. */}
      <Route
        element={
          <RotaProtegida>
            <LayoutApp />
          </RotaProtegida>
        }
      >
        <Route path="/" element={<Resumo />} />
        <Route path="/contas" element={<Contas />} />
      </Route>

      {/* path="*" corresponde a qualquer endereço não apanhado acima. */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
