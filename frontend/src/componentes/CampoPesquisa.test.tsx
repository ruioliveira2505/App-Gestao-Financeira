/*
 * TESTES DO CampoPesquisa
 * =======================
 */

import { useState } from 'react'

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { CampoPesquisa } from './CampoPesquisa'

/** É um campo controlado — este anfitrião guarda o texto por ele. */
function Anfitriao({ inicial = '' }: { inicial?: string }) {
  const [valor, setValor] = useState(inicial)
  return (
    <CampoPesquisa
      valor={valor}
      aoMudar={setValor}
      placeholder="Procurar…"
      rotulo="Procurar conta"
    />
  )
}

describe('CampoPesquisa', () => {
  it('escreve no campo e propaga o texto', async () => {
    render(<Anfitriao />)
    const campo = screen.getByRole('searchbox', { name: 'Procurar conta' })

    await userEvent.type(campo, 'poupança')

    expect(campo).toHaveValue('poupança')
  })

  it('o "✕" só aparece com texto e, ao limpar, esvazia o campo e devolve-lhe o foco', async () => {
    render(<Anfitriao />)
    const campo = screen.getByRole('searchbox', { name: 'Procurar conta' })

    expect(
      screen.queryByRole('button', { name: 'Limpar pesquisa' }),
    ).not.toBeInTheDocument()

    await userEvent.type(campo, 'abc')
    await userEvent.click(screen.getByRole('button', { name: 'Limpar pesquisa' }))

    expect(campo).toHaveValue('')
    expect(campo).toHaveFocus()
    expect(
      screen.queryByRole('button', { name: 'Limpar pesquisa' }),
    ).not.toBeInTheDocument()
  })

  it('arranca com texto inicial e mostra logo o "✕"', () => {
    render(<Anfitriao inicial="renda" />)

    expect(screen.getByRole('searchbox', { name: 'Procurar conta' })).toHaveValue('renda')
    expect(screen.getByRole('button', { name: 'Limpar pesquisa' })).toBeInTheDocument()
  })
})
