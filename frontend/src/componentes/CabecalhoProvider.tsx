/*
 * CabecalhoProvider — PREENCHE O CONTEXTO DO CABEÇALHO
 * ==================================================
 *
 * Guarda o cabeçalho atual (título + ação + "voltar") e expõe a função
 * "definir" para as páginas o atualizarem. O LayoutApp envolve as páginas
 * autenticadas neste provider; a BarraTopoMobile lê o valor.
 *
 * "definir" é criado com useCallback([]) — nunca muda de identidade —,
 * para que o efeito que o chama no <CabecalhoPagina> não dispare em ciclo.
 */

import { useCallback, useState, type ReactNode } from 'react'

import {
  CabecalhoContexto,
  DefinirCabecalhoContexto,
  type Cabecalho,
  type DefinirCabecalho,
} from './cabecalhoContexto'

export function CabecalhoProvider({ children }: { children: ReactNode }) {
  const [cabecalho, setCabecalho] = useState<Cabecalho | null>(null)
  const definir = useCallback<DefinirCabecalho>((novo) => setCabecalho(novo), [])

  return (
    <DefinirCabecalhoContexto.Provider value={definir}>
      <CabecalhoContexto.Provider value={cabecalho}>{children}</CabecalhoContexto.Provider>
    </DefinirCabecalhoContexto.Provider>
  )
}
