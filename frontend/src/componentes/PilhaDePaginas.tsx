/*
 * PilhaDePaginas — A PÁGINA DE BAIXO FICA, A DE CIMA DESLIZA POR CIMA
 * ===================================================================
 *
 * O modelo de navegação do iOS: ao abrir o detalhe de uma conta, a lista
 * de contas NÃO desaparece — continua lá por baixo, e o detalhe entra a
 * deslizar por cima dela; ao recuar, o detalhe sai a deslizar e revela a
 * lista, tal como estava (mesmo scroll, sem recarregar).
 *
 * PORQUÊ ESTE COMPONENTE: antes dele, cada endereço tinha a sua página e
 * só ela — ao mudar de "/contas" para "/contas/c1", o React desmontava a
 * lista e montava o detalhe do zero. O detalhe deslizava, sim, mas sobre
 * um fundo VAZIO, e ao recuar a lista só reaparecia de golpe no fim (e a
 * recarregar). O mesmo nas folhas: abrir "Nova conta" recriava a lista
 * por trás, e o scroll voltava ao topo.
 *
 * COMO SE USA — como "rota de layout" em App.tsx: o elemento de uma rota
 * cujas filhas são as páginas e folhas que se abrem por cima de "fundo":
 *
 *   <Route path="/contas" element={<PilhaDePaginas fundo={<Contas />} />}>
 *     <Route index element={null} />
 *     <Route path="nova" element={<ContaNova />} />      ← folha
 *     <Route path=":id" element={<ContaDetalhe />} />    ← página
 *   </Route>
 *
 * Como o elemento da rota-mãe é o MESMO para todas as filhas, o React
 * nunca desmonta "fundo" ao navegar entre elas — só o <Outlet> (a filha)
 * muda.
 *
 * Quem desliza por cima é a PaginaDeslizante da página de cima: em
 * telemóvel, passa a ser uma CAMADA fixa sobre o ecrã, com scroll
 * próprio, e anuncia à pilha (ContextoPilha) quando entra e quando sai.
 * Enquanto a tapa, a página de baixo fica "inert" (fora do alcance do
 * teclado e dos leitores de ecrã) e deixa a barra de topo à página de
 * cima (ContextoPorBaixo). Em ecrã largo não há camadas: a página de
 * baixo esconde-se ("hidden") e a de cima ocupa o seu lugar, como antes.
 *
 * RECUO DA PÁGINA DE BAIXO (só telemóvel): enquanto a de cima entra, a
 * de baixo desliza um terço para a esquerda, ao mesmo ritmo — e volta ao
 * sítio enquanto a de cima sai. É o "parallax" das apps do iOS: as duas
 * páginas parecem mover-se juntas, como folhas de um caderno. Ver as
 * notas em PilhaDePaginas.module.css sobre o COMO (a propriedade
 * "translate" e o seletor ":has").
 *
 * As folhas (Folha.tsx) não anunciam nada: já cobrem o ecrã com o seu
 * próprio fundo escurecido, e a página de baixo continua a ser a dona da
 * barra de topo.
 */

import { useMemo, useState, type ReactNode } from 'react'
import { Outlet } from 'react-router-dom'

import { useMediaQuery } from '../hooks/useMediaQuery'
import { ContextoPilha, ContextoPorBaixo, type FaseCamada } from './contextoPilha'
import estilos from './PilhaDePaginas.module.css'

export function PilhaDePaginas({ fundo }: { fundo: ReactNode }) {
  const eMobile = useMediaQuery('(max-width: 768px)')
  const [fase, setFase] = useState<FaseCamada>('nenhuma')

  // Estável (o mesmo objecto em todas as renderizações), para a página de
  // cima o poder usar como dependência de um efeito sem o repetir a cada
  // render.
  const pilha = useMemo(() => ({ anunciar: setFase }), [])

  // Tapada só enquanto a página de cima ENTRA ou está pousada. Logo que
  // começa a SAIR, a de baixo volta a mandar na barra de topo — os botões
  // dela aparecem enquanto o detalhe ainda desliza para fora, em vez de
  // só no fim.
  const tapada = fase === 'entrar'

  return (
    <>
      <ContextoPorBaixo.Provider value={tapada}>
        <div
          className={tapada ? `${estilos.fundo} ${estilos.fundoRecuado}` : estilos.fundo}
          inert={tapada || undefined}
          hidden={tapada && !eMobile}
        >
          {fundo}
        </div>
      </ContextoPorBaixo.Provider>
      <ContextoPilha.Provider value={pilha}>
        <Outlet />
      </ContextoPilha.Provider>
    </>
  )
}
