/*
 * FiltroContas — O FILTRO GLOBAL DE CONTAS, NA PÁGINA INÍCIO
 * ============================================================
 *
 * Um botão-ícone que abre uma folha (de baixo, como "Nova conta" — não há
 * nenhum nível anterior para onde "recuar") com a lista de contas em
 * multi-escolha: "Todas" no topo, marcada quando não há nenhuma conta
 * escolhida; marcar TODAS as contas uma a uma colapsa de volta a esse
 * estado — a mesma interação e a mesma regra "com uma só conta não há
 * nada para filtrar" já usadas na lista de Contas do filtro de Movimentos
 * (ver ListaContas, em componentes/FiltroMovimentos.tsx). Não é o MESMO
 * componente PRINCIPAL porque este filtro não vive dentro de uma folha
 * com vários seletores (Tipo, Categorias, Datas) como a de Movimentos —
 * é um único botão global (ver a nota "FILTRO DE CONTAS É GLOBAL" em
 * Inicio.tsx). A linha de opção em si (avatar + etiqueta + "✓",
 * "aria-pressed") já é literalmente a mesma peça — `LinhaOpcaoFiltro`,
 * partilhada com FiltroMovimentos, SeletorPeriodo e
 * FiltroCategoriasResumo.
 *
 * GATILHO NA BARRA DE TOPO (revisão de design/UX): este componente vive
 * inteiro dentro da prop "acao" de useDefinirCabecalho, em Inicio.tsx —
 * por isso o seu gatilho aparece na barra de topo mobile, à direita do
 * ☰, e não dentro do conteúdo da página. Era antes uma pílula com texto
 * ("Contas · Todas ›"), a única acção da página fora do padrão "botão só
 * de ícone" já usado nas outras barras de topo da app (ex.: o "+" em
 * Contas.tsx); passou a seguir essa mesma receita — círculo 2.5rem,
 * fundo "--cor-fundo", "box-shadow: var(--sombra-flutuante)" — com o
 * ícone já usado para "Contas" no menu de navegação (`IconeContas`) e um
 * pontinho de "filtro activo" (a mesma peça de FiltroCategoriasResumo),
 * já que sem texto o botão sozinho não distingue "todas" de "algumas".
 * O nome completo da selecção continua acessível — só deixou de estar
 * sempre visível — via "aria-label" no próprio botão e como título da
 * folha que abre.
 */

import { useState } from 'react'

import { Avatar } from './Avatar'
import { Folha } from './Folha'
import { IconeContas, IconeFechar } from './icones'
import { LinhaOpcaoFiltro as LinhaOpcao } from './LinhaOpcaoFiltro'
import type { Conta } from '../lib/contas'
import estilos from './FiltroContas.module.css'

type Props = {
  contas: Conta[]
  selecionadas: string[]
  aoMudar: (ids: string[]) => void
}

function resumo(selecionadas: string[], contas: Conta[]): string {
  const n = selecionadas.length
  if (n === 0) return 'Todas'
  if (n === 1) return contas.find((conta) => conta.id === selecionadas[0])?.nome ?? '1 conta'
  return `${n} contas`
}

export function FiltroContas({ contas, selecionadas, aoMudar }: Props) {
  const [aberto, setAberto] = useState(false)

  // Com uma só conta (ou nenhuma) não há nada para filtrar — o mesmo
  // critério de ListaContas em FiltroMovimentos.tsx.
  if (contas.length <= 1) return null

  const ordenadas = [...contas].sort((a, b) => a.nome.localeCompare(b.nome))

  function alternar(id: string) {
    const proximas = selecionadas.includes(id)
      ? selecionadas.filter((outro) => outro !== id)
      : [...selecionadas, id]
    const todas = contas.every((conta) => proximas.includes(conta.id))
    aoMudar(todas ? [] : proximas)
  }

  return (
    <>
      <button
        type="button"
        className={estilos.gatilho}
        aria-haspopup="dialog"
        aria-label={`Contas: ${resumo(selecionadas, contas)}`}
        onClick={() => setAberto(true)}
      >
        <IconeContas tamanho={18} />
        {selecionadas.length > 0 && <span className={estilos.ponto} aria-hidden="true" />}
      </button>

      {aberto && (
        <Folha
          titulo="Contas"
          direcao="baixo"
          varianteFechar="circulo"
          iconeFechar={<IconeFechar tamanho={22} />}
          rotuloFechar="Fechar"
          aoDispensar={() => setAberto(false)}
        >
          {() => (
            <div className={estilos.lista}>
              <LinhaOpcao
                multi
                etiqueta="Todas"
                selecionada={selecionadas.length === 0}
                aoTocar={() => aoMudar([])}
              />
              {ordenadas.map((conta) => (
                <LinhaOpcao
                  key={conta.id}
                  multi
                  etiqueta={conta.nome}
                  antes={<Avatar nome={conta.banco || conta.nome} />}
                  selecionada={selecionadas.includes(conta.id)}
                  aoTocar={() => alternar(conta.id)}
                />
              ))}
            </div>
          )}
        </Folha>
      )}
    </>
  )
}
