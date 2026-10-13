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
  assinaturaDosAvisos,
  avisosDasAutorizacoes,
  contaSincroniza,
  criarConta,
  editarConta,
  estadoAutorizacao,
  listarContas,
  obterConta,
  valorParaComparar,
  type Conta,
  type Vinculo,
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
  vinculo: null,
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

describe('estadoAutorizacao', () => {
  // Um momento fixo, para os testes não dependerem do dia em que correm.
  const AGORA = new Date('2026-10-01T12:00:00Z')

  it('com mais de 7 dias de validade, está ativa', () => {
    expect(estadoAutorizacao('2026-12-30T12:00:00Z', AGORA)).toBe('ativa')
  })

  it('a 7 dias ou menos do fim, está a expirar', () => {
    expect(estadoAutorizacao('2026-10-08T12:00:00Z', AGORA)).toBe('a-expirar')
    expect(estadoAutorizacao('2026-10-01T13:00:00Z', AGORA)).toBe('a-expirar')
  })

  it('com a validade ultrapassada, está expirada', () => {
    expect(estadoAutorizacao('2026-09-30T12:00:00Z', AGORA)).toBe('expirada')
    expect(estadoAutorizacao('2026-10-01T12:00:00Z', AGORA)).toBe('expirada')
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

// --- Avisos das autorizações (a lista de contas) ---

describe('avisosDasAutorizacoes', () => {
  const AGORA = new Date('2026-10-01T12:00:00Z')

  // Um vínculo de exemplo; cada teste muda só o que interessa.
  function vinculo(sobrepor: Partial<Vinculo> = {}): Vinculo {
    return {
      conta_bancaria_id: 'cb1',
      banco: 'Caixa Geral de Depósitos',
      titular: 'Rui Oliveira',
      valido_ate: '2026-12-30T12:00:00Z',
      autorizacao_id: 'a1',
      iban: null,
      sincronizado_em: null,
      suspensa_desde: null,
      autorizacao_terminada_em: null,
      falha_em: null,
      falha_motivo: null,
      estado: 'vinculada',
      motivo: null,
      ...sobrepor,
    }
  }
  function conta(id: string, v: Vinculo | null): Conta {
    return { ...CONTA, id, vinculo: v }
  }

  it('sem autorizações a terminar nem terminadas, não há avisos', () => {
    const contas = [conta('c1', vinculo()), conta('c2', null)]
    expect(avisosDasAutorizacoes(contas, AGORA)).toEqual([])
  })

  it('uma autorização a 7 dias ou menos do fim dá um aviso «a expirar»', () => {
    const contas = [conta('c1', vinculo({ valido_ate: '2026-10-05T12:00:00Z' }))]
    expect(avisosDasAutorizacoes(contas, AGORA)).toEqual([
      {
        autorizacao_id: 'a1',
        banco: 'Caixa Geral de Depósitos',
        titular: 'Rui Oliveira',
        caso: 'a-expirar',
        data: '2026-10-05T12:00:00Z',
      },
    ])
  })

  it('uma conta suspensa por a autorização ter terminado dá um aviso «terminada», com a data em que terminou', () => {
    const fim = '2026-09-02T10:00:00Z'
    const contas = [
      conta('c1', vinculo({ estado: 'suspensa', motivo: 'expirada', suspensa_desde: fim, autorizacao_terminada_em: fim })),
    ]
    expect(avisosDasAutorizacoes(contas, AGORA)[0]).toMatchObject({ caso: 'terminada', data: fim })
  })

  it('uma conta que o banco deixou de partilhar, com a autorização ativa, não dá aviso: renovar não a resolve', () => {
    const contas = [conta('c1', vinculo({ estado: 'suspensa', motivo: 'indisponivel' }))]
    expect(avisosDasAutorizacoes(contas, AGORA)).toEqual([])
  })

  it('mas se a autorização dessa conta também terminou, avisa-se', () => {
    const contas = [
      conta(
        'c1',
        vinculo({ estado: 'suspensa', motivo: 'indisponivel', autorizacao_terminada_em: '2026-09-20T10:00:00Z' }),
      ),
    ]
    expect(avisosDasAutorizacoes(contas, AGORA)[0]?.caso).toBe('terminada')
  })

  it('com o prazo já passado pelo relógio deste aparelho, mas ainda ativa no backend, diz «a expirar» (nunca some)', () => {
    const contas = [conta('c1', vinculo({ valido_ate: '2026-09-30T12:00:00Z' }))]
    expect(avisosDasAutorizacoes(contas, AGORA)[0]?.caso).toBe('a-expirar')
  })

  it('várias contas da mesma autorização dão um só aviso', () => {
    const terminada = vinculo({ estado: 'suspensa', motivo: 'expirada', autorizacao_terminada_em: '2026-09-30T12:00:00Z' })
    const contas = [conta('c1', terminada), conta('c2', { ...terminada, conta_bancaria_id: 'cb2' })]
    expect(avisosDasAutorizacoes(contas, AGORA)).toHaveLength(1)
  })

  it('o mesmo banco com dois titulares são duas autorizações; as terminadas vêm primeiro', () => {
    const contas = [
      conta('c1', vinculo({ autorizacao_id: 'a1', valido_ate: '2026-10-03T12:00:00Z' })),
      conta(
        'c2',
        vinculo({
          autorizacao_id: 'a2',
          titular: 'Ana Oliveira',
          estado: 'suspensa',
          motivo: 'expirada',
          autorizacao_terminada_em: '2026-09-30T12:00:00Z',
          falha_em: null,
          falha_motivo: null,
        }),
      ),
    ]
    expect(avisosDasAutorizacoes(contas, AGORA).map((a) => [a.titular, a.caso])).toEqual([
      ['Ana Oliveira', 'terminada'],
      ['Rui Oliveira', 'a-expirar'],
    ])
  })
})

describe('assinaturaDosAvisos', () => {
  it('muda quando o conjunto de avisos muda, e não depende da ordem', () => {
    const a = { autorizacao_id: 'a1', banco: 'X', titular: null, caso: 'a-expirar' as const, data: '2026-10-05' }
    const b = { autorizacao_id: 'a2', banco: 'Y', titular: null, caso: 'terminada' as const, data: '2026-09-02' }
    expect(assinaturaDosAvisos([a, b])).toBe(assinaturaDosAvisos([b, a]))
    expect(assinaturaDosAvisos([a])).not.toBe(assinaturaDosAvisos([{ ...a, caso: 'terminada' }]))
  })
})

describe('contaSincroniza', () => {
  it('só uma conta vinculada (não suspensa, não manual) sincroniza', () => {
    const v: Vinculo = {
      conta_bancaria_id: 'cb1', banco: 'X', titular: null, valido_ate: '2026-12-30T12:00:00Z',
      autorizacao_id: 'a1', iban: null, sincronizado_em: null, suspensa_desde: null,
      autorizacao_terminada_em: null, falha_em: null, falha_motivo: null, estado: 'vinculada', motivo: null,
    }
    expect(contaSincroniza({ ...CONTA, vinculo: v })).toBe(true)
    expect(contaSincroniza({ ...CONTA, vinculo: { ...v, estado: 'suspensa', motivo: 'expirada' } })).toBe(false)
    expect(contaSincroniza({ ...CONTA, vinculo: null })).toBe(false)
  })
})
