/*
 * TESTES DA PÁGINA "EDITAR MOVIMENTO"
 * ==================================
 *
 * Cobre o formulário preenchido a partir do movimento existente (incluindo
 * a conversão do valor com sinal para o par tipo/valor absoluto), guardar
 * as alterações, e — o que é próprio desta página — o "Eliminar movimento"
 * no fim, com o diálogo de confirmação.
 */

import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { http, HttpResponse, type HttpHandler } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

import { servidorMsw } from '../test/servidor-msw'
import { definirEcraMobile } from '../test/setup'
import { MovimentoEditar } from './MovimentoEditar'

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

const MOVIMENTO = {
  id: 'm1',
  conta_id: 'c1',
  data: '2026-02-10',
  descricao: 'Compras',
  valor: '-50.00',
  created_at: '2026-02-10T10:00:00Z',
  updated_at: '2026-02-10T10:00:00Z',
}

function usarBase(extra: HttpHandler[] = []) {
  servidorMsw.use(
    http.get('/api/movimentos/m1', () => HttpResponse.json(MOVIMENTO)),
    http.get('/api/contas', () => HttpResponse.json([CONTA])),
    ...extra,
  )
}

function montar() {
  return render(
    <MemoryRouter initialEntries={['/movimentos/m1/editar']}>
      <Routes>
        <Route path="/movimentos/:id/editar" element={<MovimentoEditar />} />
        <Route path="/movimentos" element={<p>lista de movimentos</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('Página Editar movimento', () => {
  it('mostra o formulário preenchido com os dados do movimento', async () => {
    usarBase()
    montar()

    expect(await screen.findByLabelText('Descrição')).toHaveValue('Compras')
    // O valor com sinal negativo torna-se "Saída" + valor absoluto: o
    // seletor de tipo mostra "Saída" (e "Entrada" não está à vista).
    expect(screen.getByText('Saída')).toBeInTheDocument()
    expect(screen.queryByText('Entrada')).not.toBeInTheDocument()
    expect(screen.getByLabelText(/Valor/)).toHaveValue('50.00')
    expect(screen.getByText('Conta à ordem')).toBeInTheDocument()
  })

  it('o "✓" guarda as alterações e volta à lista', async () => {
    let corpoRecebido: Record<string, unknown> | null = null
    usarBase([
      http.patch('/api/movimentos/m1', async ({ request }) => {
        corpoRecebido = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({ ...MOVIMENTO, descricao: 'Compras (corrigido)' })
      }),
    ])
    montar()

    const descricao = await screen.findByLabelText('Descrição')
    await userEvent.clear(descricao)
    await userEvent.type(descricao, 'Compras (corrigido)')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar alterações' }))

    expect(await screen.findByText('lista de movimentos')).toBeInTheDocument()
    // Sem tocar no tipo, o valor volta a sair com o mesmo sinal (negativo).
    expect(corpoRecebido).toMatchObject({
      conta_id: 'c1',
      descricao: 'Compras (corrigido)',
      valor: '-50.00',
    })
  })

  it('mudar de "Saída" para "Entrada" inverte o sinal do valor', async () => {
    let corpoRecebido: Record<string, unknown> | null = null
    usarBase([
      http.patch('/api/movimentos/m1', async ({ request }) => {
        corpoRecebido = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(MOVIMENTO)
      }),
    ])
    montar()

    await screen.findByLabelText('Descrição')
    // Abre o seletor de tipo pelo valor atual ("Saída") e escolhe "Entrada".
    await userEvent.click(screen.getByText('Saída'))
    await userEvent.click(screen.getByText('Entrada'))
    await userEvent.click(screen.getByRole('button', { name: 'Guardar alterações' }))

    await screen.findByText('lista de movimentos')
    expect(corpoRecebido).toMatchObject({ valor: '50.00' })
  })

  it('elimina o movimento após confirmação e volta à lista', async () => {
    let eliminou = false
    usarBase([
      http.delete('/api/movimentos/m1', () => {
        eliminou = true
        return new HttpResponse(null, { status: 204 })
      }),
    ])
    montar()

    await userEvent.click(await screen.findByRole('button', { name: 'Eliminar movimento' }))
    const dialogo = await screen.findByRole('dialog', { name: 'Eliminar movimento' })
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Eliminar' }))

    expect(await screen.findByText('lista de movimentos')).toBeInTheDocument()
    expect(eliminou).toBe(true)
  })

  it('cancela a eliminação sem apagar nada', async () => {
    let eliminou = false
    usarBase([
      http.delete('/api/movimentos/m1', () => {
        eliminou = true
        return new HttpResponse(null, { status: 204 })
      }),
    ])
    montar()

    await userEvent.click(await screen.findByRole('button', { name: 'Eliminar movimento' }))
    const dialogo = await screen.findByRole('dialog', { name: 'Eliminar movimento' })
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Cancelar' }))

    expect(
      screen.queryByRole('dialog', { name: 'Eliminar movimento' }),
    ).not.toBeInTheDocument()
    expect(eliminou).toBe(false)
  })

  it('em mobile, arrastar o seletor de conta para baixo abandona a edição', async () => {
    definirEcraMobile(true)
    servidorMsw.use(
      http.get('/api/movimentos/m1', () => HttpResponse.json(MOVIMENTO)),
      http.get('/api/contas', () =>
        HttpResponse.json([CONTA, { ...CONTA, id: 'c2', nome: 'Poupança' }]),
      ),
    )
    montar()

    // findByText (não getByText): o seletor de conta só aparece depois de
    // o formulário obter a lista de contas.
    await userEvent.click(await screen.findByText('Conta à ordem'))
    const painel = await screen.findByRole('dialog', { name: 'Conta' })
    const cabecalho = painel.firstElementChild as HTMLElement

    fireEvent.pointerDown(cabecalho, { clientX: 40, clientY: 80, pointerId: 1 })
    fireEvent.pointerMove(cabecalho, { clientX: 44, clientY: 330, pointerId: 1 })
    fireEvent.pointerUp(cabecalho, { clientX: 44, clientY: 330, pointerId: 1 })

    expect(await screen.findByText('lista de movimentos')).toBeInTheDocument()
  })
})
