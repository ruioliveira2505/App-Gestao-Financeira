/*
 * CLIENTE HTTP DA API DE CATEGORIAS
 * =================================
 *
 * As funções que falam com os endpoints /categorias do backend: ler a
 * árvore (usada no seletor de categoria do formulário de movimento, nos
 * filtros, e na própria página de gestão), e criar/editar/eliminar uma
 * categoria (grupo ou subcategoria) — usadas só pela página de gestão da
 * árvore (/categorias).
 *
 * A árvore tem sempre dois níveis — GRUPO (ex.: "Alimentação") com
 * SUBCATEGORIAS aninhadas (ex.: "Supermercado") — e cada grupo tem uma
 * "direcao" ('entrada' ou 'saida'; ver app/models/categoria.py, no
 * backend) que as suas subcategorias herdam. Um movimento liga-se sempre a
 * uma SUBCATEGORIA (nunca a um grupo directamente) — nesta árvore, todo o
 * grupo tem pelo menos a subcategoria "Outros". A árvore vem ordenada por
 * "ordem" (a posição deliberada da semente, ou o fim dos irmãos para uma
 * categoria criada à mão — ver app/models/categoria.py) — nunca
 * alfabeticamente.
 *
 * ELIMINAR PODE EXIGIR MIGRAÇÃO: se a categoria a eliminar (ou, sendo um
 * grupo, alguma das suas subcategorias) ainda tiver movimentos associados,
 * o backend recusa com 409 em vez de escolher um destino sozinho — quem
 * chama eliminarCategoria() tem de apanhar esse erro (ErroApi, campo
 * "estado"), perguntar ao utilizador para onde migram, e voltar a chamar
 * com "migrarParaId".
 */

import { pedido } from './http'

export type Direcao = 'entrada' | 'saida'

export type SubcategoriaArvore = {
  id: string
  nome: string
  // Categorias protegidas ("Outros", dentro de "Outras Entradas"/"Outras
  // Saídas") não podem ser editadas nem eliminadas — são o destino
  // garantido de um movimento sem categoria mais específica.
  protegida: boolean
}

export type GrupoArvore = {
  id: string
  nome: string
  direcao: Direcao
  subcategorias: SubcategoriaArvore[]
}

/** A árvore de categorias do utilizador (todos os grupos, com as
 *  subcategorias aninhadas), pela ordem deliberada da semente. */
export function obterArvoreCategorias(): Promise<GrupoArvore[]> {
  return pedido<GrupoArvore[]>('/categorias/arvore')
}

/** Uma categoria (grupo ou subcategoria) tal como devolvida por
 *  criar/editar (schema CategoriaOut do backend) — mais achatada do que
 *  GrupoArvore, que só existe para a forma em árvore. */
export type Categoria = {
  id: string
  nome: string
  parent_id: string | null
  direcao: Direcao
  protegida: boolean
}

/** Cria um GRUPO (parentId nulo, direcao obrigatória) ou uma SUBCATEGORIA
 *  (parentId de um grupo, sem direcao — herda a do grupo). */
export function criarGrupo(nome: string, direcao: Direcao): Promise<Categoria> {
  return pedido<Categoria>('/categorias', {
    method: 'POST',
    body: JSON.stringify({ nome, direcao }),
  })
}

export function criarSubcategoria(nome: string, parentId: string): Promise<Categoria> {
  return pedido<Categoria>('/categorias', {
    method: 'POST',
    body: JSON.stringify({ nome, parent_id: parentId }),
  })
}

/** Renomeia uma categoria (grupo: parentId null) ou renomeia e/ou move uma
 *  subcategoria para outro grupo (parentId do grupo de destino — o mesmo
 *  de que já tinha, para só renomear). */
export function editarCategoria(
  id: string,
  nome: string,
  parentId: string | null,
): Promise<Categoria> {
  return pedido<Categoria>(`/categorias/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ nome, parent_id: parentId }),
  })
}

/**
 * Elimina uma categoria. "migrarParaId" só é preciso quando uma tentativa
 * anterior sem ele falhou com 409 (ver a nota ELIMINAR PODE EXIGIR
 * MIGRAÇÃO no topo do ficheiro) — nesse caso, indica para onde os
 * movimentos afetados passam.
 */
export function eliminarCategoria(id: string, migrarParaId?: string): Promise<void> {
  const query = migrarParaId ? `?migrar_para_id=${encodeURIComponent(migrarParaId)}` : ''
  return pedido<void>(`/categorias/${id}${query}`, { method: 'DELETE' })
}

/**
 * O id da subcategoria-refúgio ("Outros", protegida) do lado indicado —
 * o destino por omissão de um movimento novo (ver MovimentoFormulario), e
 * o único destino sempre garantido ao migrar movimentos de uma categoria
 * eliminada. undefined só pode acontecer com uma árvore incompleta (ex.:
 * ainda a carregar, ou nos testes, se o "Outros" protegido faltar).
 */
export function categoriaRefugio(arvore: GrupoArvore[], direcao: Direcao): string | undefined {
  for (const grupo of arvore) {
    if (grupo.direcao !== direcao) continue
    const refugio = grupo.subcategorias.find((sub) => sub.protegida)
    if (refugio) return refugio.id
  }
  return undefined
}

/** A direcao da subcategoria com este id, ou undefined se não existir na
 *  árvore (ex.: um id vazio, ou uma árvore ainda por carregar). */
export function direcaoDaCategoria(arvore: GrupoArvore[], categoriaId: string): Direcao | undefined {
  for (const grupo of arvore) {
    if (grupo.subcategorias.some((sub) => sub.id === categoriaId)) return grupo.direcao
  }
  return undefined
}
