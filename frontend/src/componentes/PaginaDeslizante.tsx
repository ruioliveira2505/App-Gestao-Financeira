/*
 * PaginaDeslizante — TRANSIÇÃO LATERAL DE ENTRADA/SAÍDA (só em mobile)
 * =====================================================================
 *
 * Envolve uma página "de detalhe" (as que usam <CabecalhoPagina voltar=…>)
 * para, em mobile, se comportar como um "push" do iOS: entra a deslizar da
 * DIREITA (avançar um nível a partir de /perfil) e sai a deslizar de volta
 * para a DIREITA (recuar). Em ecrã largo não faz nada — devolve os filhos
 * tal e qual, sem os envolver em nada, porque esta transição só foi pedida
 * "pelo menos em mobile"; em desktop a página continua a comportar-se como
 * hoje.
 *
 * A ENTRADA é a parte fácil: uma animação CSS (ver o ficheiro .module.css)
 * que corre sozinha ao MONTAR — sem JavaScript nenhum a mandar nela, a
 * mesma ideia das folhas (Folha.tsx) e da entrada de ContaDetalhe.tsx.
 *
 * A SAÍDA é mais difícil, e é a razão de este componente existir. O botão
 * "‹" que a desencadeia não vive na página — vive na barra de topo
 * partilhada (BarraTopoMobile), que por omissão navega logo ao ser
 * tocado. Para dar tempo à animação de saída, o cabeçalho da página
 * (CabecalhoPagina) aceita um "aoRecuar": em vez de navegar de imediato, a
 * barra de topo entrega a essa função a navegação já decidida
 * ("navegarDeFacto"), e é esta página — através do "aoRecuar" abaixo —
 * quem decide QUANDO ela acontece: só depois da própria animação de
 * saída, nunca antes (senão a página desaparecia antes de se ver a
 * animar).
 *
 * USO — a página troca o seu retorno direto por um "render-prop" (o mesmo
 * padrão já usado em Folha.tsx para "children"/"acao"):
 *
 *   return (
 *     <PaginaDeslizante>
 *       {(aoRecuar) => (
 *         <div>
 *           <LinkVoltar para="/perfil">Perfil</LinkVoltar>
 *           <CabecalhoPagina titulo="…" voltar="/perfil" aoRecuar={aoRecuar} />
 *           …
 *         </div>
 *       )}
 *     </PaginaDeslizante>
 *   )
 *
 * Nada mais na página muda — o "aoRecuar" recebido passa-se directamente
 * ao <CabecalhoPagina>, que o repassa ao contexto do cabeçalho.
 */

import { useCallback, useState, type ReactNode } from 'react'

import { useMediaQuery } from '../hooks/useMediaQuery'
import estilos from './PaginaDeslizante.module.css'

// Tem de coincidir com a duração da animação "sai-para-a-direita" no CSS —
// só depois dela é que a navegação de facto acontece. O mesmo valor da
// entrada de ContaDetalhe.tsx e da saída de Folha.tsx, para a app inteira
// "sentir" a mesma velocidade de transição.
const DURACAO_SAIDA_MS = 280

type Props = {
  children: (aoRecuar: (navegarDeFacto: () => void) => void) => ReactNode
}

export function PaginaDeslizante({ children }: Props) {
  const eMobile = useMediaQuery('(max-width: 768px)')
  // Só entra em animação de saída quando "aoRecuar" é chamado — antes
  // disso a página está sempre a meio da entrada ou já pousada.
  const [aSair, setASair] = useState(false)

  const aoRecuar = useCallback((navegarDeFacto: () => void) => {
    setASair(true)
    // A navegação real só acontece depois da animação — se acontecesse já,
    // a página desmontava-se a meio, sem se ver sair.
    window.setTimeout(navegarDeFacto, DURACAO_SAIDA_MS)
  }, [])

  // Em desktop não há transição nenhuma: os filhos saem tal e qual, e o
  // "aoRecuar" que se lhes passa nunca chega a ser chamado (a barra de
  // topo mobile, que é quem o chamaria, não existe em ecrã largo).
  if (!eMobile) return <>{children(aoRecuar)}</>

  return (
    <div className={`${estilos.envolucro} ${aSair ? estilos.aSair : estilos.aEntrar}`}>
      {children(aoRecuar)}
    </div>
  )
}
