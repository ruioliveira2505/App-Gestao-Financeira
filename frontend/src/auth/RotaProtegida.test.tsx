/*
 * TESTES DA RotaProtegida
 * =======================
 *
 * Monta a RotaProtegida dentro de um router de teste (MemoryRouter, que
 * guarda a "localização" em memória em vez de mexer no endereço real do
 * browser) e de um AuthProvider, controlando com o MSW a resposta de
 * GET /auth/me. Verifica o que fica visível em cada um dos três estados:
 * a carregar, sem sessão (redireciona) e com sessão (mostra o conteúdo).
 */

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

import { servidorMsw } from '../test/servidor-msw'
import { AuthProvider } from './AuthProvider'
import { RotaProtegida } from './RotaProtegida'

const UTILIZADOR = { id: '11111111-1111-1111-1111-111111111111', email: 'ana@exemplo.pt' }
const semSessao = () =>
  HttpResponse.json({ detail: 'Sessão inválida ou expirada.' }, { status: 401 })

// Monta a árvore de teste: AuthProvider por fora, router com duas rotas —
// "/" protegida, "/login" pública — a começar em "/".
function montar() {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/login" element={<p>ecrã de login</p>} />
          <Route
            path="/"
            element={
              <RotaProtegida>
                <p>conteúdo protegido</p>
              </RotaProtegida>
            }
          />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  )
}

describe('RotaProtegida', () => {
  it('mostra um indicador enquanto a sessão está a ser verificada', () => {
    servidorMsw.use(http.get('/api/auth/me', () => HttpResponse.json(UTILIZADOR)))

    montar()

    // Antes de a resposta de /auth/me chegar, o estado é 'a-carregar'.
    expect(screen.getByText('A carregar…')).toBeInTheDocument()
  })

  it('redireciona para /login quando não há sessão', async () => {
    servidorMsw.use(http.get('/api/auth/me', semSessao))

    montar()

    expect(await screen.findByText('ecrã de login')).toBeInTheDocument()
    expect(screen.queryByText('conteúdo protegido')).not.toBeInTheDocument()
  })

  it('mostra o conteúdo protegido quando há sessão', async () => {
    servidorMsw.use(http.get('/api/auth/me', () => HttpResponse.json(UTILIZADOR)))

    montar()

    expect(await screen.findByText('conteúdo protegido')).toBeInTheDocument()
    expect(screen.queryByText('ecrã de login')).not.toBeInTheDocument()
  })
})
