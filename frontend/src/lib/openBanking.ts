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
}

/**
 * Uma conta bancária trazida por uma ligação, ainda por confirmar como
 * "esta é a minha conta X" — ver GET /open-banking/ligacoes/{id}/
 * contas-ligadas. "conta_id" só vem preenchido se já tiver sido associada
 * a uma Conta desta aplicação (não deveria acontecer logo a seguir a uma
 * ligação nova, mas o campo existe para o caso de o utilizador voltar a
 * visitar o mesmo link).
 */
export type ContaLigada = {
  id: string
  // O banco desta conta (o mesmo para todas as contas de uma ligação) —
  // mostrado, bloqueado, ao configurar a conta, e usado como nome sugerido.
  banco: string
  iban: string | null
  moeda: string
  nome_titular: string | null
  conta_id: string | null
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
