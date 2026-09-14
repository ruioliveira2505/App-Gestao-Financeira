/*
 * PontoCategoria — O PONTO COLORIDO DE UMA CATEGORIA
 * ====================================================
 *
 * Um pequeno círculo colorido, sem letra — a "cor" de uma categoria, tal
 * como o Avatar dá cor a uma conta: determinística a partir do NOME DO
 * GRUPO (nunca da subcategoria), para que todas as subcategorias do mesmo
 * grupo ("Alimentação" > "Supermercado", "Alimentação" > "Restaurantes e
 * Cafés"...) partilhem a mesma cor. Usa a mesma paleta de seis tons do
 * Avatar (src/index.css, --avatar-N-bg) e a mesma lógica de "cor a partir
 * de um nome" (src/lib/corDeterministica.ts) — não há cor guardada em
 * lado nenhum, nem no backend nem aqui.
 *
 * Usado em dois tamanhos: "sm" (10px, por omissão) nas opções do seletor
 * de categoria, ao lado do nome da subcategoria; "md" (40px, igual ao
 * Avatar) na linha da lista de movimentos, a substituir o símbolo neutro
 * que lá estava antes desta fatia existir (uma seta na diagonal, sem
 * ligação nenhuma à categoria do movimento).
 */

import { indiceDeCor } from '../lib/corDeterministica'
import estilos from './PontoCategoria.module.css'

type Props = {
  // O nome do GRUPO a que a categoria pertence — não o da subcategoria.
  nomeGrupo: string
  tamanho?: 'sm' | 'md'
}

export function PontoCategoria({ nomeGrupo, tamanho = 'sm' }: Props) {
  const cor = indiceDeCor(nomeGrupo)

  return (
    <span className={`${estilos.ponto} ${estilos[tamanho]}`} data-cor={cor} aria-hidden="true" />
  )
}
