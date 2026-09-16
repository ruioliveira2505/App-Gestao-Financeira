/*
 * useColapsarAoRolar — DETECTAR QUE SE ROLOU PARA ALÉM DE UM PONTO
 * =================================================================
 *
 * Usado pelo cabeçalho "large title" das páginas principais em mobile
 * (ver CabecalhoPagina.tsx): quando se rola a página para baixo, o título
 * grande e a barra de procura devem desaparecer do conteúdo, e o título
 * passa a aparecer, compacto, na barra de topo fixa, ao lado do ☰ (ver
 * BarraTopoMobile.tsx) — o mesmo padrão de "large title que colapsa" das
 * apps iOS.
 *
 * A DETECÇÃO usa IntersectionObserver, não um ouvinte do evento "scroll"
 * — o mesmo padrão já usado na sentinela do scroll infinito da lista de
 * Movimentos (ver a nota PAGINAÇÃO POR CURSOR em
 * src/paginas/Movimentos.tsx): olhar só para uma pequena marca invisible
 * colocada logo a seguir ao que deve desaparecer poupa ter de calcular à
 * mão, a cada disparo de "scroll", se já se rolou o suficiente — o browser
 * já sabe dizer sozinho quando um elemento sai ou entra no ecrã.
 *
 * A ligação entre essa marca (a "sentinela") e o observador é uma
 * "callback ref" (uma função passada a `ref`, não `useRef` + `useEffect`):
 * o observador nasce quando a sentinela aparece no DOM e morre quando
 * desaparece, sem depender de uma lista de dependências a acompanhar esse
 * aparecimento/desaparecimento.
 *
 * Um só booleano, "colapsado" — sem valor de transição a meio (0 a 1): a
 * animação em si é feita em CSS, a reagir à mudança desse booleano (ver
 * CabecalhoPagina.module.css e BarraTopoMobile.module.css), não a um
 * valor de scroll contínuo. Foi a opção escolhida em detrimento de seguir
 * o dedo 1:1 (como o iOS faz de facto): mais simples, reaproveita o
 * padrão já existente no projecto, e o "salto" de um estado para o outro
 * fica suave com uma transição CSS bem ajustada — ver a decisão em
 * caderno/decisoes.md.
 */

import { useCallback, useRef, useState } from 'react'

export function useColapsarAoRolar(): {
  sentinelaRef: (no: HTMLElement | null) => void
  colapsado: boolean
} {
  const [colapsado, setColapsado] = useState(false)
  const observadorRef = useRef<IntersectionObserver | null>(null)

  const sentinelaRef = useCallback((no: HTMLElement | null) => {
    observadorRef.current?.disconnect()
    observadorRef.current = null
    if (!no) return
    const observador = new IntersectionObserver((entradas) => {
      // A sentinela deixa de estar visível quando se rola para além
      // dela — "colapsado" fica true. Volta a "não colapsado" ao rolar
      // de volta para cima, até ela reaparecer.
      setColapsado(!entradas[0]?.isIntersecting)
    })
    observador.observe(no)
    observadorRef.current = observador
  }, [])

  return { sentinelaRef, colapsado }
}
