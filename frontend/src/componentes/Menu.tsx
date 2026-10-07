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
 *
 * FECHAR COM ANIMAÇÃO: o painel não desaparece de golpe — desvanece (a
 * duração de "aparecer", src/lib/movimento.ts) e só depois sai da página.
 * Durante esse instante ("aFechar"), tocar outra vez no gatilho reabre-o
 * em vez de esperar que acabe de fechar.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'

import { DURACAO_APARECER_MS } from '../lib/movimento'
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
  // A desvanecer, antes de sair da página (ver FECHAR COM ANIMAÇÃO).
  const [aFechar, setAFechar] = useState(false)

  function fechar() {
    setAFechar(true)
  }

  function alternar() {
    if (aberto && !aFechar) {
      fechar()
    } else if (aberto && aFechar) {
      // A meio de fechar: cancela o fecho e fica aberto (o efeito abaixo
      // desfaz o seu temporizador ao "aFechar" voltar a false).
      setAFechar(false)
    } else {
      setAberto(true)
    }
  }

  // Enquanto desvanece: no fim da animação, sai mesmo da página. O
  // temporizador é desfeito se o fecho for cancelado (reabrir) ou se o
  // componente sair antes disso.
  useEffect(() => {
    if (!aFechar) return
    const temporizador = window.setTimeout(() => {
      setAberto(false)
      setAFechar(false)
    }, DURACAO_APARECER_MS)
    return () => window.clearTimeout(temporizador)
  }, [aFechar])

  // Referência ao elemento que envolve o gatilho e o painel — serve para
  // distinguir "clicou dentro do menu" de "clicou fora".
  const raizRef = useRef<HTMLDivElement>(null)

  // Só enquanto o menu está aberto: ouvir cliques fora e a tecla Escape
  // para o fechar. A função devolvida remove os ouvintes quando o menu
  // fecha (ou o componente sai do ecrã).
  useEffect(() => {
    if (!aberto || aFechar) return

    function aoClicarFora(evento: MouseEvent) {
      if (raizRef.current && !raizRef.current.contains(evento.target as Node)) {
        setAFechar(true)
      }
    }
    function aoTeclar(evento: KeyboardEvent) {
      if (evento.key === 'Escape') setAFechar(true)
    }

    document.addEventListener('mousedown', aoClicarFora)
    document.addEventListener('keydown', aoTeclar)
    return () => {
      document.removeEventListener('mousedown', aoClicarFora)
      document.removeEventListener('keydown', aoTeclar)
    }
  }, [aberto, aFechar])

  return (
    <div
      ref={raizRef}
      className={alinhamento === 'pagina' ? estilos.raizPagina : estilos.raiz}
    >
      {gatilho({ aberto: aberto && !aFechar, alternar })}

      {aberto && (
        // Um clique em qualquer parte do painel (portanto, em qualquer
        // MenuItem sem "mantemAberto", por propagação) fecha o menu.
        <div
          className={[
            estilos.painel,
            posicao === 'baixo' && estilos.painelBaixo,
            alinhamento === 'direita' && estilos.painelDireita,
            alinhamento === 'pagina' && estilos.painelPagina,
            aFechar && estilos.painelAFechar,
          ]
            .filter(Boolean)
            .join(' ')}
          role="menu"
          onClick={fechar}
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
  // Ícone à esquerda do rótulo (ex.: o de "Sincronizar agora"). Numa
  // mesma lista de itens, ou todos têm ícone ou nenhum tem — um ícone
  // sozinho desalinha os rótulos e parece um engano.
  icone?: ReactNode
  // Item visível mas indisponível: rótulo esbatido, não reage ao toque e
  // não fecha o menu. Mostrar a acção em vez de a esconder ensina que ela
  // existe; "descricao" (abaixo) deve dizer porque não está disponível —
  // um item cinzento sem explicação deixa a pessoa a adivinhar.
  desativado?: boolean
  // Segunda linha, mais pequena, por baixo do rótulo (ex.: "Nenhuma conta
  // ligada", a razão de um item desativado).
  descricao?: ReactNode
}

export function MenuItem({
  children,
  onClick,
  selecionado,
  sufixo,
  mantemAberto,
  perigo,
  icone,
  desativado,
  descricao,
}: PropsItem) {
  const classes = [estilos.item, perigo && estilos.itemPerigo, desativado && estilos.itemDesativado]
    .filter(Boolean)
    .join(' ')
  return (
    <button
      type="button"
      role="menuitem"
      aria-current={selecionado ? 'true' : undefined}
      // "aria-disabled" (e não o atributo "disabled") mantém o item
      // alcançável por teclado e leitores de ecrã — assim a pessoa ouve
      // que ele existe e porquê está indisponível, em vez de o saltar.
      aria-disabled={desativado || undefined}
      className={classes}
      onClick={(evento) => {
        // Um item desativado não faz nada e não fecha o menu (o painel
        // fecha ao receber qualquer clique — daí o stopPropagation).
        if (desativado) {
          evento.stopPropagation()
          return
        }
        if (mantemAberto) evento.stopPropagation()
        onClick()
      }}
    >
      {selecionado !== undefined && (
        <span className={estilos.itemMarca} aria-hidden="true">
          {selecionado ? <IconeCheck tamanho={16} /> : null}
        </span>
      )}
      {icone && (
        <span className={estilos.itemIcone} aria-hidden="true">
          {icone}
        </span>
      )}
      {descricao ? (
        <span className={estilos.itemTextos}>
          <span className={estilos.itemRotulo}>{children}</span>
          <span className={estilos.itemDescricao}>{descricao}</span>
        </span>
      ) : (
        <span className={estilos.itemRotulo}>{children}</span>
      )}
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
