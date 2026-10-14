/*
 * EstadoMensagem — UM ESTADO DA PÁGINA, COM MENSAGEM
 * ==================================================
 *
 * A forma comum dos estados de uma página que substituem o conteúdo: sem
 * contas, um erro ao carregar, uma procura sem resultados, uma conta que
 * já não existe. Sempre igual, para se reconhecerem de página para
 * página: um ícone num círculo cinzento de 56px, um título, um texto curto
 * (quando é preciso) e os botões da aplicação (Botao/LinkBotao), empilhados
 * e da mesma largura. Em todos os tamanhos de ecrã, como no desenho, a
 * mensagem fica ao centro do ecrã e os botões no rodapé: em telemóvel, a
 * toda a largura; em ecrã largo, com 280px, centrados na coluna de
 * conteúdo ao lado da barra lateral (ver o .module.css).
 *
 * "papel" põe role="alert" num erro, para um leitor de ecrã o anunciar
 * logo, sem o utilizador ter de lá chegar.
 */

import type { ReactNode } from 'react'

import estilos from './EstadoMensagem.module.css'

export function EstadoMensagem({
  icone,
  titulo,
  texto,
  acoes,
  papel,
}: {
  icone: ReactNode
  titulo: string
  // Opcional: um estado pode dizer-se só com o título e o botão.
  texto?: string
  acoes: ReactNode
  papel?: 'alert'
}) {
  return (
    <div className={estilos.estado} role={papel}>
      <span className={estilos.icone} aria-hidden="true">
        {icone}
      </span>
      <p className={estilos.titulo}>{titulo}</p>
      {texto && <p className={estilos.texto}>{texto}</p>}
      <div className={estilos.acoes}>{acoes}</div>
    </div>
  )
}
