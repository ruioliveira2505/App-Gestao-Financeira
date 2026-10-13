/*
 * PÁGINA DE UMA CONTA — «VER CONTA» (/contas/:id)
 * ===============================================
 *
 * Uma página de LEITURA: mostra a conta e o seu estado, sem formulários.
 * Muda-se em Editar (o lápis da barra de topo); desvincular e eliminar
 * também vivem lá. De cima para baixo:
 *
 *   - BARRA DE TOPO: "‹" para voltar, o NOME da conta ao centro e o lápis
 *     (Editar) à direita — dois círculos do mesmo tamanho, para o nome ficar
 *     mesmo centrado.
 *   - CABEÇALHO: o monograma grande (o Avatar, a mesma cor e letra da linha
 *     da lista) e o SALDO por baixo, sem legenda visível (o «Saldo atual»
 *     fica só para leitores de ecrã: o número fala por si). Noutra moeda, o
 *     valor convertido em destaque e o original por baixo.
 *   - PAINEL DO BANCO (sem título; só numa conta com vínculo ao banco):
 *     a linha «Autorização», com um ponto de cor e o estado (Ativa, A
 *     expirar, Terminada), e a linha «Sincronização», com o estado e o "↻"
 *     para sincronizar agora.
 *   - DETALHES: banco, tipo, moeda, IBAN (com copiar), data e saldo
 *     iniciais. Banco e tipo aparecem sempre («Sem banco», «Sem tipo»).
 *   - RECONCILIAÇÕES: as três mais recentes (data, saldo e o acerto, na
 *     cor). Numa conta vinculada só existem as que se criaram ao vincular
 *     («Ao vincular»), e o painel só aparece se houver alguma.
 *
 * Os três painéis têm a mesma forma: um contorno fino, sem fundo, e em
 * cada linha o CAMPO (pequeno, cinzento) em cima e o VALOR por baixo.
 *
 * TEXTOS DE ESTADO, sempre «Estado · detalhe» (o mesmo padrão dos avisos
 * em baixo): a autorização diz só o estado; a sincronização diz também
 * quando — «Sincronizada · há 2 horas», «Sincronizada · agora», «Ainda não
 * sincronizada», «A sincronizar…», «Falhou · sem ligação», «Falhou · limite
 * do banco» e, numa conta suspensa, «Suspensa · desde 2 set» (sem "↻").
 *
 * POR AGORA (fatias seguintes): a linha «Autorização» só se lê (abrirá
 * Perfil › Autorizações, ainda por fazer); o painel das reconciliações só
 * se lê (o «+» e a lista completa chegam com a página Reconciliar); e uma
 * falha de sincronização só se vê na visita em que aconteceu (ao voltar,
 * mostra-se a última sincronização que correu bem).
 *
 * <PaginaDeslizante>: em mobile, entra a deslizar da direita e sai a
 * deslizar de volta para lá, ao estilo do "push"/"pop" do iOS (ver a nota
 * em PaginaDeslizante.tsx); em desktop não muda nada.
 *
 * Desenho decidido no canvas de design de Contas («3 · Ver conta»).
 */

import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'

import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'

import { useAuth } from '../auth/useAuth'
import { useConta, useReconciliacoes } from '../hooks/useContas'
import { CHAVES } from '../lib/consultas'
import { Avatar } from '../componentes/Avatar'
import { ApenasLeitor } from '../componentes/ApenasLeitor'
import { AvisoEmBaixo, type Aviso, type TipoAviso } from '../componentes/AvisoEmBaixo'
import { EstadoMensagem } from '../componentes/EstadoMensagem'
import { Botao } from '../componentes/Botao'
import { CabecalhoPagina } from '../componentes/CabecalhoPagina'
import { IconeCopiar, IconeLapis, IconeLupa, IconeSemLigacao, IconeSincronizar } from '../componentes/icones'
import { LinkBotao } from '../componentes/LinkBotao'
import { LinkVoltar } from '../componentes/LinkVoltar'
import { PaginaDeslizante } from '../componentes/PaginaDeslizante'
import { estadoDaAutorizacaoDoVinculo, type Conta, type Vinculo } from '../lib/contas'
import { diaCurto, formatarData, mesmoDia, tempoDecorrido } from '../lib/datas'
import { escutarAvisos } from '../lib/avisoPendente'
import { ErroApi } from '../lib/http'
import { etiquetaMoeda, formatarDinheiro } from '../lib/moedas'
import { sincronizar } from '../lib/openBanking'
import type { Reconciliacao } from '../lib/reconciliacoes'
import estilos from './ContaDetalhe.module.css'

// Quantas reconciliações se mostram no painel (as mais recentes).
const RECONCILIACOES_VISIVEIS = 3

/** Esqueleto mostrado enquanto a conta carrega: a forma da página (o
 *  círculo do monograma, a barra do saldo e um painel com quatro linhas),
 *  em barras cinzentas que pulsam devagar. */
function Esqueleto() {
  return (
    <div role="status" aria-label="A carregar a conta">
      <div className={estilos.heroi}>
        <span className={`${estilos.esq} ${estilos.esqAvatar}`} />
        <span className={`${estilos.esq} ${estilos.esqSaldo}`} />
      </div>
      <div className={estilos.painel}>
        {[0, 1, 2, 3].map((indice) => (
          <div key={indice} className={`${estilos.linha} ${estilos.linhaEsqueleto}`}>
            <span className={`${estilos.esq} ${estilos.esqCampo}`} />
            <span className={`${estilos.esq} ${estilos.esqValor}`} />
          </div>
        ))}
      </div>
    </div>
  )
}

// --- O estado da autorização e da sincronização ---

/** As três cores de estado: as das caixas de aviso da app (verde, âmbar,
 *  vermelho) e o cinzento neutro (sem estado a assinalar). */
type Tom = 'ok' | 'aviso' | 'negativo' | 'neutro'

/** O estado da AUTORIZAÇÃO, como se diz na linha: só o estado, sem
 *  detalhe (as datas estão no Perfil, onde se renova). Sai só da
 *  autorização (ver estadoDaAutorizacaoDoVinculo, em lib/contas.ts), e não
 *  do estado da conta: uma conta suspensa porque o banco deixou de a
 *  partilhar pode ter a autorização ativa, ou já terminada. */
function linhaAutorizacao(vinculo: Vinculo): { texto: string; tom: Tom } {
  const estado = estadoDaAutorizacaoDoVinculo(vinculo)
  if (estado === 'terminada') return { texto: 'Terminada', tom: 'negativo' }
  if (estado === 'a-expirar') return { texto: 'A expirar', tom: 'aviso' }
  return { texto: 'Ativa', tom: 'ok' }
}

/** Uma falha de sincronização nesta visita: sem ligação (o banco não
 *  respondeu; pode tentar-se outra vez), o limite de acessos do banco (só
 *  amanhã), ou um conflito (409: outra operação na conta, ou a autorização
 *  terminou no banco — nesse caso, a conta passa a suspensa e é isso que a
 *  linha mostra, ao voltar a pedir a conta). */
type Falha = 'sem-ligacao' | 'limite' | 'conflito'

/** O estado da SINCRONIZAÇÃO, como se diz na linha: «Estado · detalhe». */
function linhaSincronizacao(
  vinculo: Vinculo,
  aSincronizar: boolean,
  falha: Falha | null,
): { texto: string; tom: Tom } {
  if (vinculo.estado === 'suspensa') {
    const desde = vinculo.suspensa_desde ? ` · desde ${diaCurto(vinculo.suspensa_desde)}` : ''
    return { texto: `Suspensa${desde}`, tom: 'neutro' }
  }
  if (aSincronizar) return { texto: 'A sincronizar…', tom: 'neutro' }
  if (falha === 'sem-ligacao') return { texto: 'Falhou · sem ligação', tom: 'negativo' }
  if (falha === 'limite') return { texto: 'Falhou · limite do banco', tom: 'aviso' }
  if (falha === 'conflito') return { texto: 'Falhou · tenta mais tarde', tom: 'negativo' }
  if (!vinculo.sincronizado_em) return { texto: 'Ainda não sincronizada', tom: 'neutro' }
  const quando = tempoDecorrido(vinculo.sincronizado_em)
  return { texto: quando ? `Sincronizada · ${quando}` : 'Sincronizada', tom: 'ok' }
}

/** O ponto de cor de uma linha de estado. Decorativo: o estado diz-se
 *  sempre em texto, ao lado, nunca só pela cor. */
function Ponto({ tom }: { tom: Tom }) {
  return <span className={`${estilos.ponto} ${estilos[`ponto_${tom}`]}`} aria-hidden="true" />
}

/** "PT50000201231234567890154" → "PT50 0002 0123 1234 5678 9015 4": em
 *  grupos de quatro, como no extrato do banco — lê-se e confere-se melhor. */
function ibanEmGrupos(iban: string): string {
  return iban.replace(/\s+/g, '').replace(/(.{4})/g, '$1 ').trim()
}

/** Uma linha do painel das reconciliações: a data à esquerda («Ao
 *  vincular» por baixo, nas criadas ao vincular a conta), e à direita o
 *  saldo afirmado com o acerto por baixo, na cor do sinal (verde se
 *  positivo, vermelho se negativo, cinzento se passou a zero). */
function LinhaReconciliacao({ reconciliacao, moeda }: { reconciliacao: Reconciliacao; moeda: string }) {
  const acerto = Number(reconciliacao.acerto)
  const tom = acerto > 0 ? estilos.acertoPositivo : acerto < 0 ? estilos.acertoNegativo : estilos.acertoZero
  const acertoTexto = `${acerto > 0 ? '+' : ''}${formatarDinheiro(reconciliacao.acerto, moeda)}`
  return (
    <div className={estilos.reconciliacao}>
      <span className={estilos.reconciliacaoEsquerda}>
        <span>{formatarData(reconciliacao.data)}</span>
        {reconciliacao.origem === 'banco' && <span className={estilos.reconciliacaoNota}>Ao vincular</span>}
      </span>
      <span className={estilos.reconciliacaoDireita}>
        <span className={estilos.reconciliacaoSaldo}>{formatarDinheiro(reconciliacao.saldo, moeda)}</span>
        <span className={`${estilos.reconciliacaoAcerto} ${tom}`}>
          {acerto === 0 ? <ApenasLeitor>Sem acerto: </ApenasLeitor> : null}
          {acertoTexto}
        </span>
      </span>
    </div>
  )
}

export function ContaDetalhe() {
  const { id } = useParams<{ id: string }>()
  const { utilizador } = useAuth()
  const localizacao = useLocation()
  const navegar = useNavigate()
  const clienteConsultas = useQueryClient()

  // A conta vem da cache partilhada (useConta, em hooks/useContas.ts):
  // quando Editar guarda, ou se sincroniza, a chave ['contas'] é
  // invalidada e esta página redesenha-se sozinha com os dados novos.
  const consultaConta = useConta(id)
  const conta: Conta | null = consultaConta.data ?? null
  const consultaReconciliacoes = useReconciliacoes(id)
  // A carregar outra vez depois de um erro ("Tentar outra vez"): mostra o
  // esqueleto em vez da mensagem.
  const erroConta = conta === null && consultaConta.error && !consultaConta.isFetching ? consultaConta.error : null
  const naoExiste = erroConta instanceof ErroApi && erroConta.estado === 404

  // --- O aviso em baixo (ver AvisoEmBaixo) ---
  // Pode chegar no "state" da navegação, vindo de outra página («Conta
  // criada», «Alterações guardadas»): lê-se uma vez, ao montar, e limpa-se
  // do histórico, para não voltar a aparecer ao recarregar a página.
  const [aviso, setAviso] = useState<Aviso | null>(() => {
    const chegada = (localizacao.state as { aviso?: string } | null)?.aviso
    return chegada ? { texto: chegada, tipo: 'ok', chave: 1 } : null
  })
  const avisoDeChegada = (localizacao.state as { aviso?: string } | null)?.aviso
  useEffect(() => {
    if (avisoDeChegada) navegar(localizacao.pathname, { replace: true, state: null })
  }, [avisoDeChegada, localizacao.pathname, navegar])
  // Estável entre desenhos: o aviso recomeça a contar sempre que esta
  // função muda.
  const fecharAviso = useCallback(() => setAviso(null), [])
  function avisar(texto: string, tipo: TipoAviso) {
    setAviso((anterior) => ({ texto, tipo, chave: (anterior?.chave ?? 0) + 1 }))
  }
  // O aviso que Editar entrega ao guardar («Alterações guardadas»): esta
  // página fica montada por baixo da folha de Editar e escuta os avisos da
  // sua conta (ver lib/avisoPendente.ts — um recuo no histórico não leva
  // "state" de navegação).
  useEffect(() => {
    if (!id) return
    return escutarAvisos(id, (texto) =>
      setAviso((anterior) => ({ texto, tipo: 'ok', chave: (anterior?.chave ?? 0) + 1 })),
    )
  }, [id])

  // --- Sincronizar (o "↻" do painel do banco) ---
  const [aSincronizar, setASincronizar] = useState(false)
  const [falha, setFalha] = useState<Falha | null>(null)
  // A falha a mostrar: a desta visita ou, se não houver, a que o backend
  // guardou (a última falha por causa do banco, se for mais recente do que
  // a última sincronização boa) — assim «Falhou · …» continua ao reabrir.
  const vinculoAtual = conta?.vinculo ?? null
  const falhaGuardada: Falha | null = vinculoAtual?.falha_motivo ?? null
  const falhaVisivel: Falha | null = falha ?? falhaGuardada
  // O limite de acessos do banco volta a zero no dia seguinte: o ↻ só fica
  // desativado se o limite foi atingido HOJE (nesta visita, ou guardado com
  // a data de hoje).
  const bloqueadoPeloLimite =
    falha === 'limite' ||
    (falha === null && falhaGuardada === 'limite' && !!vinculoAtual?.falha_em && mesmoDia(vinculoAtual.falha_em))

  async function aoSincronizar() {
    if (!conta?.vinculo || aSincronizar || bloqueadoPeloLimite) return
    setASincronizar(true)
    setFalha(null)
    try {
      const resultado = await sincronizar(conta.vinculo.conta_bancaria_id)
      // O saldo, a última sincronização e as reconciliações mudaram:
      // invalida as contas (esta e a lista, por baixo). O "await" espera
      // pelos dados novos antes do aviso.
      await clienteConsultas.invalidateQueries({ queryKey: CHAVES.contas })
      const n = resultado.movimentos_importados
      avisar(
        n === 0
          ? 'Atualizado · sem movimentos novos'
          : n === 1
            ? 'Atualizado · 1 movimento novo'
            : `Atualizado · ${n} movimentos novos`,
        'ok',
      )
    } catch (erro) {
      // O limite de acessos do banco responde 429: tentar outra vez hoje
      // já não adianta, por isso o "↻" fica desativado.
      const estadoHttp = erro instanceof ErroApi ? erro.estado : null
      const motivo: Falha = estadoHttp === 429 ? 'limite' : estadoHttp === 409 ? 'conflito' : 'sem-ligacao'
      setFalha(motivo)
      avisar(
        motivo === 'limite'
          ? 'Não atualizado · limite do banco'
          : motivo === 'conflito'
            ? 'Não atualizado · tenta mais tarde'
            : 'Não atualizado · sem ligação',
        'alerta',
      )
      // Uma autorização que o banco deu por terminada (409) muda o estado
      // da conta (passa a suspensa): volta a pedir a conta.
      void clienteConsultas.invalidateQueries({ queryKey: CHAVES.contas })
    } finally {
      setASincronizar(false)
    }
  }

  async function copiarIban(iban: string) {
    try {
      await navigator.clipboard.writeText(iban)
      avisar('IBAN copiado', 'ok')
    } catch {
      avisar('Não foi possível copiar o IBAN', 'alerta')
    }
  }

  const moedaPrincipal = utilizador?.moeda_principal ?? 'EUR'
  // A conversão só se mostra quando há algo a converter (outra moeda, e
  // taxa de câmbio disponível) — a mesma regra da lista de contas.
  const mostraConversao = conta !== null && conta.moeda !== moedaPrincipal && conta.saldo_convertido !== null
  const reconciliacoes = consultaReconciliacoes.data ?? []
  // As reconciliações falharam ao carregar (e não há dados anteriores).
  const erroReconciliacoes = !consultaReconciliacoes.data && consultaReconciliacoes.isError
  // As mais recentes primeiro (a API devolve-as por ordem de data).
  const recentes = [...reconciliacoes].reverse().slice(0, RECONCILIACOES_VISIVEIS)

  return (
    <>
      <PaginaDeslizante>
        {(aoRecuar) => (
          <div>
            <LinkVoltar para="/contas">Contas</LinkVoltar>

            {/* Montado sempre — mesmo a carregar ou em erro — para o "‹" da
                barra estar lá desde o início. O nome e o lápis só entram
                quando a conta chega. */}
            <CabecalhoPagina
              titulo={conta?.nome ?? ''}
              voltar="/contas"
              aoRecuar={aoRecuar}
              acao={
                conta ? (
                  <Link
                    to={`/contas/${conta.id}/editar`}
                    // Diz à folha de editar se ESTA página tem uma página da
                    // app atrás de si no histórico (ver "eliminar", em
                    // ContaEditar.tsx) — só assim pode recuar duas de uma vez.
                    state={{ detalheVeioDeDentro: localizacao.key !== 'default' }}
                    className={estilos.acaoIcone}
                    aria-label="Editar conta"
                  >
                    <IconeLapis tamanho={20} />
                  </Link>
                ) : undefined
              }
            />

            {naoExiste ? (
              <EstadoMensagem
                icone={<IconeLupa tamanho={26} />}
                titulo="Esta conta já não existe"
                texto="Pode ter sido eliminada noutro dispositivo."
                papel="alert"
                acoes={<LinkBotao para="/contas">Voltar a Contas</LinkBotao>}
              />
            ) : erroConta ? (
              <EstadoMensagem
                icone={<IconeSemLigacao tamanho={26} />}
                titulo="Não foi possível carregar a conta"
                texto="Verifica a ligação à internet e tenta outra vez."
                papel="alert"
                acoes={<Botao onClick={() => void consultaConta.refetch()}>Tentar outra vez</Botao>}
              />
            ) : !conta ? (
              <Esqueleto />
            ) : (
              <>
                {/* Cabeçalho: o monograma e o saldo, sem legenda visível. */}
                <div className={estilos.heroi}>
                  <Avatar nome={conta.banco || conta.nome} tamanho="xl" />
                  <ApenasLeitor>Saldo atual</ApenasLeitor>
                  <span className={Number(conta.saldo) < 0 ? `${estilos.saldo} ${estilos.negativo}` : estilos.saldo}>
                    {mostraConversao
                      ? formatarDinheiro(conta.saldo_convertido as string, moedaPrincipal)
                      : formatarDinheiro(conta.saldo, conta.moeda)}
                  </span>
                  {mostraConversao && (
                    <span className={estilos.saldoOriginal}>{formatarDinheiro(conta.saldo, conta.moeda)}</span>
                  )}
                </div>

                {/* Painel do banco: só numa conta com vínculo. Sem título —
                    as duas linhas dizem o que são. */}
                {conta.vinculo && (
                  <PainelBanco
                    vinculo={conta.vinculo}
                    aSincronizar={aSincronizar}
                    falha={falhaVisivel}
                    bloqueadoPeloLimite={bloqueadoPeloLimite}
                    aoSincronizar={aoSincronizar}
                  />
                )}

                <section className={estilos.seccao} aria-labelledby="titulo-detalhes">
                  <h2 id="titulo-detalhes" className={estilos.titulo}>
                    Detalhes
                  </h2>
                  <div className={estilos.painel}>
                    <div className={estilos.linha}>
                      <span className={estilos.textos}>
                        <span className={estilos.campo}>Banco</span>
                        <span className={conta.banco ? estilos.valor : `${estilos.valor} ${estilos.vazio}`} title={conta.banco ?? undefined}>
                          {conta.banco || 'Sem banco'}
                        </span>
                      </span>
                    </div>
                    <div className={estilos.linha}>
                      <span className={estilos.textos}>
                        <span className={estilos.campo}>Tipo de conta</span>
                        <span className={conta.tipo ? estilos.valor : `${estilos.valor} ${estilos.vazio}`}>
                          {conta.tipo || 'Sem tipo'}
                        </span>
                      </span>
                    </div>
                    <div className={estilos.linha}>
                      <span className={estilos.textos}>
                        <span className={estilos.campo}>Moeda</span>
                        <span className={estilos.valor}>{etiquetaMoeda(conta.moeda)}</span>
                      </span>
                    </div>
                    {conta.vinculo?.iban && (
                      <div className={estilos.linha}>
                        <span className={estilos.textos}>
                          <span className={estilos.campo}>IBAN</span>
                          {/* O IBAN pode passar para uma segunda linha num ecrã
                              estreito: cortado, deixava de se poder conferir. */}
                          <span className={`${estilos.valor} ${estilos.valorQuebra}`}>
                            {ibanEmGrupos(conta.vinculo.iban)}
                          </span>
                        </span>
                        <button
                          type="button"
                          className={estilos.icone}
                          aria-label="Copiar IBAN"
                          onClick={() => void copiarIban((conta.vinculo as Vinculo).iban as string)}
                        >
                          <IconeCopiar tamanho={17} />
                        </button>
                      </div>
                    )}
                    <div className={estilos.linha}>
                      <span className={estilos.textos}>
                        <span className={estilos.campo}>Data inicial</span>
                        <span className={estilos.valor}>{formatarData(conta.data_ancora)}</span>
                      </span>
                    </div>
                    <div className={estilos.linha}>
                      <span className={estilos.textos}>
                        <span className={estilos.campo}>Saldo inicial</span>
                        <span className={estilos.valor}>{formatarDinheiro(conta.saldo_ancora, conta.moeda)}</span>
                      </span>
                    </div>
                  </div>
                </section>

                {/* Reconciliações: numa conta manual, sempre (mesmo sem
                    nenhuma); numa vinculada, só se houver (vêm do banco). */}
                {(reconciliacoes.length > 0 || !conta.vinculo || erroReconciliacoes) && (
                  <section className={estilos.seccao} aria-labelledby="titulo-reconciliacoes">
                    <h2 id="titulo-reconciliacoes" className={estilos.titulo}>
                      Reconciliações
                    </h2>
                    <div className={estilos.painel}>
                      {erroReconciliacoes ? (
                        // Sem dados por um erro: não se diz «Ainda sem
                        // reconciliações», que seria falso.
                        <p className={`${estilos.linha} ${estilos.textoErro}`}>
                          Não foi possível carregar as reconciliações
                        </p>
                      ) : recentes.length === 0 ? (
                        <p className={`${estilos.linha} ${estilos.vazio}`}>Ainda sem reconciliações</p>
                      ) : (
                        recentes.map((reconciliacao) => (
                          <LinhaReconciliacao key={reconciliacao.id} reconciliacao={reconciliacao} moeda={conta.moeda} />
                        ))
                      )}
                    </div>
                  </section>
                )}
              </>
            )}
          </div>
        )}
      </PaginaDeslizante>

      {/* Sempre montado: é a região que os leitores de ecrã escutam. */}
      <AvisoEmBaixo aviso={aviso} aoFechar={fecharAviso} />
    </>
  )
}

/** O painel do banco: «Autorização» e «Sincronização» (com o "↻"). */
function PainelBanco({
  vinculo,
  aSincronizar,
  falha,
  bloqueadoPeloLimite,
  aoSincronizar,
}: {
  vinculo: Vinculo
  aSincronizar: boolean
  falha: Falha | null
  // O limite de acessos do banco ainda vale (foi hoje): o ↻ fica desativado.
  bloqueadoPeloLimite: boolean
  aoSincronizar: () => void
}) {
  const autorizacao = linhaAutorizacao(vinculo)
  const sincronizacao = linhaSincronizacao(vinculo, aSincronizar, falha)
  // O "↻" só existe numa conta vinculada (uma suspensa não sincroniza), e
  // fica desativado com o limite do banco (só amanhã).
  const podeSincronizar = vinculo.estado === 'vinculada'
  const limite = bloqueadoPeloLimite
  return (
    <section className={`${estilos.seccao} ${estilos.seccaoBanco}`} aria-label="Banco">
      <div className={estilos.painel}>
        <div className={estilos.linha}>
          <span className={estilos.textos}>
            <span className={estilos.campo}>Autorização</span>
            <span className={`${estilos.valor} ${estilos.valorComPonto}`}>
              <Ponto tom={autorizacao.tom} />
              <span className={estilos.valorTexto}>{autorizacao.texto}</span>
            </span>
          </span>
        </div>
        {/* Sem role="status": o resultado de sincronizar já é anunciado pelo
            aviso em baixo, e «há 2 horas» a passar a «há 3 horas» não deve
            ser lido sem ninguém ter feito nada. */}
        <div className={estilos.linha}>
          <span className={estilos.textos}>
            <span className={estilos.campo}>Sincronização</span>
            <span className={`${estilos.valor} ${estilos.valorComPonto} ${estilos[`texto_${sincronizacao.tom}`]}`}>
              <Ponto tom={sincronizacao.tom} />
              <span className={estilos.valorTexto}>{sincronizacao.texto}</span>
            </span>
          </span>
          {podeSincronizar && (
            <button
              type="button"
              className={estilos.icone}
              aria-label={falha && falha !== 'limite' ? 'Tentar sincronizar outra vez' : 'Sincronizar agora'}
              aria-busy={aSincronizar}
              aria-disabled={limite || undefined}
              onClick={aoSincronizar}
            >
              {aSincronizar ? <span className={estilos.roda} aria-hidden="true" /> : <IconeSincronizar tamanho={19} />}
            </button>
          )}
        </div>
      </div>
    </section>
  )
}
