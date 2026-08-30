/*
 * CaixaErro — MENSAGEM DE ERRO DESTACADA
 * =====================================
 *
 * Mostra uma mensagem de erro dentro de uma caixa com as cores de erro da
 * aplicação. Usada nos formulários para apresentar a mensagem que o
 * servidor devolve (ex.: "Email ou password incorretos.") ou uma
 * validação feita no cliente.
 *
 * O atributo role="alert" faz com que um leitor de ecrã anuncie o
 * conteúdo assim que ele aparece, sem o utilizador ter de o procurar.
 */

import type { ReactNode } from 'react'

import estilos from './CaixaErro.module.css'

export function CaixaErro({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className={estilos.caixa}>
      {children}
    </p>
  )
}
