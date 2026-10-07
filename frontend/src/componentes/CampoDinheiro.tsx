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
 *     do campo em cima, ténue, e o valor por baixo. Por omissão sem símbolo
 *     de moeda (no formulário de movimento, a moeda vem da conta escolhida
 *     mesmo ao lado). Com "mostrarSimbolo", o símbolo aparece DEPOIS do
 *     valor, colado a ele, como se escreve em português ("412,90 €") — útil
 *     quando a moeda pode mudar no próprio formulário (Nova conta), para o
 *     valor nunca ficar sem unidade. Vazio, mostra "0,00 €" esbatido.
 *
 * "lado" — a linha de ficha com o nome do campo à esquerda e o valor
 * (com o símbolo, se pedido) encostado à direita.
 *
 * "negativo" (só nas linhas de ficha com símbolo): mostra um "−" antes do valor e
 * pinta-o a vermelho, como os valores negativos do resto da app. É só
 * apresentação: o valor continua a ser escrito e devolvido SEM sinal —
 * quem usa decide o sinal (ex.: o interruptor "Saldo negativo").
 *
 * COMO O SÍMBOLO FICA COLADO AO TEXTO: um <input> não cresce com o que se
 * escreve — tem uma largura fixa. Para o "€" ficar logo a seguir ao último
 * algarismo, o <input> vive numa grelha de uma só célula, partilhada com
 * uma cópia invisível do valor (um pseudo-elemento "::after", no CSS): a
 * célula fica com a largura dessa cópia, e o <input>, a ocupar a mesma
 * célula, fica exactamente com a largura do texto.
 */

import { useId, useRef } from 'react'

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
  // "empilhado" (rótulo por cima, com contorno), "linha" (linha de ficha,
  // rótulo em cima) ou "lado" (linha de ficha, rótulo à esquerda e valor à
  // direita). Ver CampoTexto.
  disposicao?: 'empilhado' | 'linha' | 'lado'
  // Só nas linhas de ficha: o símbolo da moeda depois do valor (ver a
  // nota no topo).
  mostrarSimbolo?: boolean
  // Só nas linhas de ficha com símbolo: mostra o valor com "−", a vermelho.
  negativo?: boolean
}

export function CampoDinheiro({
  etiqueta,
  valor,
  aoMudar,
  moeda,
  disposicao = 'empilhado',
  mostrarSimbolo = false,
  negativo = false,
}: Props) {
  const id = useId()
  const inputRef = useRef<HTMLInputElement>(null)

  const input = (
    <input
      id={id}
      className={estilos.input}
      inputMode="decimal"
      value={valor}
      onChange={(evento) => aoMudar(apenasNumero(evento.target.value))}
    />
  )

  const classeFicha = `${estilos.campo} ${estilos.linha} ${disposicao === 'lado' ? estilos.lado : ''}`

  if (disposicao !== 'empilhado' && mostrarSimbolo) {
    const comSinal = negativo && valor !== ''
    return (
      <div className={classeFicha}>
        <label htmlFor={id} className={estilos.etiqueta}>
          {etiqueta}
        </label>
        {/* Tocar em qualquer ponto da linha do valor (também à direita do
            "€") põe o cursor no campo. */}
        <div
          className={comSinal ? `${estilos.valorLinha} ${estilos.valorNegativo}` : estilos.valorLinha}
          onClick={() => inputRef.current?.focus()}
        >
          {comSinal && <span aria-hidden="true">−</span>}
          {/* "data-valor": a cópia invisível que dá a largura (ver COMO O
              SÍMBOLO FICA COLADO AO TEXTO). Vazio, a do texto de exemplo. */}
          <span className={estilos.ajusta} data-valor={valor || '0,00'}>
            <input
              ref={inputRef}
              id={id}
              className={estilos.input}
              inputMode="decimal"
              placeholder="0,00"
              size={1}
              value={valor}
              onChange={(evento) => aoMudar(apenasNumero(evento.target.value))}
            />
          </span>
          <span className={valor === '' ? `${estilos.simboloLinha} ${estilos.simboloVazio}` : estilos.simboloLinha} aria-hidden="true">
            {simboloDe(moeda)}
          </span>
        </div>
      </div>
    )
  }

  if (disposicao !== 'empilhado') {
    return (
      <div className={classeFicha}>
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
