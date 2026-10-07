/*
 * TESTES DA PilhaDePaginas
 * ========================
 *
 * A promessa da pilha: a página de baixo ("fundo") NÃO é recriada quando
 * se abre uma página por cima dela, nem quando se volta — continua montada
 * (com o seu estado, o seu scroll, sem recarregar). Em telemóvel fica à
 * vista por baixo, mas inacessível ("inert"); em ecrã largo esconde-se.
 */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect } from 'react'
import { describe, expect, it } from 'vitest'
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom'

import { definirEcraMobile } from '../test/setup'
import { PaginaDeslizante } from './PaginaDeslizante'
import { PilhaDePaginas } from './PilhaDePaginas'

// Conta quantas vezes o fundo foi MONTADO — se a pilha o recriasse ao
// navegar, este número subia.
let montagens = 0

function Lista() {
  useEffect(() => {
    montagens += 1
  }, [])
  return (
    <div>
      <p>lista</p>
      <Link to="/coisas/1">abrir detalhe</Link>
    </div>
  )
}

function Detalhe() {
  return (
    <PaginaDeslizante>
      {() => (
        <div>
          <p>detalhe</p>
          <Link to="/coisas">voltar à lista</Link>
        </div>
      )}
    </PaginaDeslizante>
  )
}

function montar(entrada = '/coisas') {
  montagens = 0
  return render(
    <MemoryRouter initialEntries={[entrada]}>
      <Routes>
        <Route path="/coisas" element={<PilhaDePaginas fundo={<Lista />} />}>
          <Route index element={null} />
          <Route path=":id" element={<Detalhe />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

describe('PilhaDePaginas', () => {
  it('a página de baixo não é recriada ao abrir uma página por cima, nem ao voltar', async () => {
    definirEcraMobile(true)
    montar()
    expect(montagens).toBe(1)

    await userEvent.click(screen.getByRole('link', { name: 'abrir detalhe' }))
    expect(screen.getByText('detalhe')).toBeInTheDocument()
    // Continua lá, por baixo — a mesma montagem.
    expect(screen.getByText('lista')).toBeInTheDocument()
    expect(montagens).toBe(1)

    await userEvent.click(screen.getByRole('link', { name: 'voltar à lista' }))
    expect(screen.queryByText('detalhe')).not.toBeInTheDocument()
    expect(montagens).toBe(1)
  })

  it('em telemóvel, enquanto tapada, a página de baixo fica à vista mas inacessível', () => {
    definirEcraMobile(true)
    montar('/coisas/1')

    const fundo = screen.getByText('lista').closest('[inert]')
    expect(fundo).not.toBeNull()
    // À vista (não escondida) — o detalhe desliza POR CIMA dela. O
    // "inert" (verificado acima) é o que a tira do alcance do teclado e
    // dos leitores de ecrã num browser real; o jsdom destes testes ainda
    // não o aplica às consultas por papel, por isso não se testa aqui.
    expect(fundo).not.toHaveAttribute('hidden')
  })

  it('em ecrã largo, a página de baixo esconde-se enquanto outra está por cima', () => {
    montar('/coisas/1')

    expect(screen.getByText('lista').closest('[hidden]')).not.toBeNull()
    expect(screen.getByText('detalhe')).toBeInTheDocument()
  })
})
