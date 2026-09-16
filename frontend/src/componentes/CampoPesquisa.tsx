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
 *
 * "desativado": usado pelo modo de seleção múltipla de Movimentos — o
 * campo fica com aspeto esbatido e deixa de aceitar escrita, mas continua
 * no DOM, no mesmo espaço, com o texto que já lá estava. A alternativa
 * (esconder o campo por completo nesse modo) foi posta de lado: a página
 * "saltava" ao entrar/sair da seleção, um movimento estranho para uma
 * mudança que é só de MODO, não de conteúdo.
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
  // Ver a nota "desativado", acima. Por omissão, false.
  desativado?: boolean
}

export function CampoPesquisa({ valor, aoMudar, placeholder, rotulo, desativado = false }: Props) {
  // Referência ao <input> para lhe devolver o foco depois de limpar (quem
  // limpa quer, quase sempre, escrever outra coisa a seguir).
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <div className={desativado ? `${estilos.campo} ${estilos.desativado}` : estilos.campo}>
      <span className={estilos.icone} aria-hidden="true">
        <IconeLupa tamanho={18} />
      </span>
      <input
        ref={inputRef}
        type="search"
        className={estilos.input}
        placeholder={placeholder}
        value={valor}
        disabled={desativado}
        onChange={(evento) => aoMudar(evento.target.value)}
        aria-label={rotulo}
      />
      {valor !== '' && !desativado && (
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
