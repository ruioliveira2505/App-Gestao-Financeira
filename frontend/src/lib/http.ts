/*
 * NÚCLEO DO CLIENTE HTTP
 * ======================
 *
 * A função `pedido` e a classe `ErroApi` são a base sobre a qual todos os
 * módulos que falam com a API do backend são construídos (src/lib/api.ts
 * para a autenticação, src/lib/contas.ts para as contas, etc.).
 *
 * Centralizar isto aqui garante que:
 *
 *   1. A política de credenciais (enviar o cookie de sessão em todos os
 *      pedidos) fica definida uma única vez.
 *
 *   2. As respostas de erro do backend são convertidas de forma uniforme
 *      numa exceção (ErroApi) com uma mensagem legível — quem chama trata
 *      sempre o erro da mesma maneira, seja qual for o endpoint.
 *
 *   3. Se o endereço da API mudar, muda-se aqui e em mais lado nenhum.
 */

// Prefixo comum a todos os pedidos. Em desenvolvimento, o servidor do
// Vite interceta tudo o que começa por "/api" e reencaminha-o para o
// backend (ver vite.config.ts) — do ponto de vista do browser existe uma
// única origem, o que evita restrições de CORS e mantém o cookie de
// sessão a ser enviado normalmente.
const PREFIXO_API = '/api'

// Mensagem usada quando a resposta de erro não traz um texto aproveitável
// (por exemplo, um erro de validação 422, cujo campo "detail" é uma lista
// estruturada e não uma frase, ou uma falha sem corpo JSON nenhum).
const MENSAGEM_ERRO_GENERICA = 'Ocorreu um erro inesperado. Tenta novamente.'

/**
 * Erro lançado quando a API responde com um código de falha (4xx ou 5xx).
 *
 * Além da mensagem legível (herdada de Error), guarda o código de estado
 * HTTP em "estado", para que quem chama possa reagir de forma diferente a
 * cada situação (401 sem sessão, 404 não encontrado, 409 conflito...) sem
 * ter de interpretar a mensagem de texto.
 */
export class ErroApi extends Error {
  readonly estado: number

  constructor(mensagem: string, estado: number) {
    super(mensagem)
    this.name = 'ErroApi'
    this.estado = estado
  }
}

/**
 * Faz um pedido à API: acrescenta o prefixo "/api", envia o cookie de
 * sessão, e converte uma resposta de erro em ErroApi.
 *
 * O tipo genérico <T> é o formato esperado do corpo da resposta em caso de
 * sucesso — cada função que a usa indica-o. Para respostas 204 (sem
 * corpo), o retorno é undefined e o tipo declarado é void.
 */
export async function pedido<T>(caminho: string, opcoes: RequestInit = {}): Promise<T> {
  const resposta = await fetch(`${PREFIXO_API}${caminho}`, {
    ...opcoes,
    // credentials: 'include' instrui o browser a enviar o cookie de
    // sessão neste pedido (e a aceitar um novo cookie na resposta). Sem
    // isto, o cookie httpOnly criado no login nunca acompanharia os
    // pedidos seguintes.
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      // O spread no fim permite a quem chama acrescentar ou sobrepor
      // cabeçalhos, sem perder o Content-Type definido acima.
      ...opcoes.headers,
    },
  })

  // 204 (No Content): sucesso sem corpo para interpretar (ex.: logout,
  // apagar). Tentar ler JSON aqui daria erro.
  if (resposta.status === 204) {
    return undefined as T
  }

  // Tenta interpretar o corpo como JSON. Se falhar (corpo vazio ou
  // não-JSON), "corpo" fica null.
  const corpo = await resposta.json().catch(() => null)

  // resposta.ok é verdadeiro para 200–299. Para qualquer outro, lança-se
  // um ErroApi.
  if (!resposta.ok) {
    // O FastAPI coloca a mensagem de erro no campo "detail". Quando é uma
    // frase (401, 404, 409...), usa-se essa; num 422 de validação seria
    // uma lista, e aí recorre-se à mensagem genérica.
    const mensagem =
      corpo !== null && typeof corpo.detail === 'string'
        ? corpo.detail
        : MENSAGEM_ERRO_GENERICA
    throw new ErroApi(mensagem, resposta.status)
  }

  return corpo as T
}
