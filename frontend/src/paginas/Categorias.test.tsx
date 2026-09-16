/*
 * TESTES DA PÁGINA CATEGORIAS (a lista de grupos)
 * ==================================================
 */

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

import { servidorMsw } from '../test/servidor-msw'
import { Categorias } from './Categorias'

const ARVORE = [
  { id: 'g1', nome: 'Trabalho', direcao: 'entrada', subcategorias: [{ id: 's1', nome: 'Salário', protegida: false }] },
  {
    id: 'g2',
    nome: 'Outras Entradas',
    direcao: 'entrada',
    subcategorias: [{ id: 's2', nome: 'Outros', protegida: true }],
  },
  {
    id: 'g3',
    nome: 'Alimentação',
    direcao: 'saida',
    subcategorias: [
      { id: 's3', nome: 'Supermercado', protegida: false },
      { id: 's4', nome: 'Restaurantes', protegida: false },
    ],
  },
]

function montar() {
  servidorMsw.use(http.get('/api/categorias/arvore', () => HttpResponse.json(ARVORE)))
  return render(
    <MemoryRouter initialEntries={['/categorias']}>
      <Routes>
        <Route path="/categorias" element={<Categorias />} />
        <Route path="/categorias/novo" element={<p>novo grupo</p>} />
        <Route path="/categorias/:grupoId" element={<p>grupo</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('Página Categorias', () => {
  it('mostra os grupos em duas secções, Entradas e Saídas', async () => {
    montar()

    const secaoEntradas = (await screen.findByText('Entradas')).closest('section') as HTMLElement
    expect(secaoEntradas).toHaveTextContent('Trabalho')
    expect(secaoEntradas).toHaveTextContent('Outras Entradas')

    const secaoSaidas = screen.getByText('Saídas').closest('section') as HTMLElement
    expect(secaoSaidas).toHaveTextContent('Alimentação')
  })

  it('mostra a contagem de subcategorias de cada grupo', async () => {
    montar()

    // "Trabalho" e "Outras Entradas" têm as duas 1 subcategoria só.
    expect((await screen.findAllByText('1 subcategoria')).length).toBe(2)
    expect(screen.getByText('2 subcategorias')).toBeInTheDocument()
  })

  it('cada grupo é um link para a sua página', async () => {
    montar()

    expect(await screen.findByRole('link', { name: /Alimentação/ })).toHaveAttribute(
      'href',
      '/categorias/g3',
    )
  })

  it('o "+" no cabeçalho leva a criar um grupo novo', async () => {
    montar()

    expect(await screen.findByRole('link', { name: 'Novo grupo' })).toHaveAttribute(
      'href',
      '/categorias/novo',
    )
  })

  it('se o pedido da árvore falhar, mostra o erro em vez da lista', async () => {
    // Não usa montar(): esse auxiliar regista sempre, por baixo, o seu
    // próprio handler de SUCESSO para "/api/categorias/arvore" — como é
    // chamado depois de qualquer "servidorMsw.use()" do próprio teste,
    // ganharia sempre ao handler de falha registado aqui (ver o mesmo
    // problema, já documentado, em MovimentoNovo.test.tsx).
    servidorMsw.use(
      http.get('/api/categorias/arvore', () =>
        HttpResponse.json({ detail: 'Falha de rede.' }, { status: 500 }),
      ),
    )
    render(
      <MemoryRouter initialEntries={['/categorias']}>
        <Routes>
          <Route path="/categorias" element={<Categorias />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByRole('alert')).toHaveTextContent('Falha de rede.')
    expect(screen.queryByText('Trabalho')).not.toBeInTheDocument()
  })
})
