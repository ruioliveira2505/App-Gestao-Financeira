/*
 * TESTES DO CampoTexto
 * ====================
 *
 * Confirma o essencial do componente: o rótulo fica ligado ao campo (para
 * clicar no texto focar o campo, e para os leitores de ecrã), o valor
 * recebido é mostrado, e cada alteração é comunicada já como texto (não
 * como evento do DOM).
 */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { CampoTexto } from './CampoTexto'

describe('CampoTexto', () => {
  it('liga o rótulo ao campo e comunica o texto escrito', async () => {
    const aoMudar = vi.fn()
    // getByLabelText só encontra o campo se o <label> e o <input>
    // estiverem associados (htmlFor / id).
    render(<CampoTexto etiqueta="Email" valor="" aoMudar={aoMudar} />)

    await userEvent.type(screen.getByLabelText('Email'), 'a')

    expect(aoMudar).toHaveBeenCalledWith('a')
  })

  it('mostra o valor recebido e aplica o tipo indicado', () => {
    render(
      <CampoTexto etiqueta="Password" tipo="password" valor="segredo" aoMudar={() => {}} />,
    )

    const campo = screen.getByLabelText('Password')
    expect(campo).toHaveValue('segredo')
    expect(campo).toHaveAttribute('type', 'password')
  })
})
