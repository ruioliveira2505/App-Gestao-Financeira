/*
 * CACHE DOS DADOS DO SERVIDOR (TanStack Query)
 * ============================================
 *
 * Os dados que vêm da API (contas, movimentos…) são "estado do servidor":
 * a verdade está no backend, e o frontend só tem uma CÓPIA, que pode
 * ficar desactualizada. A biblioteca TanStack Query gere essa cópia numa
 * CACHE partilhada pela app inteira:
 *
 *   - cada conjunto de dados tem uma CHAVE (ex.: ['contas'] para a lista,
 *     ['contas', id] para uma conta) — duas páginas que pedem a mesma
 *     chave partilham os mesmos dados e o mesmo pedido;
 *   - uma página "subscreve" uma chave com useQuery (ver
 *     hooks/useContas.ts) e volta a desenhar-se sozinha quando os dados
 *     dessa chave mudam;
 *   - depois de ALTERAR alguma coisa no servidor (criar, editar,
 *     eliminar…), "invalida-se" a chave: os dados passam a ser
 *     considerados desactualizados, e todas as páginas que os mostram —
 *     estejam à vista ou montadas por baixo de outra — pedem-nos de novo.
 *
 * Este ficheiro define as chaves (num só sítio, para não haver gralhas
 * entre quem lê e quem invalida) e cria o "cliente" — o objecto que guarda
 * a cache, entregue à app em main.tsx (QueryClientProvider).
 */

import { QueryClient } from '@tanstack/react-query'

import { ErroApi } from './http'

// As chaves da cache. São listas porque a invalidação funciona por
// PREFIXO: invalidar ['contas'] invalida também ['contas', '123'] — a
// lista e o detalhe de cada conta de uma vez.
export const CHAVES = {
  contas: ['contas'] as const,
  conta: (id: string) => ['contas', id] as const,
  // Debaixo da chave da conta: invalidar ['contas'] (por exemplo, depois de
  // sincronizar) também volta a pedir as reconciliações.
  reconciliacoes: (contaId: string) => ['contas', contaId, 'reconciliacoes'] as const,
}

/** Repete uma vez, menos um 401 (ver a nota "retry", abaixo). */
function repetirUmaVez(tentativasFeitas: number, erro: unknown): boolean {
  if (erro instanceof ErroApi && erro.estado === 401) return false
  return tentativasFeitas < 1
}

/**
 * Cria o cliente da cache.
 *
 * - staleTime (30 s): durante 30 segundos depois de chegarem, os dados são
 *   considerados "frescos" — uma página que os peça nesse intervalo usa
 *   a cache sem novo pedido (ex.: abrir "Nova conta" logo depois da lista
 *   não volta a pedir as contas). Depois disso, são usados na mesma (vê-se
 *   logo alguma coisa), mas pedidos outra vez em segundo plano. As
 *   alterações feitas NA app não dependem disto: invalidam a chave
 *   explicitamente.
 * - retry: um pedido falhado é repetido uma vez (uma falha de rede
 *   momentânea não chega a mostrar erro) — exceto um 401: a sessão
 *   terminou, repetir não adianta e a app já está a sair para o login
 *   (ver src/lib/http.ts). Nos testes, nunca — um teste de
 *   erro quer ver o erro logo, não esperar pela repetição.
 * - Por omissão, a biblioteca também volta a pedir os dados desactualizados
 *   quando a janela volta a ter o foco (ex.: voltar à app no telemóvel
 *   depois de a ter deixado em segundo plano).
 */
export function criarClienteConsultas({ testes = false }: { testes?: boolean } = {}): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: testes ? false : repetirUmaVez,
      },
    },
  })
}
