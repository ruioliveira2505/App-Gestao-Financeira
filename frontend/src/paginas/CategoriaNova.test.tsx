/*
 * TESTES DO MODAL "NOVO GRUPO"
 * =============================
 */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

import { servidorMsw } from '../test/servidor-msw'
import { CategoriaNova } from './CategoriaNova'

function montar(entrada = '/categorias/novo') {
  return render(
    <MemoryRouter initialEntries={[entrada]}>
      <Routes>
        <Route path="/categorias" element={<p>lista de categorias</p>} />
        <Route path="/categorias/novo" element={<CategoriaNova />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('Modal Novo grupo', () => {
  it('cria um grupo de saída (a direção por omissão) e volta à lista', async () => {
    let corpoRecebido: Record<string, unknown> | null = null
    servidorMsw.use(
      http.post('/api/categorias', async ({ request }) => {
        corpoRecebido = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({ id: 'g1' }, { status: 201 })
      }),
    )
    montar()

    await userEvent.type(screen.getByLabelText('Nome'), 'Hobbies')
    await userEvent.click(screen.getByRole('button', { name: 'Criar grupo' }))

    expect(await screen.findByText('lista de categorias')).toBeInTheDocument()
    expect(corpoRecebido).toMatchObject({ nome: 'Hobbies', direcao: 'saida' })
  })

  it('escolher "Entrada" muda a direção enviada', async () => {
    let corpoRecebido: Record<string, unknown> | null = null
    servidorMsw.use(
      http.post('/api/categorias', async ({ request }) => {
        corpoRecebido = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({ id: 'g1' }, { status: 201 })
      }),
    )
    montar()

    await userEvent.type(screen.getByLabelText('Nome'), 'Prémios diversos')
    await userEvent.click(screen.getByText('Saída'))
    await userEvent.click(screen.getByText('Entrada'))
    await userEvent.click(screen.getByRole('button', { name: 'Criar grupo' }))

    await screen.findByText('lista de categorias')
    expect(corpoRecebido).toMatchObject({ direcao: 'entrada' })
  })

  it('o "✓" só fica ativo com um nome preenchido', async () => {
    montar()

    expect(screen.getByRole('button', { name: 'Criar grupo' })).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Nome'), 'X')
    expect(screen.getByRole('button', { name: 'Criar grupo' })).toBeEnabled()
  })

  it('mostra o erro do servidor sem fechar o modal', async () => {
    servidorMsw.use(
      http.post('/api/categorias', () =>
        HttpResponse.json({ detail: 'Já existe uma categoria com este nome no mesmo grupo.' }, { status: 409 }),
      ),
    )
    montar()

    await userEvent.type(screen.getByLabelText('Nome'), 'Alimentação')
    await userEvent.click(screen.getByRole('button', { name: 'Criar grupo' }))

    expect(
      await screen.findByText('Já existe uma categoria com este nome no mesmo grupo.'),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Nome')).toBeInTheDocument()
  })
})
