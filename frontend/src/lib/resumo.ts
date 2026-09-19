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
 */

import { pedido } from './http'

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
 * periodo_fim] — hoje, sempre o mês atual (não há ainda nenhum filtro
 * que o mude); vêm explícitos na resposta para a página nunca ter de
 * recalcular por si própria o que "mês atual" significa.
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

export function obterResumo(): Promise<Resumo> {
  return pedido<Resumo>('/resumo')
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

export function obterDetalheGrupo(grupoId: string): Promise<GrupoDetalhe> {
  return pedido<GrupoDetalhe>(`/resumo/categorias/${grupoId}`)
}
