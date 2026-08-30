/*
 * useAuth — ACESSO AO ESTADO DE AUTENTICAÇÃO
 * ==========================================
 *
 * Um "hook" é uma função cujo nome começa por "use" e que dá a um
 * componente acesso a funcionalidades do React (estado, contexto, ciclo
 * de vida). Este hook devolve o valor do contexto de autenticação —
 * estado atual, dados do utilizador, e as funções registar/login/logout.
 *
 * Uso típico dentro de um componente:
 *
 *   const { estado, utilizador, logout } = useAuth()
 *
 * Assim, nenhum componente precisa de saber que existe um contexto, nem de
 * lidar com o React.useContext diretamente.
 */

import { useContext } from 'react'

import { AuthContexto, type ValorAutenticacao } from './contexto'

export function useAuth(): ValorAutenticacao {
  const valor = useContext(AuthContexto)

  // O contexto vale null quando não há nenhum <AuthProvider> acima do
  // componente que chamou este hook. Em vez de devolver esse null e deixar
  // o componente rebentar mais à frente ao tentar ler uma propriedade
  // inexistente, falha-se aqui, de imediato, com uma mensagem que aponta
  // diretamente para a causa.
  if (valor === null) {
    throw new Error('useAuth tem de ser usado dentro de <AuthProvider>.')
  }

  return valor
}
