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
 *   - saldo_convertido é "saldo" já convertido para a moeda principal do
 *     utilizador autenticado (ver src/paginas/PerfilPreferencias.tsx), à
 *     taxa de câmbio de hoje — "null" só na falta genuína de taxas de
 *     câmbio para converter (o backend nunca falha o pedido inteiro só
 *     por isso). Nunca a moeda da PRÓPRIA CONTA (essa é sempre "moeda",
 *     acima) — é a moeda em que se compara/soma valores ENTRE contas.
 *   - ligacao é "null" para uma conta manual (ou uma que já foi
 *     desvinculada — ver src/lib/openBanking.ts); quando presente, dá o
 *     necessário para "Sincronizar agora"/"Desvincular" no detalhe da
 *     conta (conta_ligada_id), o nome do banco a mostrar (aspsp_nome) e a
 *     validade do consentimento dado ao banco (valido_ate, data e hora
 *     ISO) — de onde sai o estado da ligação (ver estadoLigacao, abaixo).
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
  saldo_convertido: string | null
  ligacao: { conta_ligada_id: string; aspsp_nome: string; valido_ate: string } | null
  created_at: string
  updated_at: string
}

// --- Estado da ligação ao banco ---
//
// Uma conta ligada recebe movimentos do banco através de um consentimento
// dado pelo utilizador, que dura o máximo que o banco aceita: até 180
// dias pela regra europeia (90 se o banco não o indicar). Passada a validade, o banco deixa de responder e os movimentos
// param de entrar sem aviso nenhum — por isso a interface mostra, ANTES
// disso, que a ligação está prestes a expirar.

/** Os três estados possíveis da ligação de uma conta ao banco. */
export type EstadoLigacao = 'ligada' | 'a-expirar' | 'expirada'

/** Quantos dias antes do fim da validade a ligação passa a "a-expirar". */
export const DIAS_AVISO_EXPIRACAO = 7

/**
 * O estado da ligação a partir da validade do consentimento ("valido_ate",
 * data e hora ISO). "agora" é um parâmetro (e não lido aqui dentro) para
 * os testes poderem fixar o momento — sem isso, o resultado dependeria do
 * dia em que os testes correm.
 */
export function estadoLigacao(validoAte: string, agora: Date = new Date()): EstadoLigacao {
  const fim = new Date(validoAte).getTime()
  if (fim <= agora.getTime()) return 'expirada'
  const msPorDia = 24 * 60 * 60 * 1000
  return fim - agora.getTime() <= DIAS_AVISO_EXPIRACAO * msPorDia ? 'a-expirar' : 'ligada'
}

// --- Valores na moeda principal ---
//
// Para comparar contas em moedas diferentes usa-se sempre
// "saldo_convertido" — o saldo na moeda principal definida pelo
// utilizador em Perfil › Preferências. Ordenar pelo "saldo" de cada
// conta misturaria unidades (640 dólares não são mais do que 600
// euros só porque 640 > 600).

/**
 * O valor de uma conta para ordenar por saldo: o saldo convertido para a
 * moeda principal, como número. "null" quando não há taxa de câmbio para
 * converter — quem ordena decide onde pôr essas contas (ver Contas.tsx).
 */
export function valorParaComparar(conta: Conta): number | null {
  return conta.saldo_convertido === null ? null : Number(conta.saldo_convertido)
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
// São campos ABERTOS: o utilizador pode sempre escrever um valor novo (o
// modo "procurar ou adicionar" do seletor — ver ListaDeOpcoes.tsx). A
// lista mostrada tem só os valores que o utilizador já usou nas suas
// contas — sem listas pré-feitas: uma lista de bancos prendia a app a um
// país, e uma de tipos influenciava a escolha (decisões de desenho).

/**
 * Junta "partida" com os valores de "jaUsados" (ignorando os vazios), sem
 * duplicados, por ordem alfabética. Os seletores de banco e tipo usam-na
 * duas vezes: primeiro com os valores já usados nas contas, e depois para
 * acrescentar o valor escolhido no momento (passado em "jaUsados"), se
 * ainda não estiver na lista.
 */
export function sugestoes(partida: string[], jaUsados: (string | null)[]): string[] {
  const conjunto = new Set(partida)
  for (const valor of jaUsados) {
    if (valor && valor.trim()) conjunto.add(valor.trim())
  }
  return [...conjunto].sort((a, b) => a.localeCompare(b, 'pt'))
}
