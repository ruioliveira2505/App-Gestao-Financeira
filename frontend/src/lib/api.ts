/*
 * CLIENTE HTTP DA API DE AUTENTICAÇÃO
 * ===================================
 *
 * Este ficheiro é o único ponto do frontend que fala diretamente com a
 * API do backend. Todo o resto da aplicação (componentes, estado de
 * sessão) chama as funções exportadas aqui — registar, login, logout,
 * obterUtilizadorAtual — e nunca usa "fetch" diretamente.
 *
 * Concentrar isto num sítio tem três objetivos:
 *
 *   1. A política de credenciais (enviar o cookie de sessão em todos os
 *      pedidos) fica definida uma única vez.
 *
 *   2. As respostas de erro do backend são convertidas de forma uniforme
 *      numa exceção (ErroApi) com uma mensagem legível — o código que
 *      chama trata sempre o erro da mesma maneira, seja qual for o
 *      endpoint.
 *
 *   3. Se um dia o endereço da API mudar, muda-se aqui e em mais lado
 *      nenhum.
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
 * Forma dos dados de um utilizador tal como a API os devolve. Corresponde
 * ao schema UserPublico do backend (backend/app/schemas/auth.py): o
 * identificador e o email, nunca a password nem o seu hash.
 *
 * O "id" é o UUID em texto — o formato JSON não tem um tipo próprio para
 * UUID, por isso chega ao frontend como uma string.
 */
export type Utilizador = {
  id: string
  email: string
}

/**
 * Erro lançado quando a API responde com um código de falha (4xx ou 5xx).
 *
 * Além da mensagem legível (herdada de Error), guarda o código de estado
 * HTTP em "estado", para que o código que chama possa reagir de forma
 * diferente a cada situação — por exemplo, distinguir um 401 (sem sessão
 * válida) de um 409 (email já registado) — sem ter de interpretar a
 * mensagem de texto.
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
 * Função interna partilhada por todas as chamadas à API. Faz o pedido,
 * trata o cookie de sessão, e converte respostas de erro em ErroApi.
 *
 * O tipo genérico <T> é o formato esperado do corpo da resposta em caso de
 * sucesso — cada função pública abaixo indica-o (Utilizador, ou void para
 * o logout, que não devolve corpo).
 */
async function pedido<T>(caminho: string, opcoes: RequestInit = {}): Promise<T> {
  const resposta = await fetch(`${PREFIXO_API}${caminho}`, {
    ...opcoes,
    // credentials: 'include' instrui o browser a enviar o cookie de
    // sessão neste pedido (e a aceitar um novo cookie na resposta). Sem
    // isto, o cookie httpOnly criado no login nunca acompanharia os
    // pedidos seguintes, e a API responderia sempre como se não houvesse
    // sessão iniciada.
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      // O spread no fim permite a quem chama acrescentar ou sobrepor
      // cabeçalhos, sem perder o Content-Type definido acima.
      ...opcoes.headers,
    },
  })

  // 204 (No Content) é a resposta do logout: sucesso, sem qualquer corpo
  // para interpretar. Tentar ler JSON aqui daria erro. Devolve-se
  // undefined — as funções que caem neste caso declaram o retorno como
  // void.
  if (resposta.status === 204) {
    return undefined as T
  }

  // Tenta interpretar o corpo como JSON. Se falhar (corpo vazio, ou não
  // -JSON), "corpo" fica null e o tratamento de erro abaixo recorre à
  // mensagem genérica.
  const corpo = await resposta.json().catch(() => null)

  // resposta.ok é verdadeiro para códigos 200–299. Para qualquer outro,
  // constrói-se e lança-se um ErroApi.
  if (!resposta.ok) {
    // O FastAPI coloca a mensagem de erro no campo "detail". Nas falhas
    // desta API que interessam ao utilizador (401, 409) esse campo é uma
    // frase — usa-se essa. Num 422 de validação seria uma lista, e aí
    // recorre-se à mensagem genérica.
    const mensagem =
      corpo !== null && typeof corpo.detail === 'string'
        ? corpo.detail
        : MENSAGEM_ERRO_GENERICA
    throw new ErroApi(mensagem, resposta.status)
  }

  return corpo as T
}

/**
 * Regista um novo utilizador. Em caso de sucesso, devolve os dados
 * públicos do utilizador criado. Se o email já estiver registado, o
 * backend responde 409 e esta função lança um ErroApi com estado 409.
 */
export function registar(email: string, password: string): Promise<Utilizador> {
  return pedido<Utilizador>('/auth/registo', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
}

/**
 * Autentica um utilizador existente e inicia uma sessão. O cookie de
 * sessão vem na resposta e é guardado automaticamente pelo browser. Em
 * caso de credenciais inválidas, o backend responde 401 e esta função
 * lança um ErroApi com estado 401.
 */
export function login(email: string, password: string): Promise<Utilizador> {
  return pedido<Utilizador>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
}

/**
 * Termina a sessão atual. O backend apaga a sessão e instrui o browser a
 * descartar o cookie. Responde 204 (sem corpo) mesmo que já não houvesse
 * sessão ativa, por isso esta função praticamente nunca falha.
 */
export function logout(): Promise<void> {
  return pedido<void>('/auth/logout', { method: 'POST' })
}

/**
 * Devolve os dados do utilizador associado ao cookie de sessão atual.
 * Usada ao arrancar a aplicação para descobrir se já existe uma sessão
 * iniciada. Se não existir sessão válida, o backend responde 401 e esta
 * função lança um ErroApi com estado 401.
 */
export function obterUtilizadorAtual(): Promise<Utilizador> {
  return pedido<Utilizador>('/auth/me')
}
