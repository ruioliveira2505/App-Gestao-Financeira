/*
 * TESTES DAS FUNÇÕES PURAS DOS FILTROS DE MOVIMENTOS
 * =================================================
 *
 * Cobrem o que não depende de React: ler/escrever os filtros no URL,
 * contá-los e aplicá-los a uma lista. A interface (a folha) é testada em
 * Movimentos.test.tsx.
 */

import { describe, expect, it } from 'vitest'

import {
  aplicarFiltros,
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
import type { Movimento } from './movimentos'

/** ISO local (AAAA-MM-DD) — igual ao que intervaloDoPreset usa por dentro
 *  (meia-noite LOCAL, não UTC). */
function isoLocal(data: Date): string {
  const ano = data.getFullYear()
  const mes = String(data.getMonth() + 1).padStart(2, '0')
  const dia = String(data.getDate()).padStart(2, '0')
  return `${ano}-${mes}-${dia}`
}

/** Um movimento mínimo, só com o que os filtros olham. */
function movimento(sobrepor: Partial<Movimento>): Movimento {
  return {
    id: 'm',
    conta_id: 'c1',
    data: '2026-06-15',
    descricao: 'Teste',
    valor: '-10.00',
    created_at: '2026-06-15T00:00:00Z',
    updated_at: '2026-06-15T00:00:00Z',
    ...sobrepor,
  }
}

describe('lerFiltros / escreverFiltros', () => {
  it('faz a ida e volta de todos os campos', () => {
    const filtros = {
      tipo: 'saida' as const,
      contas: ['c1', 'c2'],
      de: '2026-01-01',
      ate: '2026-03-31',
    }
    const params = escreverFiltros(filtros)
    expect(params.get('tipo')).toBe('saida')
    expect(params.get('contas')).toBe('c1,c2')
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

describe('aplicarFiltros', () => {
  const movimentos = [
    movimento({ id: 'a', conta_id: 'c1', valor: '50.00', data: '2026-02-10' }),
    movimento({ id: 'b', conta_id: 'c2', valor: '-30.00', data: '2026-05-20' }),
    movimento({ id: 'c', conta_id: 'c1', valor: '-8.00', data: '2026-08-01' }),
  ]

  it('filtra por tipo (entrada = valor >= 0)', () => {
    expect(
      aplicarFiltros(movimentos, { ...FILTROS_VAZIOS, tipo: 'entrada' }).map((m) => m.id),
    ).toEqual(['a'])
  })

  it('filtra por conta (várias contas = qualquer uma delas)', () => {
    expect(
      aplicarFiltros(movimentos, { ...FILTROS_VAZIOS, contas: ['c1'] }).map((m) => m.id),
    ).toEqual(['a', 'c'])
  })

  it('filtra por intervalo de datas, inclusive nas pontas', () => {
    expect(
      aplicarFiltros(movimentos, {
        ...FILTROS_VAZIOS,
        de: '2026-02-10',
        ate: '2026-05-20',
      }).map((m) => m.id),
    ).toEqual(['a', 'b'])
  })

  it('combina os filtros (todos têm de passar)', () => {
    expect(
      aplicarFiltros(movimentos, {
        ...FILTROS_VAZIOS,
        tipo: 'saida',
        contas: ['c1'],
      }).map((m) => m.id),
    ).toEqual(['c'])
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
