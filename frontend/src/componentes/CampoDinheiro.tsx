/*
 * CampoDinheiro — CAMPO PARA UM VALOR MONETÁRIO
 * ============================================
 *
 * Um <input> para escrever um valor em dinheiro, com o teclado numérico em
 * telemóvel (inputMode="decimal"). O valor é texto livre ("1234.56" ou
 * "1234,56" — quem submete converte a vírgula em ponto).
 *
 * "disposicao":
 *   - "empilhado" (por omissão) — rótulo por cima, campo com contorno e o
 *     símbolo da moeda (€, $, …) dentro dele. Para formulários soltos.
 *   - "linha" — uma linha de formulário em ficha (ver CampoTexto): o nome
 *     do campo em cima, ténue, e o valor por baixo. Sem símbolo de moeda (a
 *     moeda está escolhida num campo mesmo ao lado, por isso repeti-la aqui
 *     só acrescentava ruído).
 */

import { useId } from 'react'

import { simboloDe } from '../lib/moedas'
import estilos from './CampoDinheiro.module.css'

/** Deixa passar só o que faz parte de um número: dígitos e UM separador
 *  decimal (vírgula ou ponto). Tudo o resto — letras, símbolos, um segundo
 *  separador — é descartado à medida que se escreve, por isso nunca chega a
 *  aparecer no campo (é assim que os apps de banca tratam o valor: não
 *  deixam escrever o inválido, em vez de o validarem depois). */
function apenasNumero(bruto: string): string {
  const limpo = bruto.replace(/[^\d.,]/g, '')
  const primeiroSeparador = limpo.search(/[.,]/)
  if (primeiroSeparador === -1) return limpo
  return (
    limpo.slice(0, primeiroSeparador + 1) +
    limpo.slice(primeiroSeparador + 1).replace(/[.,]/g, '')
  )
}

type Props = {
  // Nome do campo (texto do <label>).
  etiqueta: string
  valor: string
  aoMudar: (valor: string) => void
  // Código da moeda (ex.: "EUR") — o símbolo mostrado na disposição
  // "empilhado".
  moeda: string
  // "empilhado" (rótulo por cima, com contorno) ou "linha" (linha de ficha
  // agrupada). Ver CampoTexto.
  disposicao?: 'empilhado' | 'linha'
}

export function CampoDinheiro({
  etiqueta,
  valor,
  aoMudar,
  moeda,
  disposicao = 'empilhado',
}: Props) {
  const id = useId()

  const input = (
    <input
      id={id}
      className={estilos.input}
      inputMode="decimal"
      value={valor}
      onChange={(evento) => aoMudar(apenasNumero(evento.target.value))}
    />
  )

  if (disposicao === 'linha') {
    return (
      <div className={`${estilos.campo} ${estilos.linha}`}>
        <label htmlFor={id} className={estilos.etiqueta}>
          {etiqueta}
        </label>
        {input}
      </div>
    )
  }

  return (
    <div className={estilos.campo}>
      <label htmlFor={id} className={estilos.etiqueta}>
        {etiqueta}
      </label>
      <div className={estilos.moldura}>
        <span className={estilos.simbolo} aria-hidden="true">
          {simboloDe(moeda)}
        </span>
        {input}
      </div>
    </div>
  )
}
