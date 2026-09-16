/*
 * TESTES DE PerfilSeccao
 * =======================
 *
 * O marcador partilhado pelas três secções do perfil ainda por construir
 * (Conta, Segurança, Preferências — ver a nota no topo de
 * PerfilSeccao.tsx). Cobre-se aqui só o que é seu: o título recebido por
 * prop chega ao cabeçalho, o "Em breve" aparece, e o "‹ voltar" leva a
 * /perfil.
 */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

import { PerfilSeccao } from './PerfilSeccao'

function montar(titulo: string) {
  return render(
    <MemoryRouter initialEntries={['/perfil/seguranca']}>
      <Routes>
        <Route path="/perfil/seguranca" element={<PerfilSeccao titulo={titulo} />} />
        <Route path="/perfil" element={<p>página de perfil</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('PerfilSeccao', () => {
  it('mostra o título recebido e "Em breve"', () => {
    montar('Segurança')

    expect(screen.getByRole('heading', { name: 'Segurança' })).toBeInTheDocument()
    expect(screen.getByText('Em breve.')).toBeInTheDocument()
  })

  it('o "‹ voltar" leva a /perfil', async () => {
    montar('Segurança')

    await userEvent.click(screen.getByRole('link', { name: 'Perfil' }))

    expect(await screen.findByText('página de perfil')).toBeInTheDocument()
  })
})
