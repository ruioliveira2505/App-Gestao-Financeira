/*
 * ItemNav — UMA LIGAÇÃO NA BARRA LATERAL
 * =====================================
 *
 * Um item de navegação: ícone + rótulo, ligado a uma rota. Destaca-se
 * quando a rota que representa é a rota actual (via NavLink, do React
 * Router, que fornece "isActive").
 *
 * Usado pela BarraLateral (desktop), um por secção da aplicação.
 *
 * No modo compacto (barra lateral recolhida), o rótulo é escondido por
 * CSS, ficando apenas o ícone, centrado; o texto passa a um "title"
 * (tooltip nativo) para não se perder o significado.
 */

import type { ReactNode } from 'react'

// NavLink é como o Link, mas conhece o estado activo (a rota actual).
import { NavLink } from 'react-router-dom'

import estilos from './ItemNav.module.css'

type Props = {
  // Endereço para onde o item navega.
  para: string
  // Texto visível.
  etiqueta: string
  // O ícone (um componente de icones.tsx).
  icone: ReactNode
  // Quando true, o item só fica activo se a rota for exactamente "para" —
  // usado no "/" (que, sem isto, ficaria activo em todas as rotas, por ser
  // prefixo de todas).
  exato?: boolean
  // Modo compacto: só ícone (barra lateral recolhida).
  compacto?: boolean
}

export function ItemNav({ para, etiqueta, icone, exato = false, compacto = false }: Props) {
  return (
    <NavLink
      to={para}
      end={exato}
      // No modo compacto, o texto do rótulo passa a tooltip do browser.
      title={compacto ? etiqueta : undefined}
      className={({ isActive }) =>
        [estilos.item, isActive && estilos.ativo, compacto && estilos.compacto]
          .filter(Boolean)
          .join(' ')
      }
    >
      <span className={estilos.icone}>{icone}</span>
      <span className={estilos.rotulo}>{etiqueta}</span>
    </NavLink>
  )
}
