/*
 * TESTES DA PÁGINA PERFIL
 * =======================
 *
 * Monta a página dentro de um AuthProvider real e de um router de teste,
 * com o MSW a controlar GET /auth/me (para a identidade) e
 * POST /auth/logout (para "Terminar sessão"). O caminho feliz do "Terminar
 * sessão" (fecha a sessão e navega para /login) já está coberto
 * indiretamente em App.test.tsx, a partir da navegação real (barra
 * lateral/menu ☰); aqui cobre-se o que é próprio deste componente: a
 * lista de secções, e o que acontece EM TORNO da chamada a logout() — o
 * estado "a processar" (botão desativado, texto trocado) e a proteção
 * contra um duplo clique.
 */

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { delay, http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

import { servidorMsw } from '../test/servidor-msw'
import { AuthProvider } from '../auth/AuthProvider'
import { Perfil } from './Perfil'

const UTILIZADOR = { id: '11111111-1111-1111-1111-111111111111', email: 'ana@exemplo.pt' }

function montar() {
  servidorMsw.use(http.get('/api/auth/me', () => HttpResponse.json(UTILIZADOR)))
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={['/perfil']}>
        <Routes>
          <Route path="/perfil" element={<Perfil />} />
          <Route path="/login" element={<p>Iniciar sessão</p>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  )
}

describe('Página Perfil', () => {
  it('mostra a identidade e a lista de secções', async () => {
    montar()

    expect(await screen.findByText('ana')).toBeInTheDocument()
    expect(screen.getByText('ana@exemplo.pt')).toBeInTheDocument()

    expect(screen.getByRole('link', { name: /Conta/ })).toHaveAttribute('href', '/perfil/conta')
    expect(screen.getByRole('link', { name: /Segurança/ })).toHaveAttribute(
      'href',
      '/perfil/seguranca',
    )
    expect(screen.getByRole('link', { name: /Preferências/ })).toHaveAttribute(
      'href',
      '/perfil/preferencias',
    )
    // Categorias, ao contrário das outras três, leva à página REAL — não a
    // um sub-ecrã de "Em breve" (ver a nota no topo de Perfil.tsx).
    expect(screen.getByRole('link', { name: /Categorias/ })).toHaveAttribute(
      'href',
      '/categorias',
    )
  })

  it('ao terminar sessão, o botão fica desativado com "A terminar…" até o pedido responder', async () => {
    servidorMsw.use(
      http.post('/api/auth/logout', async () => {
        await delay()
        return new HttpResponse(null, { status: 204 })
      }),
    )
    montar()

    const botao = await screen.findByRole('button', { name: 'Terminar sessão' })
    await userEvent.click(botao)

    expect(await screen.findByRole('button', { name: 'A terminar…' })).toBeDisabled()
    expect(await screen.findByText('Iniciar sessão')).toBeInTheDocument()
  })

  it('clicar duas vezes seguidas em "Terminar sessão" só chama logout uma vez', async () => {
    // Regressão: sem a guarda "if (aSair) return", um duplo clique (ou um
    // duplo toque, fácil de acontecer em mobile) enquanto o primeiro
    // pedido ainda está em curso dispararia um segundo POST /auth/logout
    // redundante.
    let chamadas = 0
    servidorMsw.use(
      http.post('/api/auth/logout', async () => {
        chamadas += 1
        await delay()
        return new HttpResponse(null, { status: 204 })
      }),
    )
    montar()

    const botao = await screen.findByRole('button', { name: 'Terminar sessão' })
    await userEvent.click(botao)
    // Ainda a processar o primeiro clique — o botão já está desativado, mas
    // testa-se aqui diretamente a função (via clique) e não só o "disabled"
    // do HTML, que por si só já impediria um clique real do rato.
    await userEvent.click(botao)

    await screen.findByText('Iniciar sessão')
    expect(chamadas).toBe(1)
  })

  it('se o pedido de logout falhar, reativa o botão para se poder tentar de novo', async () => {
    servidorMsw.use(
      http.post('/api/auth/logout', () =>
        HttpResponse.json({ detail: 'Falha de rede.' }, { status: 500 }),
      ),
    )
    montar()

    const botao = await screen.findByRole('button', { name: 'Terminar sessão' })
    await userEvent.click(botao)

    await waitFor(() => expect(botao).toBeEnabled())
    expect(botao).toHaveTextContent('Terminar sessão')
    // Continua na página de Perfil — não houve navegação para /login.
    expect(screen.queryByText('Iniciar sessão')).not.toBeInTheDocument()
  })
})
