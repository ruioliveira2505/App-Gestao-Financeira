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
import {
  apagarConta,
  criarConta,
  editarConta,
  estadoLigacao,
  listarContas,
  obterConta,
  valorParaComparar,
} from './contas'
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
  saldo_convertido: null,
  ligacao: null,
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

// --- Funções puras (sem rede) ---

describe('estadoLigacao', () => {
  // Um momento fixo, para os testes não dependerem do dia em que correm.
  const AGORA = new Date('2026-10-01T12:00:00Z')

  it('com mais de 7 dias de validade, está ligada', () => {
    expect(estadoLigacao('2026-12-30T12:00:00Z', AGORA)).toBe('ligada')
  })

  it('a 7 dias ou menos do fim, está a expirar', () => {
    expect(estadoLigacao('2026-10-08T12:00:00Z', AGORA)).toBe('a-expirar')
    expect(estadoLigacao('2026-10-01T13:00:00Z', AGORA)).toBe('a-expirar')
  })

  it('com a validade ultrapassada, está expirada', () => {
    expect(estadoLigacao('2026-09-30T12:00:00Z', AGORA)).toBe('expirada')
    expect(estadoLigacao('2026-10-01T12:00:00Z', AGORA)).toBe('expirada')
  })
})

describe('valorParaComparar', () => {
  const conta = (saldo_convertido: string | null) => ({ ...CONTA, saldo_convertido })

  it('valorParaComparar usa o saldo convertido, não o da própria conta', () => {
    // Uma conta em dólares: saldo 640, convertido 548,61 — compara-se 548,61.
    expect(valorParaComparar({ ...CONTA, moeda: 'USD', saldo: '640.00', saldo_convertido: '548.61' })).toBe(548.61)
  })

  it('valorParaComparar é null sem taxa de câmbio', () => {
    expect(valorParaComparar(conta(null))).toBeNull()
  })
})
