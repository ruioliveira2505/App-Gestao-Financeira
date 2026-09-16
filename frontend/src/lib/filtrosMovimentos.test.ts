/*
 * TESTES DAS FUNÇÕES PURAS DOS FILTROS DE MOVIMENTOS
 * =================================================
 *
 * Cobrem o que não depende de React: ler/escrever os filtros no URL e
 * contá-los. A filtragem em si passou para o backend (ver a nota no topo
 * de filtrosMovimentos.ts) — testada em tests/test_movimentos.py, no
 * backend. A interface (a folha) é testada em Movimentos.test.tsx.
 */

import { describe, expect, it } from 'vitest'

import {
  contarFiltrosAtivos,
  escreverFiltros,
  FILTROS_VAZIOS,
  intervaloDoMes,
  intervaloDoPreset,
  lerFiltros,
  mesDeIntervalo,
  PRESETS,
  presetAtivo,
  ROTULO_PRESET,
} from './filtrosMovimentos'

/** ISO local (AAAA-MM-DD) — igual ao que intervaloDoPreset usa por dentro
 *  (meia-noite LOCAL, não UTC). */
function isoLocal(data: Date): string {
  const ano = data.getFullYear()
  const mes = String(data.getMonth() + 1).padStart(2, '0')
  const dia = String(data.getDate()).padStart(2, '0')
  return `${ano}-${mes}-${dia}`
}

describe('lerFiltros / escreverFiltros', () => {
  it('faz a ida e volta de todos os campos', () => {
    const filtros = {
      tipo: 'saida' as const,
      contas: ['c1', 'c2'],
      categorias: ['cat1', 'cat2'],
      de: '2026-01-01',
      ate: '2026-03-31',
    }
    const params = escreverFiltros(filtros)
    expect(params.get('tipo')).toBe('saida')
    expect(params.get('contas')).toBe('c1,c2')
    expect(params.get('categorias')).toBe('cat1,cat2')
    expect(lerFiltros(params)).toEqual(filtros)
  })

  it('omite do URL o que está no estado por omissão', () => {
    expect(escreverFiltros(FILTROS_VAZIOS).toString()).toBe('')
  })

  it('ignora um "tipo" que não seja "entrada" nem "saida"', () => {
    expect(lerFiltros(new URLSearchParams('tipo=xpto')).tipo).toBeNull()
  })
})

describe('contarFiltrosAtivos', () => {
  it('conta tipo, contas e o intervalo de datas como um filtro cada', () => {
    expect(contarFiltrosAtivos(FILTROS_VAZIOS)).toBe(0)
    expect(contarFiltrosAtivos({ ...FILTROS_VAZIOS, tipo: 'entrada' })).toBe(1)
    expect(
      contarFiltrosAtivos({ ...FILTROS_VAZIOS, contas: ['c1'], de: '2026-01-01' }),
    ).toBe(2)
  })

  it('as datas contam como UM filtro mesmo com só uma ponta', () => {
    expect(contarFiltrosAtivos({ ...FILTROS_VAZIOS, ate: '2026-12-31' })).toBe(1)
  })
})

describe('atalhos de datas', () => {
  it('são três janelas móveis (7 / 30 / 90 dias)', () => {
    expect(PRESETS).toEqual(['7d', '30d', '90d'])
    expect(ROTULO_PRESET['7d']).toBe('Últimos 7 dias')
    expect(ROTULO_PRESET['90d']).toBe('Últimos 90 dias')
  })

  it('cada janela móvel acaba HOJE e recua N-1 dias', () => {
    const hoje = new Date()
    hoje.setHours(0, 0, 0, 0)
    const hojeIso = isoLocal(hoje)

    for (const [preset, dias] of [
      ['7d', 7],
      ['30d', 30],
      ['90d', 90],
    ] as const) {
      const { de, ate } = intervaloDoPreset(preset)
      expect(ate).toBe(hojeIso)
      const inicio = new Date(hoje)
      inicio.setDate(inicio.getDate() - (dias - 1))
      expect(de).toBe(isoLocal(inicio))
    }
  })

  it('presetAtivo reconhece um intervalo que corresponde a uma janela', () => {
    const intervalo = intervaloDoPreset('30d')
    expect(
      presetAtivo({ ...FILTROS_VAZIOS, de: intervalo.de, ate: intervalo.ate }),
    ).toBe('30d')
    expect(
      presetAtivo({ ...FILTROS_VAZIOS, de: '2000-01-01', ate: '2000-06-30' }),
    ).toBeNull()
  })
})

describe('mês específico', () => {
  it('intervaloDoMes vai do dia 1 ao último dia do mês', () => {
    expect(intervaloDoMes('2026-02')).toEqual({ de: '2026-02-01', ate: '2026-02-28' })
    expect(intervaloDoMes('2026-03')).toEqual({ de: '2026-03-01', ate: '2026-03-31' })
  })

  it('mesDeIntervalo reconhece um mês de calendário completo, e só esse', () => {
    expect(
      mesDeIntervalo({ ...FILTROS_VAZIOS, de: '2026-03-01', ate: '2026-03-31' }),
    ).toBe('2026-03')
    // Não é o mês completo (falta o último dia).
    expect(
      mesDeIntervalo({ ...FILTROS_VAZIOS, de: '2026-03-01', ate: '2026-03-20' }),
    ).toBeNull()
    // Não começa no dia 1.
    expect(
      mesDeIntervalo({ ...FILTROS_VAZIOS, de: '2026-03-05', ate: '2026-03-31' }),
    ).toBeNull()
  })
})
