/*
 * TESTES DA FORMATAÇÃO DE DATAS
 * ============================
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import { diaCurto, formatarDataCurta, formatarIntervalo, hojeIso, mesmoDia, rotuloDiaRelativo, tempoDecorrido } from './datas'

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

describe('tempoDecorrido', () => {
  // Um momento fixo, para os testes não dependerem da hora em que correm.
  const AGORA = new Date('2026-10-13T12:00:00Z')
  const antes = (ms: number) => new Date(AGORA.getTime() - ms).toISOString()
  const MIN = 60 * 1000
  const HORA = 60 * MIN
  const DIA = 24 * HORA

  it('menos de um minuto é «agora»', () => {
    expect(tempoDecorrido(antes(20 * 1000), AGORA)).toBe('agora')
  })

  it('em minutos, horas e dias, com o singular certo', () => {
    expect(tempoDecorrido(antes(5 * MIN), AGORA)).toBe('há 5 min')
    expect(tempoDecorrido(antes(HORA), AGORA)).toBe('há 1 hora')
    expect(tempoDecorrido(antes(2 * HORA + 10 * MIN), AGORA)).toBe('há 2 horas')
    expect(tempoDecorrido(antes(DIA), AGORA)).toBe('há 1 dia')
    expect(tempoDecorrido(antes(3 * DIA), AGORA)).toBe('há 3 dias')
  })

  it('nos limites: 59 min, 23 horas, 6 dias', () => {
    expect(tempoDecorrido(antes(59 * MIN), AGORA)).toBe('há 59 min')
    expect(tempoDecorrido(antes(23 * HORA + 59 * MIN), AGORA)).toBe('há 23 horas')
    expect(tempoDecorrido(antes(6 * DIA + 23 * HORA), AGORA)).toBe('há 6 dias')
  })

  it('uma data no futuro (relógio desacertado) é «agora»; uma inválida dá texto vazio', () => {
    expect(tempoDecorrido(new Date(AGORA.getTime() + 5 * MIN).toISOString(), AGORA)).toBe('agora')
    expect(tempoDecorrido('não é uma data', AGORA)).toBe('')
  })

  it('a partir de uma semana, a data curta', () => {
    expect(tempoDecorrido('2026-09-02T10:00:00Z', AGORA)).toBe('a 2 set')
  })
})

describe('diaCurto', () => {
  it('dia e mês abreviado; o ano só se não for o atual', () => {
    const agora = new Date('2026-10-13T12:00:00Z')
    expect(diaCurto('2026-09-02T10:00:00Z', agora)).toBe('2 set')
    expect(diaCurto('2025-12-30T10:00:00Z', agora)).toBe('30 dez 2025')
  })
})

describe('mesmoDia', () => {
  it('compara o dia no fuso do aparelho', () => {
    const agora = new Date(2026, 9, 13, 18, 0)
    expect(mesmoDia(new Date(2026, 9, 13, 0, 5).toISOString(), agora)).toBe(true)
    expect(mesmoDia(new Date(2026, 9, 12, 23, 55).toISOString(), agora)).toBe(false)
  })
})

describe('formatarDataCurta', () => {
  it('dia sem zero à frente, mês abreviado em minúsculas e ano', () => {
    expect(formatarDataCurta('2026-07-03')).toBe('3 jul 2026')
    expect(formatarDataCurta('2026-01-01')).toBe('1 jan 2026')
    expect(formatarDataCurta('2025-12-31')).toBe('31 dez 2025')
  })

  it('aceita também um instante ISO (só conta a data)', () => {
    expect(formatarDataCurta('2026-10-14T09:30:00Z')).toBe('14 out 2026')
  })
})
