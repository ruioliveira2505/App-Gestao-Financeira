/*
 * TESTES DA PÁGINA "EDITAR CONTA"
 * ==============================
 *
 * Cobre o carregamento do formulário preenchido e — o que é próprio desta
 * página — a acção "Eliminar conta" no fim (com diálogo de confirmação).
 */

import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

import { servidorMsw } from '../test/servidor-msw'
import { definirEcraMobile } from '../test/setup'
import { ContaEditar } from './ContaEditar'

const CONTA = {
  id: 'c1',
  nome: 'Conta à ordem',
  banco: 'BPI',
  tipo: 'Conta corrente',
  moeda: 'EUR',
  data_ancora: '2026-01-01',
  saldo_ancora: '1000.00',
  saldo: '1000.00',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

function montar() {
  return render(
    <MemoryRouter initialEntries={['/contas/c1/editar']}>
      <Routes>
        <Route path="/contas/:id/editar" element={<ContaEditar />} />
        <Route path="/contas/:id" element={<p>detalhe da conta</p>} />
        <Route path="/contas" element={<p>lista de contas</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('Página Editar conta', () => {
  it('em mobile, é uma folha e o "✓" guarda as alterações', async () => {
    definirEcraMobile(true)
    let corpoRecebido: Record<string, unknown> | null = null
    servidorMsw.use(
      http.get('/api/contas/c1', () => HttpResponse.json(CONTA)),
      http.get('/api/contas', () => HttpResponse.json([CONTA])),
      http.patch('/api/contas/c1', async ({ request }) => {
        corpoRecebido = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({ ...CONTA, nome: 'Conta renomeada' })
      }),
    )

    montar()

    await screen.findByRole('dialog', { name: 'Editar conta' })
    const nome = screen.getByLabelText('Nome')
    await userEvent.clear(nome)
    await userEvent.type(nome, 'Conta renomeada')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar alterações' }))

    expect(await screen.findByText('detalhe da conta')).toBeInTheDocument()
    expect(corpoRecebido).toMatchObject({ nome: 'Conta renomeada' })
  })

  it('em mobile, arrastar o seletor de moeda para baixo abandona a edição', async () => {
    definirEcraMobile(true)
    servidorMsw.use(
      http.get('/api/contas/c1', () => HttpResponse.json(CONTA)),
      http.get('/api/contas', () => HttpResponse.json([CONTA])),
    )

    montar()

    await screen.findByRole('dialog', { name: 'Editar conta' })
    await userEvent.click(screen.getByText(/Euro/))
    const painelMoeda = await screen.findByRole('dialog', { name: 'Moeda' })
    const cabecalho = painelMoeda.firstElementChild as HTMLElement

    fireEvent.pointerDown(cabecalho, { clientX: 40, clientY: 80, pointerId: 1 })
    fireEvent.pointerMove(cabecalho, { clientX: 44, clientY: 330, pointerId: 1 })
    fireEvent.pointerUp(cabecalho, { clientX: 44, clientY: 330, pointerId: 1 })

    // Como no "Nova conta": as duas folhas saem juntas e vai-se parar ao
    // detalhe da conta (o destino de sair da edição).
    expect(await screen.findByText('detalhe da conta')).toBeInTheDocument()
  })

  it('em desktop, o seletor de banco abre a lista por baixo do campo', async () => {
    servidorMsw.use(
      http.get('/api/contas/c1', () => HttpResponse.json(CONTA)),
      http.get('/api/contas', () => HttpResponse.json([CONTA])),
    )

    montar()

    await screen.findByLabelText('Nome')
    // O campo "Banco" mostra "BPI"; clicar abre a lista NO SÍTIO.
    await userEvent.click(screen.getByText('BPI'))

    // Não abre um diálogo/modal — a lista fica em linha.
    expect(screen.queryByRole('dialog', { name: 'Banco' })).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Adicionar banco/ }),
    ).toBeInTheDocument()

    // Escolher "Sem banco" fecha a lista e muda o valor.
    await userEvent.click(screen.getByRole('button', { name: 'Sem banco' }))
    expect(
      screen.queryByRole('button', { name: /Adicionar banco/ }),
    ).not.toBeInTheDocument()
    expect(screen.getByText('Sem banco')).toBeInTheDocument()
  })

  it('mostra o formulário preenchido com os dados da conta', async () => {
    servidorMsw.use(
      http.get('/api/contas/c1', () => HttpResponse.json(CONTA)),
      // O formulário pede a lista de contas para as sugestões.
      http.get('/api/contas', () => HttpResponse.json([CONTA])),
    )

    montar()

    expect(await screen.findByLabelText('Nome')).toHaveValue('Conta à ordem')
    // O campo "Banco" é agora um seletor: mostra o valor atual como texto.
    expect(screen.getByText('BPI')).toBeInTheDocument()
  })

  it('elimina a conta após confirmação e volta à lista', async () => {
    let eliminou = false
    servidorMsw.use(
      http.get('/api/contas/c1', () => HttpResponse.json(CONTA)),
      http.get('/api/contas', () => HttpResponse.json([CONTA])),
      http.delete('/api/contas/c1', () => {
        eliminou = true
        return new HttpResponse(null, { status: 204 })
      }),
    )

    montar()
    await userEvent.click(await screen.findByRole('button', { name: 'Eliminar conta' }))

    // Aparece o diálogo de confirmação; o botão de confirmar diz "Eliminar".
    const dialogo = await screen.findByRole('dialog', { name: 'Eliminar conta' })
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Eliminar' }))

    expect(await screen.findByText('lista de contas')).toBeInTheDocument()
    expect(eliminou).toBe(true)
  })

  it('cancela a eliminação sem apagar nada', async () => {
    let eliminou = false
    servidorMsw.use(
      http.get('/api/contas/c1', () => HttpResponse.json(CONTA)),
      http.get('/api/contas', () => HttpResponse.json([CONTA])),
      http.delete('/api/contas/c1', () => {
        eliminou = true
        return new HttpResponse(null, { status: 204 })
      }),
    )

    montar()
    await userEvent.click(await screen.findByRole('button', { name: 'Eliminar conta' }))
    const dialogo = await screen.findByRole('dialog', { name: 'Eliminar conta' })
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Cancelar' }))

    // Fecha o action sheet de confirmação (o modal "Editar conta" fica).
    expect(
      screen.queryByRole('dialog', { name: 'Eliminar conta' }),
    ).not.toBeInTheDocument()
    expect(eliminou).toBe(false)
  })
})
