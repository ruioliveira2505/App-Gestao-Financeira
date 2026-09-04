/*
 * LinkVoltar — LIGAÇÃO "‹ VOLTAR" NO TOPO DE UMA PÁGINA
 * ===================================================
 *
 * Uma pequena ligação de regresso, usada no topo das páginas de detalhe e
 * de formulário (detalhe de conta, criar/editar conta).
 *
 * Só aparece em ECRÃ LARGO. Em ecrã estreito a barra de topo
 * (BarraTopoMobile) já mostra um "‹" de regresso, e esta ligação no
 * conteúdo seria redundante — por isso o CSS esconde-a (ver
 * LinkVoltar.module.css).
 */

import { Link } from 'react-router-dom'

import estilos from './LinkVoltar.module.css'

type Props = {
  para: string
  children: string
  // "true" navega SUBSTITUINDO a entrada atual no histórico (em vez de
  // empilhar uma nova) — para páginas que são um passo intermédio, como o
  // formulário de editar conta, não ficarem no histórico a serem
  // reabertas com o "recuar".
  substituir?: boolean
}

export function LinkVoltar({ para, children, substituir = false }: Props) {
  return (
    <Link to={para} replace={substituir} className={estilos.link}>
      <span aria-hidden="true">‹</span> {children}
    </Link>
  )
}
