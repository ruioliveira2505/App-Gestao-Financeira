/*
 * MenuMobile — MENU DE NAVEGAÇÃO EM ECRÃ ESTREITO
 * ==============================================
 *
 * O painel que abre a partir do botão ☰ da barra de topo (BarraTopoMobile),
 * só em mobile. Ocupa o ecrã todo e entra a deslizar da esquerda para a
 * direita; fecha-se pelo "X" no canto superior esquerdo (onde estava o ☰)
 * ou pela tecla Escape.
 *
 * É PURA NAVEGAÇÃO — o equivalente à barra de separadores nativa de muitas
 * apps: leva às secções da aplicação e a mais lado nenhum. Não tem
 * "Terminar sessão"; isso vive na página de Perfil, para não se lhe tocar
 * por engano ao mudar de secção.
 *
 * ESTRUTURA (a mesma da barra lateral do desktop, de cima para baixo):
 *   - cabeçalho com a geometria da barra de topo — "X" à esquerda (onde
 *     estava o ☰), nome da aplicação ao centro;
 *   - a lista de secções (SECCOES: Início · Movimentos · Contas), linhas
 *     planas sobre o fundo cinzento; a secção atual leva um visto (✓);
 *   - no fundo, a zona de perfil: o avatar com a inicial e o nome,
 *     ligados à página de Perfil.
 *
 * As linhas não têm cartão nem traço a separá-las: assentam no cinzento e,
 * ao toque, ganham um preenchimento um pouco mais escuro — como os itens
 * da barra lateral em desktop.
 *
 * MONTAGEM E ANIMAÇÃO DE SAÍDA: o LayoutApp só monta este componente
 * enquanto o menu está aberto. A ENTRADA anima-se por CSS ao montar. Para
 * a SAÍDA, "fechar()" marca "aFechar" (troca a animação para a de saída) e
 * agenda a desmontagem real para o fim da animação, chamando "aoFechar"
 * (que vive no LayoutApp, sempre montado — logo é seguro chamá-lo mesmo
 * depois de este componente sair).
 *
 * FOCO PRESO: com "aria-modal", o Tab não deve sair do painel enquanto o
 * menu está aberto. "aoTeclar" trata disso, além do Escape.
 *
 * "deslizar da esquerda" e não um gesto de arrasto: o iOS reserva o
 * arrasto a partir da margem esquerda para o seu próprio "voltar". Por
 * isso a abertura é despoletada pelo botão e o fecho é sempre o "X" /
 * Escape — nunca um swipe.
 */

import { useEffect, useRef, useState, type KeyboardEvent } from 'react'

import { NavLink } from 'react-router-dom'

import { useAuth } from '../auth/useAuth'
import { inicial, nomeApresentado } from '../lib/nomeUtilizador'
import { SECCOES, type Seccao } from '../lib/seccoes'
import { IconeCheck, IconeFechar } from './icones'
import estilos from './MenuMobile.module.css'

// Deve acompanhar a duração da animação ".painelAFechar" no CSS: quando a
// animação de saída acaba, desmonta-se o painel.
const DURACAO_SAIDA_MS = 250

type Props = {
  aoFechar: () => void
}

export function MenuMobile({ aoFechar }: Props) {
  const { utilizador } = useAuth()
  const painelRef = useRef<HTMLDivElement>(null)
  // Recebe o foco quando o menu abre, para a navegação por teclado / leitor
  // de ecrã começar dentro do painel.
  const fecharRef = useRef<HTMLButtonElement>(null)
  // A decorrer a animação de saída? Troca as animações de entrada pelas de
  // saída (ver CSS) e impede um segundo "fechar".
  const [aFechar, setAFechar] = useState(false)
  // Guarda o temporizador da saída para o limpar se o componente sair antes
  // (ex.: uma navegação que desmonte a moldura).
  const temporizador = useRef<number | undefined>(undefined)

  useEffect(() => {
    fecharRef.current?.focus()
    return () => window.clearTimeout(temporizador.current)
  }, [])

  // Inicia a saída: anima e, terminada a animação, desmonta.
  function fechar() {
    if (aFechar) return
    setAFechar(true)
    temporizador.current = window.setTimeout(aoFechar, DURACAO_SAIDA_MS)
  }

  function aoTeclar(evento: KeyboardEvent<HTMLDivElement>) {
    if (evento.key === 'Escape') {
      fechar()
      return
    }
    if (evento.key !== 'Tab' || !painelRef.current) return

    // Foco preso: ao passar do último elemento focável volta ao primeiro, e
    // vice-versa.
    const focaveis = painelRef.current.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled])',
    )
    if (focaveis.length === 0) return
    const primeiro = focaveis[0]
    const ultimo = focaveis[focaveis.length - 1]

    if (evento.shiftKey && document.activeElement === primeiro) {
      evento.preventDefault()
      ultimo.focus()
    } else if (!evento.shiftKey && document.activeElement === ultimo) {
      evento.preventDefault()
      primeiro.focus()
    }
  }

  // Classe de uma linha, com o estado ativo do NavLink.
  const classeLinha = ({ isActive }: { isActive: boolean }) =>
    isActive ? `${estilos.linha} ${estilos.linhaAtiva}` : estilos.linha

  // Uma linha de secção (ícone + rótulo, visto quando é a rota atual).
  const linhaSeccao = (sec: Seccao) => (
    <NavLink
      key={sec.para}
      to={sec.para}
      end={sec.exato}
      onClick={fechar}
      className={classeLinha}
    >
      {({ isActive }) => (
        <>
          <span className={estilos.icone}>
            <sec.Icone tamanho={22} />
          </span>
          <span className={estilos.rotulo}>{sec.etiqueta}</span>
          {isActive && <IconeCheck tamanho={18} />}
        </>
      )}
    </NavLink>
  )

  return (
    <div
      ref={painelRef}
      className={aFechar ? `${estilos.painel} ${estilos.painelAFechar}` : estilos.painel}
      role="dialog"
      aria-modal="true"
      aria-label="Menu de navegação"
      onKeyDown={aoTeclar}
    >
      <div className={estilos.cabecalho}>
        <div className={estilos.zonaLateral}>
          <button
            type="button"
            ref={fecharRef}
            className={estilos.botaoFechar}
            onClick={fechar}
            aria-label="Fechar menu"
          >
            <IconeFechar tamanho={24} />
          </button>
        </div>
        <span className={estilos.titulo}>Gestão Financeira</span>
        <div className={estilos.zonaLateral} aria-hidden="true" />
      </div>

      <div className={estilos.corpo}>
        {/* A navegação: Início · Movimentos · Contas. */}
        <nav className={estilos.seccoes} aria-label="Secções">
          {SECCOES.map(linhaSeccao)}
        </nav>

        {/* Zona de perfil, no fundo — leva à página de Perfil (dados da
            conta, definições, terminar sessão). */}
        <div className={estilos.perfil}>
          <NavLink to="/perfil" onClick={fechar} className={classeLinha}>
            {({ isActive }) => (
              <>
                <span className={estilos.avatar} aria-hidden="true">
                  {inicial(utilizador?.email)}
                </span>
                <span className={estilos.rotulo}>{nomeApresentado(utilizador?.email)}</span>
                {isActive && <IconeCheck tamanho={18} />}
              </>
            )}
          </NavLink>
        </div>
      </div>
    </div>
  )
}
