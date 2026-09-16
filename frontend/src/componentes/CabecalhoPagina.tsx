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
 * "aoRecuar": só as páginas envolvidas em <PaginaDeslizante> a passam —
 * atrasa a navegação do "‹" para dar tempo à animação de saída (ver a nota
 * em PaginaDeslizante.tsx e em BarraTopoMobile.tsx). Sem ela, "‹" navega de
 * imediato, como sempre.
 *
 * "icone": desenha-se à esquerda do título, no cabeçalho do conteúdo
 * (desktop, ou páginas principais). Não vai para a barra de topo.
 *
 * "colapsavel": só tem efeito numa página PRINCIPAL, em mobile (sem
 * "voltar"). Ao rolar para além do título grande, este passa a mostrar-se
 * COMPACTO na barra de topo, ao lado do ☰ — o mesmo padrão do "large
 * title" do iOS a colapsar (ver useColapsarAoRolar.ts, e a nota em
 * BarraTopoMobile.tsx). "aoColapsar", se indicado, é chamado sempre que
 * esse estado muda — para a própria página poder animar em sincronia
 * outros elementos que também devam desaparecer ao rolar (ex.: a barra de
 * procura, logo a seguir a este cabeçalho).
 */

import { useEffect, type ReactNode } from 'react'

import { useColapsarAoRolar } from '../hooks/useColapsarAoRolar'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { useDefinirCabecalho } from './useCabecalho'
import estilos from './CabecalhoPagina.module.css'

type Props = {
  titulo: string
  subtitulo?: string
  icone?: ReactNode
  acao?: ReactNode
  voltar?: string
  aoRecuar?: (navegarDeFacto: () => void) => void
  colapsavel?: boolean
  aoColapsar?: (colapsado: boolean) => void
}

export function CabecalhoPagina({
  titulo,
  subtitulo,
  icone,
  acao,
  voltar,
  aoRecuar,
  colapsavel = false,
  aoColapsar,
}: Props) {
  const eMobile = useMediaQuery('(max-width: 768px)')
  const definir = useDefinirCabecalho()

  // Só activo numa página principal (sem "voltar") — nas de detalhe o
  // título já vive sempre na barra de topo, não há "large title" nenhum
  // para colapsar.
  const { sentinelaRef, colapsado } = useColapsarAoRolar()
  const ehColapsavel = colapsavel && !voltar
  // "undefined" (não "false") quando a página não é colapsavel — é o que
  // diz à barra de topo para nem sequer desenhar ali o título compacto
  // (ver BarraTopoMobile.tsx): "false" significaria "colapsavel, mas
  // ainda não rolado", um estado bem diferente de "nem faz parte disto".
  const tituloCompacto = ehColapsavel ? colapsado : undefined

  useEffect(() => {
    if (!definir) return
    definir({ titulo, acao, voltar, aoRecuar, tituloCompacto })
    // "definir" é estável (ver cabecalhoContexto). "acao" entra nas
    // dependências porque muda dentro da mesma página — ex.: no detalhe de
    // uma conta, só existe depois de a conta carregar. Não há ciclo: este
    // componente só re-renderiza quando a sua página re-renderiza (não
    // consome o contexto que muda a cada "definir").
  }, [definir, titulo, acao, voltar, aoRecuar, tituloCompacto])

  useEffect(() => {
    if (ehColapsavel) aoColapsar?.(colapsado)
  }, [aoColapsar, ehColapsavel, colapsado])

  // Mobile dentro da moldura.
  if (eMobile && definir) {
    // Página de detalhe: o título está na barra de topo, ao centro. Aqui
    // só fica o subtítulo, se houver.
    if (voltar) {
      return subtitulo ? <p className={estilos.subtituloSolto}>{subtitulo}</p> : null
    }
    // Página principal: título grande no conteúdo (a barra de topo só tem
    // o ☰ e a ação) — desvanece-se ao colapsar, quando "colapsavel". A
    // sentinela (invisível) é o que o useColapsarAoRolar vigia: assim que
    // sai do ecrã por cima, "colapsado" passa a true.
    return (
      <div
        className={
          tituloCompacto
            ? `${estilos.tituloGrande} ${estilos.tituloGrandeEscondido}`
            : estilos.tituloGrande
        }
      >
        <h1>{titulo}</h1>
        {subtitulo && <p className={estilos.subtitulo}>{subtitulo}</p>}
        {colapsavel && <div ref={sentinelaRef} className={estilos.sentinelaColapso} aria-hidden="true" />}
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
