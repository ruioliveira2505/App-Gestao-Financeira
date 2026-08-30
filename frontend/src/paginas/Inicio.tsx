/*
 * PÁGINA INICIAL (ÁREA AUTENTICADA)
 * =================================
 *
 * Primeiro ecrã que um utilizador vê depois de iniciar sessão. Tem duas
 * partes: o cabeçalho comum às páginas autenticadas (nome da aplicação e
 * botão de terminar sessão — ver Cabecalho.tsx) e uma zona de conteúdo.
 *
 * Nesta fase, o conteúdo apenas identifica quem está autenticado; as
 * funcionalidades da aplicação (contas, movimentos, categorias) serão
 * acrescentadas aqui mais tarde.
 *
 * Esta página está sempre dentro de <RotaProtegida> (ver src/App.tsx),
 * por isso só é renderizada quando existe uma sessão válida; o objecto do
 * utilizador está sempre preenchido quando este componente aparece.
 */

import { useAuth } from '../auth/useAuth'
import { Cabecalho } from '../componentes/Cabecalho'
import estilos from './Inicio.module.css'

export function Inicio() {
  const { utilizador } = useAuth()

  return (
    // O fragmento <>...</> agrupa o cabeçalho e o conteúdo sem acrescentar
    // um elemento extra à volta.
    <>
      <Cabecalho />

      <main className={estilos.conteudo}>
        {/* utilizador?.email: o "?." devolve undefined em vez de rebentar
            caso utilizador fosse null. Na prática nunca é, por esta página
            viver dentro de <RotaProtegida>, mas o TypeScript não tem essa
            garantia e esta forma satisfá-lo sem ramos extra. */}
        <p>Sessão iniciada como {utilizador?.email}.</p>
      </main>
    </>
  )
}
