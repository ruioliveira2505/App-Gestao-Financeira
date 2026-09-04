/*
 * CampoSelecao — CAMPO DE ESCOLHA COM RÓTULO
 * =========================================
 *
 * Escolher um valor de uma lista (ex.: a moeda, o banco ou o tipo de uma
 * conta). É controlado: o valor vive no estado de quem usa o componente.
 *
 * DUAS APRESENTAÇÕES:
 *   - "empilhado" (por omissão): um <select> nativo com o rótulo por cima
 *     — para formulários soltos.
 *   - "linha": uma linha de ficha — rótulo ténue em cima, e por baixo o
 *     valor selecionado + uma seta que abre a lista:
 *       · TELEMÓVEL — seta ">"; abre o PainelDeEscolha (folha que entra
 *         da direita);
 *       · DESKTOP — seta "v" (gira para "^" com a lista aberta);
 *         divulgação EM LINHA: a lista aparece por baixo do campo, DENTRO
 *         da ficha, empurrando o que está abaixo (sem camada flutuante,
 *         por isso não é cortada pelo "overflow: hidden" da ficha). As
 *         opções da lista ficam em tinta secundária; a que está escolhida
 *         (com o "✓") em tinta plena, para se destacar.
 *     A escolha faz-se com useMediaQuery — são árvores de DOM diferentes.
 *
 * "rotuloVazio" acrescenta no topo uma opção de "nenhum" (ex.: "Sem
 * banco"), com valor "". "permiteNovo" acrescenta no fundo a linha
 * "Adicionar…" para escrever um valor à mão (campos abertos: banco, tipo);
 * um valor escrito que coincida com uma opção existente reaproveita-a, sem
 * duplicar.
 *
 * FOCO: quando a lista fecha, o foco volta ao botão que a abriu.
 */

import { useEffect, useId, useRef, useState } from 'react'

import { IconeChevronDireita } from './icones'
import { ListaDeOpcoes, type OpcaoLista } from './ListaDeOpcoes'
import { PainelDeEscolha } from './PainelDeEscolha'
import { useMediaQuery } from '../hooks/useMediaQuery'
import estilos from './CampoSelecao.module.css'

type Props = {
  etiqueta: string
  valor: string
  aoMudar: (valor: string) => void
  opcoes: OpcaoLista[]
  // "empilhado" (rótulo por cima, <select> nativo) ou "linha" (linha de
  // ficha, abre a lista). Ver CampoTexto.
  disposicao?: 'empilhado' | 'linha'
  // Se presente, acrescenta uma opção de "nenhum" no topo, com valor "".
  rotuloVazio?: string
  // Se true, a última linha da lista deixa escrever um valor à mão.
  permiteNovo?: boolean
  // Rótulo dessa linha (ex.: "Adicionar banco"). Só usado com "permiteNovo".
  rotuloNovo?: string
}

export function CampoSelecao({
  etiqueta,
  valor,
  aoMudar,
  opcoes,
  disposicao = 'empilhado',
  rotuloVazio,
  permiteNovo = false,
  rotuloNovo,
}: Props) {
  const id = useId()
  const eMobile = useMediaQuery('(max-width: 768px)')
  const [aberto, setAberto] = useState(false)
  const raizRef = useRef<HTMLDivElement>(null)
  const gatilhoRef = useRef<HTMLButtonElement>(null)
  // Marca a primeira renderização, para não roubar o foco ao carregar a
  // página (só o queremos devolver DEPOIS de a lista ter estado aberta).
  const primeiraRender = useRef(true)

  useEffect(() => {
    if (primeiraRender.current) {
      primeiraRender.current = false
      return
    }
    if (!aberto) gatilhoRef.current?.focus()
  }, [aberto])

  // Desktop, lista aberta: fechar ao clicar fora ou premir Escape (no
  // telemóvel é o Folha que trata disso).
  useEffect(() => {
    if (eMobile || !aberto) return
    function aoClicarFora(evento: MouseEvent) {
      if (raizRef.current && !raizRef.current.contains(evento.target as Node)) {
        setAberto(false)
      }
    }
    function aoTeclar(evento: KeyboardEvent) {
      if (evento.key === 'Escape') setAberto(false)
    }
    document.addEventListener('mousedown', aoClicarFora)
    document.addEventListener('keydown', aoTeclar)
    return () => {
      document.removeEventListener('mousedown', aoClicarFora)
      document.removeEventListener('keydown', aoTeclar)
    }
  }, [eMobile, aberto])

  // Lista efetiva, com a opção de "nenhum" no topo quando pedida.
  const opcoesFinais: OpcaoLista[] =
    rotuloVazio !== undefined ? [{ valor: '', etiqueta: rotuloVazio }, ...opcoes] : opcoes

  const escolhida = opcoesFinais.find((opcao) => opcao.valor === valor)
  const textoValor = escolhida?.etiqueta ?? valor ?? rotuloVazio ?? ''

  // Um valor escrito à mão que coincida (ignorando maiúsculas/espaços) com
  // uma opção existente reaproveita essa opção, em vez de duplicar.
  function tratarNovo(escrito: string) {
    const normal = escrito.trim().toLocaleLowerCase('pt')
    const existente = opcoesFinais.find(
      (o) => o.etiqueta.trim().toLocaleLowerCase('pt') === normal,
    )
    aoMudar(existente ? existente.valor : escrito)
  }

  if (disposicao === 'linha') {
    return (
      <div ref={raizRef} className={`${estilos.campo} ${estilos.linha}`}>
        <label htmlFor={id} className={estilos.etiqueta}>
          {etiqueta}
        </label>

        <button
          type="button"
          id={id}
          ref={gatilhoRef}
          className={estilos.gatilho}
          aria-haspopup="listbox"
          aria-expanded={!eMobile && aberto}
          onClick={() => setAberto((a) => !a)}
        >
          <span className={estilos.gatilhoValor}>{textoValor}</span>
          <span
            className={[
              estilos.gatilhoSeta,
              !eMobile && estilos.setaDesktop,
              !eMobile && aberto && estilos.setaAberta,
            ]
              .filter(Boolean)
              .join(' ')}
            aria-hidden="true"
          >
            <IconeChevronDireita tamanho={16} />
          </span>
        </button>

        {aberto &&
          (eMobile ? (
            <PainelDeEscolha
              titulo={etiqueta}
              opcoes={opcoesFinais}
              valor={valor}
              aoEscolher={aoMudar}
              aoFechar={() => setAberto(false)}
              aoAdicionar={permiteNovo ? tratarNovo : undefined}
              rotuloAdicionar={rotuloNovo}
            />
          ) : (
            <div className={estilos.painelLinha}>
              <ListaDeOpcoes
                esbatido
                opcoes={opcoesFinais}
                valor={valor}
                aoEscolher={(v) => {
                  aoMudar(v)
                  setAberto(false)
                }}
                aoAdicionar={
                  permiteNovo
                    ? (v) => {
                        tratarNovo(v)
                        setAberto(false)
                      }
                    : undefined
                }
                rotuloAdicionar={rotuloNovo}
              />
            </div>
          ))}
      </div>
    )
  }

  return (
    <div className={estilos.campo}>
      <label htmlFor={id} className={estilos.etiqueta}>
        {etiqueta}
      </label>
      <select
        id={id}
        className={estilos.selecao}
        value={valor}
        onChange={(evento) => aoMudar(evento.target.value)}
      >
        {opcoesFinais.map((opcao) => (
          <option key={opcao.valor} value={opcao.valor}>
            {opcao.etiqueta}
          </option>
        ))}
      </select>
    </div>
  )
}
