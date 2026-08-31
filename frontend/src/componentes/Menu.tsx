/*
 * Menu — MENU FLUTUANTE (POPOVER)
 * ==============================
 *
 * Um botão que, ao ser clicado, revela uma pequena lista de acções por
 * cima dele. Fecha ao: clicar fora, premir Escape, ou clicar numa das
 * acções.
 *
 * O botão que abre o menu é fornecido por quem usa o componente, através
 * da prop "gatilho" — uma função que recebe o estado (aberto) e a função
 * que o alterna, e devolve o elemento a mostrar. Isto permite que o mesmo
 * Menu sirva o perfil na barra lateral (gatilho = avatar + email) e, mais
 * tarde, o "⋯" de uma linha de tabela (gatilho = três pontos).
 *
 * As acções são <MenuItem>, passados como filhos.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'

import estilos from './Menu.module.css'

type PropsGatilho = {
  aberto: boolean
  alternar: () => void
}

type Props = {
  gatilho: (props: PropsGatilho) => ReactNode
  children: ReactNode
}

export function Menu({ gatilho, children }: Props) {
  const [aberto, setAberto] = useState(false)

  // Referência ao elemento que envolve o gatilho e o painel — serve para
  // distinguir "clicou dentro do menu" de "clicou fora".
  const raizRef = useRef<HTMLDivElement>(null)

  // Só enquanto o menu está aberto: ouvir cliques fora e a tecla Escape
  // para o fechar. A função devolvida remove os ouvintes quando o menu
  // fecha (ou o componente sai do ecrã).
  useEffect(() => {
    if (!aberto) return

    function aoClicarFora(evento: MouseEvent) {
      if (raizRef.current && !raizRef.current.contains(evento.target as Node)) {
        setAberto(false)
      }
    }
    function aoTeclar(evento: KeyboardEvent) {
      if (evento.key === 'Escape') setAberto(false)
    }

    document.addEventListener('mousedown', aoClicarFora)
    document.addEventListener('keydown', aoTeclar)
    return () => {
      document.removeEventListener('mousedown', aoClicarFora)
      document.removeEventListener('keydown', aoTeclar)
    }
  }, [aberto])

  return (
    <div ref={raizRef} className={estilos.raiz}>
      {gatilho({ aberto, alternar: () => setAberto((v) => !v) })}

      {aberto && (
        // Um clique em qualquer parte do painel (portanto, em qualquer
        // MenuItem, por propagação) fecha o menu.
        <div className={estilos.painel} role="menu" onClick={() => setAberto(false)}>
          {children}
        </div>
      )}
    </div>
  )
}

type PropsItem = {
  children: ReactNode
  onClick: () => void
}

export function MenuItem({ children, onClick }: PropsItem) {
  return (
    <button type="button" role="menuitem" className={estilos.item} onClick={onClick}>
      {children}
    </button>
  )
}

// Linha não interactiva no topo do menu — para identificar o contexto
// (ex.: o email do utilizador). stopPropagation impede que um clique nela
// feche o menu (o painel fecha ao receber qualquer clique).
export function MenuCabecalho({ children }: { children: ReactNode }) {
  return (
    <div className={estilos.cabecalho} onClick={(evento) => evento.stopPropagation()}>
      {children}
    </div>
  )
}
