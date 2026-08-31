/*
 * PÁGINA CONTAS
 * =============
 *
 * Lista das contas do utilizador — conta bancária, cartão, dinheiro, etc.
 * É a raiz do domínio financeiro: os movimentos vão pertencer a contas.
 *
 * Neste momento é apenas um marcador de posição. O conteúdo real (total
 * por moeda, lista agrupada por tipo, criar/editar/apagar, página de
 * detalhe por conta) é a fatia seguinte; esta página existe já para a
 * barra lateral ter o destino "Contas".
 */

import estilos from './Contas.module.css'

export function Contas() {
  return (
    <div>
      <h1>Contas</h1>
      <p className={estilos.nota}>Em breve: as tuas contas e o saldo de cada uma.</p>
    </div>
  )
}
