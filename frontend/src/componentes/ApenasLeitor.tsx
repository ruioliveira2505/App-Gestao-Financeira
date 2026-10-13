/*
 * ApenasLeitor — TEXTO SÓ PARA LEITORES DE ECRÃ
 * =============================================
 *
 * Um texto que não se vê, mas que um leitor de ecrã (o programa que lê a
 * página em voz alta a quem não a vê) lê, como parte do que o rodeia. Serve
 * para dizer por palavras o que no ecrã se diz só por um ícone ou pela
 * posição: por exemplo, «vinculada» no nome de uma linha da lista de
 * contas, cujo ícone de elos é só visual, ou «Saldo atual» antes de um
 * saldo que se mostra sem legenda.
 *
 * Usa a técnica habitual de "visually hidden" (ver o .module.css): o texto
 * continua na página, com um tamanho de 1px e recortado. NÃO usa
 * "display: none" nem "hidden", que o esconderiam também dos leitores de
 * ecrã — o contrário do que se quer.
 */

import type { ReactNode } from 'react'

import estilos from './ApenasLeitor.module.css'

export function ApenasLeitor({ children }: { children: ReactNode }) {
  return <span className={estilos.apenasLeitor}>{children}</span>
}
