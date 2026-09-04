/*
 * LinkBotao — LIGAÇÃO COM ASPECTO DE BOTÃO
 * =======================================
 *
 * Um <Link> do React Router que se parece com um Botao. Para quando a
 * ação é "ir para outra página" (ex.: "Nova conta" → /contas/nova,
 * "Editar" → /contas/:id/editar): semanticamente é uma ligação, mas deve
 * ter o mesmo peso visual que os botões.
 *
 * Partilha as classes de Botao.module.css — os CSS Modules dão a este
 * ficheiro exactamente os mesmos nomes reescritos, por isso o aspecto é
 * garantidamente igual ao do Botao.
 *
 * PROPRIEDADES
 *   - para:       o destino da navegação (a prop "to" do <Link>).
 *   - variante:   "primario" (por omissão) | "secundario" | "perigo".
 *   - apenasIcone: quando verdadeiro, o botão fica redondo e do tamanho de
 *                 um ícone, sem espaço para texto. Nesse caso "children"
 *                 deve ser só um ícone.
 *   - titulo:     obrigatório na prática quando apenasIcone é verdadeiro —
 *                 dá o nome acessível (aria-label) e a dica ao passar o
 *                 rato (title), já que não há texto visível a nomear o
 *                 botão. Ignorado quando há texto.
 */

import type { ReactNode } from 'react'

import { Link } from 'react-router-dom'

import estilos from './Botao.module.css'

type Variante = 'primario' | 'secundario' | 'perigo'

type Props = {
  para: string
  children: ReactNode
  variante?: Variante
  apenasIcone?: boolean
  titulo?: string
}

export function LinkBotao({
  para,
  children,
  variante = 'primario',
  apenasIcone = false,
  titulo,
}: Props) {
  // Junta a classe base, a da variante de cor e, se for o caso, o
  // modificador de forma "só ícone". filter(Boolean) descarta o valor
  // falso quando apenasIcone é falso.
  const classes = [estilos.botao, estilos[variante], apenasIcone && estilos.apenasIcone]
    .filter(Boolean)
    .join(' ')

  return (
    <Link
      to={para}
      className={classes}
      aria-label={apenasIcone ? titulo : undefined}
      title={apenasIcone ? titulo : undefined}
    >
      {children}
    </Link>
  )
}
