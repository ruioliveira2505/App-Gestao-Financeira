/*
 * TESTES DO MODAL "NOVO MOVIMENTO"
 * ================================
 *
 * Exercita também o MovimentoFormulario em modo de criação. A concha do
 * modal (arrasto, animações, Escape…) é a mesma Folha já testada a fundo
 * em ContaNova.test.tsx — aqui cobre-se só o que é próprio desta rota, e
 * uma vez a coordenação com a folha aninhada (o seletor de conta), para
 * confirmar que está ligada.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

import { servidorMsw } from '../test/servidor-msw'
import { definirEcraMobile } from '../test/setup'
import { MovimentoNovo } from './MovimentoNovo'

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

function montar(entrada = '/movimentos/novo') {
  return render(
    <MemoryRouter initialEntries={[entrada]}>
      <Routes>
        <Route path="/movimentos" element={<p>lista de movimentos</p>} />
        <Route path="/movimentos/novo" element={<MovimentoNovo />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('Página Novo movimento', () => {
  it('cria uma saída (valor negativo) e volta à lista', async () => {
    let corpoRecebido: Record<string, unknown> | null = null
    servidorMsw.use(
      http.get('/api/contas', () => HttpResponse.json([CONTA])),
      http.post('/api/movimentos', async ({ request }) => {
        corpoRecebido = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({ id: 'm1' }, { status: 201 })
      }),
    )

    montar()

    // Em desktop, escolher a conta revela a lista em linha, por baixo do
    // campo (sem camada flutuante) — tal como em ContaFormulario.
    await userEvent.click(await screen.findByText('Escolher conta'))
    await userEvent.click(screen.getByText('Conta à ordem'))

    await userEvent.type(screen.getByLabelText('Descrição'), 'Supermercado')
    await userEvent.type(screen.getByLabelText(/Valor/), '49,90')
    // "Saída" já é a escolha por omissão do seletor de tipo.
    await userEvent.click(screen.getByRole('button', { name: 'Criar movimento' }))

    expect(await screen.findByText('lista de movimentos')).toBeInTheDocument()
    expect(corpoRecebido).toMatchObject({
      conta_id: 'c1',
      descricao: 'Supermercado',
      valor: '-49.90',
    })
  })

  it('escolher "Entrada" dá um valor positivo', async () => {
    let corpoRecebido: Record<string, unknown> | null = null
    servidorMsw.use(
      http.get('/api/contas', () => HttpResponse.json([CONTA])),
      http.post('/api/movimentos', async ({ request }) => {
        corpoRecebido = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({ id: 'm1' }, { status: 201 })
      }),
    )

    montar()
    await userEvent.click(await screen.findByText('Escolher conta'))
    await userEvent.click(screen.getByText('Conta à ordem'))

    // Tipo é um seletor (como a Conta): abre-se pelo valor atual ("Saída")
    // e escolhe-se "Entrada".
    await userEvent.click(screen.getByText('Saída'))
    await userEvent.click(screen.getByText('Entrada'))
    await userEvent.type(screen.getByLabelText('Descrição'), 'Salário')
    await userEvent.type(screen.getByLabelText(/Valor/), '1500')
    await userEvent.click(screen.getByRole('button', { name: 'Criar movimento' }))

    await screen.findByText('lista de movimentos')
    expect(corpoRecebido).toMatchObject({ valor: '1500.00' })
  })

  it('o "✓" só fica ativo com os campos obrigatórios preenchidos', async () => {
    servidorMsw.use(http.get('/api/contas', () => HttpResponse.json([CONTA])))
    montar()
    await screen.findByText('Escolher conta')

    // Sem conta escolhida, mesmo com o resto preenchido, o "✓" está
    // desativado — uma conta é sempre obrigatória.
    const confirmar = screen.getByRole('button', { name: 'Criar movimento' })
    await userEvent.type(screen.getByLabelText('Descrição'), 'Compras')
    await userEvent.type(screen.getByLabelText(/Valor/), '10')
    expect(confirmar).toBeDisabled()

    await userEvent.click(screen.getByText('Escolher conta'))
    await userEvent.click(screen.getByText('Conta à ordem'))
    expect(confirmar).toBeEnabled()
  })

  it('um valor de "0" não ativa o "✓"', async () => {
    servidorMsw.use(http.get('/api/contas', () => HttpResponse.json([CONTA])))
    montar()

    await userEvent.click(await screen.findByText('Escolher conta'))
    await userEvent.click(screen.getByText('Conta à ordem'))
    await userEvent.type(screen.getByLabelText('Descrição'), 'Nada')
    await userEvent.type(screen.getByLabelText(/Valor/), '0')

    expect(screen.getByRole('button', { name: 'Criar movimento' })).toBeDisabled()
  })

  it('sem contas nenhumas, pede para criar uma conta em vez do formulário', async () => {
    servidorMsw.use(http.get('/api/contas', () => HttpResponse.json([])))
    montar()

    expect(await screen.findByText('Precisas de uma conta primeiro.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Criar conta' })).toHaveAttribute(
      'href',
      '/contas/nova',
    )
    expect(screen.queryByLabelText('Descrição')).not.toBeInTheDocument()
  })

  it('em mobile, a conta escolhe-se num painel que entra da direita', async () => {
    definirEcraMobile(true)
    servidorMsw.use(
      http.get('/api/contas', () =>
        HttpResponse.json([CONTA, { ...CONTA, id: 'c2', nome: 'Poupança' }]),
      ),
    )
    montar()

    await userEvent.click(await screen.findByText('Escolher conta'))
    const painel = await screen.findByRole('dialog', { name: 'Conta' })
    await userEvent.click(within(painel).getByText('Poupança'))

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Conta' })).not.toBeInTheDocument(),
    )
    expect(screen.getByText('Poupança')).toBeInTheDocument()
  })

  it('arrastar o painel da conta para BAIXO abandona o fluxo (vai à lista)', async () => {
    definirEcraMobile(true)
    servidorMsw.use(
      http.get('/api/contas', () =>
        HttpResponse.json([CONTA, { ...CONTA, id: 'c2', nome: 'Poupança' }]),
      ),
    )
    montar()

    await userEvent.click(await screen.findByText('Escolher conta'))
    const painel = await screen.findByRole('dialog', { name: 'Conta' })
    const cabecalho = painel.firstElementChild as HTMLElement

    fireEvent.pointerDown(cabecalho, { clientX: 40, clientY: 80, pointerId: 1 })
    fireEvent.pointerMove(cabecalho, { clientX: 44, clientY: 330, pointerId: 1 })
    fireEvent.pointerUp(cabecalho, { clientX: 44, clientY: 330, pointerId: 1 })

    expect(await screen.findByText('lista de movimentos')).toBeInTheDocument()
  })

  it('é um modal e o "X" fecha-o (volta à lista)', async () => {
    servidorMsw.use(http.get('/api/contas', () => HttpResponse.json([CONTA])))
    montar()

    expect(await screen.findByRole('dialog', { name: 'Novo movimento' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Fechar' }))

    expect(await screen.findByText('lista de movimentos')).toBeInTheDocument()
  })
})
