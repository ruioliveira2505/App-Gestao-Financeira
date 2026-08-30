/*
 * TESTES DA PÁGINA INICIAL
 * ========================
 *
 * Monta a página dentro de um AuthProvider e de um router de teste. O MSW
 * responde a GET /auth/me com um utilizador (para o estado ficar
 * 'autenticado'). O comportamento do botão de terminar sessão é testado à
 * parte, em Cabecalho.test.tsx.
 */

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router-dom'

import { servidorMsw } from '../test/servidor-msw'
import { AuthProvider } from '../auth/AuthProvider'
import { Inicio } from './Inicio'

const UTILIZADOR = { id: '11111111-1111-1111-1111-111111111111', email: 'ana@exemplo.pt' }

describe('Página inicial', () => {
  it('identifica o utilizador com sessão iniciada', async () => {
    servidorMsw.use(http.get('/api/auth/me', () => HttpResponse.json(UTILIZADOR)))

    render(
      <AuthProvider>
        <MemoryRouter>
          <Inicio />
        </MemoryRouter>
      </AuthProvider>,
    )

    expect(await screen.findByText('Sessão iniciada como ana@exemplo.pt.')).toBeInTheDocument()
  })
})
