/*
 * TESTES DE moedas.ts
 * ===================
 */

import { describe, expect, it } from 'vitest'

import { formatarDinheiro, OPCOES_MOEDA } from './moedas'

describe('formatarDinheiro', () => {
  it('formata em euros no formato português (vírgula decimal, símbolo)', () => {
    const texto = formatarDinheiro('1234.56', 'EUR')
    expect(texto).toContain('234,56')
    expect(texto).toContain('€')
  })

  it('mantém o sinal em valores negativos', () => {
    expect(formatarDinheiro('-50.00', 'EUR')).toContain('-')
  })

  it('cai num formato simples quando o código de moeda é inválido', () => {
    // "X" não tem 3 letras — o Intl.NumberFormat rejeita-o.
    expect(formatarDinheiro('10.00', 'X')).toBe('10.00 X')
  })
})

describe('OPCOES_MOEDA', () => {
  it('inclui todas as moedas suportadas, ordenadas por nome', () => {
    const valores = OPCOES_MOEDA.map((o) => o.valor)
    expect(valores).toContain('EUR')
    expect(valores).toContain('USD')
    expect(valores.length).toBe(5)
    const etiquetas = OPCOES_MOEDA.map((o) => o.etiqueta)
    expect(etiquetas).toEqual([...etiquetas].sort((a, b) => a.localeCompare(b, 'pt')))
  })
})
