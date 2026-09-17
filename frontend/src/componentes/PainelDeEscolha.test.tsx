/*
 * TESTES DO PainelDeEscolha
 * =========================
 *
 * O painel de "avançar um nível" para escolher um valor de uma lista.
 * Verifica-se: mostra as opções e assinala a escolhida; tocar numa opção
 * comunica-a e fecha; "Voltar" / Escape fecham sem escolher nada.
 *
 * O painel anima a saída antes de desmontar (~250ms) e só no fim corre os
 * callbacks — daí os "waitFor".
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { definirEcraMobile } from '../test/setup'
import { PainelDeEscolha } from './PainelDeEscolha'

const OPCOES = [
  { valor: 'EUR', etiqueta: 'Euro' },
  { valor: 'USD', etiqueta: 'Dólar americano' },
  { valor: 'GBP', etiqueta: 'Libra esterlina' },
]

describe('PainelDeEscolha', () => {
  it('mostra as opções e assinala a que está escolhida', () => {
    render(
      <PainelDeEscolha
        titulo="Moeda"
        opcoes={OPCOES}
        valor="USD"
        aoEscolher={vi.fn()}
        aoFechar={vi.fn()}
      />,
    )

    expect(screen.getByRole('dialog', { name: 'Moeda' })).toBeInTheDocument()
    expect(screen.getByText('Euro')).toBeInTheDocument()
    // A opção atual leva "aria-current".
    expect(screen.getByRole('button', { name: /Dólar americano/ })).toHaveAttribute(
      'aria-current',
      'true',
    )
  })

  it('tocar numa opção comunica-a e fecha o painel', async () => {
    const aoEscolher = vi.fn()
    const aoFechar = vi.fn()
    render(
      <PainelDeEscolha
        titulo="Moeda"
        opcoes={OPCOES}
        valor="EUR"
        aoEscolher={aoEscolher}
        aoFechar={aoFechar}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: /Libra esterlina/ }))

    // A escolha só é aplicada no fim da animação de saída, seguida do fecho.
    await waitFor(() => expect(aoEscolher).toHaveBeenCalledWith('GBP'))
    await waitFor(() => expect(aoFechar).toHaveBeenCalledTimes(1))
  })

  it('"Voltar" fecha sem escolher nada', async () => {
    const aoEscolher = vi.fn()
    const aoFechar = vi.fn()
    render(
      <PainelDeEscolha
        titulo="Moeda"
        opcoes={OPCOES}
        valor="EUR"
        aoEscolher={aoEscolher}
        aoFechar={aoFechar}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Voltar' }))

    await waitFor(() => expect(aoFechar).toHaveBeenCalledTimes(1))
    expect(aoEscolher).not.toHaveBeenCalled()
  })

  it('arrastar o cabeçalho para baixo além do limiar fecha o painel', async () => {
    definirEcraMobile(true) // o arrasto é um gesto de toque — só em mobile.
    const aoFechar = vi.fn()
    render(
      <PainelDeEscolha
        titulo="Moeda"
        opcoes={OPCOES}
        valor="EUR"
        aoEscolher={vi.fn()}
        aoFechar={aoFechar}
      />,
    )

    const dialogo = screen.getByRole('dialog', { name: 'Moeda' })
    // ".cabecalho" é o primeiro filho de ".painelInterior", não
    // directamente do "dialog" — ver a nota em Folha.module.css.
    const cabecalho = dialogo.firstElementChild?.firstElementChild as HTMLElement

    fireEvent.pointerDown(cabecalho, { clientY: 80, pointerId: 1 })
    fireEvent.pointerMove(cabecalho, { clientY: 320, pointerId: 1 })
    fireEvent.pointerUp(cabecalho, { clientY: 320, pointerId: 1 })

    await waitFor(() => expect(aoFechar).toHaveBeenCalledTimes(1))
  })

  it('a tecla Escape fecha o painel', async () => {
    const aoFechar = vi.fn()
    render(
      <PainelDeEscolha
        titulo="Moeda"
        opcoes={OPCOES}
        valor="EUR"
        aoEscolher={vi.fn()}
        aoFechar={aoFechar}
      />,
    )

    await userEvent.keyboard('{Escape}')

    await waitFor(() => expect(aoFechar).toHaveBeenCalledTimes(1))
  })

  // "direcao='baixo'" — ver a nota "DUAS DIREÇÕES" no topo do ficheiro:
  // usada quando não há nenhuma folha por trás (ex.: a moeda principal em
  // Preferências), ao contrário da "direita" testada acima (usada dentro
  // de um fluxo já aberto, ex.: a moeda de uma conta).
  describe('direcao="baixo"', () => {
    it('o botão de fechar chama-se "Fechar", não "Voltar" — não há para onde recuar', () => {
      render(
        <PainelDeEscolha
          titulo="Moeda"
          opcoes={OPCOES}
          valor="EUR"
          aoEscolher={vi.fn()}
          aoFechar={vi.fn()}
          direcao="baixo"
        />,
      )

      expect(screen.getByRole('button', { name: 'Fechar' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Voltar' })).not.toBeInTheDocument()
    })

    it('tocar em "Fechar" fecha o painel sem escolher nada', async () => {
      const aoEscolher = vi.fn()
      const aoFechar = vi.fn()
      render(
        <PainelDeEscolha
          titulo="Moeda"
          opcoes={OPCOES}
          valor="EUR"
          aoEscolher={aoEscolher}
          aoFechar={aoFechar}
          direcao="baixo"
        />,
      )

      await userEvent.click(screen.getByRole('button', { name: 'Fechar' }))

      await waitFor(() => expect(aoFechar).toHaveBeenCalledTimes(1))
      expect(aoEscolher).not.toHaveBeenCalled()
    })
  })
})
