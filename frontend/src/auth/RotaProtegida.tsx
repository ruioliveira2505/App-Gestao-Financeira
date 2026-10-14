/*
 * RotaProtegida — GUARDA DE ACESSO A UMA ROTA
 * ===========================================
 *
 * Componente que envolve o conteúdo de uma rota que só deve estar
 * acessível a um utilizador com sessão iniciada. Decide o que mostrar
 * consoante o estado de autenticação (lido do contexto, via useAuth):
 *
 *   - 'a-carregar': a verificação inicial de sessão ainda decorre (o
 *     pedido a GET /auth/me feito pelo AuthProvider ao arrancar). Mostra
 *     um indicador de espera. É importante NÃO redirecionar já para o
 *     ecrã de início de sessão neste estado — ainda não se sabe se há
 *     sessão, e um utilizador autenticado que recarregue a página veria
 *     um salto indevido para /login.
 *
 *   - 'anonimo': não há sessão. Redireciona para /login, a dizer de onde
 *     vem ("de") para se voltar lá depois de entrar — exceto depois de
 *     terminar a sessão de propósito, quando se começa do zero — e, se a
 *     sessão terminou a meio, que foi isso que aconteceu
 *     ("sessaoTerminou"), para o login o explicar.
 *
 *   - 'autenticado': mostra o conteúdo protegido.
 *
 * Uso:
 *
 *   <RotaProtegida>
 *     <PaginaInicial />
 *   </RotaProtegida>
 */

import type { ReactNode } from 'react'

// Navigate é um componente do React Router: quando é renderizado, provoca
// uma navegação para a rota indicada, sem que o utilizador clique em nada.
import { Navigate, useLocation } from 'react-router-dom'

import { useAuth } from './useAuth'

export function RotaProtegida({ children }: { children: ReactNode }) {
  const { estado, motivoSemSessao } = useAuth()
  const localizacao = useLocation()

  if (estado === 'a-carregar') {
    return <p>A carregar…</p>
  }

  if (estado === 'anonimo') {
    // replace: substitui a entrada atual no histórico do browser em vez
    // de acrescentar uma nova — assim, o botão "retroceder" não traz o
    // utilizador de volta a uma rota protegida a que não tem acesso.
    // Depois de um logout voluntário não se guarda a página: quem entrar a
    // seguir (talvez outra pessoa) começa do início.
    const estadoNavegacao =
      motivoSemSessao === 'logout'
        ? undefined
        : {
            de: `${localizacao.pathname}${localizacao.search}${localizacao.hash}`,
            sessaoTerminou: motivoSemSessao === 'expirou',
          }
    return <Navigate to="/login" replace state={estadoNavegacao} />
  }

  // estado === 'autenticado'. O fragmento <>...</> permite devolver os
  // filhos sem acrescentar um elemento extra à volta.
  return <>{children}</>
}
