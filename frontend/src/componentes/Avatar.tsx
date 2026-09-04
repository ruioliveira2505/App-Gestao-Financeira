/*
 * Avatar — CÍRCULO COM A INICIAL
 * =============================
 *
 * Um círculo colorido com a primeira letra de um nome. A cor é escolhida
 * de forma determinística a partir do nome (o mesmo nome dá sempre a mesma
 * cor), de uma paleta de seis tons definida em src/index.css.
 *
 * Usado por conta na lista e no detalhe — dá identidade visual e ajuda a
 * varrer a lista de contas.
 */

import estilos from './Avatar.module.css'

const N_CORES = 6

// Hash simples e estável de uma string para um índice de cor.
function indiceDeCor(chave: string): number {
  let acumulador = 0
  for (let i = 0; i < chave.length; i++) {
    acumulador = (acumulador * 31 + chave.charCodeAt(i)) >>> 0
  }
  return acumulador % N_CORES
}

type Props = {
  // O texto de onde saem a inicial e a cor (ex.: o nome do banco ou da
  // conta).
  nome: string
  // "md" (40px) para linhas de lista; "xl" (88px) para o cabeçalho de
  // identidade no detalhe de uma conta e a pré-visualização no formulário.
  tamanho?: 'md' | 'xl'
}

export function Avatar({ nome, tamanho = 'md' }: Props) {
  const inicial = (nome.trim()[0] ?? '?').toUpperCase()
  const cor = indiceDeCor(nome)

  return (
    <span
      className={`${estilos.avatar} ${estilos[tamanho]}`}
      data-cor={cor}
      aria-hidden="true"
    >
      {inicial}
    </span>
  )
}
