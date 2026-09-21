/*
 * TESTES DA PÁGINA DE DETALHE DE CATEGORIAS
 * ==========================================
 *
 * Monta a página dentro de um AuthProvider real (moeda principal
 * conhecida) e de um MemoryRouter com "de"/"ate"/"contas" já no URL — a
 * mesma forma como Inicio.tsx a alcança (ver a nota no topo de
 * CategoriasResumo.tsx). Cobre: o esqueleto enquanto o pedido está em
 * curso; a barra empilhada e a lista completa (SEM limite de 4, ao
 * contrário do cartão de Início); o alternador "+/−" a trocar de lista;
 * cada linha a ser um link para "/resumo/categorias/:grupoId" com o
 * mesmo período/contas; o estado vazio; e a falha do pedido.
 */

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { delay, http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

import { servidorMsw } from '../test/servidor-msw'
import { AuthProvider } from '../auth/AuthProvider'
import { CategoriasResumo } from './CategoriasResumo'
import type { GrupoResumo } from '../lib/resumo'

const UTILIZADOR = { id: 'u1', email: 'ana@exemplo.pt', moeda_principal: 'GBP' }

function grupo(overrides: Partial<GrupoResumo>): GrupoResumo {
  return { grupo_id: 'g', nome: 'Grupo', valor: '100.00', percentagem: 100, ...overrides }
}

const RESUMO = {
  saldo_total: '3000.00',
  entradas: '2313.34',
  saidas: '-1202.22',
  liquido: '1111.12',
  categorias_entradas: [
    grupo({ grupo_id: 'e1', nome: 'Salário', valor: '2000.00', percentagem: 86 }),
  ],
  categorias_saidas: [
    grupo({ grupo_id: 's1', nome: 'Habitação', valor: '-698.82', percentagem: 58 }),
    grupo({ grupo_id: 's2', nome: 'Alimentação', valor: '-244.85', percentagem: 20 }),
  ],
  periodo_inicio: '2026-09-01',
  periodo_fim: '2026-09-30',
}

function montar(caminho = '/resumo/categorias?de=2026-09-01&ate=2026-09-30') {
  servidorMsw.use(http.get('/api/auth/me', () => HttpResponse.json(UTILIZADOR)))
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[caminho]}>
        <Routes>
          <Route path="/resumo/categorias" element={<CategoriasResumo />} />
          <Route path="/resumo/categorias/:grupoId" element={<p>página do grupo</p>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  )
}

describe('Página de detalhe de categorias', () => {
  it('mostra o esqueleto enquanto o pedido está em curso', async () => {
    servidorMsw.use(
      http.get('/api/resumo', async () => {
        await delay('infinite')
      }),
    )
    montar()
    expect(await screen.findByRole('status', { name: 'A carregar as categorias' })).toBeInTheDocument()
  })

  it('mostra a lista COMPLETA de Saídas (sem limite de 4), com percentagem', async () => {
    servidorMsw.use(http.get('/api/resumo', () => HttpResponse.json(RESUMO)))
    montar()
    expect(await screen.findByText('Habitação')).toBeInTheDocument()
    expect(screen.getByText('Alimentação')).toBeInTheDocument()
    expect(screen.getByText('698,82 £')).toBeInTheDocument()
    expect(screen.getByText('58%')).toBeInTheDocument()
  })

  it('o subtítulo mostra só o mês do período', async () => {
    servidorMsw.use(http.get('/api/resumo', () => HttpResponse.json(RESUMO)))
    montar()
    await screen.findByText('Habitação')
    expect(screen.getByText('Setembro 2026')).toBeInTheDocument()
  })

  it('clicar em "+" troca para a lista de Entradas', async () => {
    servidorMsw.use(http.get('/api/resumo', () => HttpResponse.json(RESUMO)))
    montar()
    await screen.findByText('Habitação')

    await userEvent.click(screen.getByRole('button', { name: 'Entradas' }))

    expect(screen.getByText('Salário')).toBeInTheDocument()
    expect(screen.queryByText('Habitação')).not.toBeInTheDocument()
  })

  it('cada categoria é um link para a sua página de subcategorias, com o mesmo período', async () => {
    servidorMsw.use(http.get('/api/resumo', () => HttpResponse.json(RESUMO)))
    montar()
    await screen.findByText('Habitação')

    const ligacao = screen.getByRole('link', { name: /Habitação/ })
    expect(ligacao).toHaveAttribute(
      'href',
      '/resumo/categorias/s1?de=2026-09-01&ate=2026-09-30',
    )
  })

  it('o link de cada categoria leva também "contas", quando esta página foi aberta com uma selecção', async () => {
    // O sentido inverso (CategoriaResumoDetalhe.tsx → "‹ Categorias" a
    // preservar "contas") já estava testado; faltava confirmar este —
    // que "parametros.toString()" (usado no <Link> de cada linha) inclui
    // mesmo "contas" quando presente no URL desta própria página, não só
    // "de"/"ate".
    servidorMsw.use(http.get('/api/resumo', () => HttpResponse.json(RESUMO)))
    montar('/resumo/categorias?de=2026-09-01&ate=2026-09-30&contas=c1,c2')
    await screen.findByText('Habitação')

    const ligacao = screen.getByRole('link', { name: /Habitação/ })
    expect(ligacao).toHaveAttribute(
      'href',
      '/resumo/categorias/s1?de=2026-09-01&ate=2026-09-30&contas=c1%2Cc2',
    )
  })

  it('sem saídas neste período, mostra uma mensagem em vez da lista', async () => {
    servidorMsw.use(
      http.get('/api/resumo', () => HttpResponse.json({ ...RESUMO, categorias_saidas: [] })),
    )
    montar()
    expect(await screen.findByText('Sem saídas neste período.')).toBeInTheDocument()
  })

  it('mostra uma mensagem de erro se o pedido falhar', async () => {
    servidorMsw.use(
      http.get('/api/resumo', () => HttpResponse.json({ detail: 'Falha de rede.' }, { status: 500 })),
    )
    montar()
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument()
    })
  })
})
