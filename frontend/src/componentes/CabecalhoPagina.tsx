/*
 * CabecalhoPagina — CABEÇALHO COMUM ÀS PÁGINAS
 * ===========================================
 *
 * Um título (<h1>), opcionalmente um subtítulo e um ícone à esquerda, e
 * uma ranhura à direita para uma ação (ex.: o botão "+").
 *
 * APRESENTAÇÕES, conforme o ecrã e o tipo de página:
 *   - DESKTOP (ou fora da moldura, ex.: um teste isolado): desenha-se no
 *     conteúdo, como um cabeçalho normal (ícone + título + subtítulo, ação
 *     à direita).
 *   - MOBILE, página principal (sem "voltar"): o título aparece aqui, no
 *     conteúdo, GRANDE (estilo "large title" do iOS/WhatsApp); a ação vai
 *     para a barra de topo (via CabecalhoContexto). Ao rolar, o título sai
 *     do ecrã.
 *   - MOBILE, página de detalhe (com "voltar"): o título vai para o CENTRO
 *     da barra de topo (entre o "‹" e a ação); aqui só fica o subtítulo,
 *     se houver.
 *
 * "voltar" (um caminho): nas páginas de detalhe, faz a barra de topo mobile
 * mostrar "‹ voltar" em vez do botão ☰ do menu. Esse "‹" recua no histórico
 * (navigate(-1)); o caminho passado aqui serve-lhe de recurso para quando
 * não há histórico (ver BarraTopoMobile). Em desktop, onde não há barra de
 * topo, a página mostra o seu próprio <LinkVoltar> no conteúdo (que em
 * mobile fica escondido, para não duplicar o "‹" da barra).
 *
 * "icone": desenha-se à esquerda do título, no cabeçalho do conteúdo
 * (desktop, ou páginas principais). Não vai para a barra de topo.
 */

import { useEffect, type ReactNode } from 'react'

import { useMediaQuery } from '../hooks/useMediaQuery'
import { useDefinirCabecalho } from './useCabecalho'
import estilos from './CabecalhoPagina.module.css'

type Props = {
  titulo: string
  subtitulo?: string
  icone?: ReactNode
  acao?: ReactNode
  voltar?: string
}

export function CabecalhoPagina({ titulo, subtitulo, icone, acao, voltar }: Props) {
  const eMobile = useMediaQuery('(max-width: 768px)')
  const definir = useDefinirCabecalho()

  useEffect(() => {
    if (!definir) return
    definir({ titulo, acao, voltar })
    // "definir" é estável (ver cabecalhoContexto). "acao" entra nas
    // dependências porque muda dentro da mesma página — ex.: no detalhe de
    // uma conta, só existe depois de a conta carregar. Não há ciclo: este
    // componente só re-renderiza quando a sua página re-renderiza (não
    // consome o contexto que muda a cada "definir").
  }, [definir, titulo, acao, voltar])

  // Mobile dentro da moldura.
  if (eMobile && definir) {
    // Página de detalhe: o título está na barra de topo, ao centro. Aqui
    // só fica o subtítulo, se houver.
    if (voltar) {
      return subtitulo ? <p className={estilos.subtituloSolto}>{subtitulo}</p> : null
    }
    // Página principal: título grande no conteúdo (a barra de topo só tem
    // o ☰ e a ação).
    return (
      <div className={estilos.tituloGrande}>
        <h1>{titulo}</h1>
        {subtitulo && <p className={estilos.subtitulo}>{subtitulo}</p>}
      </div>
    )
  }

  return (
    <header className={estilos.cabecalho}>
      {icone && <div className={estilos.icone}>{icone}</div>}
      <div className={estilos.textos}>
        <h1>{titulo}</h1>
        {subtitulo && <p className={estilos.subtitulo}>{subtitulo}</p>}
      </div>
      {acao && <div className={estilos.acao}>{acao}</div>}
    </header>
  )
}
