/*
 * Interruptor — UMA LINHA DE FICHA COM UM INTERRUPTOR LIGA/DESLIGA
 * ================================================================
 *
 * O controlo normal de uma escolha de sim/não, à maneira do iOS: o texto à
 * esquerda e o interruptor à direita. Toda a linha é tocável (não só o
 * interruptor), porque o alvo de toque fica muito maior.
 *
 * Para quem usa leitor de ecrã é um "switch" (role="switch") com
 * "aria-checked" — anunciado como "ligado"/"desligado", não como um
 * botão genérico.
 *
 * Usado, por exemplo, em "Saldo negativo" no formulário de uma conta: o
 * teclado numérico do iPhone não tem a tecla "−", por isso o sinal escolhe-
 * se aqui, à parte do valor.
 */

import estilos from './Interruptor.module.css'

type Props = {
  etiqueta: string
  ligado: boolean
  aoMudar: (ligado: boolean) => void
}

export function Interruptor({ etiqueta, ligado, aoMudar }: Props) {
  return (
    <div>
      <button
        type="button"
        role="switch"
        aria-checked={ligado}
        className={estilos.linha}
        onClick={() => aoMudar(!ligado)}
      >
        <span className={estilos.etiqueta}>{etiqueta}</span>
        <span className={ligado ? `${estilos.trilho} ${estilos.ligado}` : estilos.trilho} aria-hidden="true">
          <span className={estilos.botao} />
        </span>
      </button>
    </div>
  )
}
