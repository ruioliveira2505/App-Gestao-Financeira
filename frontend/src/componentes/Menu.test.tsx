/*
 * TESTES DO Menu
 * ==============
 *
 * Cobrem o comportamento de abrir/fechar: abre ao clicar no gatilho;
 * fecha ao clicar num item (chamando a acção desse item), ao clicar fora,
 * e ao premir Escape.
 */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { Menu, MenuItem } from './Menu'

function montar(aoEscolher: () => void = () => {}) {
  return render(
    <Menu
      gatilho={({ aberto, alternar }) => (
        <button type="button" aria-expanded={aberto} onClick={alternar}>
          abrir
        </button>
      )}
    >
      <MenuItem onClick={aoEscolher}>Acção</MenuItem>
    </Menu>,
  )
}

describe('Menu', () => {
  it('abre ao clicar no gatilho e fecha ao escolher um item', async () => {
    const aoEscolher = vi.fn()
    montar(aoEscolher)

    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'abrir' }))
    expect(screen.getByRole('menuitem', { name: 'Acção' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('menuitem', { name: 'Acção' }))
    expect(aoEscolher).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument()
  })

  it('fecha ao clicar fora', async () => {
    montar()
    await userEvent.click(screen.getByRole('button', { name: 'abrir' }))
    expect(screen.getByRole('menuitem')).toBeInTheDocument()

    await userEvent.click(document.body)
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument()
  })

  it('fecha ao premir Escape', async () => {
    montar()
    await userEvent.click(screen.getByRole('button', { name: 'abrir' }))
    expect(screen.getByRole('menuitem')).toBeInTheDocument()

    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument()
  })
})
