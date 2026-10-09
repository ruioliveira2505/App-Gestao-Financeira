/*
 * TESTES DA FORMATAÇÃO DE DATAS
 * ============================
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import { formatarIntervalo, hojeIso, rotuloDiaRelativo } from './datas'

/** ISO (AAAA-MM-DD) de hoje deslocado N dias, em data LOCAL — tal como
 *  rotuloDiaRelativo compara (não UTC, senão a poucas horas da meia-noite
 *  o teste desalinha por um dia). */
function iso(deslocamentoDias: number): string {
  const data = new Date()
  data.setDate(data.getDate() + deslocamentoDias)
  const ano = data.getFullYear()
  const mes = String(data.getMonth() + 1).padStart(2, '0')
  const dia = String(data.getDate()).padStart(2, '0')
  return `${ano}-${mes}-${dia}`
}

describe('rotuloDiaRelativo', () => {
  it('usa "Hoje ·" / "Ontem ·" nos dois dias mais recentes, com a data ao lado', () => {
    expect(rotuloDiaRelativo(iso(0))).toMatch(/^Hoje · \d{1,2} \S+$/)
    expect(rotuloDiaRelativo(iso(-1))).toMatch(/^Ontem · \d{1,2} \S+$/)
  })

  it('usa o dia da semana (capitalizado) nos restantes dias', () => {
    const rotulo = rotuloDiaRelativo(iso(-5))
    expect(rotulo).not.toMatch(/^(Hoje|Ontem)/)
    // "<Prefixo> · <dia> <mês>"
    expect(rotulo).toMatch(/^[A-ZÁ-Ú]\S* · \d{1,2} \S+$/)
  })

  it('acrescenta o ano quando a data é de outro ano', () => {
    const rotulo = rotuloDiaRelativo('2020-03-15')
    expect(rotulo).toMatch(/ 2020$/)
    expect(rotulo).toContain('mar')
  })

  it('tira o ponto que o pt-PT põe na abreviatura do mês ("set." → "set")', () => {
    expect(rotuloDiaRelativo('2020-09-04')).not.toMatch(/\./)
  })
})

describe('formatarIntervalo', () => {
  it('mesmo ano: o ano aparece só uma vez, no fim', () => {
    expect(formatarIntervalo('2026-09-08', '2026-10-07')).toBe('8 set – 7 out 2026')
  })

  it('anos diferentes: o ano aparece em cada ponta', () => {
    expect(formatarIntervalo('2025-12-30', '2026-01-05')).toBe('30 dez 2025 – 5 jan 2026')
  })

  it('só uma ponta', () => {
    expect(formatarIntervalo('2026-03-01', null)).toBe('Desde 1 mar 2026')
    expect(formatarIntervalo(null, '2026-03-31')).toBe('Até 31 mar 2026')
  })

  it('ambas as pontas null → ""', () => {
    expect(formatarIntervalo(null, null)).toBe('')
  })
})

describe('hojeIso', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('dá a data local, e não a UTC, logo a seguir à meia-noite', () => {
    // vi.setSystemTime fixa o relógio do teste. A data é construída em
    // hora LOCAL (3 de julho, 00h30), por isso o resultado esperado não
    // depende do fuso horário da máquina que corre o teste: em Lisboa, no
    // verão, este instante ainda é 2 de julho em UTC, e toISOString()
    // daria o dia errado.
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 6, 3, 0, 30))

    expect(hojeIso()).toBe('2026-07-03')
  })
})
