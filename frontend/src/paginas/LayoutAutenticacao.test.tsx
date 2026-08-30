/*
 * TESTE DO LayoutAutenticacao
 * ===========================
 *
 * O componente é só uma moldura visual, sem lógica. O teste confirma
 * apenas o essencial: que o título recebido aparece como cabeçalho e que
 * o conteúdo passado como filho é renderizado.
 */

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { LayoutAutenticacao } from './LayoutAutenticacao'

describe('LayoutAutenticacao', () => {
  it('mostra o título como cabeçalho e o conteúdo recebido', () => {
    render(
      <LayoutAutenticacao titulo="Iniciar sessão">
        <p>conteúdo do formulário</p>
      </LayoutAutenticacao>,
    )

    expect(screen.getByRole('heading', { name: 'Iniciar sessão' })).toBeInTheDocument()
    expect(screen.getByText('conteúdo do formulário')).toBeInTheDocument()
  })
})
