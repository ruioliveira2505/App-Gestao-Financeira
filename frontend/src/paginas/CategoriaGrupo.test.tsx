/*
 * TESTES DO MODAL DE UM GRUPO DE CATEGORIAS
 * =============================================
 *
 * Cobre: listar subcategorias (e esconder o "⋯" da protegida), adicionar,
 * renomear (grupo e subcategoria), mover uma subcategoria para outro
 * grupo (e mostrar o erro de nome duplicado DENTRO da folha "Mover
 * para"), eliminar — incluindo o passo de migração quando o backend o
 * exige (409) —, e esconder o ícone "Eliminar grupo" num grupo com uma
 * subcategoria protegida (os dois refúgios "Outras Entradas"/"Outras
 * Saídas"). O grupo abre como folha (Folha, direcao="baixo") — o cabeçalho
 * tem "role=dialog" com o nome do grupo como "aria-label", e as suas duas
 * ações vivem num menu "⋯" (reticências na vertical, para se distinguir do
 * "⋯" horizontal de cada subcategoria).
 *
 * Os handlers de mutação (POST/PATCH/DELETE) actualizam "arvoreAtual" em
 * memória, para o pedido GET seguinte (feito pela própria página, depois
 * de cada alteração) já refletir o resultado — sem isto, cada teste teria
 * de simular só o que interessa e ignorar o refetch real que a página faz.
 */

import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

import { servidorMsw } from '../test/servidor-msw'
import { CategoriaGrupo } from './CategoriaGrupo'

type Sub = { id: string; nome: string; protegida: boolean }
type Grupo = { id: string; nome: string; direcao: 'entrada' | 'saida'; subcategorias: Sub[] }

function arvoreInicial(): Grupo[] {
  return [
    {
      id: 'g1',
      nome: 'Alimentação',
      direcao: 'saida',
      subcategorias: [
        { id: 's1', nome: 'Supermercado', protegida: false },
        { id: 's2', nome: 'Restaurantes', protegida: false },
      ],
    },
    { id: 'g2', nome: 'Transportes', direcao: 'saida', subcategorias: [{ id: 's3', nome: 'Combustível', protegida: false }] },
    { id: 'g3', nome: 'Outras Saídas', direcao: 'saida', subcategorias: [{ id: 's4', nome: 'Outros', protegida: true }] },
    { id: 'g4', nome: 'Trabalho', direcao: 'entrada', subcategorias: [{ id: 's5', nome: 'Salário', protegida: false }] },
  ]
}

function usar(arvore: Grupo[]) {
  servidorMsw.use(
    http.get('/api/categorias/arvore', () => HttpResponse.json(arvore)),
    http.post('/api/categorias', async ({ request }) => {
      const corpo = (await request.json()) as { nome: string; parent_id: string }
      const novo: Sub = { id: `novo-${arvore.flatMap((g) => g.subcategorias).length + 1}`, nome: corpo.nome, protegida: false }
      const grupo = arvore.find((g) => g.id === corpo.parent_id)
      grupo?.subcategorias.push(novo)
      return HttpResponse.json({ id: novo.id }, { status: 201 })
    }),
    http.patch('/api/categorias/:id', async ({ request, params }) => {
      const corpo = (await request.json()) as { nome: string; parent_id: string | null }
      const id = params.id as string
      for (const grupo of arvore) {
        if (grupo.id === id) {
          grupo.nome = corpo.nome
          return HttpResponse.json({ id })
        }
        const sub = grupo.subcategorias.find((s) => s.id === id)
        if (sub) {
          sub.nome = corpo.nome
          if (corpo.parent_id && corpo.parent_id !== grupo.id) {
            grupo.subcategorias = grupo.subcategorias.filter((s) => s.id !== id)
            arvore.find((g) => g.id === corpo.parent_id)?.subcategorias.push(sub)
          }
          return HttpResponse.json({ id })
        }
      }
      return HttpResponse.json({ id })
    }),
    http.delete('/api/categorias/:id', ({ params, request }) => {
      const id = params.id as string
      const url = new URL(request.url)
      const migrarParaId = url.searchParams.get('migrar_para_id')

      // "s1" simula uma categoria com movimentos: recusa sem migração.
      if (id === 's1' && !migrarParaId) {
        return HttpResponse.json(
          { detail: '1 movimento(s) usam esta categoria. Indica para onde migrar.' },
          { status: 409 },
        )
      }
      if (migrarParaId) {
        const destino = arvore.flatMap((g) => g.subcategorias).find((s) => s.id === migrarParaId)
        if (!destino) return new HttpResponse(null, { status: 400 })
      }
      const grupo = arvore.find((g) => g.id === id)
      if (grupo) {
        arvore.splice(arvore.indexOf(grupo), 1)
      } else {
        for (const g of arvore) {
          g.subcategorias = g.subcategorias.filter((s) => s.id !== id)
        }
      }
      return new HttpResponse(null, { status: 204 })
    }),
  )
}

function montar(grupoId = 'g1') {
  return render(
    <MemoryRouter initialEntries={[`/categorias/${grupoId}`]}>
      <Routes>
        <Route path="/categorias" element={<p>lista de categorias</p>} />
        <Route path="/categorias/:grupoId" element={<CategoriaGrupo />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('Modal de um grupo de categorias', () => {
  it('mostra o nome do grupo e as suas subcategorias', async () => {
    usar(arvoreInicial())
    montar()

    expect(await screen.findByRole('dialog', { name: 'Alimentação' })).toBeInTheDocument()
    expect(screen.getByText('Supermercado')).toBeInTheDocument()
    expect(screen.getByText('Restaurantes')).toBeInTheDocument()
  })

  it('uma subcategoria protegida não tem "⋯"', async () => {
    usar(arvoreInicial())
    montar('g3')

    await screen.findByText('Outros')
    expect(screen.queryByRole('button', { name: 'Opções de Outros' })).not.toBeInTheDocument()
  })

  it('adiciona uma subcategoria nova', async () => {
    usar(arvoreInicial())
    montar()
    await screen.findByText('Supermercado')

    await userEvent.click(screen.getByRole('button', { name: 'Adicionar subcategoria' }))
    await userEvent.type(screen.getByPlaceholderText('Nome da subcategoria'), 'Take-away')
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }))

    expect(await screen.findByText('Take-away')).toBeInTheDocument()
  })

  it('renomeia uma subcategoria em linha', async () => {
    usar(arvoreInicial())
    montar()
    await screen.findByText('Supermercado')

    await userEvent.click(screen.getByRole('button', { name: 'Opções de Supermercado' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Renomear' }))

    const campo = screen.getByDisplayValue('Supermercado')
    await userEvent.clear(campo)
    await userEvent.type(campo, 'Compras do mês')
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }))

    expect(await screen.findByText('Compras do mês')).toBeInTheDocument()
    expect(screen.queryByText('Supermercado')).not.toBeInTheDocument()
  })

  it('renomeia o grupo, através do "⋯" do cabeçalho', async () => {
    usar(arvoreInicial())
    montar()
    await screen.findByText('Supermercado')

    await userEvent.click(screen.getByRole('button', { name: 'Opções do grupo' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Renomear grupo' }))

    const campo = await screen.findByLabelText('Nome')
    await userEvent.clear(campo)
    await userEvent.type(campo, 'Comida e Bebidas')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(await screen.findByRole('dialog', { name: 'Comida e Bebidas' })).toBeInTheDocument()
  })

  it('move uma subcategoria para outro grupo da mesma direção', async () => {
    usar(arvoreInicial())
    montar()
    await screen.findByText('Supermercado')

    await userEvent.click(screen.getByRole('button', { name: 'Opções de Supermercado' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Mover para outro grupo' }))

    const painel = await screen.findByRole('dialog', { name: 'Mover para' })
    // Só grupos da mesma direção (saída), sem o próprio grupo atual.
    expect(within(painel).getByText('Transportes')).toBeInTheDocument()
    expect(within(painel).getByText('Outras Saídas')).toBeInTheDocument()
    expect(within(painel).queryByText('Trabalho')).not.toBeInTheDocument()
    expect(within(painel).queryByText('Alimentação')).not.toBeInTheDocument()

    await userEvent.click(within(painel).getByText('Transportes'))

    await waitFor(() => expect(screen.queryByText('Supermercado')).not.toBeInTheDocument())
  })

  it('elimina uma subcategoria sem movimentos', async () => {
    usar(arvoreInicial())
    montar()
    await screen.findByText('Restaurantes')

    await userEvent.click(screen.getByRole('button', { name: 'Opções de Restaurantes' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Eliminar' }))
    const dialogo = await screen.findByRole('dialog', { name: 'Eliminar subcategoria' })
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Eliminar' }))

    await waitFor(() => expect(screen.queryByText('Restaurantes')).not.toBeInTheDocument())
  })

  it('eliminar uma categoria com movimentos pede para onde migram', async () => {
    usar(arvoreInicial())
    montar()
    await screen.findByText('Supermercado')

    await userEvent.click(screen.getByRole('button', { name: 'Opções de Supermercado' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Eliminar' }))
    const dialogo = await screen.findByRole('dialog', { name: 'Eliminar subcategoria' })
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Eliminar' }))

    const seletor = await screen.findByRole('dialog', { name: 'Para onde migram os movimentos?' })
    expect(within(seletor).getByText(/1 movimento/)).toBeInTheDocument()
    // "Supermercado" (o próprio) não aparece como destino possível.
    expect(within(seletor).queryByRole('button', { name: 'Supermercado' })).not.toBeInTheDocument()

    await userEvent.click(within(seletor).getByRole('button', { name: 'Restaurantes' }))

    await waitFor(() => expect(screen.queryByText('Supermercado')).not.toBeInTheDocument())
  })

  it('um grupo com uma subcategoria protegida não tem "Eliminar grupo" no menu', async () => {
    usar(arvoreInicial())
    montar('g3')
    await screen.findByRole('dialog', { name: 'Outras Saídas' })

    await userEvent.click(screen.getByRole('button', { name: 'Opções do grupo' }))
    expect(screen.getByRole('menuitem', { name: 'Renomear grupo' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Eliminar grupo' })).not.toBeInTheDocument()
  })

  it('o erro de mover para um grupo com um nome já existente aparece dentro do "Mover para"', async () => {
    usar(arvoreInicial())
    // Sobrepõe só o PATCH: simula o backend a recusar por já existir uma
    // subcategoria com este nome no grupo de destino — o mesmo 400 que a
    // API devolve neste caso.
    servidorMsw.use(
      http.patch('/api/categorias/:id', () =>
        HttpResponse.json({ detail: 'Já existe uma subcategoria com este nome neste grupo.' }, { status: 400 }),
      ),
    )
    montar()
    await screen.findByText('Supermercado')

    await userEvent.click(screen.getByRole('button', { name: 'Opções de Supermercado' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Mover para outro grupo' }))
    const painel = await screen.findByRole('dialog', { name: 'Mover para' })
    await userEvent.click(within(painel).getByText('Transportes'))

    // O erro aparece DENTRO da folha "Mover para" — que continua aberta —,
    // não numa caixa qualquer da página por trás dela.
    expect(await within(painel).findByText(/Já existe uma subcategoria/)).toBeInTheDocument()
    expect(screen.getByText('Supermercado')).toBeInTheDocument()
  })

  it('elimina o grupo e volta à lista de categorias', async () => {
    usar(arvoreInicial())
    montar('g2')
    await screen.findByRole('dialog', { name: 'Transportes' })

    await userEvent.click(screen.getByRole('button', { name: 'Opções do grupo' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Eliminar grupo' }))
    const dialogo = await screen.findByRole('dialog', { name: 'Eliminar grupo' })
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Eliminar' }))

    expect(await screen.findByText('lista de categorias')).toBeInTheDocument()
  })
})
