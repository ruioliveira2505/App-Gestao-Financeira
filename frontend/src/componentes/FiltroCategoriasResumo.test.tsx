/*
 * TESTES DO FiltroCategoriasResumo
 * =================================
 *
 * O componente não faz nenhum pedido à API nem depende de router — recebe
 * a árvore, a direcção e a selecção actual todas por prop, e devolve a
 * nova selecção via "aoMudar". Cobre: nenhum grupo desta direcção (não
 * desenha nada); o "aria-label" do gatilho a mudar consoante haja ou não
 * filtro activo; a folha só mostra os grupos da direcção pedida; "Todas"
 * limpa a selecção; marcar uma subcategoria isolada; marcar/desmarcar um
 * GRUPO inteiro de uma vez ao tocar no seu cabeçalho (inclui o id do
 * próprio grupo, não só as subcategorias — ver a nota "O ID DO PRÓPRIO
 * GRUPO" no topo de FiltroCategoriasResumo.tsx); e a colapsagem para
 * "Todas" (selecção vazia) quando a selecção resultante passa a incluir
 * TODOS os ids possíveis desta direcção — o comportamento central de
 * "aplicar", em FiltroCategoriasResumo.tsx.
 */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { FiltroCategoriasResumo } from './FiltroCategoriasResumo'
import type { GrupoArvore } from '../lib/categorias'

const ARVORE: GrupoArvore[] = [
  {
    id: 'g1',
    nome: 'Alimentação',
    direcao: 'saida',
    subcategorias: [
      { id: 's1', nome: 'Supermercado', protegida: false },
      { id: 's2', nome: 'Restaurantes', protegida: false },
    ],
  },
  {
    id: 'g2',
    nome: 'Transportes',
    direcao: 'saida',
    subcategorias: [{ id: 's3', nome: 'Combustível', protegida: false }],
  },
  {
    id: 'g3',
    nome: 'Salário',
    direcao: 'entrada',
    subcategorias: [],
  },
]

describe('FiltroCategoriasResumo', () => {
  it('não desenha nada quando a árvore não tem nenhum grupo desta direcção', () => {
    const { container } = render(
      <FiltroCategoriasResumo arvore={[ARVORE[2]]} direcao="saida" seleccionadas={[]} aoMudar={vi.fn()} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('o nome acessível do gatilho muda quando há um filtro activo', () => {
    const { rerender } = render(
      <FiltroCategoriasResumo arvore={ARVORE} direcao="saida" seleccionadas={[]} aoMudar={vi.fn()} />,
    )
    expect(screen.getByRole('button', { name: 'Categorias' })).toBeInTheDocument()

    rerender(
      <FiltroCategoriasResumo arvore={ARVORE} direcao="saida" seleccionadas={['s1']} aoMudar={vi.fn()} />,
    )
    expect(screen.getByRole('button', { name: 'Categorias (filtro activo)' })).toBeInTheDocument()
  })

  it('a folha só mostra os grupos da direcção pedida', async () => {
    render(<FiltroCategoriasResumo arvore={ARVORE} direcao="saida" seleccionadas={[]} aoMudar={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Categorias' }))

    expect(screen.getByText('Todas')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Alimentação' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Transportes' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Supermercado' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Combustível' })).toBeInTheDocument()
    // "Salário" é de "entrada" — não deve aparecer na folha de "saida".
    expect(screen.queryByRole('button', { name: 'Salário' })).not.toBeInTheDocument()
  })

  it('tocar em "Todas" limpa a selecção', async () => {
    const aoMudar = vi.fn()
    render(
      <FiltroCategoriasResumo arvore={ARVORE} direcao="saida" seleccionadas={['s1']} aoMudar={aoMudar} />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Categorias (filtro activo)' }))

    await userEvent.click(screen.getByRole('button', { name: 'Todas' }))

    expect(aoMudar).toHaveBeenCalledWith([])
  })

  it('tocar numa subcategoria isolada acrescenta-a à selecção', async () => {
    const aoMudar = vi.fn()
    render(<FiltroCategoriasResumo arvore={ARVORE} direcao="saida" seleccionadas={[]} aoMudar={aoMudar} />)
    await userEvent.click(screen.getByRole('button', { name: 'Categorias' }))

    await userEvent.click(screen.getByRole('button', { name: 'Supermercado' }))

    expect(aoMudar).toHaveBeenCalledWith(['s1'])
  })

  it('tocar no cabeçalho de um grupo marca o grupo INTEIRO de uma vez — o próprio id do grupo incluído', async () => {
    const aoMudar = vi.fn()
    render(<FiltroCategoriasResumo arvore={ARVORE} direcao="saida" seleccionadas={[]} aoMudar={aoMudar} />)
    await userEvent.click(screen.getByRole('button', { name: 'Categorias' }))

    await userEvent.click(screen.getByRole('button', { name: 'Alimentação' }))

    // "g1" (o próprio grupo) + as duas subcategorias — não só estas.
    expect(aoMudar).toHaveBeenCalledWith(['g1', 's1', 's2'])
  })

  it('tocar de novo no cabeçalho de um grupo já todo marcado desmarca-o por completo', async () => {
    const aoMudar = vi.fn()
    render(
      <FiltroCategoriasResumo
        arvore={ARVORE}
        direcao="saida"
        seleccionadas={['g1', 's1', 's2']}
        aoMudar={aoMudar}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Categorias (filtro activo)' }))

    await userEvent.click(screen.getByRole('button', { name: 'Alimentação' }))

    expect(aoMudar).toHaveBeenCalledWith([])
  })

  it('marcar o último grupo em falta — ficando TUDO marcado — colapsa de volta para "Todas" (selecção vazia)', async () => {
    const aoMudar = vi.fn()
    // "Alimentação" já está toda marcada; falta só "Transportes" para a
    // selecção cobrir TODOS os ids possíveis desta direcção.
    render(
      <FiltroCategoriasResumo
        arvore={ARVORE}
        direcao="saida"
        seleccionadas={['g1', 's1', 's2']}
        aoMudar={aoMudar}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Categorias (filtro activo)' }))

    await userEvent.click(screen.getByRole('button', { name: 'Transportes' }))

    // Marcar tudo tem o MESMO efeito prático que "Todas" — a selecção
    // colapsa para [], em vez de ficar uma lista com cada id escrito à mão.
    expect(aoMudar).toHaveBeenCalledWith([])
  })
})
