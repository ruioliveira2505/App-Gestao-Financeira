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
 * VOCABULÁRIO: uma AUTORIZAÇÃO é o consentimento dado no banco para a
 * aplicação ler as contas partilhadas, durante um prazo; cada conta
 * partilhada é uma CONTA BANCÁRIA; o VÍNCULO é o facto de uma conta
 * bancária alimentar uma conta desta aplicação.
 *
 * UMA FUNÇÃO NÃO SEGUE ESTE PADRÃO: iniciarAutorizacao, mais abaixo, não
 * usa "pedido" (que faz um "fetch") — faz o browser SAIR da aplicação de
 * propósito, porque o endpoint que chama (POST /open-banking/autorizar)
 * reencaminha para o ecrã de login real do banco. Ver a nota nessa
 * função.
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
 * Uma conta bancária trazida por uma autorização — ver GET /open-banking/
 * autorizacoes/{id}/contas-bancarias. Ao voltar do banco, cada uma é de um
 * de três casos (o backend reconhece-as pela identificação estável da
 * conta bancária):
 *   - JÁ NAS TUAS CONTAS: "conta_id" preenchido — a conta bancária já
 *     alimentava uma conta tua, e o vínculo renovou-se sozinho (ou já
 *     tinha sido vinculada antes). "conta_nome" é o nome dessa conta;
 *   - JÁ FOI UMA CONTA TUA, entretanto desvinculada: "conta_antiga"
 *     preenchido. Nesta interface entra como conta nova: o backend já
 *     sabe vincular a conta antiga, mas o ecrã para isso ainda não
 *     existe;
 *   - NOVA: nenhum dos dois.
 */
export type ContaBancaria = {
  id: string
  // O banco desta conta (o mesmo para todas as contas de uma autorização) —
  // mostrado, bloqueado, ao configurar a conta.
  banco: string
  iban: string | null
  moeda: string
  nome_titular: string | null
  conta_id: string | null
  conta_nome: string | null
  // Até quando vale a autorização (data e hora ISO 8601).
  valido_ate: string
  // Sugestões para uma conta nova: o tipo (a partir do tipo de conta que
  // o banco envia) e um nome, mostrado como EXEMPLO no campo.
  tipo_sugerido: string | null
  nome_sugerido: string
  conta_antiga: { id: string; nome: string } | null
}

/** Os bancos suportados num país (por omissão, Portugal), com o prazo de autorização de cada um. */
export function listarBancos(pais: string = 'PT'): Promise<Banco[]> {
  return pedido<Banco[]>(`/open-banking/bancos?pais=${encodeURIComponent(pais)}`)
}

/** As contas bancárias que uma autorização trouxe — pedidas ao voltar do banco. */
export function listarContasBancarias(autorizacaoId: string): Promise<ContaBancaria[]> {
  return pedido<ContaBancaria[]>(`/open-banking/autorizacoes/${autorizacaoId}/contas-bancarias`)
}

/**
 * Inicia uma autorização num banco — SAI da aplicação de propósito, em
 * vez de fazer um pedido "fetch" (ver a nota no topo do ficheiro). POST
 * /open-banking/autorizar tem um efeito real do lado da Enable Banking (regista um pedido
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
export function iniciarAutorizacao(banco: string, pais: string = 'PT'): void {
  irAoBanco(new URLSearchParams({ banco, pais }))
}

/**
 * Renova uma autorização: o mesmo caminho até ao banco (e pelas mesmas
 * razões: sai da aplicação de propósito, com um formulário POST), mas
 * indicando a autorização a renovar ("renova") em vez do banco — o banco e
 * o país vêm dessa autorização, do lado do backend. No regresso, a
 * aplicação abre "Nova conta" com a autorização nova, onde as contas
 * reconhecidas aparecem já renovadas.
 */
export function renovarAutorizacao(autorizacaoId: string): void {
  irAoBanco(new URLSearchParams({ renova: autorizacaoId }))
}

/** Cria e submete o formulário POST para /open-banking/autorizar, com os
 *  parâmetros dados — partilhado por iniciarAutorizacao e
 *  renovarAutorizacao. */
function irAoBanco(parametros: URLSearchParams): void {
  const formulario = document.createElement('form')
  formulario.method = 'POST'
  formulario.action = `/api/open-banking/autorizar?${parametros.toString()}`
  document.body.appendChild(formulario)
  formulario.submit()
}

/** O que POST /open-banking/contas-bancarias/{id}/criar-conta devolve. */
export type ContaCriadaDoBanco = {
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
export function criarContaDoBanco(
  contaBancariaId: string,
  nome: string,
  dataDe?: string,
  tipo?: string | null,
): Promise<ContaCriadaDoBanco> {
  const parametros = new URLSearchParams({ nome })
  if (dataDe) parametros.set('data_de', dataDe)
  // "tipo" — o mesmo campo livre do formulário manual ("Conta corrente",
  // "Poupança"…); sem valor, a conta fica "sem tipo", como no manual.
  if (tipo) parametros.set('tipo', tipo)
  return pedido<ContaCriadaDoBanco>(
    `/open-banking/contas-bancarias/${contaBancariaId}/criar-conta?${parametros.toString()}`,
    { method: 'POST' },
  )
}

/**
 * Desfaz o vínculo de uma conta bancária: a conta deixa de sincronizar,
 * mas ela e os movimentos já importados ficam (passa a ser uma conta
 * manual). O caminho termina em "/vinculo" porque é o vínculo que se
 * apaga, não a conta.
 */
export function desvincular(contaBancariaId: string): Promise<void> {
  return pedido<void>(`/open-banking/contas-bancarias/${contaBancariaId}/vinculo`, { method: 'DELETE' })
}

/** O que POST /open-banking/contas-bancarias/{id}/sincronizar devolve. */
export type ResultadoSincronizacao = {
  movimentos_importados: number
}

/**
 * Importa os movimentos NOVOS de uma conta JÁ vinculada — chamada pelo
 * botão "Sincronizar" no detalhe de uma conta (ContaDetalhe.tsx) e pelo
 * menu da lista de contas, para todas de uma vez (Contas.tsx). Nunca pede
 * uma data: o backend calcula sozinho desde onde continuar (ver
 * sincronizar_movimentos, em backend/app/services/importacao_movimentos.py).
 */
export function sincronizar(contaBancariaId: string): Promise<ResultadoSincronizacao> {
  return pedido<ResultadoSincronizacao>(
    `/open-banking/contas-bancarias/${contaBancariaId}/sincronizar`,
    { method: 'POST' },
  )
}
