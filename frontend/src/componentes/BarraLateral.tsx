/*
 * BarraLateral — NAVEGAÇÃO PRINCIPAL DA APLICAÇÃO
 * ==============================================
 *
 * A barra à esquerda, presente nas páginas autenticadas em DESKTOP
 * (renderizada pelo LayoutApp; em mobile fica escondida — a navegação aí é
 * o menu ☰ da BarraTopoMobile). Tem três zonas:
 *
 *   - topo: um botão que recolhe/expande a barra, e o nome da aplicação;
 *   - navegação: um ItemNav (ícone + rótulo) por secção — vindas da lista
 *     partilhada SECCOES: Início, Movimentos, Contas. É pura navegação, à
 *     maneira de uma barra de separadores nativa;
 *   - fundo: a zona de perfil — o avatar com a inicial do nome e o nome,
 *     que é uma LIGAÇÃO para a página de Perfil (dados da conta,
 *     definições, terminar sessão). Não abre um menu suspenso: leva mesmo
 *     à página, tal como a zona de perfil do menu ☰ em mobile.
 *
 * Pode estar "recolhida" (só ícones, 72px) — controlado pelo LayoutApp
 * através da prop "recolhida".
 */

import { NavLink } from 'react-router-dom'

import { useAuth } from '../auth/useAuth'
import { inicial, nomeApresentado } from '../lib/nomeUtilizador'
import { SECCOES } from '../lib/seccoes'
import { IconeMenu, IconeRecolher } from './icones'
import { ItemNav } from './ItemNav'
import estilos from './BarraLateral.module.css'

type Props = {
  recolhida: boolean
  aoAlternarRecolher: () => void
}

export function BarraLateral({ recolhida, aoAlternarRecolher }: Props) {
  const { utilizador } = useAuth()

  const classesAside = [estilos.barra, recolhida && estilos.recolhida]
    .filter(Boolean)
    .join(' ')

  const nome = nomeApresentado(utilizador?.email)

  return (
    <aside id="barra-lateral" className={classesAside}>
      <div className={estilos.topo}>
          <button
            type="button"
            className={estilos.botaoRecolher}
            onClick={aoAlternarRecolher}
            aria-label={recolhida ? 'Expandir menu' : 'Recolher menu'}
          >
            {recolhida ? <IconeMenu /> : <IconeRecolher />}
          </button>
          <span className={estilos.nomeApp}>Gestão Financeira</span>
        </div>

        <nav className={estilos.nav}>
          {SECCOES.map((item) => (
            <ItemNav
              key={item.para}
              para={item.para}
              etiqueta={item.etiqueta}
              icone={<item.Icone />}
              exato={item.exato}
              compacto={recolhida}
            />
          ))}
        </nav>

        {/* Zona de perfil, no fundo — leva à página de Perfil. No modo
            recolhido só fica o avatar; o nome vai para o "title" (tooltip
            nativo), como nos ItemNav. */}
        <div className={estilos.perfil}>
          <NavLink
            to="/perfil"
            title={recolhida ? nome : undefined}
            className={({ isActive }) =>
              [estilos.gatilhoPerfil, isActive && estilos.perfilAtivo]
                .filter(Boolean)
                .join(' ')
            }
          >
            <span className={estilos.avatar} aria-hidden="true">
              {inicial(utilizador?.email)}
            </span>
            <span className={estilos.nome}>{nome}</span>
          </NavLink>
        </div>
    </aside>
  )
}
