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
 *
 * DENTRO DE UMA PILHA (ver PilhaDePaginas.tsx): quando a rota desta página
 * está por cima de outra (ex.: o detalhe de uma conta sobre a lista), a
 * página passa a ser uma CAMADA fixa sobre o ecrã, com scroll próprio, e
 * desliza POR CIMA da página de baixo — que continua lá, em vez de um
 * fundo vazio. Anuncia à pilha quando entra e quando começa a sair, para
 * a página de baixo saber quando está tapada.
 */

import { useCallback, useContext, useLayoutEffect, useState, type ReactNode } from 'react'

import { useMediaQuery } from '../hooks/useMediaQuery'
import { ContextoPilha, ContextoPorBaixo } from './contextoPilha'
import estilos from './PaginaDeslizante.module.css'
import { DURACAO_DESLOCAR_MS } from '../lib/movimento'

// Tem de coincidir com a duração da animação "sai-para-a-direita" no CSS —
// só depois dela é que a navegação de facto acontece. O mesmo valor da
// entrada de ContaDetalhe.tsx e da saída de Folha.tsx, para a app inteira
// "sentir" a mesma velocidade de transição — a de "deslocar" (src/lib/
// movimento.ts, igual à variável --movimento-deslocar do CSS).
const DURACAO_SAIDA_MS = DURACAO_DESLOCAR_MS

type Props = {
  children: (aoRecuar: (navegarDeFacto: () => void) => void) => ReactNode
}

export function PaginaDeslizante({ children }: Props) {
  const eMobile = useMediaQuery('(max-width: 768px)')
  // Só entra em animação de saída quando "aoRecuar" é chamado — antes
  // disso a página está sempre a meio da entrada ou já pousada.
  const [aSair, setASair] = useState(false)
  // A pilha a que esta página pertence, se a sua rota estiver por cima de
  // outra (ver PilhaDePaginas.tsx); "null" numa página isolada.
  const pilha = useContext(ContextoPilha)
  // Se esta página já está tapada por outra (ex.: a lista de categorias do
  // Início, quando se abre uma categoria por cima dela).
  const tapada = useContext(ContextoPorBaixo)

  // Anuncia à pilha que entrou (ao montar) e que já não existe (ao
  // desmontar). "useLayoutEffect" e não "useEffect": corre antes de o
  // browser pintar, para a página de baixo ceder a barra de topo no mesmo
  // quadro em que esta aparece.
  useLayoutEffect(() => {
    if (!pilha) return
    pilha.anunciar('entrar')
    return () => pilha.anunciar('nenhuma')
  }, [pilha])

  const aoRecuar = useCallback(
    (navegarDeFacto: () => void) => {
      setASair(true)
      // A página de baixo volta já a mandar na barra de topo, enquanto
      // esta ainda desliza para fora.
      pilha?.anunciar('sair')
      // A navegação real só acontece depois da animação — se acontecesse
      // já, a página desmontava-se a meio, sem se ver sair.
      window.setTimeout(navegarDeFacto, DURACAO_SAIDA_MS)
    },
    [pilha],
  )

  // Em desktop não há transição nenhuma: os filhos saem tal e qual, e o
  // "aoRecuar" que se lhes passa nunca chega a ser chamado (a barra de
  // topo mobile, que é quem o chamaria, não existe em ecrã largo).
  // Uma página A SAIR também deixa de mandar na barra de topo (o mesmo
  // contexto das páginas tapadas — ver CabecalhoPagina.tsx): sem isto, ao
  // redesenhar-se para animar a saída, voltava a reclamar a barra e
  // tapava os botões da página de baixo até ao fim do recuo.
  const semBarra = tapada || aSair

  if (!eMobile) return <>{children(aoRecuar)}</>

  return (
    <ContextoPorBaixo.Provider value={semBarra}>
      <div
        // Marca a camada para a pilha (PilhaDePaginas.module.css): se esta
        // página estiver por baixo de outra, é ela — e não o invólucro à
        // volta — que recua para a esquerda.
        data-camada={pilha ? '' : undefined}
        className={[estilos.envolucro, aSair ? estilos.aSair : estilos.aEntrar, pilha && estilos.camada]
          .filter(Boolean)
          .join(' ')}
      >
        {children(aoRecuar)}
      </div>
    </ContextoPorBaixo.Provider>
  )
}
