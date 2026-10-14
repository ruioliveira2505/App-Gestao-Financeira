/*
 * TESTES DA SESSÃO TERMINADA A MEIO
 * =================================
 *
 * Quando a sessão termina enquanto a pessoa está na app, o primeiro pedido
 * autenticado devolve 401. Estes testes verificam o caminho todo: a app
 * sai para o login, o login explica o que aconteceu (um aviso que sai ao
 * fim de uns segundos), e, depois de entrar, volta-se à página onde se
 * estava. E os casos em que NÃO é «sessão terminada»: um 401 no próprio
 * login (password errada) e terminar a sessão de propósito.
 */

import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'

import { pedido } from '../lib/http'
import { Login } from '../paginas/Login'
import { servidorMsw } from '../test/servidor-msw'
import { AuthProvider } from './AuthProvider'
import { RotaProtegida } from './RotaProtegida'
import { useAuth } from './useAuth'

const UTILIZADOR = { id: 'u1', email: 'ana@exemplo.pt', moeda_principal: 'EUR' }
const SESSAO_INVALIDA = () => HttpResponse.json({ detail: 'Sessão inválida ou expirada.' }, { status: 401 })

// Uma página protegida com dois botões: um faz um pedido autenticado
// (que o teste faz falhar com 401) e outro termina a sessão.
function Pagina() {
  const { logout } = useAuth()
  const { pathname, search } = useLocation()
  return (
    <div>
      <p>página {pathname + search}</p>
      <button onClick={() => void pedido('/contas').catch(() => undefined)}>Pedir contas</button>
      <button onClick={() => void logout()}>Terminar sessão</button>
    </div>
  )
}

function montar(entrada: string) {
  servidorMsw.use(http.get('/api/auth/me', () => HttpResponse.json(UTILIZADOR)))
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[entrada]}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="*"
            element={
              <RotaProtegida>
                <Pagina />
              </RotaProtegida>
            }
          />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  )
}

async function entrar() {
  await userEvent.type(screen.getByLabelText('Email'), 'ana@exemplo.pt')
  await userEvent.type(screen.getByLabelText('Password'), 'password-segura')
  await userEvent.click(screen.getByRole('button', { name: 'Iniciar sessão' }))
}

describe('sessão terminada a meio', () => {
  it('um 401 leva ao login com o aviso, e depois de entrar volta à página onde se estava', async () => {
    servidorMsw.use(http.get('/api/contas', SESSAO_INVALIDA))
    montar('/contas/abc?ordem=nome')
    await screen.findByText('página /contas/abc?ordem=nome')

    await userEvent.click(screen.getByRole('button', { name: 'Pedir contas' }))

    // No login, com a explicação, numa região que o leitor de ecrã anuncia.
    expect(await screen.findByRole('heading', { name: 'Iniciar sessão' })).toBeInTheDocument()
    expect(within(screen.getByRole('status')).getByText('Sessão terminada · entra outra vez')).toBeInTheDocument()

    servidorMsw.use(http.post('/api/auth/login', () => HttpResponse.json(UTILIZADOR)))
    await entrar()

    // De volta onde estava, com a mesma pesquisa.
    expect(await screen.findByText('página /contas/abc?ordem=nome')).toBeInTheDocument()
  })

  it('vários pedidos a falhar ao mesmo tempo só provocam uma saída', async () => {
    servidorMsw.use(http.get('/api/contas', SESSAO_INVALIDA))
    montar('/contas')
    await screen.findByText('página /contas')

    // Dois pedidos seguidos, antes de a página mudar.
    const pedir = screen.getByRole('button', { name: 'Pedir contas' })
    await userEvent.click(pedir)
    await userEvent.click(pedir).catch(() => undefined)

    expect(await screen.findByRole('heading', { name: 'Iniciar sessão' })).toBeInTheDocument()
    expect(screen.getAllByText('Sessão terminada · entra outra vez')).toHaveLength(1)
  })

  it('a password errada (401 no próprio login) não é «sessão terminada»', async () => {
    servidorMsw.use(
      http.get('/api/auth/me', SESSAO_INVALIDA),
      http.post('/api/auth/login', () =>
        HttpResponse.json({ detail: 'Email ou password incorretos.' }, { status: 401 }),
      ),
    )
    render(
      <AuthProvider>
        <MemoryRouter initialEntries={['/login']}>
          <Routes>
            <Route path="/login" element={<Login />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>,
    )
    await screen.findByRole('heading', { name: 'Iniciar sessão' })

    await entrar()

    expect(await screen.findByText('Email ou password incorretos.')).toBeInTheDocument()
    expect(screen.queryByText('Sessão terminada · entra outra vez')).not.toBeInTheDocument()
  })

  it('terminar a sessão de propósito não mostra o aviso, nem guarda a página', async () => {
    servidorMsw.use(http.post('/api/auth/logout', () => new HttpResponse(null, { status: 204 })))
    montar('/contas/abc')
    await screen.findByText('página /contas/abc')

    await userEvent.click(screen.getByRole('button', { name: 'Terminar sessão' }))

    expect(await screen.findByRole('heading', { name: 'Iniciar sessão' })).toBeInTheDocument()
    expect(screen.queryByText('Sessão terminada · entra outra vez')).not.toBeInTheDocument()

    servidorMsw.use(http.post('/api/auth/login', () => HttpResponse.json(UTILIZADOR)))
    await entrar()

    // Começa do início: quem entra a seguir (talvez outra pessoa) não vai
    // parar à página da sessão anterior.
    await waitFor(() => expect(screen.getByText('página /')).toBeInTheDocument())
  })
})
