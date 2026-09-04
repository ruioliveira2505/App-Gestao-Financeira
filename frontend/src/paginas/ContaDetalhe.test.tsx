/*
 * TESTES DA PÁGINA DE DETALHE DE UMA CONTA
 * =======================================
 */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { delay, http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

import { servidorMsw } from '../test/servidor-msw'
import { ContaDetalhe } from './ContaDetalhe'

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
    <MemoryRouter initialEntries={['/contas/c1']}>
      <Routes>
        <Route path="/contas/:id" element={<ContaDetalhe />} />
        <Route path="/contas/:id/editar" element={<p>página de edição</p>} />
        <Route path="/contas" element={<p>lista de contas</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('Página de detalhe de uma conta', () => {
  it('mostra o nome, o saldo e a ficha de detalhes', async () => {
    servidorMsw.use(http.get('/api/contas/c1', () => HttpResponse.json(CONTA)))

    montar()

    // O nome da conta é o título (vai para a barra de topo em mobile).
    expect(await screen.findByRole('heading', { name: 'Conta à ordem' })).toBeInTheDocument()
    // O saldo aparece em destaque e outra vez na ficha "Detalhes".
    expect(screen.getAllByText(/1.?000,00/).length).toBeGreaterThanOrEqual(1)
    // Ficha "Detalhes": banco, tipo, moeda e o ponto de partida.
    expect(screen.getByText('Banco')).toBeInTheDocument()
    expect(screen.getByText('BPI')).toBeInTheDocument()
    expect(screen.getByText('Tipo de conta')).toBeInTheDocument()
    expect(screen.getByText('Conta corrente')).toBeInTheDocument()
    expect(screen.getByText('Início dos movimentos')).toBeInTheDocument()
    expect(screen.getByText('Saldo de início')).toBeInTheDocument()
  })

  it('a acção "Editar" leva ao formulário de edição', async () => {
    servidorMsw.use(http.get('/api/contas/c1', () => HttpResponse.json(CONTA)))

    montar()

    const editar = await screen.findByRole('link', { name: 'Editar' })
    expect(editar).toHaveAttribute('href', '/contas/c1/editar')

    await userEvent.click(editar)
    expect(await screen.findByText('página de edição')).toBeInTheDocument()
  })

  it('não tem acção de eliminar (isso vive no formulário de edição)', async () => {
    servidorMsw.use(http.get('/api/contas/c1', () => HttpResponse.json(CONTA)))

    montar()
    await screen.findByRole('heading', { name: 'Conta à ordem' })

    expect(screen.queryByRole('button', { name: /eliminar|remover|apagar/i })).not.toBeInTheDocument()
  })

  it('mostra uma mensagem e uma saída quando a conta não carrega', async () => {
    servidorMsw.use(
      http.get('/api/contas/c1', () =>
        HttpResponse.json({ detail: 'Conta não encontrada.' }, { status: 404 }),
      ),
    )

    montar()

    expect(await screen.findByRole('alert')).toHaveTextContent('Conta não encontrada.')
    expect(screen.getByRole('link', { name: 'Voltar às contas' })).toHaveAttribute(
      'href',
      '/contas',
    )
  })

  it('mostra um esqueleto enquanto a conta carrega', async () => {
    servidorMsw.use(
      http.get('/api/contas/c1', async () => {
        await delay()
        return HttpResponse.json(CONTA)
      }),
    )

    montar()

    // Enquanto a resposta não chega, há um esqueleto anunciado como "status".
    expect(screen.getByRole('status', { name: 'A carregar a conta' })).toBeInTheDocument()
    // Quando a conta chega, o esqueleto dá lugar ao conteúdo.
    expect(await screen.findByRole('heading', { name: 'Conta à ordem' })).toBeInTheDocument()
    expect(
      screen.queryByRole('status', { name: 'A carregar a conta' }),
    ).not.toBeInTheDocument()
  })
})
