/*
 * AVISO PENDENTE — UM AVISO DEIXADO PARA A PÁGINA DE BAIXO
 * ========================================================
 *
 * Quando se guarda em Editar conta, a folha fecha-se RECUANDO no histórico
 * (para não deixar /contas/:id/editar empilhado), e um recuo não leva
 * "state" de navegação. Mas a página da conta, por baixo, deve mostrar o
 * aviso «Alterações guardadas». A solução é este pequeno «correio»:
 *
 *   - a página da conta ESCUTA os avisos da sua conta (escutarAvisos)
 *     enquanto está montada — e está, por baixo da folha de Editar;
 *   - quem guarda ENTREGA o aviso (deixarAviso): se alguém está à escuta,
 *     recebe-o logo; se não (por exemplo, Editar aberto diretamente pelo
 *     URL), fica guardado e é entregue a quem começar a escutar — mas só
 *     nos segundos seguintes (PRAZO_MS): mais tarde, «Alterações guardadas»
 *     já não diria respeito ao que o utilizador está a ver.
 *
 * Escutar, em vez de a página ir «ver se há correio» quando a navegação
 * muda, é a forma que o React recomenda para reagir a algo de fora: o
 * estado muda na função que recebe o aviso, e não diretamente num efeito.
 *
 * Vive só na memória do separador (variáveis deste módulo): não precisa de
 * sobreviver a um recarregar da página — aí o aviso já não faria sentido.
 */

type Ouvinte = (texto: string) => void

// Quem está à escuta, por conta (o id da conta → a função a chamar).
const ouvintes = new Map<string, Ouvinte>()
// Avisos entregues sem ninguém à escuta, por conta, com o momento da entrega.
const pendentes = new Map<string, { texto: string; em: number }>()

// Quanto tempo um aviso sem ouvinte espera por quem o vá buscar (10 s).
const PRAZO_MS = 10_000

/** Entrega um aviso à página da conta "contaId" (já, ou quando escutar). */
export function deixarAviso(contaId: string, texto: string): void {
  const ouvinte = ouvintes.get(contaId)
  if (ouvinte) ouvinte(texto)
  else pendentes.set(contaId, { texto, em: Date.now() })
}

/**
 * Começa a escutar os avisos da conta "contaId": um aviso que já estivesse
 * à espera é entregue logo. Devolve a função que deixa de escutar (para o
 * "return" de um useEffect).
 */
export function escutarAvisos(contaId: string, ouvinte: Ouvinte): () => void {
  ouvintes.set(contaId, ouvinte)
  const pendente = pendentes.get(contaId)
  if (pendente !== undefined) {
    pendentes.delete(contaId)
    if (Date.now() - pendente.em <= PRAZO_MS) ouvinte(pendente.texto)
  }
  return () => {
    if (ouvintes.get(contaId) === ouvinte) ouvintes.delete(contaId)
  }
}
