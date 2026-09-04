/*
 * contextoFolha — COORDENA DUAS FOLHAS EMPILHADAS
 * ==============================================
 *
 * Uma folha (o componente Folha) pode abrir OUTRA folha por cima de si —
 * por exemplo, o modal "Nova conta" abre a folha de escolha da moeda. Aí
 * há dois gestos de saída com destinos diferentes:
 *
 *   - arrastar para o LADO (ou o "‹") — recua UM nível: a folha de cima
 *     fecha e volta-se à de baixo (o formulário de "Nova conta");
 *   - arrastar para BAIXO — abandona o FLUXO TODO: as folhas empilhadas
 *     descem JUNTAS e vai-se para a página que estava por trás.
 *
 * Para o arrasto para baixo ficar suave, as duas folhas têm de descer em
 * simultâneo — não pode ver-se a de baixo parada por trás da de cima. É
 * isso que este contexto coordena: enquanto a folha de cima é arrastada
 * para baixo, comunica o seu deslocamento à de baixo ("espelharDeslocamento")
 * para as duas se moverem como uma só; ao largar, "concluirArrasto" diz se
 * passou o limiar (as duas saem e navega-se) ou não (as duas voltam ao
 * sítio). Um contexto atravessa "portais" do React, por isso funciona
 * mesmo estando a folha de cima desenhada no <body>.
 *
 * Fora de um fluxo destes (ex.: a folha da moeda aberta a partir da
 * página "Editar conta", que não é um modal), não há "Provider": o valor
 * é null e o arrasto para baixo comporta-se como o recuo simples.
 */

import { createContext } from 'react'

export type ValorContextoFolha = {
  // Deslocamento vertical (px, >= 0) do arrasto em curso da folha de cima.
  // A folha de fundo espelha-o para as duas descerem juntas. 0 = reposta.
  espelharDeslocamento: (deslocamentoY: number) => void
  // Fim do arrasto para baixo da folha de cima: "true" = passou o limiar
  // (as duas folhas saem, quem monta a de fundo trata de navegar); "false"
  // = arrasto curto (as duas voltam ao sítio, com animação).
  concluirArrasto: (descartar: boolean) => void
}

export const ContextoFolha = createContext<ValorContextoFolha | null>(null)
