/*
 * Testes do LimparCacheAoMudarDeUtilizador: a cache dos dados do servidor
 * esvazia-se quando muda quem está autenticado (e só nessa altura).
 *
 * "useAuth" é substituído por uma versão falsa (vi.mock), para o teste
 * escolher directamente quem está autenticado em cada momento, sem passar
 * por login/logout.
 */

import { QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { CHAVES, criarClienteConsultas } from '../lib/consultas'
import { LimparCacheAoMudarDeUtilizador } from './LimparCacheAoMudarDeUtilizador'

let utilizadorAtual: { id: string } | null = null
vi.mock('./useAuth', () => ({ useAuth: () => ({ utilizador: utilizadorAtual }) }))

function arvore(cliente: ReturnType<typeof criarClienteConsultas>) {
  return (
    <QueryClientProvider client={cliente}>
      <LimparCacheAoMudarDeUtilizador>
        <p>app</p>
      </LimparCacheAoMudarDeUtilizador>
    </QueryClientProvider>
  )
}

describe('LimparCacheAoMudarDeUtilizador', () => {
  it('esvazia a cache quando entra outro utilizador — e não antes', () => {
    const cliente = criarClienteConsultas({ testes: true })
    utilizadorAtual = { id: 'ana' }
    const { rerender } = render(arvore(cliente))

    // A Ana tem as suas contas na cache.
    cliente.setQueryData(CHAVES.contas, [{ id: 'conta-da-ana' }])

    // Uma nova renderização com o MESMO utilizador não mexe na cache.
    rerender(arvore(cliente))
    expect(cliente.getQueryData(CHAVES.contas)).toEqual([{ id: 'conta-da-ana' }])

    // Sai a Ana, entra o Bruno: as contas da Ana desaparecem.
    utilizadorAtual = { id: 'bruno' }
    rerender(arvore(cliente))
    expect(cliente.getQueryData(CHAVES.contas)).toBeUndefined()
  })

  it('esvazia a cache ao terminar sessão', () => {
    const cliente = criarClienteConsultas({ testes: true })
    utilizadorAtual = { id: 'ana' }
    const { rerender } = render(arvore(cliente))
    cliente.setQueryData(CHAVES.contas, [{ id: 'conta-da-ana' }])

    utilizadorAtual = null
    rerender(arvore(cliente))
    expect(cliente.getQueryData(CHAVES.contas)).toBeUndefined()
  })
})
