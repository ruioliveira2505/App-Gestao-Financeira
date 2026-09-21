/*
 * LinhaOpcaoFiltro — UMA LINHA DE OPÇÃO, PARTILHADA POR TODOS OS FILTROS
 * ==========================================================================
 *
 * Etiqueta + "✓" quando escolhida — o botão usado em toda a lista de
 * opções de qualquer filtro desta app: `FiltroMovimentos.tsx` (Contas,
 * Tipo, Categorias, Datas), `FiltroContas.tsx`, `SeletorPeriodo.tsx` e
 * `FiltroCategoriasResumo.tsx` (Início). Existia repetido, quase palavra
 * por palavra (a mesma função, o mesmo CSS), em cada um destes quatro
 * ficheiros — extraído para aqui numa revisão de design/UX, depois de os
 * três filtros de Início terem estabilizado, para uma mudança de aspecto
 * (cor, espaçamento, ícone) deixar de ter de ser repetida em quatro
 * sítios diferentes (e continuar, inevitavelmente, a divergir entre eles
 * com o tempo).
 *
 * "multi" escolhe a semântica ARIA, não o aspecto visual (que é sempre o
 * mesmo — negrito quando escolhida, "✓" à direita): "aria-pressed" para
 * multi-escolha (Contas, Categorias — várias linhas podem estar
 * marcadas ao mesmo tempo), "aria-current" para escolha única (Tipo,
 * Datas, "Mês específico"/"Data personalizada" — só uma de cada vez).
 */

import type { ReactNode } from 'react'

import { IconeCheck } from './icones'
import estilos from './LinhaOpcaoFiltro.module.css'

type Props = {
  etiqueta: string
  selecionada: boolean
  aoTocar: () => void
  // Um elemento opcional antes da etiqueta (o Avatar de uma conta, o
  // PontoCategoria de uma subcategoria).
  antes?: ReactNode
  multi?: boolean
}

export function LinhaOpcaoFiltro({ etiqueta, selecionada, aoTocar, antes, multi = false }: Props) {
  return (
    <button
      type="button"
      className={estilos.linha}
      aria-current={!multi && selecionada ? 'true' : undefined}
      aria-pressed={multi ? selecionada : undefined}
      onClick={aoTocar}
    >
      {antes && <span className={estilos.linhaAntes}>{antes}</span>}
      <span className={estilos.linhaEtiqueta}>{etiqueta}</span>
      {selecionada && <IconeCheck tamanho={18} />}
    </button>
  )
}
