/*
 * TESTES DE PerfilPreferencias
 * =============================
 *
 * Monta a página dentro de um AuthProvider real (autenticado por
 * GET /auth/me, tal como Perfil.test.tsx) e verifica: a moeda REAL do
 * utilizador aparece (não o alçapão "EUR" usado só enquanto "utilizador"
 * é null); escolher outra grava de imediato (PATCH /auth/me, sem botão
 * "Guardar" — ver a nota no topo de PerfilPreferencias.tsx); escolher a
 * já activa não faz pedido nenhum; "A atualizar…" aparece enquanto o
 * pedido está em curso; e uma falha do pedido não muda a moeda mostrada,
 * só aparece um erro.
 */

import { render as renderBase, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { delay, http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'

import { servidorMsw } from '../test/servidor-msw'
import { AuthProvider } from '../auth/AuthProvider'
import { PerfilPreferencias } from './PerfilPreferencias'
import { ComConsultas } from '../test/consultas'
import { CHAVES, criarClienteConsultas } from '../lib/consultas'

// Todas as montagens deste ficheiro levam a cache dos dados do servidor à
// volta (a app recebe-a em main.tsx; aqui, cada montagem tem uma nova).
// A página usa a cache para avisar que os saldos das contas mudaram;
// "wrapper" é a opção do Testing Library para envolver o que se monta num
// componente.
function render(ui: Parameters<typeof renderBase>[0]) {
  return renderBase(ui, { wrapper: ComConsultas })
}

// moeda_principal "USD" (não "EUR"): distingue mostrar o valor REAL vindo
// do servidor de mostrar o EUR do "utilizador ?? 'EUR'" (o alçapão para
// quando "utilizador" ainda é null) — com os dois em "EUR", nenhum teste
// conseguiria notar se esse alçapão fosse usado por engano em vez do
// valor a sério.
const UTILIZADOR = { id: '11111111-1111-1111-1111-111111111111', email: 'ana@exemplo.pt', moeda_principal: 'USD' }

function montar() {
  servidorMsw.use(http.get('/api/auth/me', () => HttpResponse.json(UTILIZADOR)))
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={['/perfil/preferencias']}>
        <Routes>
          <Route path="/perfil/preferencias" element={<PerfilPreferencias />} />
          <Route path="/perfil" element={<p>página de perfil</p>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  )
}

describe('PerfilPreferencias', () => {
  it('mostra a moeda principal REAL do utilizador, não o alçapão "EUR"', async () => {
    montar()

    expect(await screen.findByText(/Dólar americano/)).toBeInTheDocument()
    expect(screen.queryByText(/Euro/)).not.toBeInTheDocument()
  })

  it('escolher outra moeda grava de imediato, sem nenhum botão "Guardar"', async () => {
    let corpoRecebido: Record<string, unknown> | null = null
    servidorMsw.use(
      http.patch('/api/auth/me', async ({ request }) => {
        corpoRecebido = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({ ...UTILIZADOR, moeda_principal: 'EUR' })
      }),
    )
    montar()

    await userEvent.click(await screen.findByText(/Dólar americano/))
    await userEvent.click(screen.getByText(/Euro/))

    expect(corpoRecebido).toEqual({ moeda_principal: 'EUR' })
    // O valor mostrado no campo passa a refletir a nova moeda — só depois
    // de o servidor confirmar (o PATCH acima já respondeu).
    expect(await screen.findByText(/Euro/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Guardar/ })).not.toBeInTheDocument()
  })

  it('escolher a moeda já ativa não faz nenhum pedido ao servidor', async () => {
    let chamadas = 0
    servidorMsw.use(
      http.patch('/api/auth/me', () => {
        chamadas += 1
        return HttpResponse.json(UTILIZADOR)
      }),
    )
    montar()

    await userEvent.click(await screen.findByText(/Dólar americano/))
    // A lista abre com a moeda actual já marcada — escolhê-la de novo é o
    // mesmo toque que fecharia um seletor nativo sem mudar nada. Com a
    // lista aberta, "Dólar americano" aparece duas vezes (o campo já
    // escolhido + a opção na lista) — a última é sempre a opção, nunca o
    // campo (que vem antes dela no DOM).
    const opcoes = screen.getAllByText(/Dólar americano/)
    await userEvent.click(opcoes[opcoes.length - 1])

    expect(chamadas).toBe(0)
  })

  it('mostra "A atualizar…" enquanto o pedido está em curso', async () => {
    servidorMsw.use(
      http.patch('/api/auth/me', async () => {
        // Um valor explícito (não delay() sozinho, cujo atraso "realista"
        // por omissão é curto e, sob carga — muitos ficheiros de teste em
        // paralelo —, tornava esta asserção instável): garante uma janela
        // mínima para "A atualizar…" ser observável antes do pedido responder.
        await delay(50)
        return HttpResponse.json({ ...UTILIZADOR, moeda_principal: 'EUR' })
      }),
    )
    montar()

    await userEvent.click(await screen.findByText(/Dólar americano/))
    await userEvent.click(screen.getByText(/Euro/))

    expect(await screen.findByText('A atualizar…')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('A atualizar…')).not.toBeInTheDocument())
  })

  it('se o pedido falhar, a moeda mostrada não muda e aparece um erro', async () => {
    servidorMsw.use(
      http.patch('/api/auth/me', () =>
        HttpResponse.json({ detail: 'Falha de rede.' }, { status: 500 }),
      ),
    )
    montar()

    await userEvent.click(await screen.findByText(/Dólar americano/))
    await userEvent.click(screen.getByText(/Euro/))

    expect(await screen.findByText('Falha de rede.')).toBeInTheDocument()
    // Continua "Dólar americano" — a mudança nunca chegou a ser
    // confirmada pelo servidor.
    expect(screen.getByText(/Dólar americano/)).toBeInTheDocument()
    expect(screen.queryByText(/Euro/)).not.toBeInTheDocument()
  })

  it('o "‹ voltar" leva a /perfil', async () => {
    montar()

    await userEvent.click(await screen.findByRole('link', { name: 'Perfil' }))

    expect(await screen.findByText('página de perfil')).toBeInTheDocument()
  })
  it('mudar a moeda principal marca as contas como desatualizadas (o saldo convertido mudou)', async () => {
    // Uma cache própria, já com a lista de contas lá dentro: depois de
    // mudar a moeda, a chave ['contas'] tem de ficar "invalidada", para as
    // páginas de contas voltarem a pedir os saldos convertidos.
    const cliente = criarClienteConsultas({ testes: true })
    cliente.setQueryData(CHAVES.contas, [])
    servidorMsw.use(
      http.get('/api/auth/me', () => HttpResponse.json(UTILIZADOR)),
      http.patch('/api/auth/me', () => HttpResponse.json({ ...UTILIZADOR, moeda_principal: 'EUR' })),
    )
    renderBase(
      <QueryClientProvider client={cliente}>
        <AuthProvider>
          <MemoryRouter initialEntries={['/perfil/preferencias']}>
            <Routes>
              <Route path="/perfil/preferencias" element={<PerfilPreferencias />} />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </QueryClientProvider>,
    )

    await userEvent.click(await screen.findByText(/Dólar americano/))
    await userEvent.click(screen.getByText(/Euro/))

    await waitFor(() => expect(cliente.getQueryState(CHAVES.contas)?.isInvalidated).toBe(true))
  })
})
