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
 *   - "categoria_id" é sempre obrigatório — nunca "sem categoria" (ver a
 *     nota CATEGORIA OBRIGATÓRIA em app/models/movimento.py, no backend).
 *   - "saldo_apos" — o saldo da conta imediatamente depois deste
 *     movimento, calculado no servidor sobre o histórico COMPLETO da
 *     conta (nunca só sobre a janela/filtro pedidos). Só vem preenchido
 *     em listarMovimentos (GET /movimentos); nos restantes pedidos
 *     (criar, obter um só, editar) fica null, porque nada os usa para o
 *     mostrar.
 */
export type Movimento = {
  id: string
  conta_id: string
  categoria_id: string
  data: string
  descricao: string
  valor: string
  created_at: string
  updated_at: string
  saldo_apos: string | null
}

/** Campos aceites ao criar ou editar um movimento (schemas MovimentoCriar
 *  / MovimentoEditar — a mesma forma nas duas, ao contrário de Conta). */
export type MovimentoDados = {
  conta_id: string
  categoria_id: string
  data: string
  descricao: string
  valor: string
}

/**
 * O cursor da PÁGINA SEGUINTE de listarMovimentos — os três campos pelos
 * quais a lista está ordenada no backend (ver a nota PAGINAÇÃO POR CURSOR
 * em app/routers/movimentos.py), tirados do ÚLTIMO movimento da página já
 * recebida. Pedir a próxima página é repetir o pedido com este cursor.
 */
export type CursorMovimentos = {
  data: string
  criadoEm: string
  id: string
}

/**
 * Os parâmetros aceites por listarMovimentos — espelham exactamente os da
 * rota GET /movimentos no backend (ver a nota FILTROS COMO PARÂMETROS, no
 * mesmo ficheiro): "contaId" filtra para uma única conta (ainda sem uso na
 * interface — fica para quando existir "ver movimentos desta conta");
 * "contas"/"categorias" filtram por uma ou mais contas/categorias;
 * "tipo", "de"/"ate" e "pesquisa" tal como na folha de filtros e no campo
 * de procura da página. "cursor", omitido, pede a PRIMEIRA página; "limite"
 * tem a mesma omissão por omissão do backend (30) quando não indicado.
 */
export type ListarMovimentosOpcoes = {
  contaId?: string
  contas?: string[]
  categorias?: string[]
  tipo?: 'entrada' | 'saida' | null
  de?: string | null
  ate?: string | null
  pesquisa?: string
  cursor?: CursorMovimentos | null
  limite?: number
}

/**
 * Lista uma JANELA de movimentos do utilizador (todas as suas contas), por
 * data mais recente primeiro — nunca o histórico completo de uma vez (ver
 * a nota PAGINAÇÃO POR CURSOR em app/routers/movimentos.py, no backend).
 * Sem "cursor", devolve a primeira página; com ele, continua a partir do
 * último movimento da página anterior.
 */
export function listarMovimentos(opcoes: ListarMovimentosOpcoes = {}): Promise<Movimento[]> {
  const params = new URLSearchParams()
  if (opcoes.contaId) params.set('conta_id', opcoes.contaId)
  if (opcoes.contas && opcoes.contas.length > 0) params.set('contas', opcoes.contas.join(','))
  if (opcoes.categorias && opcoes.categorias.length > 0) {
    params.set('categorias', opcoes.categorias.join(','))
  }
  if (opcoes.tipo) params.set('tipo', opcoes.tipo)
  if (opcoes.de) params.set('de', opcoes.de)
  if (opcoes.ate) params.set('ate', opcoes.ate)
  if (opcoes.pesquisa) params.set('pesquisa', opcoes.pesquisa)
  if (opcoes.cursor) {
    params.set('antes_data', opcoes.cursor.data)
    params.set('antes_criado_em', opcoes.cursor.criadoEm)
    params.set('antes_id', opcoes.cursor.id)
  }
  if (opcoes.limite) params.set('limite', String(opcoes.limite))

  const query = params.toString()
  return pedido<Movimento[]>(`/movimentos${query ? `?${query}` : ''}`)
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

/**
 * Eliminar vários movimentos de uma vez — o "Eliminar" do modo de seleção
 * múltipla da lista. Atómico do lado do servidor: ou apaga todos, ou (um
 * id inválido) nenhum.
 */
export function eliminarMovimentosEmLote(ids: string[]): Promise<void> {
  return pedido<void>('/movimentos/eliminar-em-lote', {
    method: 'POST',
    body: JSON.stringify({ ids }),
  })
}

/**
 * Recategorizar vários movimentos de uma vez — o "Categorizar" do modo de
 * seleção múltipla. Atómico: se a categoria não for coerente com a
 * direção de algum dos movimentos do lote, nenhum é alterado.
 */
export function recategorizarMovimentosEmLote(ids: string[], categoriaId: string): Promise<void> {
  return pedido<void>('/movimentos/recategorizar-em-lote', {
    method: 'POST',
    body: JSON.stringify({ ids, categoria_id: categoriaId }),
  })
}
