/*
 * LayoutApp — MOLDURA DAS PÁGINAS AUTENTICADAS
 * ===========================================
 *
 * Envolve todas as páginas a que só se acede com sessão iniciada.
 *
 * DUAS MOLDURAS, conforme o ecrã:
 *   - DESKTOP: barra lateral (BarraLateral) à esquerda + área de conteúdo.
 *     A barra pode estar "recolhida" (só ícones) — preferência guardada no
 *     localStorage.
 *   - MOBILE: a barra lateral está escondida. Há uma única barra fixa, a de
 *     topo (BarraTopoMobile), com:
 *       · nas páginas principais → o botão ☰, que abre o menu de navegação
 *         a ecrã inteiro (MenuMobile);
 *       · nas páginas de detalhe (as que declaram "voltar" no
 *         <CabecalhoPagina>) → um "‹ voltar".
 *     Não há barra de separadores no fundo — em Safari, empilhar uma barra
 *     nossa com o friso do próprio Safari comia demasiado ecrã.
 *
 * O <Outlet /> do React Router é o "buraco" onde a rota-filha (Início,
 * Movimentos, Contas, …) é renderizada. O CabecalhoProvider liga o cabeçalho de cada
 * página à barra de topo mobile (ver CabecalhoContexto); envolve toda a
 * árvore, mas o LayoutApp em si não o consome — só o fornece.
 */

import { useEffect, useRef, useState } from 'react'

import { Outlet, useLocation } from 'react-router-dom'

import { useMediaQuery } from '../hooks/useMediaQuery'
import { BarraLateral } from './BarraLateral'
import { BarraTopoMobile } from './BarraTopoMobile'
import { CabecalhoProvider } from './CabecalhoProvider'
import { MenuMobile } from './MenuMobile'
import estilos from './LayoutApp.module.css'

// Chave onde a preferência "barra recolhida" fica guardada no browser.
const CHAVE_RECOLHIDA = 'barraLateralRecolhida'

// O acesso ao localStorage está sempre dentro de try/catch: pode não
// estar disponível (janela privada, armazenamento desactivado) e nesses
// casos lançar excepção.
function lerRecolhida(): boolean {
  try {
    return localStorage.getItem(CHAVE_RECOLHIDA) === 'true'
  } catch {
    return false
  }
}

function guardarRecolhida(valor: boolean): void {
  try {
    localStorage.setItem(CHAVE_RECOLHIDA, String(valor))
  } catch {
    // Sem localStorage disponível — a preferência simplesmente não
    // persiste. Não é um erro que interesse ao utilizador.
  }
}

export function LayoutApp() {
  // Função como valor inicial: lê o localStorage uma só vez, na montagem.
  const [recolhida, setRecolhida] = useState(lerRecolhida)
  // Estado do menu de navegação em mobile (o painel que o ☰ abre).
  const [menuAberto, setMenuAberto] = useState(false)
  const eMobile = useMediaQuery('(max-width: 768px)')

  // O <main> é o único elemento com scroll (ver .module.css). Ao mudar de
  // página, volta-se ao topo — sem isto, abrir uma conta ou voltar à lista
  // podia aparecer a meio, na posição de scroll da página anterior.
  const { pathname } = useLocation()
  const refConteudo = useRef<HTMLElement>(null)
  useEffect(() => {
    // Salto imediato (não suave — suave seria estranho a cada navegação).
    if (refConteudo.current) refConteudo.current.scrollTop = 0
  }, [pathname])

  function alternarRecolher() {
    setRecolhida((anterior) => {
      const nova = !anterior
      guardarRecolhida(nova)
      return nova
    })
  }

  return (
    <CabecalhoProvider>
      <div className={estilos.layout}>
        <BarraLateral recolhida={recolhida} aoAlternarRecolher={alternarRecolher} />

        <div className={estilos.painel}>
          {eMobile && <BarraTopoMobile aoAbrirMenu={() => setMenuAberto(true)} />}

          {/* <main> é o único elemento que faz scroll (overflow-y: auto). A
              página em si vai dentro de um invólucro com largura máxima. */}
          <main className={estilos.conteudo} ref={refConteudo}>
            <div className={estilos.pagina}>
              <Outlet />
            </div>
          </main>
        </div>

        {/* O menu de navegação em mobile: só existe no DOM quando aberto e
            cobre o ecrã todo; por isso está fora do .painel, ao nível do
            .layout. */}
        {eMobile && menuAberto && <MenuMobile aoFechar={() => setMenuAberto(false)} />}
      </div>
    </CabecalhoProvider>
  )
}
