/*
 * CONTEXTOS DA PILHA DE PÁGINAS
 * =============================
 *
 * Dois "contextos" do React (um valor partilhado por toda uma parte da
 * árvore de componentes, sem o passar à mão de componente em componente)
 * usados pela PilhaDePaginas (ver PilhaDePaginas.tsx) para coordenar a
 * página de BAIXO (ex.: a lista de contas) com a página que entra POR
 * CIMA dela (ex.: o detalhe de uma conta):
 *
 * - ContextoPilha: dado à página de cima (através do <Outlet>). Ela usa
 *   "anunciar" para dizer em que fase está — a entrar, a sair, ou já
 *   desmontada ("nenhuma") — e a pilha ajusta a página de baixo.
 * - ContextoPorBaixo: "true" quando a página NÃO deve mandar na barra de
 *   topo — por estar tapada por outra (dado pela pilha à página de
 *   baixo), ou por estar a sair (dado pela PaginaDeslizante à própria
 *   página, durante o recuo). O cabeçalho (CabecalhoPagina) deixa então a
 *   barra à página que está, de facto, à vista.
 */

import { createContext } from 'react'

/** Em que fase está a página de cima. */
export type FaseCamada = 'nenhuma' | 'entrar' | 'sair'

export type Pilha = {
  anunciar: (fase: FaseCamada) => void
}

export const ContextoPilha = createContext<Pilha | null>(null)

export const ContextoPorBaixo = createContext(false)
