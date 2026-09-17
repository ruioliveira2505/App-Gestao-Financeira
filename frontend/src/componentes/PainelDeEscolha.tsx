/*
 * PainelDeEscolha — ESCOLHER UM VALOR NUMA FOLHA, EM TELEMÓVEL
 * =============================================================
 *
 * O "casco" da escolha em TELEMÓVEL: o componente Folha e, lá dentro, a
 * ListaDeOpcoes. Em ecrã largo, o CampoSelecao usa a lista em divulgação
 * em linha, não este painel.
 *
 * DUAS DIREÇÕES (prop "direcao"), consoante o que já está aberto por trás:
 *
 *   - "direita" (por omissão) — a folha entra a deslizar da direita, como
 *     avançar mais um nível DENTRO de um fluxo já aberto (ex.: escolher a
 *     moeda de uma conta, por cima do modal "Nova conta"/"Editar conta",
 *     ele próprio uma folha). Faz sentido só aqui: só há "recuar um
 *     nível" (o gesto de arrastar para o LADO) quando existe, de facto,
 *     um nível anterior por trás — a folha de fundo do fluxo.
 *
 *   - "baixo" — a folha sobe de baixo, como uma tarefa nova (ex.: a moeda
 *     principal em Preferências, uma PÁGINA normal, não um modal — não há
 *     nenhuma folha por trás para "recuar" a ela). Aqui não se passa
 *     "aoRecuar" ao Folha (só "aoDispensar") — sem "aoRecuar", o próprio
 *     Folha já sabe fazer o "‹"/Escape/toque-no-fundo caírem no
 *     "aoDispensar" (ver a nota em Folha.tsx), e a saída anima sempre
 *     para BAIXO, nunca para o lado — coerente com ter entrado por baixo.
 *     O ícone do botão de fechar passa a um "X" (não o "‹", que sugeriria
 *     "recuar a algum lado"), o mesmo usado em "Nova conta".
 *
 * Escolher uma opção (ou confirmar um valor à mão) aplica-a e fecha o
 * painel — daí embrulharmos os callbacks da ListaDeOpcoes com o "fechar"
 * do Folha.
 *
 * Quem usa este componente é responsável por: (a) só o montar enquanto
 * está aberto; (b) devolver o foco ao gatilho quando ele fecha.
 */

import { Folha } from './Folha'
import { IconeFechar } from './icones'
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
  // Ver a nota "DUAS DIREÇÕES" no topo do ficheiro.
  direcao?: 'direita' | 'baixo'
}

export function PainelDeEscolha({
  titulo,
  opcoes,
  valor,
  aoEscolher,
  aoFechar,
  aoAdicionar,
  rotuloAdicionar,
  direcao = 'direita',
}: Props) {
  return (
    <Folha
      titulo={titulo}
      direcao={direcao}
      varianteFechar="circulo"
      iconeFechar={direcao === 'baixo' ? <IconeFechar tamanho={22} /> : undefined}
      // Rótulo acessível do botão de fechar: "Voltar" faria supor que há
      // para onde recuar, o que não é o caso quando a folha sobe de baixo
      // (mesmo par ícone "X" + rótulo "Fechar" que "Nova conta" usa).
      rotuloFechar={direcao === 'baixo' ? 'Fechar' : undefined}
      // "aoRecuar" só faz sentido quando HÁ um nível anterior (direita) —
      // ver a nota "DUAS DIREÇÕES" no topo do ficheiro.
      aoRecuar={direcao === 'direita' ? aoFechar : undefined}
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
