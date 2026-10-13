/*
 * TESTES DO CLIENTE HTTP DE OPEN BANKING
 * ======================================
 *
 * Vocabulário: uma AUTORIZAÇÃO é o consentimento dado no banco para a
 * aplicação ler as contas partilhadas, durante um prazo; cada conta
 * partilhada é uma CONTA BANCÁRIA; o VÍNCULO é o facto de uma conta
 * bancária alimentar uma conta da aplicação.
 *
 * As funções que fazem pedidos "fetch" testam-se com o MSW (Mock Service
 * Worker), que interceta o pedido ao nível da rede e responde com o que o
 * teste definir. Um pedido para um caminho sem resposta definida faz o
 * teste falhar, por isso um caminho errado é apanhado.
 *
 * iniciarAutorizacao é diferente: não faz um "fetch", SUBMETE UM
 * FORMULÁRIO, para o browser sair da aplicação e ir para o ecrã de login
 * do banco. O MSW não vê essa navegação, por isso um caminho errado
 * passaria despercebido. Aqui substitui-se o método "submit" dos
 * formulários (com vi.spyOn, que troca um método só durante o teste) para
 * apanhar o formulário que seria submetido e verificar o método e o
 * destino.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'

import { servidorMsw } from '../test/servidor-msw'
import {
  criarContaDoBanco,
  desvincular,
  iniciarAutorizacao,
  renovarAutorizacao,
  listarContasBancarias,
  sincronizar,
} from './openBanking'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('iniciarAutorizacao', () => {
  it('submete um formulário POST para /api/open-banking/autorizar com o banco e o país', () => {
    // mockImplementation(() => {}) impede a navegação real; o espião
    // guarda, em "mock.contexts", o objeto sobre o qual "submit" foi
    // chamado — o formulário que seria submetido.
    const espiao = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => {})

    iniciarAutorizacao('Caixa Geral de Depósitos')

    expect(espiao).toHaveBeenCalledTimes(1)
    const formulario = espiao.mock.contexts[0] as HTMLFormElement
    expect(formulario.method).toBe('post')
    const destino = new URL(formulario.action, window.location.origin)
    expect(destino.pathname).toBe('/api/open-banking/autorizar')
    expect(destino.searchParams.get('banco')).toBe('Caixa Geral de Depósitos')
    expect(destino.searchParams.get('pais')).toBe('PT')
  })
})

describe('renovarAutorizacao', () => {
  it('submete um formulário POST para /api/open-banking/autorizar com a autorização a renovar', () => {
    const espiao = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => {})

    renovarAutorizacao('a1')

    const formulario = espiao.mock.contexts[0] as HTMLFormElement
    expect(formulario.method).toBe('post')
    const destino = new URL(formulario.action, window.location.origin)
    expect(destino.pathname).toBe('/api/open-banking/autorizar')
    // O banco e o país vêm da autorização antiga, do lado do backend.
    expect(destino.searchParams.get('renova')).toBe('a1')
    expect(destino.searchParams.has('banco')).toBe(false)
  })
})

describe('pedidos às rotas de contas bancárias', () => {
  it('usam os caminhos da API: contas bancárias, criar conta, sincronizar e desvincular', async () => {
    const caminhos: string[] = []
    servidorMsw.use(
      http.get('/api/open-banking/autorizacoes/a1/contas-bancarias', ({ request }) => {
        caminhos.push(new URL(request.url).pathname)
        return HttpResponse.json([])
      }),
      http.post('/api/open-banking/contas-bancarias/cb1/criar-conta', ({ request }) => {
        caminhos.push(new URL(request.url).pathname)
        return HttpResponse.json({
          conta_id: 'c1',
          nome: 'Nova',
          banco: 'CGD',
          moeda: 'EUR',
          data_ancora: '2026-01-01',
          saldo_ancora: '0.00',
          movimentos_importados: 0,
        })
      }),
      http.post('/api/open-banking/contas-bancarias/cb1/sincronizar', ({ request }) => {
        caminhos.push(new URL(request.url).pathname)
        return HttpResponse.json({ movimentos_importados: 2 })
      }),
      http.delete('/api/open-banking/contas-bancarias/cb1/vinculo', ({ request }) => {
        caminhos.push(new URL(request.url).pathname)
        return new HttpResponse(null, { status: 204 })
      }),
    )

    await listarContasBancarias('a1')
    await criarContaDoBanco('cb1', 'Nova')
    expect(await sincronizar('cb1')).toEqual({ movimentos_importados: 2 })
    await desvincular('cb1')

    expect(caminhos).toEqual([
      '/api/open-banking/autorizacoes/a1/contas-bancarias',
      '/api/open-banking/contas-bancarias/cb1/criar-conta',
      '/api/open-banking/contas-bancarias/cb1/sincronizar',
      '/api/open-banking/contas-bancarias/cb1/vinculo',
    ])
  })
})
