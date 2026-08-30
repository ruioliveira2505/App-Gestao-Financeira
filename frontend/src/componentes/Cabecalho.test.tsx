/*
 * TESTES DO Cabecalho
 * ===================
 *
 * Monta o cabeçalho dentro de um AuthProvider e de um router de teste,
 * com uma rota "/login" de exemplo para onde a navegação ocorre depois de
 * terminar a sessão. O MSW responde a GET /auth/me com um utilizador e a
 * POST /auth/logout com 204.
 */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

import { servidorMsw } from '../test/servidor-msw'
import { AuthProvider } from '../auth/AuthProvider'
import { Cabecalho } from './Cabecalho'

const UTILIZADOR = { id: '11111111-1111-1111-1111-111111111111', email: 'ana@exemplo.pt' }

function montar() {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<Cabecalho />} />
          <Route path="/login" element={<p>ecrã de login</p>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  )
}

describe('Cabecalho', () => {
  it('mostra o nome da aplicação', async () => {
    servidorMsw.use(http.get('/api/auth/me', () => HttpResponse.json(UTILIZADOR)))

    montar()

    expect(await screen.findByText('App Gestão Financeira')).toBeInTheDocument()
  })

  it('termina a sessão e navega para /login ao clicar no botão', async () => {
    let logoutChamado = false
    servidorMsw.use(
      http.get('/api/auth/me', () => HttpResponse.json(UTILIZADOR)),
      http.post('/api/auth/logout', () => {
        logoutChamado = true
        return new HttpResponse(null, { status: 204 })
      }),
    )

    montar()

    await userEvent.click(await screen.findByRole('button', { name: 'Terminar sessão' }))

    expect(await screen.findByText('ecrã de login')).toBeInTheDocument()
    expect(logoutChamado).toBe(true)
  })
})
