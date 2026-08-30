/*
 * TESTES DO AuthProvider E DO HOOK useAuth
 * ========================================
 *
 * A estratégia é montar um componente-sonda mínimo (definido no fim deste
 * ficheiro) que apenas mostra no ecrã o estado de autenticação atual e o
 * email do utilizador, e tem três botões que chamam login, logout e
 * registar. Envolvendo essa sonda num <AuthProvider> e controlando as
 * respostas da API com o MSW, verifica-se cada transição de estado
 * observando o que a sonda mostra.
 */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'

import { servidorMsw } from '../test/servidor-msw'
import { AuthProvider } from './AuthProvider'
import { useAuth } from './useAuth'

const UTILIZADOR = { id: '11111111-1111-1111-1111-111111111111', email: 'ana@exemplo.pt' }
const UTILIZADOR_NOVO = { id: '22222222-2222-2222-2222-222222222222', email: 'nova@exemplo.pt' }

// Fábrica de respostas para "não há sessão": é o que o backend devolve em
// GET /auth/me sem cookie válido. Tem de ser uma função que devolve uma
// resposta nova a cada chamada — o corpo de uma resposta HTTP só pode ser
// lido uma vez, por isso reutilizar a mesma instância entre pedidos dá
// erro.
const semSessao = () =>
  HttpResponse.json({ detail: 'Sessão inválida ou expirada.' }, { status: 401 })

describe('AuthProvider', () => {
  it('arranca em "a-carregar" e passa a "autenticado" quando já existe sessão', async () => {
    servidorMsw.use(http.get('/api/auth/me', () => HttpResponse.json(UTILIZADOR)))

    render(
      <AuthProvider>
        <Sonda />
      </AuthProvider>,
    )

    // Antes de a verificação inicial terminar, o estado é 'a-carregar'.
    expect(screen.getByText('estado: a-carregar')).toBeInTheDocument()

    // Depois de GET /auth/me responder, passa a 'autenticado'.
    expect(await screen.findByText('estado: autenticado')).toBeInTheDocument()
    expect(screen.getByText('utilizador: ana@exemplo.pt')).toBeInTheDocument()
  })

  it('passa a "anonimo" quando não existe sessão', async () => {
    servidorMsw.use(http.get('/api/auth/me', semSessao))

    render(
      <AuthProvider>
        <Sonda />
      </AuthProvider>,
    )

    expect(await screen.findByText('estado: anonimo')).toBeInTheDocument()
    expect(screen.getByText('utilizador: nenhum')).toBeInTheDocument()
  })

  it('login() faz a aplicação passar de "anonimo" a "autenticado"', async () => {
    servidorMsw.use(
      http.get('/api/auth/me', semSessao),
      http.post('/api/auth/login', () => HttpResponse.json(UTILIZADOR)),
    )

    render(
      <AuthProvider>
        <Sonda />
      </AuthProvider>,
    )
    await screen.findByText('estado: anonimo')

    await userEvent.click(screen.getByRole('button', { name: 'entrar' }))

    expect(await screen.findByText('estado: autenticado')).toBeInTheDocument()
    expect(screen.getByText('utilizador: ana@exemplo.pt')).toBeInTheDocument()
  })

  it('logout() faz a aplicação voltar a "anonimo"', async () => {
    servidorMsw.use(
      http.get('/api/auth/me', () => HttpResponse.json(UTILIZADOR)),
      http.post('/api/auth/logout', () => new HttpResponse(null, { status: 204 })),
    )

    render(
      <AuthProvider>
        <Sonda />
      </AuthProvider>,
    )
    await screen.findByText('estado: autenticado')

    await userEvent.click(screen.getByRole('button', { name: 'sair' }))

    expect(await screen.findByText('estado: anonimo')).toBeInTheDocument()
    expect(screen.getByText('utilizador: nenhum')).toBeInTheDocument()
  })

  it('registar() cria a conta, inicia a sessão e fica "autenticado"', async () => {
    servidorMsw.use(
      http.get('/api/auth/me', semSessao),
      http.post('/api/auth/registo', () => HttpResponse.json(UTILIZADOR_NOVO, { status: 201 })),
      http.post('/api/auth/login', () => HttpResponse.json(UTILIZADOR_NOVO)),
    )

    render(
      <AuthProvider>
        <Sonda />
      </AuthProvider>,
    )
    await screen.findByText('estado: anonimo')

    await userEvent.click(screen.getByRole('button', { name: 'criar' }))

    expect(await screen.findByText('estado: autenticado')).toBeInTheDocument()
    expect(screen.getByText('utilizador: nova@exemplo.pt')).toBeInTheDocument()
  })
})

describe('useAuth', () => {
  it('lança um erro explicativo quando usado fora do AuthProvider', () => {
    // Ao renderizar um componente que rebenta, o React imprime o erro na
    // consola. Silencia-se essa saída durante este teste, para o resultado
    // ficar legível — o que interessa é a exceção, verificada a seguir.
    const consolaErro = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => render(<Sonda />)).toThrow('useAuth tem de ser usado dentro de <AuthProvider>.')

    consolaErro.mockRestore()
  })
})

/**
 * Componente-sonda: não faz parte da aplicação, existe só para estes
 * testes. Mostra o estado e o utilizador atuais e oferece um botão para
 * cada ação do contexto.
 */
function Sonda() {
  const { estado, utilizador, login, logout, registar } = useAuth()

  return (
    <div>
      <p>estado: {estado}</p>
      <p>utilizador: {utilizador?.email ?? 'nenhum'}</p>
      {/* void ... : as funções devolvem uma promessa que aqui não é
          aguardada; o "void" deixa essa intenção explícita e evita um
          aviso do linter. */}
      <button onClick={() => void login('ana@exemplo.pt', 'password-longa')}>entrar</button>
      <button onClick={() => void logout()}>sair</button>
      <button onClick={() => void registar('nova@exemplo.pt', 'password-longa')}>criar</button>
    </div>
  )
}
