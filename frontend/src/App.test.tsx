/*
 * TESTES DA MOLDURA E DAS ROTAS DA APLICAÇÃO
 * =========================================
 *
 * Montam o componente App inteiro dentro de um AuthProvider e de um router
 * de teste (MemoryRouter). O MSW controla a resposta de GET /auth/me, o
 * que decide se há sessão. Verifica-se a barra lateral, a navegação entre
 * secções, o terminar sessão, a gaveta em ecrã estreito e o
 * reencaminhamento de quem não tem sessão.
 */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router-dom'

import { servidorMsw } from './test/servidor-msw'
import { AuthProvider } from './auth/AuthProvider'
import App from './App'

const UTILIZADOR = { id: '11111111-1111-1111-1111-111111111111', email: 'ana@exemplo.pt' }
const semSessao = () =>
  HttpResponse.json({ detail: 'Sessão inválida ou expirada.' }, { status: 401 })

function montar(rotaInicial = '/') {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[rotaInicial]}>
        <App />
      </MemoryRouter>
    </AuthProvider>,
  )
}

// A preferência de barra recolhida é guardada no localStorage; limpa-se
// entre testes para um não influenciar o seguinte.
afterEach(() => {
  localStorage.clear()
})

describe('Moldura da aplicação', () => {
  it('mostra a barra lateral e a página Resumo quando há sessão', async () => {
    servidorMsw.use(http.get('/api/auth/me', () => HttpResponse.json(UTILIZADOR)))

    montar('/')

    expect(
      await screen.findByText('Em breve: o teu património e a atividade recente das contas.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Resumo' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Contas' })).toBeInTheDocument()
    // A zona de perfil mostra o nome derivado do email (parte antes do "@").
    expect(screen.getByRole('button', { name: 'ana' })).toBeInTheDocument()
  })

  it('navega para Contas ao clicar no item da barra lateral', async () => {
    servidorMsw.use(http.get('/api/auth/me', () => HttpResponse.json(UTILIZADOR)))
    montar('/')
    await screen.findByRole('link', { name: 'Contas' })

    await userEvent.click(screen.getByRole('link', { name: 'Contas' }))

    expect(
      await screen.findByText('Em breve: as tuas contas e o saldo de cada uma.'),
    ).toBeInTheDocument()
  })

  it('termina a sessão pelo menu do perfil na barra lateral', async () => {
    let logoutChamado = false
    servidorMsw.use(
      http.get('/api/auth/me', () => HttpResponse.json(UTILIZADOR)),
      http.post('/api/auth/logout', () => {
        logoutChamado = true
        return new HttpResponse(null, { status: 204 })
      }),
    )
    montar('/')

    // O gatilho do menu do perfil tem o nome ("ana") como nome acessível
    // (o avatar está marcado aria-hidden). Ao abrir, o email completo
    // aparece no cabeçalho do menu.
    await userEvent.click(await screen.findByRole('button', { name: 'ana' }))
    expect(screen.getByText('ana@exemplo.pt')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Terminar sessão' }))

    expect(await screen.findByRole('heading', { name: 'Iniciar sessão' })).toBeInTheDocument()
    expect(logoutChamado).toBe(true)
  })

  it('abre e fecha a gaveta pelo botão de menu; navegar também a fecha', async () => {
    servidorMsw.use(http.get('/api/auth/me', () => HttpResponse.json(UTILIZADOR)))
    montar('/')
    const botaoMenu = await screen.findByRole('button', { name: 'Abrir menu' })
    expect(botaoMenu).toHaveAttribute('aria-expanded', 'false')

    await userEvent.click(botaoMenu)
    expect(botaoMenu).toHaveAttribute('aria-expanded', 'true')
    expect(botaoMenu).toHaveAccessibleName('Fechar menu')

    await userEvent.click(botaoMenu)
    expect(botaoMenu).toHaveAttribute('aria-expanded', 'false')

    // Navegar num item também fecha a gaveta.
    await userEvent.click(botaoMenu)
    await userEvent.click(screen.getByRole('link', { name: 'Contas' }))
    expect(botaoMenu).toHaveAttribute('aria-expanded', 'false')
  })

  it('reencaminha para /login quem não tem sessão', async () => {
    servidorMsw.use(http.get('/api/auth/me', semSessao))

    montar('/contas')

    expect(await screen.findByRole('heading', { name: 'Iniciar sessão' })).toBeInTheDocument()
  })

  it('recolhe e expande a barra lateral, guardando a preferência', async () => {
    servidorMsw.use(http.get('/api/auth/me', () => HttpResponse.json(UTILIZADOR)))
    montar('/')

    await userEvent.click(await screen.findByRole('button', { name: 'Recolher menu' }))
    expect(screen.getByRole('button', { name: 'Expandir menu' })).toBeInTheDocument()
    expect(localStorage.getItem('barraLateralRecolhida')).toBe('true')

    await userEvent.click(screen.getByRole('button', { name: 'Expandir menu' }))
    expect(screen.getByRole('button', { name: 'Recolher menu' })).toBeInTheDocument()
    expect(localStorage.getItem('barraLateralRecolhida')).toBe('false')
  })

  it('arranca recolhida quando essa é a preferência guardada', async () => {
    localStorage.setItem('barraLateralRecolhida', 'true')
    servidorMsw.use(http.get('/api/auth/me', () => HttpResponse.json(UTILIZADOR)))

    montar('/')

    expect(await screen.findByRole('button', { name: 'Expandir menu' })).toBeInTheDocument()
  })
})
