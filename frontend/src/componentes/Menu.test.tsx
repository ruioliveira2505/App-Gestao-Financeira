/*
 * TESTES DO Menu
 * ==============
 *
 * Cobrem o comportamento de abrir/fechar: abre ao clicar no gatilho;
 * fecha ao clicar num item (chamando a acção desse item), ao clicar fora,
 * e ao premir Escape — o fecho é animado (o painel desvanece antes de
 * sair), por isso espera-se por ele com waitFor. E um item desativado: visível, com a razão, mas sem
 * fazer nada nem fechar o menu.
 */

import { render, screen, waitFor } from '@testing-library/react'
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
    await waitFor(() => expect(screen.queryByRole('menuitem')).not.toBeInTheDocument())
  })

  it('fecha ao clicar fora', async () => {
    montar()
    await userEvent.click(screen.getByRole('button', { name: 'abrir' }))
    expect(screen.getByRole('menuitem')).toBeInTheDocument()

    await userEvent.click(document.body)
    await waitFor(() => expect(screen.queryByRole('menuitem')).not.toBeInTheDocument())
  })

  it('fecha ao premir Escape', async () => {
    montar()
    await userEvent.click(screen.getByRole('button', { name: 'abrir' }))
    expect(screen.getByRole('menuitem')).toBeInTheDocument()

    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menuitem')).not.toBeInTheDocument())
  })

  it('um item desativado mostra a razão, não faz nada e não fecha o menu', async () => {
    const aoEscolher = vi.fn()
    render(
      <Menu
        gatilho={({ aberto, alternar }) => (
          <button type="button" aria-expanded={aberto} onClick={alternar}>
            abrir
          </button>
        )}
      >
        <MenuItem onClick={aoEscolher} desativado descricao="Nenhuma conta ligada">
          Sincronizar agora
        </MenuItem>
      </Menu>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'abrir' }))

    const item = screen.getByRole('menuitem', { name: /Sincronizar agora/ })
    expect(item).toHaveAttribute('aria-disabled', 'true')
    expect(item).toHaveTextContent('Nenhuma conta ligada')

    await userEvent.click(item)
    expect(aoEscolher).not.toHaveBeenCalled()
    expect(screen.getByRole('menuitem', { name: /Sincronizar agora/ })).toBeInTheDocument()
  })

  it('tocar no gatilho enquanto o menu desvanece reabre-o', async () => {
    montar()
    const gatilho = screen.getByRole('button', { name: 'abrir' })
    await userEvent.click(gatilho)
    await userEvent.click(gatilho) // começa a fechar
    await userEvent.click(gatilho) // reabre, a meio do fecho

    expect(gatilho).toHaveAttribute('aria-expanded', 'true')
    // Passado o tempo do fecho, continua aberto.
    await new Promise((r) => setTimeout(r, 300))
    expect(screen.getByRole('menuitem', { name: 'Acção' })).toBeInTheDocument()
  })
})
