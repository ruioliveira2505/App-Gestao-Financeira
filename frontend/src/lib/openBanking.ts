/*
 * CLIENTE HTTP DA API DE OPEN BANKING
 * ===================================
 *
 * As funções que falam com os endpoints /open-banking do backend (ver
 * backend/app/routers/open_banking.py). O resto da aplicação (o fluxo
 * "Através do teu banco" em ContaNova.tsx, e a acção "Desvincular" em
 * ContaDetalhe.tsx) chama estas funções e nunca usa "fetch" diretamente —
 * mesma regra do resto do cliente HTTP desta app (ver src/lib/http.ts).
 *
 * UMA FUNÇÃO NÃO SEGUE ESTE PADRÃO: iniciarLigacao, mais abaixo, não usa
 * "pedido" (que faz um "fetch") — faz o browser SAIR da SPA de propósito
 * (window.location.href), porque o endpoint que chama (GET /open-banking/
 * ligar) reencaminha para o ecrã de login real do banco, fora desta
 * aplicação. Ver a nota nessa função.
 */

import { pedido } from './http'

/** Um banco (ASPSP) suportado pela Enable Banking — ver GET /open-banking/bancos. */
export type Banco = {
  name: string
  country: string
  // Quanto tempo vai durar a autorização pedida a este banco, em dias: o
  // máximo que ele aceita, até 180 (a regra europeia). Calculado pelo
  // backend — mostrado no ecrã de permissões, antes de sair para o banco.
  validade_dias: number
}

/**
 * Uma conta bancária trazida por uma ligação — ver GET /open-banking/
 * ligacoes/{id}/contas-ligadas. Ao voltar do banco, cada uma é de um de
 * três casos (o backend reconhece-as pela identificação estável da conta
 * bancária):
 *   - JÁ NAS TUAS CONTAS: "conta_id" preenchido — a conta bancária já
 *     alimentava uma conta tua, e a ligação renovou-se sozinha (ou já
 *     tinha sido associada antes). "conta_nome" é o nome dessa conta;
 *   - JÁ FOI UMA CONTA TUA, entretanto desvinculada: "conta_antiga"
 *     preenchido. Por agora entra como conta nova (religar à antiga
 *     precisa de reconciliações, que ainda não existem);
 *   - NOVA: nenhum dos dois.
 */
export type ContaLigada = {
  id: string
  // O banco desta conta (o mesmo para todas as contas de uma ligação) —
  // mostrado, bloqueado, ao configurar a conta.
  banco: string
  iban: string | null
  moeda: string
  nome_titular: string | null
  conta_id: string | null
  conta_nome: string | null
  // Até quando vale a ligação (ISO 8601) — «Ligação renovada até…».
  valido_ate: string
  // Sugestões para uma conta nova: o tipo (a partir do tipo de conta que
  // o banco envia) e um nome, mostrado como EXEMPLO no campo.
  tipo_sugerido: string | null
  nome_sugerido: string
  conta_antiga: { id: string; nome: string } | null
}

export function listarBancos(pais: string = 'PT'): Promise<Banco[]> {
  return pedido<Banco[]>(`/open-banking/bancos?pais=${encodeURIComponent(pais)}`)
}

export function listarContasLigadas(ligacaoId: string): Promise<ContaLigada[]> {
  return pedido<ContaLigada[]>(`/open-banking/ligacoes/${ligacaoId}/contas-ligadas`)
}

/**
 * Inicia a ligação a um banco — SAI da SPA de propósito, em vez de fazer
 * um pedido "fetch" (ver a nota no topo do ficheiro). POST /open-banking/
 * ligar tem um efeito real do lado da Enable Banking (regista um pedido
 * de autorização) e devolve um REDIRECIONAMENTO para o ecrã de login do
 * banco escolhido — algo que só faz sentido como uma navegação a sério
 * do browser, nunca como uma resposta processada em JavaScript.
 *
 * SUBMETE UM FORMULÁRIO, não usa "window.location.href": o endpoint é
 * POST, não GET (ver a nota em app/routers/open_banking.py, no backend,
 * sobre o risco de CSRF que um GET com este efeito lateral teria) — e
 * "window.location.href" só sabe fazer navegações GET. Um formulário
 * criado e submetido por JavaScript é a forma padrão de o browser fazer
 * uma navegação de topo a sério (não um "fetch") com outro método.
 *
 * O caminho começa por "/api" (o prefixo do proxy do Vite — ver
 * vite.config.ts), não por "pedido()", porque este URL não é lido em
 * JavaScript nenhum: o browser é que o segue directamente.
 */
export function iniciarLigacao(banco: string, pais: string = 'PT'): void {
  const parametros = new URLSearchParams({ banco, pais })
  const formulario = document.createElement('form')
  formulario.method = 'POST'
  formulario.action = `/api/open-banking/ligar?${parametros.toString()}`
  document.body.appendChild(formulario)
  formulario.submit()
}

/** O que POST /open-banking/contas-ligadas/{id}/associar-nova-conta devolve. */
export type ContaAssociada = {
  conta_id: string
  nome: string
  banco: string | null
  moeda: string
  data_ancora: string
  saldo_ancora: string
  movimentos_importados: number
}

/**
 * "dataDe", quando indicada (formato AAAA-MM-DD), limita a importação
 * inicial a partir dessa data — a escolha "todo o histórico" (sem
 * "dataDe") vs. "desde uma data" é feita no passo "confirmar" de
 * ContaNova.tsx, por cada conta descoberta. Ver a nota correspondente em
 * app/services/importacao_movimentos.py, no backend: trazer TODO o
 * histórico de uma vez também significa trazer um backlog de movimentos
 * por categorizar à mão, enquanto esta aplicação não tiver categorização
 * automática — por isso é uma escolha oferecida, não decidida sozinha.
 */
export function associarNovaConta(
  contaLigadaId: string,
  nome: string,
  dataDe?: string,
  tipo?: string | null,
): Promise<ContaAssociada> {
  const parametros = new URLSearchParams({ nome })
  if (dataDe) parametros.set('data_de', dataDe)
  // "tipo" — o mesmo campo livre do formulário manual ("Conta corrente",
  // "Poupança"…); sem valor, a conta fica "sem tipo", como no manual.
  if (tipo) parametros.set('tipo', tipo)
  return pedido<ContaAssociada>(
    `/open-banking/contas-ligadas/${contaLigadaId}/associar-nova-conta?${parametros.toString()}`,
    { method: 'POST' },
  )
}

export function desvincular(contaLigadaId: string): Promise<void> {
  return pedido<void>(`/open-banking/contas-ligadas/${contaLigadaId}`, { method: 'DELETE' })
}

/** O que POST /open-banking/contas-ligadas/{id}/sincronizar devolve. */
export type ResultadoSincronizacao = {
  movimentos_importados: number
}

/**
 * Importa os movimentos NOVOS de uma conta JÁ ligada e já associada —
 * chamada pelo botão "Sincronizar agora" em ContaDetalhe.tsx. Nunca pede
 * uma data: o backend calcula sozinho desde onde continuar (ver
 * sincronizar_movimentos, em app/services/importacao_movimentos.py).
 */
export function sincronizar(contaLigadaId: string): Promise<ResultadoSincronizacao> {
  return pedido<ResultadoSincronizacao>(
    `/open-banking/contas-ligadas/${contaLigadaId}/sincronizar`,
    { method: 'POST' },
  )
}
