/*
 * TESTES DO Botao
 * ===============
 *
 * O componente é um <button> com estilo. Os testes cobrem o
 * comportamento que ele acrescenta ou garante: mostra o conteúdo, reage
 * ao clique, não reage quando desativado, e assume type="button" por
 * omissão (para não submeter formulários sem que isso seja pedido).
 */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { Botao } from './Botao'

describe('Botao', () => {
  it('mostra o conteúdo e chama onClick ao ser clicado', async () => {
    const aoClicar = vi.fn()
    render(<Botao onClick={aoClicar}>Guardar</Botao>)

    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(aoClicar).toHaveBeenCalledTimes(1)
  })

  it('não dispara onClick quando está desativado', async () => {
    const aoClicar = vi.fn()
    render(
      <Botao onClick={aoClicar} disabled>
        Guardar
      </Botao>,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(aoClicar).not.toHaveBeenCalled()
  })

  it('assume type="button" por omissão', () => {
    render(<Botao>Guardar</Botao>)

    expect(screen.getByRole('button', { name: 'Guardar' })).toHaveAttribute('type', 'button')
  })
})
