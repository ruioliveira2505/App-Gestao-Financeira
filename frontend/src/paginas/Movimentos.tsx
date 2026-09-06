/*
 * PÁGINA MOVIMENTOS
 * =================
 *
 * A lista GLOBAL de movimentos — todas as contas do utilizador juntas,
 * não uma por conta (o backend já suporta filtrar por conta, mas essa UI
 * ainda não existe; fica para quando ligarmos "ver movimentos desta
 * conta" a partir do detalhe de uma conta). "Movimentos" é uma secção de
 * topo da aplicação, ao lado de "Contas" — não algo pendurado dentro de
 * uma conta.
 *
 * NÃO É UMA LISTA DE GESTÃO, É UM EXTRATO: ao contrário de Contas — onde
 * ordenar por saldo ou agrupar por tipo/banco são formas válidas de olhar
 * para um conjunto pequeno de linhas —, aqui o que dá sentido à página é
 * UMA ÚNICA LINHA DO TEMPO, contínua, do mais recente para o mais antigo.
 * Por isso não há "⋯" nenhum: a vista é fixa — sempre agrupada por dia,
 * sempre por data descendente. "Ordenar por valor" destruiria a sequência
 * que é o único propósito da página; "agrupar por conta" partiria essa
 * mesma linha do tempo em pedaços, e entra em contradição com o scroll
 * contínuo por data que esta página persegue (uma fatia futura: carregar
 * o histórico aos poucos, por janelas de tempo, à medida que se desce).
 *
 * Estrutura: na barra de topo, o botão de FILTROS (funil) e o "+" (novo
 * movimento) — não há "⋯" de ordenar/agrupar, a ordem é fixa. No
 * conteúdo: o título com a contagem por baixo, um campo de PROCURA (por
 * descrição ou pelo nome da conta), e a lista, agrupada por dia, sem
 * cartão, linhas separadas por um traço fino. Tocar numa linha abre-a
 * directamente para EDITAR (folha, de baixo para cima) — ao contrário de
 * Contas, não há aqui uma página de detalhe intermédia: um movimento tem
 * poucos campos, todos já visíveis na própria linha, e nada mais para
 * "detalhar".
 *
 * FILTROS (contas, tipo, datas): vivem no URL (ver
 * src/lib/filtrosMovimentos.ts), aplicam-se no cliente por agora, e toda a
 * interface deles é a folha do FiltroMovimentos. A página em si NÃO os
 * mostra — só um pontinho no funil avisa que há um subconjunto à vista.
 * Não se põe aqui uma contagem de resultados: mudaria a cada tecla e
 * fazia a barra de procura "saltar"; o caso sem resultados já tem a sua
 * própria mensagem. (Categorias: quando a fatia existir. Valor: precisa de
 * uma moeda base — as contas podem estar em moedas diferentes.)
 *
 * Cada linha mostra, à esquerda, um SÍMBOLO NEUTRO — uma seta na diagonal
 * em círculo cinzento, para cima-direita numa entrada e para baixo-esquerda
 * numa saída. É provisório: substitui o avatar da conta enquanto não há
 * categorização (ver a nota em app/models/movimento.py, no backend); quando
 * essa fatia chegar, passa a ícone/cor da categoria, sem mexer no resto da
 * linha.
 *
 * Por baixo do valor de cada movimento, o SALDO DA CONTA logo a seguir a
 * esse movimento (calculado no cliente — ver calcularSaldosApos, mais
 * abaixo) — o "saldo remanescente" de um livro de cheques.
 *
 * Estados: a carregar (esqueleto), erro, sem contas nenhumas (pede para
 * criar uma primeiro — sem conta não há onde lançar um movimento), sem
 * movimentos (estado vazio), sem resultados (de pesquisa OU de filtros —
 * mensagens diferentes), e a lista.
 */

import { useEffect, useState } from 'react'

import { Link, useLocation, useSearchParams } from 'react-router-dom'

import { CabecalhoPagina } from '../componentes/CabecalhoPagina'
import { CampoPesquisa } from '../componentes/CampoPesquisa'
import { FiltroMovimentos } from '../componentes/FiltroMovimentos'
import { IconeMais, IconeSetaDiagonal } from '../componentes/icones'
import { LinkBotao } from '../componentes/LinkBotao'
import { listarContas, type Conta } from '../lib/contas'
import { rotuloDiaRelativo } from '../lib/datas'
import {
  aplicarFiltros,
  escreverFiltros,
  FILTROS_VAZIOS,
  lerFiltros,
  type Filtros,
} from '../lib/filtrosMovimentos'
import { ErroApi } from '../lib/http'
import { formatarDinheiro } from '../lib/moedas'
import { listarMovimentos, type Movimento } from '../lib/movimentos'
import estilos from './Movimentos.module.css'

type Estado =
  | { fase: 'a-carregar' }
  | { fase: 'erro'; mensagem: string }
  | { fase: 'pronto'; movimentos: Movimento[]; contas: Conta[] }

/** Ordena os movimentos por data descendente — a única ordem que esta
 *  página usa. A desempatar (vários movimentos no mesmo dia), created_at
 *  descendente — o mesmo desempate que a API já usa em GET /movimentos. */
function ordenarPorData(movimentos: Movimento[]): Movimento[] {
  return [...movimentos].sort(
    (a, b) => b.data.localeCompare(a.data) || b.created_at.localeCompare(a.created_at),
  )
}

/** Reparte os movimentos (já ordenados por ordenarPorData) em grupos por
 *  dia, cada um com o rótulo pronto a mostrar ("Hoje · 6 set" / "Sex · 4
 *  set" / …). As chaves (texto ISO, "2026-02-01") ordenam-se corretamente
 *  como texto — descendente, para acompanhar a ordem dos movimentos
 *  dentro de cada grupo. */
function agruparPorDia(movimentosOrdenados: Movimento[]): [string, Movimento[]][] {
  const grupos = new Map<string, Movimento[]>()
  for (const movimento of movimentosOrdenados) {
    const lista = grupos.get(movimento.data) ?? []
    lista.push(movimento)
    grupos.set(movimento.data, lista)
  }
  return [...grupos.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([iso, lista]) => [rotuloDiaRelativo(iso), lista])
}

/** Tira acentos e passa a minúsculas — para a pesquisa ignorar maiúsculas
 *  e acentos, tal como em Contas. */
function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

/** Um movimento corresponde à pesquisa se o texto aparecer na descrição ou
 *  no nome da conta a que pertence. */
function corresponde(movimento: Movimento, conta: Conta | undefined, pesquisa: string): boolean {
  const alvo = normalizar([movimento.descricao, conta?.nome].filter(Boolean).join(' '))
  return alvo.includes(normalizar(pesquisa))
}

/**
 * Para cada movimento, o saldo da SUA CONTA logo a seguir a esse
 * movimento — calculado aqui, no cliente, não devolvido pela API: para
 * cada conta, percorre os seus movimentos por ordem cronológica (mais
 * antigo primeiro), a partir do saldo de âncora, somando o valor de cada
 * um.
 *
 * É um valor só de APRESENTAÇÃO — o valor de referência do saldo de uma
 * conta é sempre o "saldo" que a própria API devolve para essa conta
 * (calculado em Decimal, no servidor). Por ser só uma etiqueta sob cada
 * linha, e arredondada a 2 casas em cada formatação, somar em Number()
 * aqui não arrisca o que arriscaria fazer o mesmo do lado do servidor —
 * ver a decisão "Valores monetários — Decimal na base, texto na API".
 */
function calcularSaldosApos(movimentos: Movimento[], contas: Conta[]): Map<string, number> {
  const porConta = new Map<string, Movimento[]>()
  for (const movimento of movimentos) {
    const lista = porConta.get(movimento.conta_id) ?? []
    lista.push(movimento)
    porConta.set(movimento.conta_id, lista)
  }

  const resultado = new Map<string, number>()
  for (const conta of contas) {
    const doMesmaConta = porConta.get(conta.id) ?? []
    // Do mais antigo para o mais recente — o mesmo desempate da API, ao
    // contrário.
    const cronologicos = [...doMesmaConta].sort(
      (a, b) => a.data.localeCompare(b.data) || a.created_at.localeCompare(b.created_at),
    )
    let acumulado = Number(conta.saldo_ancora)
    for (const movimento of cronologicos) {
      acumulado += Number(movimento.valor)
      resultado.set(movimento.id, acumulado)
    }
  }
  return resultado
}

/** Esqueleto mostrado enquanto os movimentos carregam — a mesma forma do
 *  de Contas (círculo + barra), a pulsar devagar. */
function Esqueleto() {
  return (
    <div className={estilos.lista} role="status" aria-label="A carregar movimentos">
      {[0, 1, 2].map((indice) => (
        <div key={indice} className={estilos.linha}>
          <span className={`${estilos.esqueleto} ${estilos.esqueletoSimbolo}`} />
          <span className={`${estilos.esqueleto} ${estilos.esqueletoTexto}`} />
        </div>
      ))}
    </div>
  )
}

/** Uma linha da lista: um símbolo à esquerda — uma seta na diagonal em
 *  círculo cinzento, a apontar para cima-direita numa entrada e para
 *  baixo-esquerda numa saída —, a descrição (a negrito, âncora da linha)
 *  com o nome da conta por baixo, e à direita o valor (a cores: verde
 *  entrada, vermelho saída) com o saldo remanescente da conta por baixo.
 *  Tocar leva direto à folha de editar — sem chevron, a linha inteira é
 *  tocável, tal como em Contas.
 *
 *  O símbolo é neutro e provisório: substitui o avatar da conta enquanto
 *  não há categorias (quando essa fatia existir, passa a ícone/cor da
 *  categoria). A direção da seta dá uma leitura de relance de entrada/saída
 *  sem depender só da cor do valor. */
function LinhaMovimento({
  movimento,
  conta,
  saldoApos,
}: {
  movimento: Movimento
  conta: Conta | undefined
  saldoApos: number | undefined
}) {
  const entrada = Number(movimento.valor) >= 0

  return (
    <Link to={`/movimentos/${movimento.id}/editar`} className={estilos.linha}>
      <span
        className={entrada ? estilos.simbolo : `${estilos.simbolo} ${estilos.simboloSaida}`}
        aria-hidden="true"
      >
        <IconeSetaDiagonal tamanho={18} />
      </span>
      <span className={estilos.linhaTexto}>
        <span className={estilos.linhaDescricao}>{movimento.descricao}</span>
        <span className={estilos.linhaConta}>{conta?.nome ?? 'Conta eliminada'}</span>
      </span>
      <span className={estilos.linhaValores}>
        <span
          className={
            entrada
              ? `${estilos.linhaValor} ${estilos.positivo}`
              : `${estilos.linhaValor} ${estilos.negativo}`
          }
        >
          {formatarDinheiro(movimento.valor, conta?.moeda ?? 'EUR')}
        </span>
        {conta && saldoApos !== undefined && (
          <span className={estilos.linhaSaldoApos}>
            {formatarDinheiro(saldoApos.toFixed(2), conta.moeda)}
          </span>
        )}
      </span>
    </Link>
  )
}

export function Movimentos() {
  // location.key muda a cada navegação — incluindo um "voltar" para um
  // sítio já visitado (ex.: ao fechar a folha "Novo movimento", que
  // regressa aqui por navigate(-1)). Sem isto, o efeito de carregamento
  // só corria uma vez, na primeira montagem: criar um movimento e voltar
  // à lista mostrava sempre os dados antigos, até se dar refresh à mão.
  const localizacao = useLocation()

  const [estado, setEstado] = useState<Estado>({ fase: 'a-carregar' })
  const [pesquisa, setPesquisa] = useState('')

  // Os filtros vivem no URL (?tipo=…&contas=…&de=…&ate=…) — sobrevivem a
  // ir editar um movimento e voltar. "replace: true" para cada ajuste de
  // filtro não empilhar uma entrada no histórico.
  const [parametros, setParametros] = useSearchParams()
  const filtros = lerFiltros(parametros)
  function aoMudarFiltros(novos: Filtros) {
    setParametros(escreverFiltros(novos), { replace: true })
  }

  useEffect(() => {
    let activo = true
    // Sem repor "a-carregar" aqui: ao voltar a esta rota, a lista antiga
    // fica visível (sem esqueleto a piscar) até a nova chegar e a
    // substituir — só a primeira vez (estado ainda "a-carregar", vindo do
    // useState acima) é que se vê o esqueleto.
    Promise.all([listarMovimentos(), listarContas()])
      .then(([movimentos, contas]) => {
        if (activo) setEstado({ fase: 'pronto', movimentos, contas })
      })
      .catch((erro) => {
        if (!activo) return
        const mensagem =
          erro instanceof ErroApi ? erro.message : 'Não foi possível carregar os movimentos.'
        setEstado({ fase: 'erro', mensagem })
      })
    return () => {
      activo = false
    }
  }, [localizacao.key])

  const temMovimentos = estado.fase === 'pronto' && estado.movimentos.length > 0
  const temContas = estado.fase === 'pronto' && estado.contas.length > 0
  const contas = estado.fase === 'pronto' ? estado.contas : []

  const contaPorId = new Map(contas.map((conta) => [conta.id, conta]))
  const saldosApos =
    estado.fase === 'pronto' ? calcularSaldosApos(estado.movimentos, estado.contas) : new Map()

  // Aplicar filtros → filtrar pela pesquisa → ordenar por data → agrupar.
  const resultados =
    estado.fase === 'pronto'
      ? aplicarFiltros(estado.movimentos, filtros).filter((movimento) =>
          corresponde(movimento, contaPorId.get(movimento.conta_id), pesquisa),
        )
      : []
  const grupos = agruparPorDia(ordenarPorData(resultados))

  return (
    <div>
      <CabecalhoPagina
        titulo="Movimentos"
        acao={
          temMovimentos ? (
            <>
              <FiltroMovimentos filtros={filtros} aoMudar={aoMudarFiltros} contas={contas} />
              <LinkBotao para="/movimentos/novo" apenasIcone titulo="Novo movimento">
                <IconeMais tamanho={22} />
              </LinkBotao>
            </>
          ) : undefined
        }
      />

      {estado.fase === 'a-carregar' && <Esqueleto />}

      {estado.fase === 'erro' && (
        <p role="alert" className={estilos.nota}>
          {estado.mensagem}
        </p>
      )}

      {/* Sem nenhuma conta ainda: não há onde lançar um movimento — o
          convite é para criar uma conta primeiro, não um movimento. */}
      {estado.fase === 'pronto' && !temContas && (
        <div className={estilos.vazio}>
          <p className={estilos.vazioTitulo}>Precisas de uma conta primeiro.</p>
          <p>Os movimentos pertencem sempre a uma conta — cria a tua primeira conta.</p>
          <LinkBotao para="/contas/nova">Criar conta</LinkBotao>
        </div>
      )}

      {estado.fase === 'pronto' && temContas && estado.movimentos.length === 0 && (
        <div className={estilos.vazio}>
          <p className={estilos.vazioTitulo}>Ainda não tens movimentos.</p>
          <p>Regista as tuas entradas e saídas para acompanhares o saldo de cada conta.</p>
          <LinkBotao para="/movimentos/novo">Criar o primeiro</LinkBotao>
        </div>
      )}

      {estado.fase === 'pronto' && temMovimentos && (
        <>
          <CampoPesquisa
            valor={pesquisa}
            aoMudar={setPesquisa}
            placeholder="Procurar movimento…"
            rotulo="Procurar movimento"
          />

          {resultados.length === 0 ? (
            pesquisa.trim() !== '' ? (
              <p className={estilos.semResultados}>
                Nenhum movimento corresponde a «{pesquisa.trim()}».
              </p>
            ) : (
              <div className={estilos.semResultados}>
                <p>Nenhum movimento com estes filtros.</p>
                <button
                  type="button"
                  className={estilos.limparFiltros}
                  onClick={() => aoMudarFiltros(FILTROS_VAZIOS)}
                >
                  Limpar filtros
                </button>
              </div>
            )
          ) : (
            <div className={estilos.grupos}>
              {grupos.map(([rotulo, movimentosGrupo]) => (
                <section key={rotulo} className={estilos.grupo}>
                  <div className={estilos.grupoCabecalho}>
                    <span className={estilos.grupoNome}>{rotulo}</span>
                  </div>
                  <div className={estilos.lista}>
                    {movimentosGrupo.map((movimento) => (
                      <LinhaMovimento
                        key={movimento.id}
                        movimento={movimento}
                        conta={contaPorId.get(movimento.conta_id)}
                        saldoApos={saldosApos.get(movimento.id)}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
