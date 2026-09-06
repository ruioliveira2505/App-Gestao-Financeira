/*
 * CLIENTE HTTP DA API DE MOVIMENTOS
 * =================================
 *
 * As funções que falam com os endpoints /movimentos do backend. O resto
 * da aplicação (as páginas de movimentos) chama estas funções e nunca usa
 * "fetch" diretamente. A mecânica comum (prefixo, cookie, erros) vive em
 * src/lib/http.ts — o mesmo padrão de src/lib/contas.ts.
 */

import { pedido } from './http'

/**
 * Um movimento, tal como a API o devolve (schema MovimentoOut do
 * backend).
 *
 * Notas:
 *   - "valor" é texto ("1234.56" ou "-50.00"), não número — o JSON não
 *     tem tipo decimal e um número perderia precisão em cêntimos.
 *   - COM SINAL: positivo é uma entrada, negativo é uma saída. O ecrã de
 *     criar/editar pergunta "entrada ou saída?" e pede um valor sempre
 *     positivo — a conversão para um valor com sinal faz-se no próprio
 *     formulário, antes de chamar criarMovimento/editarMovimento.
 *   - "data" / created_at / updated_at são strings ISO.
 *   - Ainda sem "categoria" — ver a nota em app/models/movimento.py, no
 *     backend.
 */
export type Movimento = {
  id: string
  conta_id: string
  data: string
  descricao: string
  valor: string
  created_at: string
  updated_at: string
}

/** Campos aceites ao criar ou editar um movimento (schemas MovimentoCriar
 *  / MovimentoEditar — a mesma forma nas duas, ao contrário de Conta). */
export type MovimentoDados = {
  conta_id: string
  data: string
  descricao: string
  valor: string
}

/**
 * Lista os movimentos do utilizador (todas as suas contas), por data mais
 * recente primeiro. "contaId", se indicado, filtra para uma única conta —
 * ainda sem uso na interface (a lista é sempre global, por agora), mas já
 * suportado pelo backend.
 */
export function listarMovimentos(contaId?: string): Promise<Movimento[]> {
  const query = contaId ? `?conta_id=${encodeURIComponent(contaId)}` : ''
  return pedido<Movimento[]>(`/movimentos${query}`)
}

export function obterMovimento(id: string): Promise<Movimento> {
  return pedido<Movimento>(`/movimentos/${id}`)
}

export function criarMovimento(dados: MovimentoDados): Promise<Movimento> {
  return pedido<Movimento>('/movimentos', { method: 'POST', body: JSON.stringify(dados) })
}

export function editarMovimento(id: string, dados: MovimentoDados): Promise<Movimento> {
  return pedido<Movimento>(`/movimentos/${id}`, { method: 'PATCH', body: JSON.stringify(dados) })
}

export function apagarMovimento(id: string): Promise<void> {
  return pedido<void>(`/movimentos/${id}`, { method: 'DELETE' })
}
