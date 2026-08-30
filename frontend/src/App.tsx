/*
 * App — TABELA DE ROTAS DA APLICAÇÃO
 * ==================================
 *
 * Define que componente é mostrado para cada endereço:
 *
 *   /registo  → ecrã de criação de conta        (público)
 *   /login    → ecrã de início de sessão        (público)
 *   /         → área autenticada                (protegida por RotaProtegida)
 *   qualquer  → redireciona para /
 */

import { Navigate, Route, Routes } from 'react-router-dom'

import { RotaProtegida } from './auth/RotaProtegida'
import { Inicio } from './paginas/Inicio'
import { Login } from './paginas/Login'
import { Registo } from './paginas/Registo'

function App() {
  return (
    // <Routes> escolhe e mostra o primeiro <Route> cujo "path" corresponde
    // ao endereço atual.
    <Routes>
      <Route path="/registo" element={<Registo />} />
      <Route path="/login" element={<Login />} />

      <Route
        path="/"
        element={
          <RotaProtegida>
            <Inicio />
          </RotaProtegida>
        }
      />

      {/* path="*" corresponde a qualquer endereço não apanhado acima.
          replace evita deixar o endereço inválido no histórico. */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
