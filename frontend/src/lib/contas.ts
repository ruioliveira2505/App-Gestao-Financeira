/*
 * CLIENTE HTTP DA API DE CONTAS
 * ============================
 *
 * As funções que falam com os endpoints /contas do backend. O resto da
 * aplicação (as páginas de contas) chama estas funções e nunca usa
 * "fetch" diretamente. A mecânica comum (prefixo, cookie, erros) vive em
 * src/lib/http.ts.
 */

import { pedido } from './http'

/**
 * Uma conta, tal como a API a devolve (schema ContaOut do backend).
 *
 * Notas:
 *   - Valores monetários (saldo_ancora, saldo) são texto ("1234.56"),
 *     não números — o JSON não tem tipo decimal e um número perderia
 *     precisão em cêntimos. Converter só na fronteira da apresentação.
 *   - data_ancora / created_at / updated_at são strings ISO.
 *   - saldo é o saldo atual; enquanto não há movimentos, é igual a
 *     saldo_ancora.
 */
export type Conta = {
  id: string
  nome: string
  banco: string | null
  tipo: string | null
  moeda: string
  data_ancora: string
  saldo_ancora: string
  saldo: string
  created_at: string
  updated_at: string
}

/** Campos aceites ao criar uma conta (schema ContaCriar). */
export type ContaNova = {
  nome: string
  banco: string | null
  tipo: string | null
  moeda: string
  data_ancora: string
  saldo_ancora: string
}

/** Campos aceites ao editar uma conta (schema ContaEditar) — só os descritivos. */
export type ContaEdicao = {
  nome: string
  banco: string | null
  tipo: string | null
  moeda: string
}

export function listarContas(): Promise<Conta[]> {
  return pedido<Conta[]>('/contas')
}

export function obterConta(id: string): Promise<Conta> {
  return pedido<Conta>(`/contas/${id}`)
}

export function criarConta(dados: ContaNova): Promise<Conta> {
  return pedido<Conta>('/contas', { method: 'POST', body: JSON.stringify(dados) })
}

export function editarConta(id: string, dados: ContaEdicao): Promise<Conta> {
  return pedido<Conta>(`/contas/${id}`, { method: 'PATCH', body: JSON.stringify(dados) })
}

export function apagarConta(id: string): Promise<void> {
  return pedido<void>(`/contas/${id}`, { method: 'DELETE' })
}

// --- Opções para os seletores dos campos "banco" e "tipo" ---
//
// São campos ABERTOS: o utilizador pode sempre escrever um valor à mão
// (linha "Outro banco" / "Outro tipo" no seletor). A lista mostrada é só
// uma ajuda para reutilizar valores.
//
//   - Banco: começa VAZIA e cresce só com os bancos que o utilizador já
//     usou nas suas contas (não há lista curada — evita dar a entender
//     que a app "abençoa" certos bancos, e não há nada de manutenção).
//   - Tipo: uma lista-semente curta e quase universal, que aparece sempre,
//     mais os tipos que o utilizador já usou.

// Tipos semeados, por ordem alfabética.
export const TIPOS_COMUNS = [
  'Caixa',
  'Conta à ordem',
  'Conta de investimento',
  'Conta poupança',
]

/**
 * Junta uma lista de partida com os valores que o utilizador já usou nas
 * suas contas, sem duplicados, por ordem alfabética. Alimenta os
 * seletores dos campos "banco" (partida vazia) e "tipo" (partida =
 * TIPOS_COMUNS).
 */
export function sugestoes(partida: string[], jaUsados: (string | null)[]): string[] {
  const conjunto = new Set(partida)
  for (const valor of jaUsados) {
    if (valor && valor.trim()) conjunto.add(valor.trim())
  }
  return [...conjunto].sort((a, b) => a.localeCompare(b, 'pt'))
}
