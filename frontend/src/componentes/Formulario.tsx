/*
 * Formulario — MOLDURA DE UM FORMULÁRIO
 * ====================================
 *
 * Envolve um <form> do HTML, aplicando-lhe o arranjo vertical partilhado
 * (os elementos empilhados, com espaço uniforme entre eles) e impedindo o
 * comportamento por omissão de recarregar a página ao submeter.
 *
 * Recebe o conteúdo (campos, caixa de erro, botão) como filhos, e a
 * função a correr na submissão em "aoSubmeter" — já sem ter de tratar do
 * evento.preventDefault(), feito aqui.
 */

import type { FormEvent, ReactNode } from 'react'

import estilos from './Formulario.module.css'

type Props = {
  aoSubmeter: () => void
  children: ReactNode
}

export function Formulario({ aoSubmeter, children }: Props) {
  function tratarSubmissao(evento: FormEvent<HTMLFormElement>) {
    // Por omissão, submeter um <form> faz o browser recarregar a página.
    // Numa aplicação de página única (SPA), a submissão é tratada em
    // JavaScript — esta linha impede o recarregamento.
    evento.preventDefault()
    aoSubmeter()
  }

  return (
    <form className={estilos.formulario} onSubmit={tratarSubmissao}>
      {children}
    </form>
  )
}
