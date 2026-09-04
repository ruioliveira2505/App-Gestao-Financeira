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
  // Espessura do traço do desenho, em unidades do viewBox (0..24). 1.75 por
  // omissão — um traço fino, que lê como "nítido" e próximo do estilo dos
  // ícones do iOS. Passa-se um valor maior (ex.: 2.5) onde se quer o
  // símbolo mais encorpado e escuro, como no separador ativo da barra de
  // baixo. O traço também se pode fixar por CSS (a propriedade
  // "stroke-width" aplicada ao <svg> ganha a este atributo), útil para o
  // fazer variar com um estado — ":active", separador selecionado, etc.
  traco?: number
}

// Componente-base partilhado por todos os ícones: fixa a "moldura" do
// <svg> e recebe as formas concretas como filhos.
function Svg({
  tamanho = 18,
  traco = 1.75,
  children,
}: {
  tamanho?: number
  traco?: number
  children: ReactNode
}) {
  return (
    <svg
      width={tamanho}
      height={tamanho}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={traco}
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

// Duas setas opostas (entrada / saída) — os movimentos / transações.
export function IconeMovimentos(props: PropsIcone) {
  return (
    <Svg {...props}>
      <path d="M7 7h13" />
      <path d="m16 3 4 4-4 4" />
      <path d="M17 17H4" />
      <path d="m8 13-4 4 4 4" />
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

// Três traços horizontais — "menu" (abre a navegação em mobile; expande a
// barra lateral em desktop).
export function IconeMenu(props: PropsIcone) {
  return (
    <Svg {...props}>
      <line x1="4" x2="20" y1="6" y2="6" />
      <line x1="4" x2="20" y1="12" y2="12" />
      <line x1="4" x2="20" y1="18" y2="18" />
    </Svg>
  )
}

// Três pontos na horizontal — "mais opções" (menu de ordenar/agrupar).
export function IconeReticencias(props: PropsIcone) {
  return (
    <Svg {...props} traco={0}>
      <circle cx="5" cy="12" r="1.6" fill="currentColor" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" />
      <circle cx="19" cy="12" r="1.6" fill="currentColor" />
    </Svg>
  )
}

// Um "X" — fechar (ex.: o menu de navegação em mobile).
export function IconeFechar(props: PropsIcone) {
  return (
    <Svg {...props}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </Svg>
  )
}

// Um lápis — "editar".
export function IconeLapis(props: PropsIcone) {
  return (
    <Svg {...props}>
      <path d="M17 3a2.83 2.83 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3Z" />
      <path d="m15 5 4 4" />
    </Svg>
  )
}

// Seta para a direita — indica que uma linha é clicável (leva a outra
// página).
export function IconeChevronDireita(props: PropsIcone) {
  return (
    <Svg {...props}>
      <path d="m9 18 6-6-6-6" />
    </Svg>
  )
}

// Seta para a esquerda — "voltar" (na barra de topo, em mobile).
export function IconeChevronEsquerda(props: PropsIcone) {
  return (
    <Svg {...props}>
      <path d="m15 18-6-6 6-6" />
    </Svg>
  )
}

// Etiqueta — o nome de uma conta.
export function IconeEtiqueta(props: PropsIcone) {
  return (
    <Svg {...props}>
      <path d="M12.6 2.6A2 2 0 0 0 11.2 2H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .6 1.4l8.7 8.7a2.4 2.4 0 0 0 3.4 0l6.6-6.6a2.4 2.4 0 0 0 0-3.4z" />
      <circle cx="7.5" cy="7.5" r="1.25" fill="currentColor" stroke="none" />
    </Svg>
  )
}

// Edifício com colunas — o banco de uma conta.
export function IconeBanco(props: PropsIcone) {
  return (
    <Svg {...props}>
      <path d="M3 21h18" />
      <path d="m12 3 9 5H3z" />
      <path d="M5 21v-9M9.5 21v-9M14.5 21v-9M19 21v-9" />
    </Svg>
  )
}

// Círculo com um "€" — a moeda de uma conta.
export function IconeMoeda(props: PropsIcone) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M15.5 8.7a4 4 0 1 0 0 6.6" />
      <path d="M7.5 11h6M7.5 13.5h5" />
    </Svg>
  )
}

// Calendário — a data de início dos movimentos.
export function IconeCalendario(props: PropsIcone) {
  return (
    <Svg {...props}>
      <rect x="3" y="4.5" width="18" height="16.5" rx="2" />
      <path d="M8 2.5v4M16 2.5v4M3 9.5h18" />
    </Svg>
  )
}

// Carteira — o saldo de uma conta.
export function IconeCarteira(props: PropsIcone) {
  return (
    <Svg {...props}>
      <rect x="3" y="6" width="18" height="14" rx="2.5" />
      <path d="M3 10h18" />
      <circle cx="16.5" cy="15" r="1.25" fill="currentColor" stroke="none" />
    </Svg>
  )
}

// Lupa — pesquisar.
export function IconeLupa(props: PropsIcone) {
  return (
    <Svg {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.35-4.35" />
    </Svg>
  )
}

// Dois blocos empilhados — agrupar a lista em secções.
export function IconeAgrupar(props: PropsIcone) {
  return (
    <Svg {...props}>
      <rect x="3" y="3" width="18" height="7" rx="1.5" />
      <rect x="3" y="14" width="18" height="7" rx="1.5" />
    </Svg>
  )
}

// Setas para cima e para baixo — ordenar.
export function IconeOrdenar(props: PropsIcone) {
  return (
    <Svg {...props}>
      <path d="m3 8 4-4 4 4" />
      <path d="M7 4v16" />
      <path d="m21 16-4 4-4-4" />
      <path d="M17 20V4" />
    </Svg>
  )
}

// Lista com vistos — entrar em modo de seleção.
export function IconeSelecionar(props: PropsIcone) {
  return (
    <Svg {...props}>
      <path d="m3 7 2 2 4-4" />
      <path d="m3 17 2 2 4-4" />
      <path d="M13 6h8" />
      <path d="M13 18h8" />
    </Svg>
  )
}

// Gráfico de linhas — usado na secção "em breve" do detalhe de uma conta.
export function IconeGrafico(props: PropsIcone) {
  return (
    <Svg {...props}>
      <path d="M3 3v18h18" />
      <path d="m19 9-5 5-4-4-3 3" />
    </Svg>
  )
}

// Um visto ("check") — marca a secção atual na lista do menu.
export function IconeCheck(props: PropsIcone) {
  return (
    <Svg {...props}>
      <path d="M20 6 9 17l-5-5" />
    </Svg>
  )
}

// Um sinal "+" — criar algo novo (ex.: uma conta).
export function IconeMais(props: PropsIcone) {
  return (
    <Svg {...props}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
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

// Silhueta de uma pessoa (cabeça + ombros) — a secção "Conta" do perfil.
export function IconePessoa(props: PropsIcone) {
  return (
    <Svg {...props}>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </Svg>
  )
}

// Um cadeado fechado — a secção "Segurança" do perfil.
export function IconeCadeado(props: PropsIcone) {
  return (
    <Svg {...props}>
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </Svg>
  )
}

// Três cursores horizontais (sliders) — a secção "Preferências" do perfil.
export function IconeAjustes(props: PropsIcone) {
  return (
    <Svg {...props}>
      <line x1="21" x2="14" y1="4" y2="4" />
      <line x1="10" x2="3" y1="4" y2="4" />
      <line x1="21" x2="12" y1="12" y2="12" />
      <line x1="8" x2="3" y1="12" y2="12" />
      <line x1="21" x2="16" y1="20" y2="20" />
      <line x1="12" x2="3" y1="20" y2="20" />
      <line x1="14" x2="14" y1="2" y2="6" />
      <line x1="8" x2="8" y1="10" y2="14" />
      <line x1="16" x2="16" y1="18" y2="22" />
    </Svg>
  )
}
