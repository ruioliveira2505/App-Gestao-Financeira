/*
 * TESTES DO CLIENTE DA CACHE — REPETIÇÕES
 * =======================================
 *
 * Um pedido falhado repete-se uma vez, exceto um 401: a sessão terminou,
 * repetir não adianta.
 */

import { describe, expect, it } from 'vitest'

import { criarClienteConsultas } from './consultas'
import { ErroApi } from './http'

describe('retry do cliente da cache', () => {
  const retry = criarClienteConsultas().getDefaultOptions().queries?.retry as (
    tentativas: number,
    erro: unknown,
  ) => boolean

  it('repete uma vez uma falha qualquer', () => {
    expect(retry(0, new ErroApi('x', 500))).toBe(true)
    expect(retry(0, new TypeError('Failed to fetch'))).toBe(true)
    expect(retry(1, new ErroApi('x', 500))).toBe(false)
  })

  it('nunca repete um 401', () => {
    expect(retry(0, new ErroApi('Sessão inválida ou expirada.', 401))).toBe(false)
  })

  it('nos testes não repete nada', () => {
    expect(criarClienteConsultas({ testes: true }).getDefaultOptions().queries?.retry).toBe(false)
  })
})
