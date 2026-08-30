/*
 * TESTES DO CLIENTE HTTP DA API DE AUTENTICAÇÃO
 * =============================================
 *
 * Estes testes exercitam o ficheiro api.ts tal como ele é. Não substituem
 * o "fetch" por uma versão falsa; em vez disso, o MSW (ver
 * src/test/servidor-msw.ts) interceta o pedido HTTP ao nível da rede e
 * responde com o que cada teste definir. Assim, verifica-se o
 * comportamento real do cliente: como monta o pedido, como interpreta uma
 * resposta de sucesso e como converte uma resposta de erro numa exceção.
 *
 * Cada teste regista as suas próprias regras de resposta com
 * servidorMsw.use(...); o ficheiro de preparação repõe essas regras entre
 * testes, pelo que não há interferência de um teste para o outro.
 */

import { describe, expect, it, vi } from 'vitest'

// http e HttpResponse são as ferramentas do MSW para declarar "quando
// chegar um pedido a este método e caminho, responde assim".
import { http, HttpResponse } from 'msw'

import { servidorMsw } from '../test/servidor-msw'
import { ErroApi, login, logout, obterUtilizadorAtual, registar } from './api'

// Dados de utilizador reutilizados em vários testes, no mesmo formato que
// o backend devolve (schema UserPublico).
const UTILIZADOR = { id: '11111111-1111-1111-1111-111111111111', email: 'ana@exemplo.pt' }

describe('cliente da API de autenticação', () => {
  it('registar devolve o utilizador criado quando a resposta é 201', async () => {
    servidorMsw.use(
      http.post('/api/auth/registo', () => HttpResponse.json(UTILIZADOR, { status: 201 })),
    )

    const utilizador = await registar('ana@exemplo.pt', 'password-longa')

    expect(utilizador).toEqual(UTILIZADOR)
  })

  it('login devolve o utilizador quando a resposta é 200', async () => {
    servidorMsw.use(http.post('/api/auth/login', () => HttpResponse.json(UTILIZADOR)))

    const utilizador = await login('ana@exemplo.pt', 'password-longa')

    expect(utilizador).toEqual(UTILIZADOR)
  })

  it('logout resolve sem erro quando a resposta é 204', async () => {
    servidorMsw.use(
      http.post('/api/auth/logout', () => new HttpResponse(null, { status: 204 })),
    )

    await expect(logout()).resolves.toBeUndefined()
  })

  it('converte uma resposta 409 num ErroApi com a mensagem do campo "detail"', async () => {
    servidorMsw.use(
      http.post('/api/auth/registo', () =>
        HttpResponse.json(
          { detail: 'Já existe uma conta registada com este email.' },
          { status: 409 },
        ),
      ),
    )

    const erro = await registar('ana@exemplo.pt', 'password-longa').catch((e) => e)

    expect(erro).toBeInstanceOf(ErroApi)
    expect(erro.estado).toBe(409)
    expect(erro.message).toBe('Já existe uma conta registada com este email.')
  })

  it('converte uma resposta 401 sem sessão num ErroApi com estado 401', async () => {
    servidorMsw.use(
      http.get('/api/auth/me', () =>
        HttpResponse.json({ detail: 'Sessão inválida ou expirada.' }, { status: 401 }),
      ),
    )

    const erro = await obterUtilizadorAtual().catch((e) => e)

    expect(erro).toBeInstanceOf(ErroApi)
    expect(erro.estado).toBe(401)
  })

  it('usa a mensagem genérica quando a resposta de erro não tem "detail" em texto', async () => {
    servidorMsw.use(
      http.post('/api/auth/registo', () =>
        // Um 422 do FastAPI tem "detail" como lista, não como frase.
        HttpResponse.json({ detail: [{ msg: 'campo inválido' }] }, { status: 422 }),
      ),
    )

    const erro = await registar('invalido', 'x').catch((e) => e)

    expect(erro).toBeInstanceOf(ErroApi)
    expect(erro.message).toBe('Ocorreu um erro inesperado. Tenta novamente.')
  })

  it('envia o pedido com credentials "include" e cabeçalho Content-Type JSON', async () => {
    let tipoDeConteudo: string | null = null
    servidorMsw.use(
      http.get('/api/auth/me', ({ request }) => {
        tipoDeConteudo = request.headers.get('content-type')
        return HttpResponse.json(UTILIZADOR)
      }),
    )
    // Espia a função global "fetch" para inspecionar com que opções foi
    // chamada. Como a espia delega na implementação real (agora gerida
    // pelo MSW), a resposta simulada acima continua a funcionar.
    const espiaFetch = vi.spyOn(globalThis, 'fetch')

    await obterUtilizadorAtual()

    expect(espiaFetch).toHaveBeenCalledWith(
      '/api/auth/me',
      expect.objectContaining({ credentials: 'include' }),
    )
    expect(tipoDeConteudo).toBe('application/json')

    espiaFetch.mockRestore()
  })
})
