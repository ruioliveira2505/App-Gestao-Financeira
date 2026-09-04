/*
 * TESTES DA MOLDURA E DAS ROTAS DA APLICAÇÃO
 * =========================================
 *
 * Montam o componente App inteiro dentro de um AuthProvider e de um router
 * de teste (MemoryRouter). O MSW controla a resposta de GET /auth/me, o
 * que decide se há sessão. Verifica-se a barra lateral (desktop), a barra
 * de topo e o menu ☰ a ecrã inteiro (mobile), a navegação, o terminar
 * sessão e o reencaminhamento de quem não tem sessão.
 */

import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router-dom'

import { servidorMsw } from './test/servidor-msw'
import { definirEcraMobile } from './test/setup'
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
  it('mostra a barra lateral e a página Início quando há sessão', async () => {
    servidorMsw.use(http.get('/api/auth/me', () => HttpResponse.json(UTILIZADOR)))

    montar('/')

    expect(
      await screen.findByText(/Em breve: a análise das tuas contas/),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Início' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Movimentos' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Contas' })).toBeInTheDocument()
    // A zona de perfil é uma ligação para /perfil, com o nome derivado do
    // email (parte antes do "@") como nome acessível.
    expect(screen.getByRole('link', { name: 'ana' })).toBeInTheDocument()
  })

  it('navega para Contas ao clicar no item da barra lateral', async () => {
    servidorMsw.use(
      http.get('/api/auth/me', () => HttpResponse.json(UTILIZADOR)),
      http.get('/api/contas', () => HttpResponse.json([])),
    )
    montar('/')
    await screen.findByRole('link', { name: 'Contas' })

    await userEvent.click(screen.getByRole('link', { name: 'Contas' }))

    // A página de Contas — sem contas ainda — mostra o estado vazio.
    expect(await screen.findByText('Ainda não tens contas.')).toBeInTheDocument()
  })

  it('abre o Perfil ao clicar na zona de perfil da barra lateral', async () => {
    servidorMsw.use(http.get('/api/auth/me', () => HttpResponse.json(UTILIZADOR)))
    montar('/')

    // A zona de perfil tem o nome ("ana") como nome acessível (o avatar
    // está marcado aria-hidden) e leva direto à página de Perfil — sem
    // menu suspenso pelo meio.
    await userEvent.click(await screen.findByRole('link', { name: 'ana' }))

    expect(await screen.findByRole('heading', { name: 'Perfil' })).toBeInTheDocument()
    // O email completo aparece na página.
    expect(screen.getByText('ana@exemplo.pt')).toBeInTheDocument()
  })

  it('a página de Perfil lista as secções e cada uma abre o seu sub-ecrã', async () => {
    servidorMsw.use(http.get('/api/auth/me', () => HttpResponse.json(UTILIZADOR)))
    montar('/perfil')

    await screen.findByRole('heading', { name: 'Perfil' })
    // A lista de secções tem o seu próprio <nav aria-label="Definições">,
    // para não colidir com o item "Contas" da navegação.
    const definicoes = () => within(screen.getByRole('navigation', { name: 'Definições' }))
    expect(definicoes().getByRole('link', { name: /Conta/ })).toBeInTheDocument()
    expect(definicoes().getByRole('link', { name: /Segurança/ })).toBeInTheDocument()
    expect(definicoes().getByRole('link', { name: /Preferências/ })).toBeInTheDocument()
    expect(screen.getByText('Tema da aplicação')).toBeInTheDocument()

    // Entrar numa secção leva ao sub-ecrã (marcador "Em breve" por agora).
    await userEvent.click(definicoes().getByRole('link', { name: /Segurança/ }))
    expect(
      await screen.findByRole('heading', { name: 'Segurança' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Em breve.')).toBeInTheDocument()
  })

  it('termina a sessão na página de Perfil (a partir da barra lateral)', async () => {
    let logoutChamado = false
    servidorMsw.use(
      http.get('/api/auth/me', () => HttpResponse.json(UTILIZADOR)),
      http.post('/api/auth/logout', () => {
        logoutChamado = true
        return new HttpResponse(null, { status: 204 })
      }),
    )
    montar('/')

    await userEvent.click(await screen.findByRole('link', { name: 'ana' }))
    await screen.findByRole('heading', { name: 'Perfil' })
    await userEvent.click(screen.getByRole('button', { name: 'Terminar sessão' }))

    expect(await screen.findByRole('heading', { name: 'Iniciar sessão' })).toBeInTheDocument()
    expect(logoutChamado).toBe(true)
  })

  it('em mobile, o menu ☰ navega entre secções; o Perfil abre a partir do menu', async () => {
    definirEcraMobile(true)
    let logoutChamado = false
    servidorMsw.use(
      http.get('/api/auth/me', () => HttpResponse.json(UTILIZADOR)),
      http.get('/api/contas', () => HttpResponse.json([])),
      http.post('/api/auth/logout', () => {
        logoutChamado = true
        return new HttpResponse(null, { status: 204 })
      }),
    )
    montar('/')
    await screen.findByText(/Em breve: a análise das tuas contas/)

    const abrir = () => userEvent.click(screen.getByRole('button', { name: 'Abrir menu' }))
    const menu = () => screen.getByRole('dialog', { name: 'Menu de navegação' })
    // O menu fecha com uma animação de saída — só depois desmonta. Espera
    // que saia do DOM antes de o reabrir (senão haveria dois diálogos).
    const esperarMenuFechado = () =>
      waitFor(() =>
        expect(
          screen.queryByRole('dialog', { name: 'Menu de navegação' }),
        ).not.toBeInTheDocument(),
      )

    // Começa fechado.
    expect(
      screen.queryByRole('dialog', { name: 'Menu de navegação' }),
    ).not.toBeInTheDocument()

    // Abre pelo ☰: o cabeçalho tem o nome da app. Navega para Contas; ao
    // navegar, o menu fecha-se.
    await abrir()
    expect(within(menu()).getByText('Gestão Financeira')).toBeInTheDocument()
    await userEvent.click(within(menu()).getByRole('link', { name: 'Contas' }))
    expect(await screen.findByText('Ainda não tens contas.')).toBeInTheDocument()
    await esperarMenuFechado()

    // Reabre e vai a Perfil pela zona de perfil no fundo (o avatar + nome
    // — nome acessível "ana"). O menu não tem "Terminar sessão".
    await abrir()
    expect(
      within(menu()).queryByRole('button', { name: 'Terminar sessão' }),
    ).not.toBeInTheDocument()
    await userEvent.click(within(menu()).getByRole('link', { name: 'ana' }))
    await esperarMenuFechado()
    expect(await screen.findByRole('heading', { name: 'Perfil' })).toBeInTheDocument()

    // É na página de Perfil que se termina a sessão.
    await userEvent.click(screen.getByRole('button', { name: 'Terminar sessão' }))
    expect(await screen.findByRole('heading', { name: 'Iniciar sessão' })).toBeInTheDocument()
    expect(logoutChamado).toBe(true)
  })

  it('em mobile, o menu ☰ navega entre Início e Movimentos', async () => {
    definirEcraMobile(true)
    servidorMsw.use(
      http.get('/api/auth/me', () => HttpResponse.json(UTILIZADOR)),
      http.get('/api/contas', () => HttpResponse.json([])),
    )
    montar('/contas')
    await screen.findByText('Ainda não tens contas.')

    const menu = () => screen.getByRole('dialog', { name: 'Menu de navegação' })
    const esperarMenuFechado = () =>
      waitFor(() =>
        expect(
          screen.queryByRole('dialog', { name: 'Menu de navegação' }),
        ).not.toBeInTheDocument(),
      )

    // Toda a navegação entre secções é pelo menu ☰.
    await userEvent.click(screen.getByRole('button', { name: 'Abrir menu' }))
    await userEvent.click(within(menu()).getByRole('link', { name: 'Movimentos' }))
    expect(await screen.findByText(/Em breve: os teus movimentos/)).toBeInTheDocument()
    await esperarMenuFechado()

    await userEvent.click(screen.getByRole('button', { name: 'Abrir menu' }))
    await userEvent.click(within(menu()).getByRole('link', { name: 'Início' }))
    expect(await screen.findByText(/Em breve: a análise das tuas contas/)).toBeInTheDocument()
  })

  it('em mobile, a barra de topo mostra ☰, o título e a ação ("+") nas páginas principais', async () => {
    definirEcraMobile(true)
    servidorMsw.use(
      http.get('/api/auth/me', () => HttpResponse.json(UTILIZADOR)),
      http.get('/api/contas', () =>
        HttpResponse.json([
          {
            id: 'a',
            nome: 'À ordem',
            banco: 'BPI',
            tipo: 'Conta corrente',
            moeda: 'EUR',
            data_ancora: '2026-01-01',
            saldo_ancora: '100.00',
            saldo: '100.00',
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        ]),
      ),
    )
    montar('/contas')

    // Página principal: à esquerda o ☰ (para abrir o menu), não "Voltar".
    expect(await screen.findByRole('button', { name: 'Abrir menu' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Voltar' })).not.toBeInTheDocument()
    // A ação "+" da barra de topo leva à criação de uma conta (só aparece
    // depois de as contas carregarem).
    expect(await screen.findByRole('link', { name: 'Nova conta' })).toHaveAttribute(
      'href',
      '/contas/nova',
    )
  })

  it('em mobile, o «X» do modal "Nova conta" recua no histórico', async () => {
    definirEcraMobile(true)
    servidorMsw.use(
      http.get('/api/auth/me', () => HttpResponse.json(UTILIZADOR)),
      http.get('/api/contas', () =>
        HttpResponse.json([
          {
            id: 'a',
            nome: 'À ordem',
            banco: 'BPI',
            tipo: 'Conta corrente',
            moeda: 'EUR',
            data_ancora: '2026-01-01',
            saldo_ancora: '100.00',
            saldo: '100.00',
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        ]),
      ),
    )
    montar('/contas')

    // /contas → /contas/nova pelo "+".
    await userEvent.click(await screen.findByRole('link', { name: 'Nova conta' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Fechar' }))

    // Recuou no histórico: está de novo na lista, com a conta visível.
    expect(await screen.findByText('À ordem')).toBeInTheDocument()
  })

  it('em mobile, o «X» do modal usa o caminho de recurso quando aberto direto pelo URL', async () => {
    definirEcraMobile(true)
    servidorMsw.use(
      http.get('/api/auth/me', () => HttpResponse.json(UTILIZADOR)),
      http.get('/api/contas', () => HttpResponse.json([])),
    )
    // Entrada direta em /contas/nova — não há histórico dentro da app.
    montar('/contas/nova')

    await userEvent.click(await screen.findByRole('button', { name: 'Fechar' }))

    // Sem histórico, o "X" foi para "/contas" como recurso.
    expect(await screen.findByText('Ainda não tens contas.')).toBeInTheDocument()
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
