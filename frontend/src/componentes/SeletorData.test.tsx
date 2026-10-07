/*
 * Testes do SeletorData — o calendário da app.
 *
 * Em telemóvel o calendário é um cartão flutuante com "✕" e "✓": tocar
 * num dia só o marca (um rascunho); só o "✓" muda a data do campo, e o
 * "✕" deixa-a como estava. Em ecrã largo, tocar num dia muda logo a data
 * (testado em ContaNova.test.tsx). Também se testa a roda de mês e ano.
 */

import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'

import { definirEcraMobile } from '../test/setup'
import { SeletorData } from './SeletorData'

// Envolve o SeletorData num estado, como um formulário real faria.
function Formulario({ inicial = '2026-03-10' }: { inicial?: string }) {
  const [data, setData] = useState(inicial)
  return (
    <>
      <SeletorData etiqueta="Data de início" valor={data} aoMudar={setData} maximo="2026-10-02" />
      <output aria-label="valor">{data}</output>
    </>
  )
}

function valor() {
  return screen.getByRole('status', { name: 'valor' })
}

describe('SeletorData em telemóvel', () => {
  it('o "✕" cancela: a data marcada não passa para o campo', async () => {
    definirEcraMobile(true)
    render(<Formulario />)
    await userEvent.click(screen.getByRole('button', { name: /Data de início/ }))
    const painel = screen.getByRole('dialog', { name: 'Data de início' })

    await userEvent.click(within(painel).getByRole('button', { name: '20 de março de 2026' }))
    // Fica marcado no calendário, mas o campo ainda não mudou.
    expect(within(painel).getByRole('button', { name: '20 de março de 2026' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(valor()).toHaveTextContent('2026-03-10')

    await userEvent.click(within(painel).getByRole('button', { name: 'Cancelar' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(valor()).toHaveTextContent('2026-03-10')
  })

  it('o "✓" confirma a data marcada', async () => {
    definirEcraMobile(true)
    render(<Formulario />)
    await userEvent.click(screen.getByRole('button', { name: /Data de início/ }))
    const painel = screen.getByRole('dialog', { name: 'Data de início' })

    await userEvent.click(within(painel).getByRole('button', { name: '20 de março de 2026' }))
    await userEvent.click(within(painel).getByRole('button', { name: 'Confirmar' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(valor()).toHaveTextContent('2026-03-20')
    expect(screen.getByRole('button', { name: /Data de início/ })).toHaveTextContent('20 mar 2026')
  })

  it('as rodas de mês e ano mudam o mês que se vê', async () => {
    definirEcraMobile(true)
    render(<Formulario />)
    await userEvent.click(screen.getByRole('button', { name: /Data de início/ }))
    const painel = screen.getByRole('dialog', { name: 'Data de início' })

    // Tocar no título troca a grelha pelas rodas.
    await userEvent.click(within(painel).getByRole('button', { name: /Março 2026/ }))
    const meses = within(painel).getByRole('listbox', { name: 'Mês' })
    const anos = within(painel).getByRole('listbox', { name: 'Ano' })
    expect(within(meses).getByRole('option', { name: 'Março' })).toHaveAttribute('aria-selected', 'true')
    // O último ano da roda é o do "maximo" — não se pode ir para o futuro.
    expect(within(anos).queryByRole('option', { name: '2027' })).not.toBeInTheDocument()

    await userEvent.click(within(meses).getByRole('option', { name: 'Julho' }))
    await userEvent.click(within(anos).getByRole('option', { name: '2024' }))

    // De volta à grelha, já em julho de 2024.
    await userEvent.click(within(painel).getByRole('button', { name: /Julho 2024/ }))
    expect(within(painel).getByRole('button', { name: '1 de julho de 2024' })).toBeInTheDocument()
  })
})
