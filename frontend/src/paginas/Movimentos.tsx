/*
 * PÁGINA MOVIMENTOS
 * ================
 *
 * Um dos dois ecrãs do dia a dia (o outro é o Início). Vai ser o
 * livro-razão: os movimentos agrupados por dia, cada um com nome, valor e
 * saldo remanescente, com procurar / ordenar / filtrar e a criação,
 * edição e remoção de cada um. Em cima, a mesma barra do Início: escolher
 * as contas em análise e o período.
 *
 * Por agora é um marcador de posição — existe para a navegação de nível 1
 * (o controlo segmentado "Início · Movimentos") ter para onde levar.
 */

import { CabecalhoPagina } from '../componentes/CabecalhoPagina'
import estilos from './Movimentos.module.css'

export function Movimentos() {
  return (
    <div>
      <CabecalhoPagina titulo="Movimentos" />
      <p className={estilos.nota}>
        Em breve: os teus movimentos, agrupados por dia, com procura, ordenação e
        filtros.
      </p>
    </div>
  )
}
