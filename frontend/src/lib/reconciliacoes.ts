/*
 * CLIENTE HTTP DA API DE RECONCILIAÇÕES
 * =====================================
 *
 * Uma RECONCILIAÇÃO afirma o saldo de uma conta no FIM de um dia («no fim
 * de 30 de junho, o saldo era 12 480 €»). A aplicação compara-o com o que
 * ela própria calcula e cria um movimento de ACERTO pela diferença; a
 * partir desse dia, o saldo é sempre o afirmado. Numa conta manual, quem
 * as cria é o utilizador; numa conta vinculada ao banco, só existem as que
 * a aplicação criou ao vincular (origem "banco"), e só se mostram.
 *
 * Por agora, só a leitura (a página da conta mostra as mais recentes);
 * criar, editar e eliminar chegam com a página Reconciliar. A mecânica
 * comum dos pedidos (prefixo, cookie, erros) vive em src/lib/http.ts.
 */

import { pedido } from './http'

/**
 * Uma reconciliação, tal como a API a devolve (schema ReconciliacaoOut do
 * backend). Valores monetários em texto ("1234.56"), para não perder
 * cêntimos; "data" é o dia (AAAA-MM-DD).
 *
 *   - acerto: a diferença que a reconciliação acertou ("-35.00"). Pode
 *     passar a "0.00" mais tarde, quando se regista o movimento que a
 *     explicava: a reconciliação fica, a guardar o saldo confirmado;
 *   - origem: "utilizador" ou "banco" (criada ao vincular a conta);
 *   - lido_em: só nas do banco, quando se leu o saldo ao banco.
 */
export type Reconciliacao = {
  id: string
  conta_id: string
  data: string
  saldo: string
  origem: 'utilizador' | 'banco'
  acerto: string
  lido_em: string | null
}

/** As reconciliações de uma conta, por ordem de data (a mais antiga primeiro). */
export function listarReconciliacoes(contaId: string): Promise<Reconciliacao[]> {
  return pedido<Reconciliacao[]>(`/contas/${contaId}/reconciliacoes`)
}
