/*
 * useMediaQuery — RESPONDER A UMA MEDIA QUERY EM JAVASCRIPT
 * =======================================================
 *
 * Devolve `true`/`false` conforme a media query (ex.: "(max-width: 768px)")
 * corresponde ao ecrã atual, e re-renderiza quando isso muda (ao rodar o
 * telemóvel, ao redimensionar a janela).
 *
 * Usa-se quando a decisão não pode viver só no CSS — por exemplo, quando
 * um componente tem de renderizar coisas DIFERENTES em mobile e em desktop
 * (e não apenas escondê-las): aqui, o cabeçalho da página, que em mobile
 * vai para a barra de topo e em desktop fica no conteúdo.
 *
 * Implementado com useSyncExternalStore — a API do React própria para
 * "subscrever uma fonte externa" (aqui, o objeto MediaQueryList do
 * browser). Trata sozinha da subscrição, da leitura do valor e da
 * consistência durante a renderização.
 */

import { useCallback, useSyncExternalStore } from 'react'

export function useMediaQuery(query: string): boolean {
  // subscribe: liga um ouvinte à media query e devolve a função que o
  // desliga. Recriado só quando "query" muda.
  const subscrever = useCallback(
    (aoMudar: () => void) => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => {}
      const mql = window.matchMedia(query)
      mql.addEventListener('change', aoMudar)
      return () => mql.removeEventListener('change', aoMudar)
    },
    [query],
  )

  const ler = () => {
    if (typeof window === 'undefined' || !window.matchMedia) return false
    return window.matchMedia(query).matches
  }

  // O 3.º argumento (leitura no servidor) devolve sempre false — este
  // projeto não faz renderização no servidor, mas a assinatura pede-o.
  return useSyncExternalStore(subscrever, ler, () => false)
}
