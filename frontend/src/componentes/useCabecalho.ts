/*
 * HOOKS DO CONTEXTO DO CABEÇALHO
 * =============================
 *
 * - useDefinirCabecalho(): para as PÁGINAS declararem o seu cabeçalho à
 *   moldura. Devolve a função (estável) ou null se não houver moldura à
 *   volta (ex.: um teste que monta só a página) — nesse caso o
 *   <CabecalhoPagina> desenha-se normalmente no conteúdo.
 * - useCabecalhoAtual(): para a BARRA DE TOPO ler o cabeçalho atual.
 */

import { useContext } from 'react'

import {
  CabecalhoContexto,
  DefinirCabecalhoContexto,
  type Cabecalho,
  type DefinirCabecalho,
} from './cabecalhoContexto'

export function useDefinirCabecalho(): DefinirCabecalho | null {
  return useContext(DefinirCabecalhoContexto)
}

export function useCabecalhoAtual(): Cabecalho | null {
  return useContext(CabecalhoContexto)
}
