/*
 * PainelDeEscolha — ESCOLHER UM VALOR NUMA FOLHA QUE ENTRA DA DIREITA
 * =================================================================
 *
 * O "casco" da escolha em TELEMÓVEL: o componente Folha com
 * direcao="direita" (o mesmo modal em folha do "Nova conta", só que entra
 * a deslizar na horizontal) e, lá dentro, a ListaDeOpcoes. Em ecrã largo,
 * o CampoSelecao usa a lista em divulgação em linha, não este painel.
 *
 * DOIS GESTOS DE SAÍDA (do Folha): arrastar para o LADO — ou o "‹", Escape,
 * toque no fundo — RECUA ao formulário ("aoFechar"); arrastar para BAIXO
 * abandona o fluxo (o Folha, via contextoFolha, faz a folha de fundo sair
 * junto). Escolher uma opção (ou confirmar um valor à mão) aplica-a e
 * fecha o painel — daí embrulharmos os callbacks da ListaDeOpcoes com o
 * "fechar" do Folha.
 *
 * Quem usa este componente é responsável por: (a) só o montar enquanto
 * está aberto; (b) devolver o foco ao gatilho quando ele fecha.
 */

import { Folha } from './Folha'
import { ListaDeOpcoes, type OpcaoLista } from './ListaDeOpcoes'

type Props = {
  // Vai para o cabeçalho e para o "aria-label" da folha (ex.: "Moeda").
  titulo: string
  opcoes: OpcaoLista[]
  // O valor atualmente escolhido — a linha correspondente leva um "✓".
  valor: string
  // Corre quando o utilizador escolhe uma opção.
  aoEscolher: (valor: string) => void
  // Fecha o painel (volta ao formulário). Corre no fim da animação de saída.
  aoFechar: () => void
  // Quando presente, a última linha permite escrever um valor à mão
  // (campos abertos: banco, tipo). Recebe o texto já cortado (trim).
  aoAdicionar?: (valor: string) => void
  // Rótulo dessa linha de acção (ex.: "Adicionar banco").
  rotuloAdicionar?: string
}

export function PainelDeEscolha({
  titulo,
  opcoes,
  valor,
  aoEscolher,
  aoFechar,
  aoAdicionar,
  rotuloAdicionar,
}: Props) {
  return (
    <Folha
      titulo={titulo}
      direcao="direita"
      varianteFechar="circulo"
      aoRecuar={aoFechar}
      aoDispensar={aoFechar}
    >
      {(fechar) => (
        <ListaDeOpcoes
          opcoes={opcoes}
          valor={valor}
          aoEscolher={(v) => {
            aoEscolher(v)
            fechar()
          }}
          aoAdicionar={
            aoAdicionar
              ? (v) => {
                  aoAdicionar(v)
                  fechar()
                }
              : undefined
          }
          rotuloAdicionar={rotuloAdicionar}
        />
      )}
    </Folha>
  )
}
