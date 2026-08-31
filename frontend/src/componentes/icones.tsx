/*
 * ÍCONES
 * ======
 *
 * Conjunto de ícones da aplicação, como componentes React que devolvem um
 * <svg>. Convenção (estilo "Feather" / "Lucide"): traço, sem
 * preenchimento, viewBox de 24, cor herdada do texto à volta
 * (stroke="currentColor"), cantos redondos. Assim um ícone integra-se em
 * qualquer contexto só pela cor do texto onde está.
 *
 * Não é uma biblioteca de ícones instalada — são poucos e escritos à mão.
 * Se um dia forem muitos, passa a valer a pena uma dependência (ex.:
 * lucide-react).
 */

import type { ReactNode } from 'react'

type PropsIcone = {
  // Lado do ícone, em pixels. 18 por omissão (o tamanho usado na barra
  // lateral).
  tamanho?: number
}

// Componente-base partilhado por todos os ícones: fixa a "moldura" do
// <svg> e recebe as formas concretas como filhos.
function Svg({ tamanho = 18, children }: { tamanho?: number; children: ReactNode }) {
  return (
    <svg
      width={tamanho}
      height={tamanho}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

// Quatro rectângulos, tipo painel de resumo.
export function IconeResumo(props: PropsIcone) {
  return (
    <Svg {...props}>
      <rect width="7" height="9" x="3" y="3" rx="1" />
      <rect width="7" height="5" x="14" y="3" rx="1" />
      <rect width="7" height="9" x="14" y="12" rx="1" />
      <rect width="7" height="5" x="3" y="16" rx="1" />
    </Svg>
  )
}

// Carteira.
export function IconeContas(props: PropsIcone) {
  return (
    <Svg {...props}>
      <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
      <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
      <path d="M18 12a2 2 0 0 0 0 4h4v-4z" />
    </Svg>
  )
}

// Duas setas para a esquerda — "recolher" a barra lateral.
export function IconeRecolher(props: PropsIcone) {
  return (
    <Svg {...props}>
      <path d="m11 17-5-5 5-5" />
      <path d="m18 17-5-5 5-5" />
    </Svg>
  )
}

// Três traços horizontais — "menu" / "expandir" a barra lateral.
export function IconeMenu(props: PropsIcone) {
  return (
    <Svg {...props}>
      <line x1="4" x2="20" y1="6" y2="6" />
      <line x1="4" x2="20" y1="12" y2="12" />
      <line x1="4" x2="20" y1="18" y2="18" />
    </Svg>
  )
}

// Um "X" — fechar.
export function IconeFechar(props: PropsIcone) {
  return (
    <Svg {...props}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </Svg>
  )
}

// Olho — "mostrar" (ex.: revelar a password).
export function IconeOlho(props: PropsIcone) {
  return (
    <Svg {...props}>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </Svg>
  )
}

// Olho riscado — "ocultar".
export function IconeOlhoFechado(props: PropsIcone) {
  return (
    <Svg {...props}>
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </Svg>
  )
}
