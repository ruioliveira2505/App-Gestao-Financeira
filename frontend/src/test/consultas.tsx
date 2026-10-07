/*
 * ComConsultas — A CACHE DE DADOS DO SERVIDOR, NOS TESTES
 * =======================================================
 *
 * Na app, a cache dos dados do servidor (TanStack Query — ver
 * lib/consultas.ts) é dada a toda a árvore em main.tsx. Um teste que monta
 * uma página sozinha tem de a dar ele próprio — é o que faz este
 * componente, a pôr à volta do que se monta:
 *
 *   render(<ComConsultas><AuthProvider>…</AuthProvider></ComConsultas>)
 *
 * Cada montagem cria uma cache NOVA (um teste nunca vê dados que outro
 * teste deixou na cache), e sem repetir pedidos falhados (um teste de erro
 * vê o erro logo).
 */

import { QueryClientProvider } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'

import { criarClienteConsultas } from '../lib/consultas'

export function ComConsultas({ children }: { children: ReactNode }) {
  // "useState" com função: o cliente é criado uma só vez por montagem.
  const [cliente] = useState(() => criarClienteConsultas({ testes: true }))
  return <QueryClientProvider client={cliente}>{children}</QueryClientProvider>
}
