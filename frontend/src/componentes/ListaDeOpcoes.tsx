/*
 * ListaDeOpcoes — A LISTA DE UM SELETOR
 * ====================================
 *
 * A lista de opções de um CampoSelecao. Usa-se dentro do PainelDeEscolha
 * (folha, em telemóvel) e da divulgação em linha do CampoSelecao (desktop)
 * — o "casco" (folha ou painel em linha) é de quem a monta.
 *
 * Cada opção é um <button> a toda a largura; a escolhida leva um "✓" à
 * direita. Ao escolher, chama "aoEscolher(valor)" — quem monta a lista é
 * que trata de FECHAR o casco.
 *
 * ADICIONAR À MÃO. Quando "aoAdicionar" é passado (campos abertos: banco,
 * tipo), a última linha é uma acção ("Adicionar banco" / "Adicionar
 * tipo"). Ao tocar-lhe transforma-se num campo de escrita, com o foco
 * automático; confirmar (Enter ou o "✓") chama "aoAdicionar(texto)".
 * O Escape no campo cancela a escrita (e faz "stopPropagation", para o
 * casco por fora não fechar).
 */

import { useEffect, useRef, useState, type KeyboardEvent } from 'react'

import { IconeCheck, IconeMais } from './icones'
import estilos from './ListaDeOpcoes.module.css'

export type OpcaoLista = {
  // O valor guardado (ex.: "EUR", ou o próprio nome do banco).
  valor: string
  // O texto mostrado (ex.: "Euro (€)").
  etiqueta: string
}

type Props = {
  opcoes: OpcaoLista[]
  valor: string
  aoEscolher: (valor: string) => void
  // Última linha "Adicionar…" com campo de escrita. Recebe o texto cortado.
  aoAdicionar?: (valor: string) => void
  rotuloAdicionar?: string
  // "esbatido" (lista em linha do desktop): as opções ficam em tinta
  // secundária e só a escolhida em tinta plena.
  esbatido?: boolean
}

export function ListaDeOpcoes({
  opcoes,
  valor,
  aoEscolher,
  aoAdicionar,
  rotuloAdicionar = 'Adicionar…',
  esbatido = false,
}: Props) {
  // A linha "Adicionar…" está em modo de escrita? E o que já se escreveu.
  const [aEscrever, setAEscrever] = useState(false)
  const [texto, setTexto] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (aEscrever) inputRef.current?.focus()
  }, [aEscrever])

  function confirmarNovo() {
    const limpo = texto.trim()
    if (!limpo || !aoAdicionar) return
    aoAdicionar(limpo)
  }

  function aoTeclarNoInput(evento: KeyboardEvent<HTMLInputElement>) {
    if (evento.key === 'Enter') {
      evento.preventDefault()
      confirmarNovo()
    } else if (evento.key === 'Escape') {
      // Não deixar o Escape chegar ao casco (que fecharia o seletor):
      // aqui só cancela a escrita e volta à linha "Adicionar…".
      evento.stopPropagation()
      setAEscrever(false)
      setTexto('')
    }
  }

  return (
    <ul className={esbatido ? `${estilos.lista} ${estilos.esbatido}` : estilos.lista}>
      {opcoes.map((opcao) => {
        const selecionada = opcao.valor === valor
        return (
          <li key={opcao.valor}>
            <button
              type="button"
              aria-current={selecionada ? 'true' : undefined}
              className={
                selecionada
                  ? `${estilos.linha} ${estilos.linhaSelecionada}`
                  : estilos.linha
              }
              onClick={() => aoEscolher(opcao.valor)}
            >
              <span className={estilos.rotulo}>{opcao.etiqueta}</span>
              {selecionada && <IconeCheck tamanho={18} />}
            </button>
          </li>
        )
      })}

      {aoAdicionar &&
        (aEscrever ? (
          <li className={`${estilos.linha} ${estilos.linhaNovo}`}>
            <input
              ref={inputRef}
              className={estilos.novoInput}
              value={texto}
              placeholder="Escrever…"
              aria-label={rotuloAdicionar}
              onChange={(evento) => setTexto(evento.target.value)}
              onKeyDown={aoTeclarNoInput}
            />
            <button
              type="button"
              className={estilos.novoConfirmar}
              disabled={texto.trim() === ''}
              onClick={confirmarNovo}
              aria-label="Confirmar"
            >
              <IconeCheck tamanho={18} />
            </button>
          </li>
        ) : (
          <li>
            <button
              type="button"
              className={`${estilos.linha} ${estilos.linhaAcao}`}
              onClick={() => setAEscrever(true)}
            >
              <IconeMais tamanho={18} />
              <span className={estilos.rotulo}>{rotuloAdicionar}</span>
            </button>
          </li>
        ))}
    </ul>
  )
}
