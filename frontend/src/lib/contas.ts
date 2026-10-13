/*
 * CLIENTE HTTP DA API DE CONTAS
 * ============================
 *
 * As funções que falam com os endpoints /contas do backend. O resto da
 * aplicação (as páginas de contas) chama estas funções e nunca usa
 * "fetch" diretamente. A mecânica comum (prefixo, cookie, erros) vive em
 * src/lib/http.ts.
 */

import { pedido } from './http'

/**
 * O VÍNCULO de uma conta: a conta bancária real que a alimenta através do
 * Open Banking (schema VinculoOut do backend).
 *
 *   - conta_bancaria_id: para sincronizar e desvincular;
 *   - banco e titular: identificam a AUTORIZAÇÃO (o consentimento dado no
 *     banco) para quem a lê: uma autorização é um banco com um titular. O
 *     titular é o nome que o banco envia, e pode faltar (null);
 *   - valido_ate: até quando vale a autorização (data e hora ISO); serve
 *     para avisar ANTES de terminar (ver estadoAutorizacao, abaixo);
 *   - autorizacao_id: a autorização (para a renovar);
 *   - iban: o IBAN da conta bancária (null se o banco não o enviar);
 *   - sincronizado_em: a última sincronização que correu bem (data e hora
 *     ISO; null se ainda não houve nenhuma);
 *   - suspensa_desde: desde quando a conta está suspensa (null se está
 *     vinculada);
 *   - falha_em / falha_motivo: a última falha de sincronização por causa
 *     do banco ("sem-ligacao" ou "limite"), se for mais recente do que a
 *     última que correu bem (senão, null);
 *   - autorizacao_terminada_em: quando terminou a AUTORIZAÇÃO (null se
 *     ainda está ativa). À parte do estado da conta: uma conta suspensa
 *     porque o banco deixou de a partilhar pode ter a autorização ainda
 *     ativa, ou já terminada;
 *   - estado: o ESTADO da conta, deduzido pelo backend: "vinculada" (recebe
 *     movimentos do banco) ou "suspensa" (mantém o vínculo, mas já não
 *     sincroniza);
 *   - motivo: porque está suspensa ("expirada": o prazo passou;
 *     "revogada": retirada na aplicação; "banco": o banco deu-a por
 *     terminada; "indisponivel": o banco deixou de partilhar esta conta).
 *     null quando está vinculada.
 */
export type Vinculo = {
  conta_bancaria_id: string
  banco: string
  titular: string | null
  valido_ate: string
  autorizacao_id: string
  iban: string | null
  sincronizado_em: string | null
  suspensa_desde: string | null
  autorizacao_terminada_em: string | null
  falha_em: string | null
  falha_motivo: 'sem-ligacao' | 'limite' | null
  estado: 'vinculada' | 'suspensa'
  motivo: 'expirada' | 'revogada' | 'banco' | 'indisponivel' | null
}

/**
 * Uma conta, tal como a API a devolve (schema ContaOut do backend).
 *
 * Notas:
 *   - Valores monetários (saldo_ancora, saldo) são texto ("1234.56"),
 *     não números — o JSON não tem tipo decimal e um número perderia
 *     precisão em cêntimos. Converter só na fronteira da apresentação.
 *   - data_ancora / created_at / updated_at são strings ISO.
 *   - saldo é o saldo atual; enquanto não há movimentos, é igual a
 *     saldo_ancora.
 *   - saldo_convertido é "saldo" já convertido para a moeda principal do
 *     utilizador autenticado (ver src/paginas/PerfilPreferencias.tsx), à
 *     taxa de câmbio de hoje — "null" só na falta genuína de taxas de
 *     câmbio para converter (o backend nunca falha o pedido inteiro só
 *     por isso). Nunca a moeda da PRÓPRIA CONTA (essa é sempre "moeda",
 *     acima) — é a moeda em que se compara/soma valores ENTRE contas.
 *   - vinculo é "null" numa conta sem VÍNCULO (uma conta manual, que
 *     nunca foi alimentada pelo banco ou já foi desvinculada). Quando
 *     presente, descreve a conta bancária que alimenta esta conta (ver o
 *     tipo Vinculo, acima).
 */
export type Conta = {
  id: string
  nome: string
  banco: string | null
  tipo: string | null
  moeda: string
  data_ancora: string
  saldo_ancora: string
  saldo: string
  saldo_convertido: string | null
  vinculo: Vinculo | null
  created_at: string
  updated_at: string
}

// --- Estado da autorização ---
//
// Uma conta VINCULADA recebe movimentos do banco graças a uma AUTORIZAÇÃO:
// o consentimento dado pelo utilizador ao banco, que dura o máximo que o
// banco aceita (até 180 dias pela regra europeia, 90 se o banco não o
// indicar). Passado o prazo, o banco deixa de responder e os movimentos
// param de entrar sem aviso nenhum — por isso a interface mostra, ANTES
// disso, que a autorização está prestes a expirar.

/** Os três estados possíveis da autorização que alimenta uma conta. */
export type EstadoAutorizacao = 'ativa' | 'a-expirar' | 'expirada'

/** Quantos dias antes do fim do prazo a autorização passa a "a-expirar". */
export const DIAS_AVISO_EXPIRACAO = 7

/**
 * O estado da autorização a partir do seu prazo ("valido_ate",
 * data e hora ISO). "agora" é um parâmetro (e não lido aqui dentro) para
 * os testes poderem fixar o momento — sem isso, o resultado dependeria do
 * dia em que os testes correm.
 */
export function estadoAutorizacao(validoAte: string, agora: Date = new Date()): EstadoAutorizacao {
  const fim = new Date(validoAte).getTime()
  if (fim <= agora.getTime()) return 'expirada'
  const msPorDia = 24 * 60 * 60 * 1000
  return fim - agora.getTime() <= DIAS_AVISO_EXPIRACAO * msPorDia ? 'a-expirar' : 'ativa'
}

/** Se uma conta recebe movimentos do banco: só uma conta VINCULADA (com
 *  vínculo e não suspensa). Uma conta suspensa mantém o vínculo, mas o
 *  banco já não responde por ela; uma conta manual não tem banco. */
export function contaSincroniza(conta: Conta): boolean {
  return conta.vinculo !== null && conta.vinculo.estado === 'vinculada'
}

// --- Avisos das autorizações ---
//
// A lista de contas avisa das AUTORIZAÇÕES que precisam de atenção, para o
// utilizador as renovar a tempo (um buraco nos movimentos é difícil de
// recuperar): as que já TERMINARAM (as contas ficaram suspensas) e as que
// terminam em 7 dias ou menos. Um aviso é por AUTORIZAÇÃO, não por conta:
// uma autorização pode alimentar várias contas, e renova-se uma vez.

/** O caso de um aviso: a autorização já terminou, ou está a terminar. */
export type CasoAviso = 'terminada' | 'a-expirar'

/** Um aviso: a autorização (id, banco e titular), o seu caso e a DATA
 *  (ISO) em que terminou ou vai terminar — não se escreve no cartão, mas
 *  diz-se a quem usa um leitor de ecrã («terminou a 2 set»). */
export type AvisoAutorizacao = {
  autorizacao_id: string
  banco: string
  titular: string | null
  caso: CasoAviso
  data: string
}

/**
 * O estado da AUTORIZAÇÃO de um vínculo, como a interface o mostra:
 *   - "terminada": o backend diz que terminou (autorizacao_terminada_em);
 *   - "a-expirar": ainda ativa, mas a 7 dias ou menos do fim do prazo — ou
 *     já depois dele, pelo relógio deste aparelho, sem o backend o ter
 *     visto ainda (a página aberta enquanto o prazo passa, ou um relógio
 *     adiantado): diz-se «A expirar», nunca «Ativa»;
 *   - "ativa": nos outros casos.
 * Depende só da autorização, e não do estado da conta: uma conta que o
 * banco deixou de partilhar pode ter a autorização ativa ou terminada.
 */
export function estadoDaAutorizacaoDoVinculo(
  vinculo: Vinculo,
  agora: Date = new Date(),
): 'ativa' | 'a-expirar' | 'terminada' {
  if (vinculo.autorizacao_terminada_em) return 'terminada'
  return estadoAutorizacao(vinculo.valido_ate, agora) === 'ativa' ? 'ativa' : 'a-expirar'
}

/**
 * Os avisos das autorizações, a partir das contas: um por autorização,
 * as terminadas primeiro (são as urgentes) e, dentro de cada caso, por
 * banco e titular. O caso sai do estado da AUTORIZAÇÃO (ver
 * estadoDaAutorizacaoDoVinculo), e não do da conta: uma conta suspensa só
 * porque o banco deixou de a partilhar, com a autorização ativa, não dá
 * aviso (renovar não resolveria nada; o ícone da conta já mostra que está
 * suspensa); mas se a autorização dela também terminou, avisa-se. "agora"
 * é um parâmetro para os testes poderem fixar o momento.
 */
export function avisosDasAutorizacoes(contas: Conta[], agora: Date = new Date()): AvisoAutorizacao[] {
  const porAutorizacao = new Map<string, AvisoAutorizacao>()
  for (const { vinculo } of contas) {
    if (!vinculo || porAutorizacao.has(vinculo.autorizacao_id)) continue
    const estado = estadoDaAutorizacaoDoVinculo(vinculo, agora)
    const caso: CasoAviso | null = estado === 'ativa' ? null : estado
    if (caso) {
      porAutorizacao.set(vinculo.autorizacao_id, {
        autorizacao_id: vinculo.autorizacao_id,
        banco: vinculo.banco,
        titular: vinculo.titular,
        caso,
        // Terminada: quando a autorização terminou; a expirar: o fim do prazo.
        data: caso === 'terminada' ? (vinculo.autorizacao_terminada_em ?? vinculo.valido_ate) : vinculo.valido_ate,
      })
    }
  }
  const ordemCaso: Record<CasoAviso, number> = { terminada: 0, 'a-expirar': 1 }
  return [...porAutorizacao.values()].sort(
    (a, b) =>
      ordemCaso[a.caso] - ordemCaso[b.caso] ||
      a.banco.localeCompare(b.banco, 'pt') ||
      (a.titular ?? '').localeCompare(b.titular ?? '', 'pt'),
  )
}

/**
 * Uma "impressão digital" do conjunto de avisos (que autorizações, e em
 * que caso), independente da ordem. Serve para lembrar se o utilizador
 * recolheu os avisos: se o conjunto MUDAR (entra uma autorização nova, ou
 * uma que expirava passa a terminada), os avisos voltam a abrir-se
 * sozinhos — o que mudou merece ser visto.
 */
export function assinaturaDosAvisos(avisos: AvisoAutorizacao[]): string {
  return avisos
    .map((aviso) => `${aviso.autorizacao_id}:${aviso.caso}`)
    .sort()
    .join('|')
}

// --- Valores na moeda principal ---
//
// Para comparar contas em moedas diferentes usa-se sempre
// "saldo_convertido" — o saldo na moeda principal definida pelo
// utilizador em Perfil › Preferências. Ordenar pelo "saldo" de cada
// conta misturaria unidades (640 dólares não são mais do que 600
// euros só porque 640 > 600).

/**
 * O valor de uma conta para ordenar por saldo: o saldo convertido para a
 * moeda principal, como número. "null" quando não há taxa de câmbio para
 * converter — quem ordena decide onde pôr essas contas (ver Contas.tsx).
 */
export function valorParaComparar(conta: Conta): number | null {
  return conta.saldo_convertido === null ? null : Number(conta.saldo_convertido)
}

/** Campos aceites ao criar uma conta (schema ContaCriar). */
export type ContaNova = {
  nome: string
  banco: string | null
  tipo: string | null
  moeda: string
  data_ancora: string
  saldo_ancora: string
}

/** Campos aceites ao editar uma conta (schema ContaEditar) — só os descritivos. */
export type ContaEdicao = {
  nome: string
  banco: string | null
  tipo: string | null
  moeda: string
}

export function listarContas(): Promise<Conta[]> {
  return pedido<Conta[]>('/contas')
}

export function obterConta(id: string): Promise<Conta> {
  return pedido<Conta>(`/contas/${id}`)
}

export function criarConta(dados: ContaNova): Promise<Conta> {
  return pedido<Conta>('/contas', { method: 'POST', body: JSON.stringify(dados) })
}

export function editarConta(id: string, dados: ContaEdicao): Promise<Conta> {
  return pedido<Conta>(`/contas/${id}`, { method: 'PATCH', body: JSON.stringify(dados) })
}

export function apagarConta(id: string): Promise<void> {
  return pedido<void>(`/contas/${id}`, { method: 'DELETE' })
}

// --- Opções para os seletores dos campos "banco" e "tipo" ---
//
// São campos ABERTOS: o utilizador pode sempre escrever um valor novo (o
// modo "procurar ou adicionar" do seletor — ver ListaDeOpcoes.tsx). A
// lista mostrada tem só os valores que o utilizador já usou nas suas
// contas — sem listas pré-feitas: uma lista de bancos prendia a app a um
// país, e uma de tipos influenciava a escolha (decisões de desenho).

/**
 * Junta "partida" com os valores de "jaUsados" (ignorando os vazios), sem
 * duplicados, por ordem alfabética. Os seletores de banco e tipo usam-na
 * duas vezes: primeiro com os valores já usados nas contas, e depois para
 * acrescentar o valor escolhido no momento (passado em "jaUsados"), se
 * ainda não estiver na lista.
 */
export function sugestoes(partida: string[], jaUsados: (string | null)[]): string[] {
  const conjunto = new Set(partida)
  for (const valor of jaUsados) {
    if (valor && valor.trim()) conjunto.add(valor.trim())
  }
  return [...conjunto].sort((a, b) => a.localeCompare(b, 'pt'))
}
