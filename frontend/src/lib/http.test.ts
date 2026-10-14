/*
 * TESTES DO CLIENTE HTTP — SESSÃO TERMINADA
 * =========================================
 *
 * Um 401 numa rota autenticada avisa quem se registou com
 * definirAoSessaoTerminar; num login, registo ou logout, não (aí um 401
 * não quer dizer que a sessão terminou).
 */

import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { servidorMsw } from '../test/servidor-msw'
import { definirAoSessaoTerminar, pedido } from './http'

const respostaNaoAutenticado = () => HttpResponse.json({ detail: 'x' }, { status: 401 })

describe('pedido e a sessão terminada', () => {
  afterEach(() => definirAoSessaoTerminar(null))

  it('avisa num 401 de uma rota autenticada, e o erro continua a ser lançado', async () => {
    servidorMsw.use(http.get('/api/contas', respostaNaoAutenticado))
    const ouvinte = vi.fn()
    definirAoSessaoTerminar(ouvinte)

    await expect(pedido('/contas')).rejects.toMatchObject({ estado: 401 })

    expect(ouvinte).toHaveBeenCalledTimes(1)
  })

  it('não avisa no login, no registo nem no logout', async () => {
    servidorMsw.use(
      http.post('/api/auth/login', respostaNaoAutenticado),
      http.post('/api/auth/registo', respostaNaoAutenticado),
      http.post('/api/auth/logout', respostaNaoAutenticado),
    )
    const ouvinte = vi.fn()
    definirAoSessaoTerminar(ouvinte)

    for (const caminho of ['/auth/login', '/auth/registo', '/auth/logout']) {
      await expect(pedido(caminho, { method: 'POST' })).rejects.toMatchObject({ estado: 401 })
    }

    expect(ouvinte).not.toHaveBeenCalled()
  })

  it('outros erros (404, 500) não são «sessão terminada»', async () => {
    servidorMsw.use(
      http.get('/api/a', () => HttpResponse.json({ detail: 'x' }, { status: 404 })),
      http.get('/api/b', () => HttpResponse.json({ detail: 'x' }, { status: 500 })),
    )
    const ouvinte = vi.fn()
    definirAoSessaoTerminar(ouvinte)

    await expect(pedido('/a')).rejects.toMatchObject({ estado: 404 })
    await expect(pedido('/b')).rejects.toMatchObject({ estado: 500 })

    expect(ouvinte).not.toHaveBeenCalled()
  })
})
