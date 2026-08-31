/*
 * LayoutApp — MOLDURA DAS PÁGINAS AUTENTICADAS
 * ===========================================
 *
 * Envolve todas as páginas a que só se acede com sessão iniciada. Compõe
 * a barra lateral de navegação (BarraLateral) com a área de conteúdo.
 *
 * O <Outlet /> do React Router é o "buraco" onde a rota-filha é
 * renderizada: as rotas "/" (Resumo) e "/contas" (Contas), definidas em
 * src/App.tsx como filhas da rota que usa este layout, aparecem aqui
 * dentro, mantendo a barra lateral sempre presente à volta.
 *
 * Dois estados vivem aqui, no componente que contém tanto os controlos
 * como a barra:
 *   - gavetaAberta: em ecrã estreito, se a barra (que aí é uma gaveta)
 *     está aberta;
 *   - recolhida: em ecrã largo, se a barra está no modo compacto (só
 *     ícones). É guardado no localStorage para persistir entre visitas.
 */

import { useState } from 'react'

import { Outlet } from 'react-router-dom'

import { BarraLateral } from './BarraLateral'
import { IconeFechar, IconeMenu } from './icones'
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
  const [gavetaAberta, setGavetaAberta] = useState(false)
  // Função como valor inicial: lê o localStorage uma só vez, na montagem.
  const [recolhida, setRecolhida] = useState(lerRecolhida)

  function alternarRecolher() {
    setRecolhida((anterior) => {
      const nova = !anterior
      guardarRecolhida(nova)
      return nova
    })
  }

  return (
    <div className={estilos.layout}>
      <BarraLateral
        aberta={gavetaAberta}
        aoFechar={() => setGavetaAberta(false)}
        recolhida={recolhida}
        aoAlternarRecolher={alternarRecolher}
      />

      <div className={estilos.painel}>
        {/* Barra de topo: o CSS só a mostra em ecrã estreito. O botão
            alterna a gaveta (abre e fecha). */}
        <header className={estilos.barraTopo}>
          <button
            type="button"
            className={estilos.botaoMenu}
            aria-label={gavetaAberta ? 'Fechar menu' : 'Abrir menu'}
            aria-controls="barra-lateral"
            aria-expanded={gavetaAberta}
            onClick={() => setGavetaAberta((aberta) => !aberta)}
          >
            {gavetaAberta ? <IconeFechar tamanho={22} /> : <IconeMenu tamanho={22} />}
          </button>
          <span className={estilos.nomeApp}>Gestão Financeira</span>
        </header>

        {/* <main> é o único elemento que faz scroll (overflow-y: auto). A
            página em si vai dentro de um invólucro com largura máxima.
            Enquanto a gaveta está aberta, o scroll é congelado. */}
        <main
          className={
            gavetaAberta ? `${estilos.conteudo} ${estilos.travado}` : estilos.conteudo
          }
        >
          <div className={estilos.pagina}>
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
