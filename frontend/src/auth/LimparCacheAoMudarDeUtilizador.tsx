/*
 * LimparCacheAoMudarDeUtilizador — A CACHE NUNCA PASSA DE UM UTILIZADOR PARA OUTRO
 * ================================================================================
 *
 * A cache dos dados do servidor (TanStack Query — ver lib/consultas.ts)
 * vive enquanto a app está aberta no browser. Se o utilizador A terminar a
 * sessão e o utilizador B a iniciar no mesmo browser, sem recarregar a
 * página, a cache ainda teria as contas de A — e B podia vê-las por um
 * instante, até chegarem as suas. Para isso nunca acontecer, este
 * componente (que não desenha nada) observa QUEM está autenticado e, de
 * cada vez que muda (terminar sessão, ou entrar outra pessoa), esvazia a
 * cache inteira.
 *
 * Tem de estar DENTRO dos dois "fornecedores" (AuthProvider, de onde lê o
 * utilizador, e QueryClientProvider, de onde obtém a cache) — ver
 * main.tsx.
 */

import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, type ReactNode } from 'react'

import { useAuth } from './useAuth'

export function LimparCacheAoMudarDeUtilizador({ children }: { children: ReactNode }) {
  const { utilizador } = useAuth()
  const clienteConsultas = useQueryClient()
  // O id do utilizador da última vez — "undefined" antes da primeira
  // vez, para não esvaziar a cache só por a app ter arrancado.
  const anterior = useRef<string | null | undefined>(undefined)
  const atual = utilizador?.id ?? null

  useEffect(() => {
    if (anterior.current !== undefined && anterior.current !== atual) {
      clienteConsultas.clear()
    }
    anterior.current = atual
  }, [atual, clienteConsultas])

  return children
}
