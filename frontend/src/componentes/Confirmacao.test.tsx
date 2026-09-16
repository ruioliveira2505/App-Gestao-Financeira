/*
 * TESTES DO Confirmacao
 * ======================
 *
 * Cobre o que é específico deste componente (o resto — quando abre, o
 * que faz ao confirmar — já é testado indirectamente através das páginas
 * que o usam, ex.: ContaEditar, Movimentos): a armadilha de foco (o Tab
 * não sai do diálogo) e a devolução do foco a quem o abriu, ao fechar —
 * ambas acrescentadas nesta ronda de revisão, como correcção a uma
 * lacuna de acessibilidade (um diálogo "aria-modal" que não impedia,
 * de facto, o Tab de sair para a página por trás).
 */

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { Confirmacao } from './Confirmacao'

describe('Confirmacao', () => {
  it('ao abrir, o foco vai para "Cancelar"', () => {
    render(
      <Confirmacao titulo="Eliminar" aoConfirmar={vi.fn()} aoCancelar={vi.fn()}>
        Tens a certeza?
      </Confirmacao>,
    )

    expect(screen.getByRole('button', { name: 'Cancelar' })).toHaveFocus()
  })

  it('o Tab não deixa o foco sair do diálogo — prende-o entre "Confirmar" e "Cancelar"', () => {
    render(
      <Confirmacao titulo="Eliminar" aoConfirmar={vi.fn()} aoCancelar={vi.fn()}>
        Tens a certeza?
      </Confirmacao>,
    )

    const confirmar = screen.getByRole('button', { name: 'Confirmar' })
    const cancelar = screen.getByRole('button', { name: 'Cancelar' })

    // Já está em "Cancelar" (o último elemento focável) — Tab para a
    // frente volta ao primeiro ("Confirmar"), em vez de sair do diálogo.
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(confirmar).toHaveFocus()

    // Shift+Tab a partir do primeiro volta ao último.
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(cancelar).toHaveFocus()
  })

  it('o Escape chama aoCancelar', () => {
    const aoCancelar = vi.fn()
    render(
      <Confirmacao titulo="Eliminar" aoConfirmar={vi.fn()} aoCancelar={aoCancelar}>
        Tens a certeza?
      </Confirmacao>,
    )

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(aoCancelar).toHaveBeenCalledTimes(1)
  })

  it('ao fechar (desmontar), devolve o foco a quem o abriu', () => {
    // O botão "Abrir" tem o foco no instante em que Confirmacao monta —
    // tal como aconteceria a sério (o utilizador tocou nele para abrir
    // esta confirmação).
    render(<button type="button">Abrir</button>)
    const abrir = screen.getByRole('button', { name: 'Abrir' })
    abrir.focus()
    expect(abrir).toHaveFocus()

    const { unmount } = render(
      <Confirmacao titulo="Eliminar" aoConfirmar={vi.fn()} aoCancelar={vi.fn()}>
        Tens a certeza?
      </Confirmacao>,
    )
    // Ao montar, o foco sai do "Abrir" e vai para "Cancelar".
    expect(screen.getByRole('button', { name: 'Cancelar' })).toHaveFocus()

    unmount()

    expect(abrir).toHaveFocus()
  })
})
