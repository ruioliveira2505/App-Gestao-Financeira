/*
 * PÁGINA INICIAL (ÁREA AUTENTICADA)
 * =================================
 *
 * Primeiro ecrã que um utilizador vê depois de iniciar sessão. Nesta
 * fase, o seu único conteúdo é identificar quem está autenticado e
 * oferecer um botão para terminar a sessão — as funcionalidades da
 * aplicação (contas, movimentos, categorias) serão acrescentadas aqui
 * mais tarde.
 *
 * Esta página está sempre dentro de <RotaProtegida> (ver src/App.tsx),
 * por isso só é renderizada quando existe uma sessão válida; o objeto do
 * utilizador está sempre preenchido quando este componente aparece.
 */

// useNavigate devolve uma função para navegar a partir de código — aqui,
// para enviar o utilizador para o ecrã de início de sessão depois de
// terminar a sessão.
import { useNavigate } from 'react-router-dom'

import { useAuth } from '../auth/useAuth'

export function Inicio() {
  const { utilizador, logout } = useAuth()
  const navegar = useNavigate()

  async function terminarSessao() {
    // logout() contacta o backend para apagar a sessão e limpa o estado
    // local para 'anonimo'. Mesmo que o pedido ao servidor falhe, o
    // estado local é sempre limpo (ver AuthProvider).
    await logout()
    navegar('/login')
  }

  return (
    <main>
      <h1>App Gestão Financeira</h1>

      {/* utilizador?.email: o "?." devolve undefined em vez de rebentar
          caso utilizador fosse null. Na prática nunca é, por esta página
          viver dentro de <RotaProtegida>, mas o TypeScript não tem essa
          garantia e esta forma satisfá-lo sem ramos extra. */}
      <p>Sessão iniciada como {utilizador?.email}.</p>

      {/* type="button": sem isto, um <button> dentro de um futuro <form>
          seria tratado como botão de submissão. */}
      <button type="button" onClick={() => void terminarSessao()}>
        Terminar sessão
      </button>
    </main>
  )
}
