/*
 * TESTES DA PÁGINA DE REGISTO
 * ===========================
 *
 * Monta a página dentro de um AuthProvider e de um router de teste
 * (MemoryRouter), com uma rota "/" de exemplo para onde a navegação
 * ocorre após um registo bem-sucedido. O MSW controla as respostas da
 * API. Simula-se a escrita nos campos e o clique no botão com o
 * "user-event", que reproduz interações reais do utilizador.
 */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

import { servidorMsw } from '../test/servidor-msw'
import { AuthProvider } from '../auth/AuthProvider'
import { Registo } from './Registo'

const UTILIZADOR = { id: '11111111-1111-1111-1111-111111111111', email: 'ana@exemplo.pt' }
const semSessao = () =>
  HttpResponse.json({ detail: 'Sessão inválida ou expirada.' }, { status: 401 })

function montar() {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={['/registo']}>
        <Routes>
          <Route path="/registo" element={<Registo />} />
          <Route path="/" element={<p>página inicial</p>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  )
}

describe('Página de registo', () => {
  it('cria a conta e navega para a página inicial quando o registo tem sucesso', async () => {
    servidorMsw.use(
      http.get('/api/auth/me', semSessao),
      http.post('/api/auth/registo', () => HttpResponse.json(UTILIZADOR, { status: 201 })),
      http.post('/api/auth/login', () => HttpResponse.json(UTILIZADOR)),
    )
    montar()

    await userEvent.type(screen.getByLabelText('Email'), 'ana@exemplo.pt')
    await userEvent.type(screen.getByLabelText('Password'), 'password-longa')
    await userEvent.click(screen.getByRole('button', { name: 'Criar conta' }))

    expect(await screen.findByText('página inicial')).toBeInTheDocument()
  })

  it('mostra a mensagem do servidor quando o email já está registado', async () => {
    servidorMsw.use(
      http.get('/api/auth/me', semSessao),
      http.post('/api/auth/registo', () =>
        HttpResponse.json(
          { detail: 'Já existe uma conta registada com este email.' },
          { status: 409 },
        ),
      ),
    )
    montar()

    await userEvent.type(screen.getByLabelText('Email'), 'ana@exemplo.pt')
    await userEvent.type(screen.getByLabelText('Password'), 'password-longa')
    await userEvent.click(screen.getByRole('button', { name: 'Criar conta' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Já existe uma conta registada com este email.',
    )
    // Continua na página de registo — a navegação não aconteceu.
    expect(screen.queryByText('página inicial')).not.toBeInTheDocument()
  })

  it('bloqueia no cliente uma password com menos de 8 caracteres, sem contactar o servidor', async () => {
    const registoNoServidor = vi.fn()
    servidorMsw.use(
      http.get('/api/auth/me', semSessao),
      http.post('/api/auth/registo', () => {
        registoNoServidor()
        return HttpResponse.json(UTILIZADOR, { status: 201 })
      }),
    )
    montar()

    await userEvent.type(screen.getByLabelText('Email'), 'ana@exemplo.pt')
    await userEvent.type(screen.getByLabelText('Password'), 'curta')
    await userEvent.click(screen.getByRole('button', { name: 'Criar conta' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A password tem de ter pelo menos 8 caracteres.',
    )
    expect(registoNoServidor).not.toHaveBeenCalled()
  })
})
