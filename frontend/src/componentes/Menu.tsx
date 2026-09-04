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
 * A prop "posicao" diz para que lado o painel abre: "cima" (por omissão,
 * como na barra lateral, onde o gatilho está no fundo do ecrã) ou "baixo"
 * (para um menu no topo de uma página ou numa barra de ferramentas).
 *
 * A prop "alinhamento" diz por que lado o painel se alinha ao gatilho:
 * "esquerda" (por omissão) ou "direita" — usa-se "direita" quando o
 * gatilho está encostado à margem direita do ecrã, para o painel abrir
 * para dentro em vez de sair para fora (e ficar cortado).
 *
 * O conteúdo do menu são <MenuItem> (acções), opcionalmente precedidos por
 * um <MenuCabecalho> (linha de contexto no topo).
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'

import { IconeCheck } from './icones'
import estilos from './Menu.module.css'

type PropsGatilho = {
  aberto: boolean
  alternar: () => void
}

type Props = {
  gatilho: (props: PropsGatilho) => ReactNode
  children: ReactNode
  posicao?: 'cima' | 'baixo'
  // "pagina": o painel ancora-se à margem direita da PÁGINA (não ao gatilho)
  // e ocupa a largura do conteúdo — para um menu na barra de topo. Requer
  // que o gatilho esteja dentro de um elemento posicionado que abranja a
  // página (a barra de topo, que é "position: fixed").
  alinhamento?: 'esquerda' | 'direita' | 'pagina'
}

export function Menu({
  gatilho,
  children,
  posicao = 'cima',
  alinhamento = 'esquerda',
}: Props) {
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
    <div
      ref={raizRef}
      className={alinhamento === 'pagina' ? estilos.raizPagina : estilos.raiz}
    >
      {gatilho({ aberto, alternar: () => setAberto((v) => !v) })}

      {aberto && (
        // Um clique em qualquer parte do painel (portanto, em qualquer
        // MenuItem sem "mantemAberto", por propagação) fecha o menu.
        <div
          className={[
            estilos.painel,
            posicao === 'baixo' && estilos.painelBaixo,
            alinhamento === 'direita' && estilos.painelDireita,
            alinhamento === 'pagina' && estilos.painelPagina,
          ]
            .filter(Boolean)
            .join(' ')}
          role="menu"
          onClick={() => setAberto(false)}
        >
          {children}
        </div>
      )}
    </div>
  )
}

type PropsItem = {
  children: ReactNode
  onClick: () => void
  // Quando definido, o item passa a ser uma ESCOLHA (menu de escolha única,
  // ex.: "ordenar por…"): ganha uma marca de "visto" à esquerda quando
  // "selecionado" é verdadeiro, e o espaço dessa marca fica sempre
  // reservado para os rótulos alinharem. Indefinido = item de acção normal.
  selecionado?: boolean
  // Sufixo à direita do rótulo (ex.: um chevron para "abre um submenu").
  sufixo?: ReactNode
  // Com "true", clicar no item NÃO fecha o menu — para um item que abre um
  // submenu no mesmo painel, ou o "voltar" de um submenu.
  mantemAberto?: boolean
  // Acção destrutiva ("Remover", "Apagar") — o rótulo fica na cor negativa.
  perigo?: boolean
}

export function MenuItem({
  children,
  onClick,
  selecionado,
  sufixo,
  mantemAberto,
  perigo,
}: PropsItem) {
  return (
    <button
      type="button"
      role="menuitem"
      aria-current={selecionado ? 'true' : undefined}
      className={perigo ? `${estilos.item} ${estilos.itemPerigo}` : estilos.item}
      onClick={(evento) => {
        if (mantemAberto) evento.stopPropagation()
        onClick()
      }}
    >
      {selecionado !== undefined && (
        <span className={estilos.itemMarca} aria-hidden="true">
          {selecionado ? <IconeCheck tamanho={16} /> : null}
        </span>
      )}
      <span className={estilos.itemRotulo}>{children}</span>
      {sufixo && (
        <span className={estilos.itemSufixo} aria-hidden="true">
          {sufixo}
        </span>
      )}
    </button>
  )
}

// Linha divisória entre grupos de itens dentro do mesmo menu (ex.: o campo
// por que ordenar e, por baixo, a direção).
export function MenuSeparador() {
  return <div className={estilos.separador} role="separator" />
}

// Rótulo de secção dentro de um menu com vários grupos (ex.: "ORDENAR",
// "AGRUPAR"). Não interactivo; stopPropagation para não fechar o menu.
export function MenuTitulo({ children }: { children: ReactNode }) {
  return (
    <div className={estilos.tituloSeccao} onClick={(evento) => evento.stopPropagation()}>
      {children}
    </div>
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
