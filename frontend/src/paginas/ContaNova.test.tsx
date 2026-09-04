/*
 * TESTES DO MODAL "NOVA CONTA"
 * ===========================
 *
 * Exercita também o ContaFormulario em modo de criação.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

import { servidorMsw } from '../test/servidor-msw'
import { definirEcraMobile } from '../test/setup'
import { ContaNova } from './ContaNova'

function montar(entrada = '/contas/nova') {
  return render(
    <MemoryRouter initialEntries={[entrada]}>
      <Routes>
        <Route path="/contas" element={<p>lista de contas</p>} />
        <Route path="/contas/nova" element={<ContaNova />} />
        <Route path="/contas/:id" element={<p>detalhe da conta</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('Página Nova conta', () => {
  it('cria a conta e navega para o seu detalhe', async () => {
    let corpoRecebido: Record<string, unknown> | null = null
    servidorMsw.use(
      // O formulário pede a lista de contas para as sugestões.
      http.get('/api/contas', () => HttpResponse.json([])),
      http.post('/api/contas', async ({ request }) => {
        corpoRecebido = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({ id: 'nova-1' }, { status: 201 })
      }),
    )

    montar()

    await userEvent.type(screen.getByLabelText('Nome'), 'Revolut')
    await userEvent.type(screen.getByLabelText('Saldo início'), '250,50')
    await userEvent.click(screen.getByRole('button', { name: 'Criar conta' }))

    expect(await screen.findByText('detalhe da conta')).toBeInTheDocument()
    // A vírgula decimal portuguesa foi convertida em ponto para a API.
    expect(corpoRecebido).toMatchObject({ nome: 'Revolut', saldo_ancora: '250.50' })
  })

  it('o "✓" só fica ativo com os campos obrigatórios preenchidos', async () => {
    servidorMsw.use(http.get('/api/contas', () => HttpResponse.json([])))
    montar()

    // Sem nome nem saldo, o "✓" está desativado.
    const confirmar = screen.getByRole('button', { name: 'Criar conta' })
    expect(confirmar).toBeDisabled()

    // Só com o nome ainda falta o saldo.
    await userEvent.type(screen.getByLabelText('Nome'), 'Revolut')
    expect(confirmar).toBeDisabled()

    // Com nome + saldo (a data já vem preenchida com hoje), ativa.
    await userEvent.type(screen.getByLabelText('Saldo início'), '100')
    expect(confirmar).toBeEnabled()
  })

  it('o campo de saldo não deixa escrever letras', async () => {
    servidorMsw.use(http.get('/api/contas', () => HttpResponse.json([])))
    montar()

    const saldo = screen.getByLabelText('Saldo início')
    await userEvent.type(saldo, '12a3b,4c5')

    expect(saldo).toHaveValue('123,45')
  })

  it('em mobile, a moeda escolhe-se num painel que entra da direita', async () => {
    definirEcraMobile(true)
    servidorMsw.use(http.get('/api/contas', () => HttpResponse.json([])))
    montar()

    // O campo "Moeda" é um botão (mostra o valor atual, "Euro") que abre
    // o painel.
    await userEvent.click(screen.getByText(/Euro/))

    const painel = await screen.findByRole('dialog', { name: 'Moeda' })
    await userEvent.click(within(painel).getByText(/Dólar americano/))

    // O painel anima a saída e desmonta; o campo passa a mostrar a moeda
    // escolhida.
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Moeda' })).not.toBeInTheDocument(),
    )
    expect(screen.getByText(/Dólar americano/)).toBeInTheDocument()
  })

  it('em mobile, escreve um banco à mão pela linha "Adicionar banco"', async () => {
    definirEcraMobile(true)
    let corpoRecebido: Record<string, unknown> | null = null
    servidorMsw.use(
      http.get('/api/contas', () => HttpResponse.json([])),
      http.post('/api/contas', async ({ request }) => {
        corpoRecebido = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({ id: 'nova-2' }, { status: 201 })
      }),
    )
    montar()

    // O campo "Banco" mostra "Sem banco" por omissão; abre o seletor.
    await userEvent.click(screen.getByText('Sem banco'))
    const painel = await screen.findByRole('dialog', { name: 'Banco' })

    // A linha "Adicionar banco" vira campo de escrita; escreve-se e confirma-se.
    await userEvent.click(
      within(painel).getByRole('button', { name: /Adicionar banco/ }),
    )
    await userEvent.type(
      within(painel).getByLabelText('Adicionar banco'),
      'Banco XPTO',
    )
    await userEvent.click(within(painel).getByRole('button', { name: 'Confirmar' }))

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Banco' })).not.toBeInTheDocument(),
    )
    expect(screen.getByText('Banco XPTO')).toBeInTheDocument()

    // O banco escrito à mão vai na criação da conta.
    await userEvent.type(screen.getByLabelText('Nome'), 'X')
    await userEvent.type(screen.getByLabelText('Saldo início'), '0')
    await userEvent.click(screen.getByRole('button', { name: 'Criar conta' }))
    await screen.findByText('detalhe da conta')
    expect(corpoRecebido).toMatchObject({ banco: 'Banco XPTO' })
  })

  it('arrastar o painel da moeda para o LADO recua ao formulário', async () => {
    definirEcraMobile(true)
    servidorMsw.use(http.get('/api/contas', () => HttpResponse.json([])))
    montar()

    await userEvent.click(screen.getByText(/Euro/))
    const painel = await screen.findByRole('dialog', { name: 'Moeda' })
    const cabecalho = painel.firstElementChild as HTMLElement

    // Arrasto claramente horizontal (dx >> dy) para lá do limiar.
    fireEvent.pointerDown(cabecalho, { clientX: 40, clientY: 80, pointerId: 1 })
    fireEvent.pointerMove(cabecalho, { clientX: 300, clientY: 84, pointerId: 1 })
    fireEvent.pointerUp(cabecalho, { clientX: 300, clientY: 84, pointerId: 1 })

    // O painel da moeda fecha, mas o modal "Nova conta" continua — não se
    // saiu do fluxo.
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Moeda' })).not.toBeInTheDocument(),
    )
    expect(screen.getByRole('dialog', { name: 'Nova conta' })).toBeInTheDocument()
    expect(screen.queryByText('lista de contas')).not.toBeInTheDocument()
  })

  it('arrastar o painel da moeda para BAIXO abandona o fluxo (vai à lista)', async () => {
    definirEcraMobile(true)
    servidorMsw.use(http.get('/api/contas', () => HttpResponse.json([])))
    montar()

    await userEvent.click(screen.getByText(/Euro/))
    const painel = await screen.findByRole('dialog', { name: 'Moeda' })
    const cabecalho = painel.firstElementChild as HTMLElement

    // Arrasto claramente vertical (dy >> dx) para lá do limiar.
    fireEvent.pointerDown(cabecalho, { clientX: 40, clientY: 80, pointerId: 1 })
    fireEvent.pointerMove(cabecalho, { clientX: 44, clientY: 330, pointerId: 1 })
    fireEvent.pointerUp(cabecalho, { clientX: 44, clientY: 330, pointerId: 1 })

    // As duas folhas saem e vai-se parar à página Contas.
    expect(await screen.findByText('lista de contas')).toBeInTheDocument()
  })

  it('é um modal e o "X" fecha-o (volta à lista)', async () => {
    servidorMsw.use(http.get('/api/contas', () => HttpResponse.json([])))
    montar()

    expect(screen.getByRole('dialog', { name: 'Nova conta' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Fechar' }))

    // Aberto direto pelo URL (sem histórico) → o "X" vai para /contas.
    expect(await screen.findByText('lista de contas')).toBeInTheDocument()
  })

  it('descarta-se ao arrastar o cabeçalho para baixo além do limiar', async () => {
    definirEcraMobile(true) // o arrasto é um gesto de toque — só em mobile.
    servidorMsw.use(http.get('/api/contas', () => HttpResponse.json([])))
    montar()

    const dialogo = await screen.findByRole('dialog', { name: 'Nova conta' })
    // O cabeçalho (a "pega" + a linha do título) é a zona de arrasto.
    const cabecalho = dialogo.firstElementChild as HTMLElement

    fireEvent.pointerDown(cabecalho, { clientY: 80, pointerId: 1 })
    fireEvent.pointerMove(cabecalho, { clientY: 320, pointerId: 1 })
    fireEvent.pointerUp(cabecalho, { clientY: 320, pointerId: 1 })

    expect(await screen.findByText('lista de contas')).toBeInTheDocument()
  })

  it('volta ao sítio se o arrasto para baixo for curto', async () => {
    definirEcraMobile(true) // o arrasto é um gesto de toque — só em mobile.
    servidorMsw.use(http.get('/api/contas', () => HttpResponse.json([])))
    montar()

    const dialogo = await screen.findByRole('dialog', { name: 'Nova conta' })
    const cabecalho = dialogo.firstElementChild as HTMLElement

    fireEvent.pointerDown(cabecalho, { clientY: 80, pointerId: 1 })
    fireEvent.pointerMove(cabecalho, { clientY: 130, pointerId: 1 })
    fireEvent.pointerUp(cabecalho, { clientY: 130, pointerId: 1 })

    // Arrasto curto: não descarta — o modal continua lá.
    expect(screen.getByRole('dialog', { name: 'Nova conta' })).toBeInTheDocument()
    expect(screen.queryByText('lista de contas')).not.toBeInTheDocument()
  })
})
