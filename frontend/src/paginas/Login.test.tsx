/*
 * TESTES DA PÁGINA DE INÍCIO DE SESSÃO
 * ====================================
 *
 * Monta a página dentro de um AuthProvider e de um router de teste
 * (MemoryRouter), com uma rota "/" de exemplo para onde a navegação
 * ocorre após um início de sessão bem-sucedido. O MSW controla as
 * respostas da API. Simula-se a escrita e o clique com o "user-event".
 */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

import { servidorMsw } from '../test/servidor-msw'
import { AuthProvider } from '../auth/AuthProvider'
import { Login } from './Login'

const UTILIZADOR = { id: '11111111-1111-1111-1111-111111111111', email: 'ana@exemplo.pt' }
const semSessao = () =>
  HttpResponse.json({ detail: 'Sessão inválida ou expirada.' }, { status: 401 })

function montar() {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<p>página inicial</p>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  )
}

describe('Página de início de sessão', () => {
  it('inicia a sessão e navega para a página inicial quando as credenciais estão certas', async () => {
    servidorMsw.use(
      http.get('/api/auth/me', semSessao),
      http.post('/api/auth/login', () => HttpResponse.json(UTILIZADOR)),
    )
    montar()

    await userEvent.type(screen.getByLabelText('Email'), 'ana@exemplo.pt')
    await userEvent.type(screen.getByLabelText('Password'), 'password-longa')
    await userEvent.click(screen.getByRole('button', { name: 'Iniciar sessão' }))

    expect(await screen.findByText('página inicial')).toBeInTheDocument()
  })

  it('mostra a mensagem de erro quando as credenciais estão erradas', async () => {
    servidorMsw.use(
      http.get('/api/auth/me', semSessao),
      http.post('/api/auth/login', () =>
        HttpResponse.json({ detail: 'Email ou password incorretos.' }, { status: 401 }),
      ),
    )
    montar()

    await userEvent.type(screen.getByLabelText('Email'), 'ana@exemplo.pt')
    await userEvent.type(screen.getByLabelText('Password'), 'password-errada')
    await userEvent.click(screen.getByRole('button', { name: 'Iniciar sessão' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Email ou password incorretos.')
    expect(screen.queryByText('página inicial')).not.toBeInTheDocument()
  })
})
