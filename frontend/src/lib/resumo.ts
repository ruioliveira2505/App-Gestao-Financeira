/*
 * CLIENTE HTTP DA API DE RESUMO
 * ================================
 *
 * As duas funções que falam com os endpoints /resumo do backend:
 * obterResumo (os números estáticos da página Início, incluindo a
 * repartição de entradas/saídas por GRUPO de categoria) e
 * obterDetalheGrupo (um nível mais fundo — a repartição por SUBCATEGORIA
 * de um único grupo, só pedida quando esse grupo é "aberto" em Início). O
 * resto da aplicação nunca usa "fetch" diretamente; a mecânica comum
 * (prefixo, cookie, erros) vive em src/lib/http.ts.
 *
 * As duas aceitam "contas" (opcional) — a mesma forma já usada em
 * src/lib/movimentos.ts, uma lista de ids de conta escrita no URL como
 * "id1,id2" (ver app/core/params.py, no backend) — e "de"/"ate"
 * (formato "AAAA-MM-DD", andam sempre a par). "contas" é um filtro
 * GLOBAL (ver a nota "FILTRO DE CONTAS" em app/routers/resumo.py):
 * restringe TANTO o saldo total COMO o fluxo/repartição por categoria.
 * "de"/"ate" (ver "FILTRO DE PERÍODO", no mesmo ficheiro) NUNCA afecta o
 * saldo total — só substitui o mês actual por omissão no fluxo.
 * obterDetalheGrupo aceita as duas pela mesma razão: a repartição por
 * subcategoria de um grupo tem de respeitar a mesma selecção de contas
 * e o mesmo período que já filtravam a chamada a obterResumo que a
 * originou.
 *
 * O filtro de categoria (ver "FILTRO DE CATEGORIA", no mesmo ficheiro)
 * NÃO é partilhado da mesma forma: obterResumo aceita
 * "categoriasEntradas"/"categoriasSaidas" EM SEPARADO (um por direcção —
 * a interface só mostra/filtra a direcção actualmente em ecrã, e um
 * único parâmetro partilhado deixaria a OUTRA direcção com zero
 * categorias — ver a nota no backend), enquanto obterDetalheGrupo
 * aceita um único "categorias" (o grupo pedido já fixa a direcção, só
 * há uma lista que faz sentido).
 */

import { pedido } from './http'

/** As opções comuns a obterResumo e a obterDetalheGrupo — ver a nota no
 *  topo do ficheiro. */
type OpcoesBase = {
  contas?: string[]
  de?: string
  ate?: string
}

type OpcoesResumo = OpcoesBase & {
  categoriasEntradas?: string[]
  categoriasSaidas?: string[]
}

type OpcoesDetalheGrupo = OpcoesBase & {
  categorias?: string[]
}

function querystringBase(opcoes: OpcoesBase): URLSearchParams {
  const params = new URLSearchParams()
  if (opcoes.contas && opcoes.contas.length > 0) params.set('contas', opcoes.contas.join(','))
  if (opcoes.de) params.set('de', opcoes.de)
  if (opcoes.ate) params.set('ate', opcoes.ate)
  return params
}

/**
 * Uma linha da repartição de entradas ou de saídas por GRUPO de
 * categoria (schema GrupoResumo do backend) — "grupo_id" é sempre o id
 * de um GRUPO (nunca de uma subcategoria: um movimento numa subcategoria
 * soma-se ao seu grupo-pai — ver app/routers/resumo.py). "valor" é texto,
 * já na moeda principal, com o sinal (negativo para um grupo de saídas —
 * ver formatarDinheiro); "percentagem" é um número (0-100, não é
 * dinheiro, não precisa da mesma precisão exacta), sempre positiva, face
 * ao total de entradas OU de saídas do período (nunca ao saldo).
 */
export type GrupoResumo = {
  grupo_id: string
  nome: string
  valor: string
  percentagem: number
}

/**
 * O resumo do utilizador autenticado, tal como a API o devolve (schema
 * ResumoOut do backend) — os valores já convertidos para a moeda
 * principal (ver src/paginas/PerfilPreferencias.tsx).
 *
 * Valores monetários são texto ("1234.56"), não números — a mesma
 * convenção do resto da API (ver src/lib/contas.ts); converter só na
 * fronteira da apresentação, com formatarDinheiro (src/lib/moedas.ts).
 *
 * "saldo_total" não depende de período nenhum — é sempre "quanto tenho
 * agora". "entradas"/"saidas"/"liquido"/"categorias_entradas"/
 * "categorias_saidas" dizem respeito ao intervalo [periodo_inicio,
 * periodo_fim] — o mês actual por omissão, ou o intervalo escolhido no
 * filtro de período ("de"/"ate", em obterResumo); vêm sempre explícitos
 * na resposta para a página nunca ter de recalcular por si própria o que
 * o período pedido significa.
 *
 * "categorias_entradas"/"categorias_saidas": só grupos com pelo menos um
 * movimento no período (nunca uma linha a 0%), por ordem decrescente de
 * valor — a ordenação já vem feita do backend.
 */
export type Resumo = {
  saldo_total: string
  entradas: string
  saidas: string
  liquido: string
  categorias_entradas: GrupoResumo[]
  categorias_saidas: GrupoResumo[]
  periodo_inicio: string
  periodo_fim: string
}

export function obterResumo(opcoes: OpcoesResumo = {}): Promise<Resumo> {
  const params = querystringBase(opcoes)
  if (opcoes.categoriasEntradas && opcoes.categoriasEntradas.length > 0) {
    params.set('categorias_entradas', opcoes.categoriasEntradas.join(','))
  }
  if (opcoes.categoriasSaidas && opcoes.categoriasSaidas.length > 0) {
    params.set('categorias_saidas', opcoes.categoriasSaidas.join(','))
  }
  const querystring = params.toString()
  return pedido<Resumo>(querystring ? `/resumo?${querystring}` : '/resumo')
}

/**
 * Uma linha da repartição por SUBCATEGORIA dentro de um grupo (schema
 * SubcategoriaResumo do backend) — ao contrário de GrupoResumo.percentagem
 * (face ao total de entradas/saídas do período), aqui "percentagem" é
 * face ao TOTAL DO PRÓPRIO GRUPO (ver GrupoDetalhe.valor, abaixo):
 * perguntas diferentes ("quanto do mês foi para Supermercado" vs. "quanto
 * de Alimentação foi para Supermercado") — a segunda é a que faz sentido
 * ao abrir uma categoria para a ver em detalhe. Um movimento categorizado
 * directamente no grupo, sem subcategoria própria, aparece como a sua
 * própria linha, com "nome" igual ao do próprio grupo.
 */
export type SubcategoriaResumo = {
  subcategoria_id: string
  nome: string
  valor: string
  percentagem: number
}

/**
 * A resposta de obterDetalheGrupo (schema GrupoDetalheOut do backend) —
 * o total do grupo (mesmo período e mesma conversão de moeda que
 * obterResumo) e a sua repartição por subcategoria, já ordenada por
 * valor decrescente.
 */
export type GrupoDetalhe = {
  grupo_id: string
  nome: string
  valor: string
  subcategorias: SubcategoriaResumo[]
}

export function obterDetalheGrupo(
  grupoId: string,
  opcoes: OpcoesDetalheGrupo = {},
): Promise<GrupoDetalhe> {
  const params = querystringBase(opcoes)
  if (opcoes.categorias && opcoes.categorias.length > 0) {
    params.set('categorias', opcoes.categorias.join(','))
  }
  const querystring = params.toString()
  const caminho = `/resumo/categorias/${grupoId}`
  return pedido<GrupoDetalhe>(querystring ? `${caminho}?${querystring}` : caminho)
}
