/*
 * Botao — BOTÃO COM O ESTILO DA APLICAÇÃO
 * ======================================
 *
 * Envolve um <button> normal, aplicando-lhe o estilo partilhado. Aceita
 * todas as propriedades de um <button> do HTML (onClick, disabled, ...) e
 * passa-as adiante sem alterações.
 *
 * Três variantes de aparência, escolhidas pela prop "variante":
 *   - "primario"   (por omissão): fundo com a cor de acento. A acção mais
 *                  provável de um ecrã.
 *   - "secundario": só contorno. Acções alternativas (Cancelar, Voltar).
 *   - "perigo":     contorno e texto na cor negativa. Acções destrutivas.
 *
 * Além disso, o "type" assume "button" por omissão, e não "submit": um
 * <button> dentro de um <form> submete-o se não tiver "type" — este valor
 * por omissão evita submissões acidentais. Quem quiser esse comportamento
 * passa explicitamente type="submit".
 */

import type { ButtonHTMLAttributes, ReactNode } from 'react'

import estilos from './Botao.module.css'

type Variante = 'primario' | 'secundario' | 'perigo'

// ButtonHTMLAttributes<HTMLButtonElement> é o conjunto de todas as
// propriedades válidas de um <button> (type, disabled, onClick, ...).
// Herdamo-las todas e acrescentamos "children" (o conteúdo do botão) e a
// "variante".
type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode
  variante?: Variante
}

export function Botao({
  children,
  variante = 'primario',
  type = 'button',
  className,
  ...resto
}: Props) {
  // Junta a classe base, a classe da variante, e qualquer classe extra
  // passada por quem usa o componente.
  const classes = [estilos.botao, estilos[variante], className]
    .filter(Boolean)
    .join(' ')

  return (
    <button type={type} className={classes} {...resto}>
      {children}
    </button>
  )
}
