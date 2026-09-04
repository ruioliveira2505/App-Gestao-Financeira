/*
 * PÁGINA INÍCIO
 * =============
 *
 * A página onde se cai depois do início de sessão e um dos dois ecrãs do
 * dia a dia (o outro é Movimentos). É a página de ANÁLISE: em cima,
 * escolher as contas em análise e o período; depois o saldo total, as
 * entradas, saídas e diferença do período, e cartões de análise
 * (categorias, evolução do saldo, cash-flow, movimentos recorrentes).
 *
 * Por agora é apenas um marcador de posição: o conteúdo real chega quando
 * houver movimentos para analisar.
 */

import { CabecalhoPagina } from '../componentes/CabecalhoPagina'
import estilos from './Inicio.module.css'

export function Inicio() {
  return (
    <div>
      <CabecalhoPagina titulo="Início" />
      <p className={estilos.nota}>
        Em breve: a análise das tuas contas — saldo, entradas e saídas por período.
      </p>
    </div>
  )
}
