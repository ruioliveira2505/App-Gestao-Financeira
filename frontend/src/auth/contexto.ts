/*
 * CONTEXTO DE AUTENTICAÇÃO — DEFINIÇÃO
 * ====================================
 *
 * Um "contexto" do React é um mecanismo para partilhar um valor com toda
 * uma sub-árvore de componentes sem o passar manualmente de componente em
 * componente ("prop drilling"). Um componente fornece o valor no topo
 * (aqui será o AuthProvider); qualquer componente abaixo pode lê-lo.
 *
 * Este ficheiro contém apenas a *definição* do contexto e os tipos que o
 * descrevem — não contém nenhum componente. Está separado do AuthProvider
 * (o componente que preenche o contexto) e do hook useAuth (a forma de o
 * ler) por uma razão prática: a ferramenta de recarregamento automático do
 * Vite ("Fast Refresh") só preserva o estado dos componentes se cada
 * ficheiro exportar exclusivamente componentes, ou exclusivamente outras
 * coisas — nunca uma mistura. Manter o contexto e os tipos aqui, à parte,
 * respeita essa regra.
 */

import { createContext } from 'react'

// Tipo dos dados de um utilizador, tal como chegam da API. Importado do
// cliente HTTP para que a forma seja definida num único sítio.
import type { Utilizador } from '../lib/api'

/**
 * Os três estados possíveis do processo de autenticação:
 *
 *   - 'a-carregar': ainda não se sabe se há sessão iniciada. É o estado
 *     inicial, enquanto decorre a verificação feita ao arrancar a
 *     aplicação (um pedido a GET /auth/me). Durante este estado, uma rota
 *     protegida deve mostrar um indicador de espera, e não redirecionar
 *     já para o ecrã de início de sessão.
 *
 *   - 'autenticado': existe uma sessão válida; "utilizador" está
 *     preenchido.
 *
 *   - 'anonimo': não há sessão válida; "utilizador" é null.
 */
export type EstadoAutenticacao = 'a-carregar' | 'autenticado' | 'anonimo'

/**
 * Valor partilhado através do contexto. É isto que o hook useAuth devolve
 * a qualquer componente que o chame.
 */
export type ValorAutenticacao = {
  estado: EstadoAutenticacao

  // Dados do utilizador com sessão iniciada, ou null quando não há sessão.
  utilizador: Utilizador | null

  // Regista um novo utilizador e inicia-lhe logo a sessão (o backend não
  // cria sessão no registo, por isso esta função encadeia registo + login).
  // A promessa é rejeitada com um ErroApi se o registo ou o login
  // falharem — cabe ao ecrã que a chama mostrar a mensagem.
  registar: (email: string, password: string) => Promise<void>

  // Inicia a sessão de um utilizador existente. Rejeita com ErroApi em
  // caso de credenciais inválidas.
  login: (email: string, password: string) => Promise<void>

  // Termina a sessão atual. O estado local passa a 'anonimo' mesmo que o
  // pedido ao servidor falhe.
  logout: () => Promise<void>
}

/**
 * O objeto de contexto em si. O valor por omissão é null: representa
 * "nenhum AuthProvider acima deste componente". O hook useAuth deteta esse
 * null e lança um erro claro, em vez de deixar o código seguir com um
 * valor em falta.
 */
export const AuthContexto = createContext<ValorAutenticacao | null>(null)
