/*
 * TESTES DA PÁGINA DE DETALHE DE UM GRUPO (SUBCATEGORIAS)
 * =========================================================
 *
 * Monta a página dentro de um AuthProvider real e de um MemoryRouter em
 * "/resumo/categorias/:grupoId", com "de"/"ate" no URL — a mesma forma
 * como CategoriasResumo.tsx a alcança. Cobre: o esqueleto; o título e o
 * subtítulo (só o período, no cabeçalho); que o "‹ Categorias" leva
 * consigo o mesmo querystring desta página (não um link às cegas — ver
 * a nota "voltar" em CategoriaResumoDetalhe.tsx); a barra empilhada e
 * a lista de subcategorias, cada uma com a sua percentagem; que todas as
 * subcategorias usam a MESMA cor do grupo, com um TOM diferente cada
 * (não uma cor própria por subcategoria — ver a nota "COR DAS
 * SUBCATEGORIAS" em CategoriaResumoDetalhe.tsx); os DOIS casos de "uma
 * só linha" (ver a mesma nota) — um grupo sem nenhum movimento numa
 * subcategoria real ("Sem subcategoria" + a nota "esta categoria não
 * tem subcategorias") versus uma única subcategoria REAL (sem nota
 * nenhuma); e a falha do pedido.
 */

import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { delay, http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

import { servidorMsw } from '../test/servidor-msw'
import { AuthProvider } from '../auth/AuthProvider'
import { indiceDeCor } from '../lib/corDeterministica'
import { CategoriaResumoDetalhe } from './CategoriaResumoDetalhe'

const UTILIZADOR = { id: 'u1', email: 'ana@exemplo.pt', moeda_principal: 'GBP' }

function montar(caminho = '/resumo/categorias/s1?de=2026-09-01&ate=2026-09-30') {
  servidorMsw.use(http.get('/api/auth/me', () => HttpResponse.json(UTILIZADOR)))
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[caminho]}>
        <Routes>
          <Route path="/resumo/categorias/:grupoId" element={<CategoriaResumoDetalhe />} />
          <Route path="/resumo/categorias" element={<p>lista de categorias</p>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  )
}

describe('Página de detalhe de um grupo (subcategorias)', () => {
  it('mostra o esqueleto enquanto o pedido está em curso', async () => {
    servidorMsw.use(
      http.get('/api/resumo/categorias/:grupoId', async () => {
        await delay('infinite')
      }),
    )
    montar()
    expect(await screen.findByRole('status', { name: 'A carregar a categoria' })).toBeInTheDocument()
  })

  it('mostra o nome do grupo e o período, e a lista de subcategorias com percentagem', async () => {
    servidorMsw.use(
      http.get('/api/resumo/categorias/:grupoId', () =>
        HttpResponse.json({
          grupo_id: 's1',
          nome: 'Habitação',
          valor: '-698.82',
          subcategorias: [
            { subcategoria_id: 'sub1', nome: 'Renda', valor: '-550.00', percentagem: 79 },
            { subcategoria_id: 'sub2', nome: 'Condomínio', valor: '-98.82', percentagem: 14 },
            { subcategoria_id: 'sub3', nome: 'Seguro de Casa', valor: '-50.00', percentagem: 7 },
          ],
        }),
      ),
    )
    montar()

    expect(await screen.findByRole('heading', { name: 'Habitação' })).toBeInTheDocument()
    expect(screen.getByText('Setembro 2026')).toBeInTheDocument()
    expect(screen.getByText('Renda')).toBeInTheDocument()
    expect(screen.getByText('550,00 £')).toBeInTheDocument()
    expect(screen.getByText('79%')).toBeInTheDocument()
    expect(screen.getByText('Condomínio')).toBeInTheDocument()
    expect(screen.getByText('Seguro de Casa')).toBeInTheDocument()
  })

  it('o "‹ Categorias" leva consigo o mesmo período/contas desta página, não um link às cegas', async () => {
    // Bug encontrado em uso real: este link ("LinkVoltar", visível só em
    // ecrã largo) apontava sempre para "/resumo/categorias", sem
    // parâmetros — a categoria seguinte, aberta a partir dessa lista já
    // sem período, perdia o subtítulo (ver a nota "voltar" em
    // CategoriaResumoDetalhe.tsx).
    servidorMsw.use(
      http.get('/api/resumo/categorias/:grupoId', () =>
        HttpResponse.json({
          grupo_id: 's1',
          nome: 'Habitação',
          valor: '-698.82',
          subcategorias: [{ subcategoria_id: 'sub1', nome: 'Renda', valor: '-550.00', percentagem: 100 }],
        }),
      ),
    )
    montar('/resumo/categorias/s1?de=2026-09-01&ate=2026-09-30&contas=c1')
    await screen.findByText('Renda')

    expect(screen.getByRole('link', { name: 'Categorias' })).toHaveAttribute(
      'href',
      '/resumo/categorias?de=2026-09-01&ate=2026-09-30&contas=c1',
    )
  })

  it('todas as subcategorias usam a MESMA cor do grupo, com um TOM diferente cada', async () => {
    servidorMsw.use(
      http.get('/api/resumo/categorias/:grupoId', () =>
        HttpResponse.json({
          grupo_id: 's1',
          nome: 'Habitação',
          valor: '-698.82',
          subcategorias: [
            { subcategoria_id: 'sub1', nome: 'Renda', valor: '-550.00', percentagem: 79 },
            { subcategoria_id: 'sub2', nome: 'Condomínio', valor: '-98.82', percentagem: 14 },
            { subcategoria_id: 'sub3', nome: 'Seguro de Casa', valor: '-50.00', percentagem: 7 },
          ],
        }),
      ),
    )
    const { container } = montar()
    await screen.findByText('Renda')

    // Os pontos das três subcategorias (".ponto", em
    // CategoriaResumoDetalhe.module.css) e os três segmentos da barra
    // (".segmento") têm de ter todos o MESMO "data-cor" — a cor do
    // GRUPO, "indiceDeCor('Habitação')" — e o ciclo de DOIS tons
    // "solido"/"fg" (ver a função "tom" em CategoriaResumoDetalhe.tsx)
    // tem de estar mesmo a repetir-se com a 3.ª subcategoria (volta a
    // "solido") — a prova de que o ciclo se comporta bem com MAIS
    // posições do que tons disponíveis, não só com exactamente duas.
    // Este teste existe precisamente porque uma versão anterior dava a
    // cada subcategoria uma cor hasheada a partir do seu PRÓPRIO nome —
    // sem nada a impedir que colidissem (e chegaram a colidir as três,
    // em uso real).
    const elementos = Array.from(container.querySelectorAll('[data-tom]'))
    expect(elementos).toHaveLength(6) // 3 pontos + 3 segmentos da barra
    const corEsperada = String(indiceDeCor('Habitação'))
    elementos.forEach((el) => {
      expect(el.getAttribute('data-cor')).toBe(corEsperada)
    })
    // "solido" (posições 0 e 2) aparece o dobro de vezes de "fg"
    // (posição 1 só) — confirma o ciclo "solido"/"fg"/"solido", não
    // "solido"/"fg"/"fg" nem uma terceira categoria de tom.
    const contagemPorTom = elementos.reduce<Record<string, number>>((acc, el) => {
      const t = el.getAttribute('data-tom') ?? ''
      acc[t] = (acc[t] ?? 0) + 1
      return acc
    }, {})
    expect(contagemPorTom).toEqual({ solido: 4, fg: 2 })
  })

  it('um grupo sem NENHUM movimento neste período (subcategorias vazio) mostra uma mensagem, não uma barra/lista vazias', async () => {
    // Caso raro (link/marcador antigo para um período em que este grupo
    // já não tem movimentos), mas uma resposta válida da API — diferente
    // do teste seguinte, onde "subcategorias" tem sempre pelo menos uma
    // linha (a "própria" do grupo, sem escolher subcategoria).
    servidorMsw.use(
      http.get('/api/resumo/categorias/:grupoId', () =>
        HttpResponse.json({
          grupo_id: 's1',
          nome: 'Habitação',
          valor: '0.00',
          subcategorias: [],
        }),
      ),
    )
    montar()

    await screen.findByRole('heading', { name: 'Habitação' })
    expect(screen.getByText('Sem movimentos desta categoria neste período.')).toBeInTheDocument()
  })

  it('um grupo sem nenhum movimento numa subcategoria real mostra "Sem subcategoria" e a nota', async () => {
    servidorMsw.use(
      http.get('/api/resumo/categorias/:grupoId', () =>
        HttpResponse.json({
          grupo_id: 's5',
          nome: 'Lazer',
          valor: '-24.04',
          subcategorias: [{ subcategoria_id: 'sub1', nome: 'Lazer', valor: '-24.04', percentagem: 100 }],
        }),
      ),
    )
    montar('/resumo/categorias/s5?de=2026-09-01&ate=2026-09-30')

    await screen.findByRole('heading', { name: 'Lazer' })
    // A única linha É o próprio grupo (ver a nota "DOIS CASOS DE 'UMA
    // SÓ LINHA'" em CategoriaResumoDetalhe.tsx) — mostra-se como "Sem
    // subcategoria", não repetindo "Lazer" (já no título), com a nota.
    expect(screen.getByText('Sem subcategoria')).toBeInTheDocument()
    expect(screen.getByText('Esta categoria não tem subcategorias.')).toBeInTheDocument()
  })

  it('uma única subcategoria REAL (nome diferente do grupo) não mostra nenhuma nota', async () => {
    servidorMsw.use(
      http.get('/api/resumo/categorias/:grupoId', () =>
        HttpResponse.json({
          grupo_id: 's4',
          nome: 'Saúde e Autocuidado',
          valor: '-15.76',
          subcategorias: [
            { subcategoria_id: 'sub1', nome: 'Farmácia', valor: '-15.76', percentagem: 100 },
          ],
        }),
      ),
    )
    montar('/resumo/categorias/s4?de=2026-09-01&ate=2026-09-30')

    await screen.findByRole('heading', { name: 'Saúde e Autocuidado' })
    expect(screen.getByText('Farmácia')).toBeInTheDocument()
    expect(screen.queryByText('Esta categoria não tem subcategorias.')).not.toBeInTheDocument()
    expect(screen.queryByText('Sem subcategoria')).not.toBeInTheDocument()
  })

  it('com mais do que uma subcategoria, a nota não aparece', async () => {
    servidorMsw.use(
      http.get('/api/resumo/categorias/:grupoId', () =>
        HttpResponse.json({
          grupo_id: 's1',
          nome: 'Habitação',
          valor: '-698.82',
          subcategorias: [
            { subcategoria_id: 'sub1', nome: 'Renda', valor: '-550.00', percentagem: 79 },
            { subcategoria_id: 'sub2', nome: 'Condomínio', valor: '-148.82', percentagem: 21 },
          ],
        }),
      ),
    )
    montar()

    await screen.findByText('Renda')
    expect(screen.queryByText('Esta categoria não tem subcategorias.')).not.toBeInTheDocument()
  })

  it('mostra uma mensagem de erro se o pedido falhar', async () => {
    servidorMsw.use(
      http.get('/api/resumo/categorias/:grupoId', () =>
        HttpResponse.json({ detail: 'Falha de rede.' }, { status: 500 }),
      ),
    )
    montar()
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument()
    })
  })
})
