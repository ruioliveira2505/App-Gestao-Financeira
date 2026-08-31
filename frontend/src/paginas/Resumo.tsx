/*
 * PÁGINA RESUMO
 * =============
 *
 * Página inicial da aplicação depois do início de sessão. A ideia é ser,
 * mais tarde, um resumo transversal — património total, atividade recente,
 * atalhos —, por oposição a uma lista de uma entidade só (essa é a página
 * Contas).
 *
 * Por agora é apenas um marcador de posição: existe para a barra lateral
 * ter um destino "inicial" e para haver uma página para onde cair depois
 * do login. O conteúdo real é acrescentado quando houver dados para
 * mostrar (depois das fatias de Contas e Movimentos).
 */

import estilos from './Resumo.module.css'

export function Resumo() {
  return (
    <div>
      <h1>Resumo</h1>
      <p className={estilos.nota}>
        Em breve: o teu património e a atividade recente das contas.
      </p>
    </div>
  )
}
