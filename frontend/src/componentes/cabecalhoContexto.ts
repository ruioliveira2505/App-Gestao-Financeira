/*
 * CONTEXTO DO CABEÇALHO — DEFINIÇÃO
 * ================================
 *
 * Liga o cabeçalho de cada página (título + ação + "voltar") à barra de
 * topo fixa que aparece em mobile (BarraTopoMobile). Como a barra é da
 * moldura e o cabeçalho é de cada página, a informação passa por contexto.
 *
 * DOIS contextos, de propósito:
 *   - "DefinirCabecalhoContexto" guarda uma FUNÇÃO estável (não muda entre
 *     renders) — assim o efeito que a chama, no <CabecalhoPagina>, não
 *     entra em ciclo;
 *   - "CabecalhoContexto" guarda o VALOR atual, que muda a cada página —
 *     só a barra de topo o consome.
 *
 * Este ficheiro só contém a definição (createContext + tipos). O
 * componente que os preenche está em CabecalhoProvider.tsx; os hooks para
 * os ler, em useCabecalho.ts. A separação respeita a regra do Fast
 * Refresh do Vite (um ficheiro exporta só componentes, ou só o resto).
 */

import { createContext, type ReactNode } from 'react'

export type Cabecalho = {
  titulo: string
  acao?: ReactNode
  // Quando definido, a barra de topo mostra "‹ voltar" (para este caminho)
  // em vez do menu ☰ — padrão de páginas de detalhe.
  voltar?: string
}

export type DefinirCabecalho = (cabecalho: Cabecalho | null) => void

// Vale null quando não há <CabecalhoProvider> acima (ex.: um teste que
// monta só uma página).
export const DefinirCabecalhoContexto = createContext<DefinirCabecalho | null>(null)
export const CabecalhoContexto = createContext<Cabecalho | null>(null)
