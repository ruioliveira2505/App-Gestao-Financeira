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

  useEffect(() => {
    cancelarRef.current?.focus()
  }, [])

  useEffect(() => {
    function aoTeclar(evento: KeyboardEvent) {
      if (evento.key === 'Escape') {
        // Não deixar o Escape chegar ao modal por baixo.
        evento.stopPropagation()
        aoCancelar()
      }
    }
    document.addEventListener('keydown', aoTeclar, true)
    return () => document.removeEventListener('keydown', aoTeclar, true)
  }, [aoCancelar])

  return createPortal(
    <div className={estilos.fundo} onClick={aoCancelar}>
      <div
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
