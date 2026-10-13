/*
 * useContas / useConta — AS CONTAS, LIDAS DA CACHE PARTILHADA
 * ===========================================================
 *
 * Os dois "hooks" (funções que um componente React chama para ganhar uma
 * capacidade — aqui, os dados das contas) pelos quais as páginas do módulo
 * Contas lêem as contas. Por baixo usam o useQuery da TanStack Query, uma
 * biblioteca de gestão de dados vindos do servidor: guarda numa CACHE (uma
 * cópia em memória partilhada pela app) os dados já pedidos, identificados
 * por uma "chave" (aqui ['contas'] para a lista e ['contas', id] para uma
 * conta). Todas as páginas que pedem a lista partilham o mesmo pedido e os
 * mesmos dados, e quando alguém altera uma conta e "invalida" a chave
 * ['contas'] (marca os dados como desatualizados), todas voltam a pedi-los
 * e se atualizam sozinhas.
 *
 * Cada um devolve o "resultado" do useQuery, de onde interessam:
 *   - data: os dados (undefined enquanto não chegam pela primeira vez);
 *   - error: o erro do último pedido (null se correu bem);
 *   - isFetching: true enquanto há um pedido a decorrer (também os de
 *     actualização, em segundo plano, com dados já à vista);
 *   - refetch(): pede outra vez (ex.: o botão "Tentar outra vez").
 */

import { useQuery } from '@tanstack/react-query'

import { listarContas, obterConta } from '../lib/contas'
import { listarReconciliacoes } from '../lib/reconciliacoes'
import { CHAVES } from '../lib/consultas'

/** A lista de contas do utilizador. */
export function useContas() {
  return useQuery({ queryKey: CHAVES.contas, queryFn: listarContas })
}

/** Uma conta, pelo id. "id" pode faltar (rota ainda sem parâmetro): aí não
 *  se pede nada ("enabled: false"). */
export function useConta(id: string | undefined) {
  return useQuery({
    queryKey: CHAVES.conta(id ?? ''),
    queryFn: () => obterConta(id as string),
    enabled: id !== undefined,
  })
}

/** As reconciliações de uma conta (por ordem de data). "contaId" pode
 *  faltar: aí não se pede nada. */
export function useReconciliacoes(contaId: string | undefined) {
  return useQuery({
    queryKey: CHAVES.reconciliacoes(contaId ?? ''),
    queryFn: () => listarReconciliacoes(contaId as string),
    enabled: contaId !== undefined,
  })
}
