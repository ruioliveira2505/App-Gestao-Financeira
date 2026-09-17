/*
 * CLIENTE HTTP DA API DE AUTENTICAÇÃO
 * ===================================
 *
 * Este ficheiro é o ponto do frontend que fala com os endpoints de
 * autenticação do backend. O resto da aplicação (o AuthProvider, os
 * ecrãs) chama as funções exportadas aqui — registar, login, logout,
 * obterUtilizadorAtual — e nunca usa "fetch" diretamente.
 *
 * A mecânica comum a todos os pedidos (prefixo "/api", envio do cookie de
 * sessão, conversão de erros em ErroApi) vive em src/lib/http.ts.
 */

import { pedido } from './http'

// Re-exportado para que quem já importava ErroApi deste módulo continue a
// funcionar.
export { ErroApi } from './http'

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
  // A moeda em que valores agregados entre contas (ex.: um futuro
  // património total) são mostrados — nunca a moeda de uma conta
  // concreta, essa continua sempre a sua própria (ver src/lib/moedas.ts).
  // Por omissão "EUR"; muda-se com mudarPreferencias, abaixo.
  moeda_principal: string
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

/**
 * Muda as preferências do utilizador autenticado — por agora, só a moeda
 * principal. Devolve o utilizador já atualizado, para quem chamar não
 * precisar de um segundo pedido a obterUtilizadorAtual para refletir a
 * mudança. Uma moeda fora do conjunto suportado (src/lib/moedas.ts) faz o
 * backend responder 422.
 */
export function mudarPreferencias(moedaPrincipal: string): Promise<Utilizador> {
  return pedido<Utilizador>('/auth/me', {
    method: 'PATCH',
    body: JSON.stringify({ moeda_principal: moedaPrincipal }),
  })
}
