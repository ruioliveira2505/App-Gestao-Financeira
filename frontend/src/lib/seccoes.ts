/*
 * SECCOES — AS SECÇÕES DE TOPO DA APLICAÇÃO
 * ========================================
 *
 * A lista única das secções principais da aplicação: Início, Movimentos e
 * Contas. É pura navegação — o mesmo conjunto de destinos que uma barra de
 * separadores nativa mostraria.
 *
 * Está tudo aqui, num só sítio, para as várias navegações nunca
 * divergirem:
 *   - em DESKTOP, a barra lateral (BarraLateral) desenha um item por
 *     secção, uns a seguir aos outros;
 *   - em MOBILE, o menu ☰ (MenuMobile) desenha a mesma lista.
 * Acrescentar uma secção é acrescentar uma linha a este ficheiro.
 *
 * O "Perfil" (dados da conta, preferências, terminar sessão) NÃO é uma
 * secção: é um destino à parte, alcançado pela zona de perfil no fundo de
 * cada uma daquelas navegações.
 *
 * "Icone" é o COMPONENTE do ícone (não um elemento já criado), para cada
 * navegação o desenhar no tamanho que lhe convém.
 *
 * "exato": quando verdadeiro, a secção só fica marcada como ativa se a
 * rota for exatamente "para". Necessário no "/" — que, sem isto, ficaria
 * ativo em todas as rotas, por ser prefixo de todas.
 */

import type { ComponentType } from 'react'

import { IconeContas, IconeMovimentos, IconeResumo } from '../componentes/icones'

export type Seccao = {
  para: string
  etiqueta: string
  Icone: ComponentType<{ tamanho?: number }>
  exato: boolean
}

export const SECCOES: Seccao[] = [
  { para: '/', etiqueta: 'Início', Icone: IconeResumo, exato: true },
  { para: '/movimentos', etiqueta: 'Movimentos', Icone: IconeMovimentos, exato: false },
  { para: '/contas', etiqueta: 'Contas', Icone: IconeContas, exato: false },
]
