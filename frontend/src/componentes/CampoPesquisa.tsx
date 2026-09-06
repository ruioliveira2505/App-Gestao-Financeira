/*
 * CampoPesquisa — BARRA DE PROCURA DE UMA LISTA
 * ============================================
 *
 * A "pílula" de procura que encima as listas da aplicação (Contas,
 * Movimentos): uma lupa à esquerda, o campo de texto, e — só quando há
 * algo escrito — um "✕" à direita que limpa o campo e devolve-lhe o foco.
 *
 * É um campo CONTROLADO: o texto vive no estado de quem usa o componente,
 * passado em "valor" e devolvido a cada alteração em "aoMudar".
 *
 * O <input> é type="search" (semântica de campo de procura — papel
 * "searchbox" para leitores de ecrã). Alguns browsers acrescentam a esse
 * tipo um "x" nativo para limpar; esse é escondido por CSS, porque não
 * aparece em todos e o nosso "✕" é consistente em qualquer plataforma.
 */

import { useRef } from 'react'

import { IconeFechar, IconeLupa } from './icones'
import estilos from './CampoPesquisa.module.css'

type Props = {
  valor: string
  aoMudar: (valor: string) => void
  // Marca de água do campo (ex.: "Procurar conta…").
  placeholder: string
  // Rótulo acessível do campo (ex.: "Procurar conta").
  rotulo: string
}

export function CampoPesquisa({ valor, aoMudar, placeholder, rotulo }: Props) {
  // Referência ao <input> para lhe devolver o foco depois de limpar (quem
  // limpa quer, quase sempre, escrever outra coisa a seguir).
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <div className={estilos.campo}>
      <span className={estilos.icone} aria-hidden="true">
        <IconeLupa tamanho={18} />
      </span>
      <input
        ref={inputRef}
        type="search"
        className={estilos.input}
        placeholder={placeholder}
        value={valor}
        onChange={(evento) => aoMudar(evento.target.value)}
        aria-label={rotulo}
      />
      {valor !== '' && (
        <button
          type="button"
          className={estilos.limpar}
          aria-label="Limpar pesquisa"
          onClick={() => {
            aoMudar('')
            inputRef.current?.focus()
          }}
        >
          <IconeFechar tamanho={16} />
        </button>
      )}
    </div>
  )
}
