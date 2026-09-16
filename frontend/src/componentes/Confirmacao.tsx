/*
 * Confirmacao — "ACTION SHEET" PARA CONFIRMAR UMA AÇÃO DESTRUTIVA
 * ============================================================
 *
 * À maneira do iOS: em telemóvel, uma folha compacta que sobe de baixo com
 * a AÇÃO a vermelho e, num cartão à parte por baixo, o "Cancelar" (a
 * convenção do iOS para confirmar "apagar", "terminar sessão", etc.). Em
 * ecrã largo, um cartão pequeno ao centro. Bloqueia o resto do ecrã com um
 * fundo escurecido; fecha ao clicar fora, no "Cancelar", ou com Escape.
 *
 * Desenha-se num PORTAL para o <body>: pode ser aberta de dentro de outro
 * modal (ex.: o "Eliminar conta" no fim do modal de editar conta), e um
 * portal garante que fica POR CIMA desse modal — sem o portal, ficava
 * presa no contexto de empilhamento da página, atrás do modal.
 *
 * O Escape é apanhado na fase de CAPTURA e com "stopPropagation", para o
 * modal por baixo não o receber também (senão o Escape fechava os dois).
 *
 * ARMADILHA DE FOCO (o Tab não sai do diálogo) + DEVOLUÇÃO DO FOCO ao
 * fechar (a quem o abriu) — o mesmo cuidado que o Folha já tinha; faltava
 * aqui, e um utilizador de teclado ou leitor de ecrã podia, com o Tab,
 * "atravessar" este diálogo para a página (ou o modal) por trás dele —
 * precisamente o que "aria-modal" promete impedir, mas que só de o
 * declarar não garante sozinho.
 */

import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import estilos from './Confirmacao.module.css'

type Props = {
  titulo: string
  children: ReactNode
  textoConfirmar?: string
  // Verdadeiro enquanto a ação confirmada está em curso — desativa os
  // botões e muda o texto.
  aConfirmar?: boolean
  aoConfirmar: () => void
  aoCancelar: () => void
}

export function Confirmacao({
  titulo,
  children,
  textoConfirmar = 'Confirmar',
  aConfirmar = false,
  aoConfirmar,
  aoCancelar,
}: Props) {
  // Ao abrir, o foco vai para "Cancelar" (a opção segura).
  const cancelarRef = useRef<HTMLButtonElement>(null)
  // O diálogo inteiro — usado para lhe procurar dentro os elementos
  // focáveis (armadilha de foco, mais abaixo).
  const grupoRef = useRef<HTMLDivElement>(null)
  // Quem tinha o foco mesmo antes de este diálogo abrir — para lho
  // devolver ao fechar (mais abaixo). O ARGUMENTO de useRef() é avaliado
  // já durante este primeiro render, antes de QUALQUER efeito correr —
  // por isso é AQUI, e não num useEffect próprio, que se tem de ler
  // "document.activeElement": um useEffect próprio só correria DEPOIS do
  // efeito seguinte (o que foca "Cancelar"), e já leria "Cancelar" como
  // sendo o elemento "anterior" — errado.
  const elementoAoAbrir = useRef<HTMLElement | null>(
    typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null,
  )

  useEffect(() => {
    cancelarRef.current?.focus()
  }, [])

  // Ao fechar (desmontar), devolve o foco a quem tinha antes de este
  // diálogo abrir — sem isto, o browser deixa-o em <body>, e quem navega
  // por teclado perde completamente o sítio onde estava.
  useEffect(() => {
    const elemento = elementoAoAbrir.current
    return () => {
      elemento?.focus?.()
    }
  }, [])

  useEffect(() => {
    function aoTeclar(evento: KeyboardEvent) {
      if (evento.key === 'Escape') {
        // Não deixar o Escape chegar ao modal por baixo.
        evento.stopPropagation()
        aoCancelar()
        return
      }

      if (evento.key !== 'Tab' || !grupoRef.current) return

      // Foco preso: ao passar do último elemento focável volta ao
      // primeiro, e vice-versa — o mesmo padrão de Folha.tsx.
      const focaveis = grupoRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])',
      )
      if (focaveis.length === 0) return
      const primeiro = focaveis[0]
      const ultimo = focaveis[focaveis.length - 1]

      if (evento.shiftKey && document.activeElement === primeiro) {
        evento.preventDefault()
        ultimo.focus()
      } else if (!evento.shiftKey && document.activeElement === ultimo) {
        evento.preventDefault()
        primeiro.focus()
      }
    }
    document.addEventListener('keydown', aoTeclar, true)
    return () => document.removeEventListener('keydown', aoTeclar, true)
  }, [aoCancelar])

  return createPortal(
    <div className={estilos.fundo} onClick={aoCancelar}>
      <div
        ref={grupoRef}
        className={estilos.grupo}
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        // Um clique dentro do diálogo não deve fechá-lo.
        onClick={(evento) => evento.stopPropagation()}
      >
        <div className={estilos.folha}>
          <div className={estilos.cabecalho}>
            <h2 className={estilos.titulo}>{titulo}</h2>
            <div className={estilos.mensagem}>{children}</div>
          </div>
          <button
            type="button"
            className={estilos.botaoAcao}
            onClick={aoConfirmar}
            disabled={aConfirmar}
          >
            {aConfirmar ? 'A processar…' : textoConfirmar}
          </button>
        </div>
        <button
          type="button"
          ref={cancelarRef}
          className={estilos.botaoCancelar}
          onClick={aoCancelar}
          disabled={aConfirmar}
        >
          Cancelar
        </button>
      </div>
    </div>,
    document.body,
  )
}
