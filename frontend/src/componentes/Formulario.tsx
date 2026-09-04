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
 *
 * noValidate desliga as "bolhas" de validação nativas do browser: a
 * validação e as mensagens de erro deste projecto são feitas em JavaScript
 * (com a CaixaErro), de forma consistente, e a validação a sério fica do
 * lado do servidor. Os atributos "required" nos campos mantêm-se como
 * indicação semântica, mas não bloqueiam a submissão.
 */

import type { FormEvent, ReactNode } from 'react'

import estilos from './Formulario.module.css'

type Props = {
  aoSubmeter: () => void
  children: ReactNode
  // "id" no <form> — para um botão de submeter FORA do formulário lhe
  // poder chamar a submissão (<button type="submit" form={id}>).
  id?: string
}

export function Formulario({ aoSubmeter, children, id }: Props) {
  function tratarSubmissao(evento: FormEvent<HTMLFormElement>) {
    // Por omissão, submeter um <form> faz o browser recarregar a página.
    // Numa aplicação de página única (SPA), a submissão é tratada em
    // JavaScript — esta linha impede o recarregamento.
    evento.preventDefault()
    aoSubmeter()
  }

  return (
    <form id={id} className={estilos.formulario} onSubmit={tratarSubmissao} noValidate>
      {children}
    </form>
  )
}
