/*
 * PREPARAÇÃO COMUM A TODOS OS TESTES
 * ==================================
 *
 * Este ficheiro corre uma única vez, antes de qualquer teste (está
 * indicado em "setupFiles", no bloco "test" de vite.config.ts). Serve para
 * ligar extensões que devem valer para toda a suite de testes, sem as
 * repetir em cada ficheiro:
 *
 *   1. Os "matchers" do jest-dom, que acrescentam ao expect(...) formas de
 *      verificação próprias do DOM (por exemplo, toBeInTheDocument() ou
 *      toHaveTextContent(...)), mais legíveis do que verificar as mesmas
 *      condições à mão.
 *
 *   2. O ciclo de vida do servidor de simulação de rede (MSW): arrancá-lo
 *      antes dos testes, repor as regras entre testes, e encerrá-lo no
 *      fim.
 */

// A importação com o sufixo "/vitest" regista os matchers do jest-dom
// directamente no expect do Vitest. Não é preciso atribuir o resultado a
// nada — o efeito é o próprio acto de importar.
import '@testing-library/jest-dom/vitest'

import { afterAll, afterEach, beforeAll } from 'vitest'

import { servidorMsw } from './servidor-msw'

/*
 * MOCK DE window.matchMedia
 * ------------------------
 * O jsdom não implementa matchMedia. Sem isto, qualquer componente que use
 * o hook useMediaQuery (ou matchMedia diretamente) rebentava nos testes.
 * Por omissão, "ecrã largo / desktop". Um teste que precise de simular
 * mobile chama definirEcraMobile(true) ANTES de montar o componente.
 *
 * O mock lê a consulta: as "min-width" (ex.: ">= 769px", que a app usa
 * para "isto é desktop") correspondem quando NÃO se está em mobile; as
 * "max-width" e as restantes seguem "ecraMobile". Sem isto, uma consulta
 * de desktop e uma de mobile devolviam o mesmo — e um componente que
 * pergunta "sou desktop?" via "min-width" agia ao contrário em mobile.
 */
type OuvinteMedia = (evento: { matches: boolean }) => void
let ecraMobile = false
const ouvintesMedia = new Set<OuvinteMedia>()

function consultaCorresponde(query: string): boolean {
  if (query.includes('min-width')) return !ecraMobile
  return ecraMobile
}

window.matchMedia = ((query: string) => ({
  matches: consultaCorresponde(query),
  media: query,
  onchange: null,
  addEventListener: (_tipo: string, ouvinte: OuvinteMedia) => ouvintesMedia.add(ouvinte),
  removeEventListener: (_tipo: string, ouvinte: OuvinteMedia) =>
    ouvintesMedia.delete(ouvinte),
  addListener: (ouvinte: OuvinteMedia) => ouvintesMedia.add(ouvinte),
  removeListener: (ouvinte: OuvinteMedia) => ouvintesMedia.delete(ouvinte),
  dispatchEvent: () => true,
})) as unknown as typeof window.matchMedia

/** Simula (ou desliga) um ecrã de telemóvel para os componentes que usam
 *  useMediaQuery. Chamar antes de montar. */
export function definirEcraMobile(valor: boolean): void {
  ecraMobile = valor
  ouvintesMedia.forEach((ouvinte) => ouvinte({ matches: valor }))
}

/*
 * MOCK DE IntersectionObserver
 * ----------------------------
 * O jsdom também não implementa IntersectionObserver — usado pela
 * sentinela do scroll infinito de Movimentos.tsx (ver a nota PAGINAÇÃO POR
 * CURSOR nesse ficheiro). Sem isto, montar essa página rebentava com
 * "IntersectionObserver is not defined".
 *
 * Em vez de simular intersecções verdadeiras (que exigiriam medir
 * posições e tamanhos, tudo o que o jsdom também não faz), este mock só
 * regista qual o callback associado a cada elemento observado — e
 * simularEntradaNoEcra(elemento), mais abaixo, dispara esse callback à
 * mão, tal como um scroll a sério dispararia o do browser.
 */
type EntradaIntersecaoMock = { isIntersecting: boolean; target: Element }
type OuvinteIntersecao = (entradas: EntradaIntersecaoMock[]) => void

const observadoresIntersecao = new Map<Element, OuvinteIntersecao>()

class IntersectionObserverMock {
  #callback: OuvinteIntersecao

  constructor(callback: OuvinteIntersecao) {
    this.#callback = callback
  }

  observe(elemento: Element) {
    observadoresIntersecao.set(elemento, this.#callback)
  }

  unobserve(elemento: Element) {
    observadoresIntersecao.delete(elemento)
  }

  disconnect() {
    for (const [elemento, callback] of observadoresIntersecao) {
      if (callback === this.#callback) observadoresIntersecao.delete(elemento)
    }
  }

  takeRecords() {
    return []
  }
}

window.IntersectionObserver = IntersectionObserverMock as unknown as typeof IntersectionObserver

/** Simula uma sentinela a ENTRAR no ecrã — dispara o callback do
 *  IntersectionObserver que a está a observar (ver o mock acima), com
 *  "isIntersecting: true". Usado pelos testes de scroll infinito de
 *  Movimentos.test.tsx (a sentinela do fim da lista, que pede mais uma
 *  página assim que fica visível) e, ao rolar de volta para cima, pelos
 *  testes do título colapsável do cabeçalho (App.test.tsx — ver
 *  useColapsarAoRolar.ts), onde a sentinela REAPARECE no ecrã. */
export function simularEntradaNoEcra(elemento: Element): void {
  observadoresIntersecao.get(elemento)?.([{ isIntersecting: true, target: elemento }])
}

/** O oposto: simula uma sentinela a SAIR do ecrã ("isIntersecting:
 *  false"). Usado pelos testes do título colapsável do cabeçalho
 *  (App.test.tsx — ver useColapsarAoRolar.ts) — a sentinela sai do ecrã
 *  quando se rola para além do título grande. */
export function simularSaidaDoEcra(elemento: Element): void {
  observadoresIntersecao.get(elemento)?.([{ isIntersecting: false, target: elemento }])
}

// Cada teste começa sem observadores pendentes de testes anteriores.
afterEach(() => observadoresIntersecao.clear())

// Cada teste começa em "desktop".
afterEach(() => {
  ecraMobile = false
  ouvintesMedia.clear()
})

// beforeAll: corre uma vez, antes do primeiro teste.
// onUnhandledRequest: 'error' faz falhar qualquer teste que provoque um
// pedido HTTP para o qual não exista uma regra declarada — assim, um
// pedido inesperado é um erro visível, não algo que passa despercebido.
beforeAll(() => servidorMsw.listen({ onUnhandledRequest: 'error' }))

// afterEach: corre depois de cada teste. Remove as regras que esse teste
// tenha adicionado com servidorMsw.use(...), para que não "vazem" para o
// teste seguinte e cada teste comece de um estado limpo.
afterEach(() => servidorMsw.resetHandlers())

// afterAll: corre uma vez, depois do último teste. Encerra o servidor de
// interceptação e liberta os recursos que ocupava.
afterAll(() => servidorMsw.close())
