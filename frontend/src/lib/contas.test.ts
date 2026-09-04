/*
 * TESTES DO CLIENTE HTTP DE CONTAS
 * ===============================
 *
 * Exercitam contas.ts tal como é: o MSW interceta o pedido ao nível da
 * rede e responde com o que cada teste definir. Verifica-se o método, o
 * caminho, e a conversão de erros em ErroApi.
 */

import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'

import { servidorMsw } from '../test/servidor-msw'
import { apagarConta, criarConta, editarConta, listarContas, obterConta } from './contas'
import { ErroApi } from './http'

const CONTA = {
  id: 'c1',
  nome: 'Conta X',
  banco: 'BPI',
  tipo: 'Conta corrente',
  moeda: 'EUR',
  data_ancora: '2026-01-01',
  saldo_ancora: '100.00',
  saldo: '100.00',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

describe('cliente da API de contas', () => {
  it('listarContas devolve a lista', async () => {
    servidorMsw.use(http.get('/api/contas', () => HttpResponse.json([CONTA])))

    expect(await listarContas()).toEqual([CONTA])
  })

  it('obterConta devolve uma conta', async () => {
    servidorMsw.use(http.get('/api/contas/c1', () => HttpResponse.json(CONTA)))

    expect((await obterConta('c1')).nome).toBe('Conta X')
  })

  it('criarConta envia POST e devolve a conta criada', async () => {
    servidorMsw.use(
      http.post('/api/contas', () => HttpResponse.json(CONTA, { status: 201 })),
    )

    const criada = await criarConta({
      nome: 'Conta X',
      banco: 'BPI',
      tipo: 'Conta corrente',
      moeda: 'EUR',
      data_ancora: '2026-01-01',
      saldo_ancora: '100',
    })
    expect(criada).toEqual(CONTA)
  })

  it('editarConta envia PATCH', async () => {
    servidorMsw.use(
      http.patch('/api/contas/c1', () => HttpResponse.json({ ...CONTA, nome: 'Novo nome' })),
    )

    const editada = await editarConta('c1', {
      nome: 'Novo nome',
      banco: null,
      tipo: null,
      moeda: 'EUR',
    })
    expect(editada.nome).toBe('Novo nome')
  })

  it('apagarConta resolve sem erro (204)', async () => {
    servidorMsw.use(
      http.delete('/api/contas/c1', () => new HttpResponse(null, { status: 204 })),
    )

    await expect(apagarConta('c1')).resolves.toBeUndefined()
  })

  it('converte um 404 num ErroApi com estado 404', async () => {
    servidorMsw.use(
      http.get('/api/contas/x', () =>
        HttpResponse.json({ detail: 'Conta não encontrada.' }, { status: 404 }),
      ),
    )

    const erro = await obterConta('x').catch((e) => e)
    expect(erro).toBeInstanceOf(ErroApi)
    expect(erro.estado).toBe(404)
  })
})
