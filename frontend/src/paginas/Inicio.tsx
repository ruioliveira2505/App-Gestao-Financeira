/*
 * PÁGINA INÍCIO (/)
 * =================
 *
 * A página de ANÁLISE da app — ao contrário de Contas (gestão pura, sem
 * totais agregados — ver a nota no topo de Contas.tsx) e de Movimentos
 * (o histórico linha a linha), aqui vivem os números que juntam valores
 * ENTRE contas, mesmo quando têm moedas diferentes: a razão de ser da
 * moeda principal (Perfil → Preferências) e de toda a conversão de
 * moeda construída antes desta página.
 *
 * DESENHO DELIBERADAMENTE DIFERENTE do resto da app: as outras páginas
 * são fichas neutras, uniformes entre si; esta é a única página de
 * "destino" (é onde se cai ao abrir a app) e a única de análise — faz
 * sentido destacar-se. Por isso:
 *   - SEM o título de página "Início" habitual (<CabecalhoPagina>) — por
 *     agora, sem NENHUM título visível (uma saudação pessoal foi
 *     experimentada e posta de lado, por agora — ver caderno/decisoes.md,
 *     secção "Resumo"). Ainda assim chama-se useDefinirCabecalho()
 *     directamente (sem montar <CabecalhoPagina>) só para repor o
 *     cabeçalho partilhado (sem "voltar", sem ação) — sem isto, a barra
 *     de topo em mobile ficaria a mostrar o que quer que a página
 *     anterior lá tivesse deixado (ex.: "‹ voltar", de ContaDetalhe).
 *   - Saldo Total num CARTÃO (fundo levemente destacado), não texto solto
 *     na página — assinala, ao primeiro relance, que esta zona é
 *     diferente do resto da app.
 *   - Cor: DELIBERADAMENTE conservadora — só as duas cores semânticas já
 *     estabelecidas (positivo/negativo, de Movimentos.tsx), sem nenhum
 *     acento novo. A app continua a seguir "cor só onde há significado".
 *
 * QUARTA FATIA (a mais recente): abrir uma barra de categoria revela,
 * por baixo, a sua repartição por SUBCATEGORIA (GET
 * /resumo/categorias/{grupo_id} — só pedida ao abrir, nunca antecipada;
 * ver src/lib/resumo.ts). Só um grupo aberto de cada vez — abrir outro
 * fecha o anterior; mudar de direcção (Entradas/Saídas — mudarDirecao) OU
 * usar "Ver mais"/"Ver menos" (alternarExpandido) fecha também qualquer
 * grupo aberto — sem isto, "Ver menos" podia esconder um grupo que
 * estava aberto (a 6ª categoria em diante), que reaparecia já expandido
 * ao clicar "Ver mais" outra vez. Cada resposta fica em memória (em
 * "detalhes") — reabrir o mesmo grupo não volta a pedi-la, MAS um pedido
 * que falhou ("erro") é sempre tentado de novo ao reabrir (nunca fica
 * preso). A percentagem de cada subcategoria é
 * face ao TOTAL DO GRUPO, não ao total geral de entradas/saídas (decidido
 * ao construir o backend — é a pergunta que faz sentido ao abrir UMA
 * categoria: "quanto de Alimentação foi para Supermercado", não "quanto
 * do mês").
 *
 * TERCEIRA FATIA — CORREÇÃO DE DESENHO: a primeira versão desta página
 * mostrava a barra comparativa, as três linhas Entradas/Saídas/Líquido, E
 * as duas secções de categorias, uma por baixo da outra — o
 * verde/vermelho repetia-se em três sítios diferentes a dizer a mesma
 * coisa, e a página ficava confusa/comprida. Trocado por:
 *   - Sem barra comparativa (redundante com as barras de categoria).
 *   - Um CONTROLO SEGMENTADO "Entradas"/"Saídas" (à maneira do iOS): só
 *     a repartição por categoria da direcção ACTIVA fica visível de cada
 *     vez, com o total dessa direcção em destaque por cima da lista. A
 *     mudança de altura da página ao trocar de aba é intencional e
 *     inofensiva — é uma reacção directa a um toque deliberado do
 *     utilizador, não um salto inesperado.
 *   - Líquido passou a UMA LINHA fixa, junto ao título do mês — não tem
 *     categorias próprias, não faz sentido dentro do alternador.
 *   - Só as 5 categorias maiores por omissão (já vêm ordenadas do
 *     backend), com "Ver mais"/"Ver menos" a expandir/recolher — evita
 *     uma lista comprida de barras muito pequenas, pouco informativas.
 *   - A percentagem de cada categoria deixou de aparecer em TEXTO junto
 *     do valor ("-320,00 € · 64%", denso a mais) — fica só na LARGURA da
 *     própria barra, que já a mostra visualmente; repeti-la em texto era
 *     a mesma informação duas vezes.
 *   - Nas Saídas (total E cada categoria), o "-" à frente do valor foi
 *     removido (ver formatarSemSinal, abaixo) — dentro da aba "Saídas",
 *     já com a tinta vermelha, o sinal negativo só repete o que o
 *     contexto já diz. As Entradas nunca tiveram este problema (nunca
 *     são negativas).
 *
 * SEGUNDA FATIA: a repartição de Entradas e de Saídas por GRUPO de
 * categoria — uma barra horizontal por grupo, preenchida consoante a
 * "percentagem" já calculada pelo backend (ver GrupoResumo, em
 * src/lib/resumo.ts), com o valor em texto ao lado.
 *
 * PRIMEIRA FATIA: só os quatro números estáticos do resumo, vindos de
 * GET /resumo — Saldo Total (não depende de nenhum período) e
 * Entradas/Saídas/Líquido do mês atual (o BACKEND decide o período — ver
 * a nota em app/routers/resumo.py; o mês mostrado no título da secção
 * vem de "periodo_inicio", nunca calculado aqui de novo). Sem filtros
 * ainda — ficam para uma fatia futura.
 *
 * Estados: a carregar (esqueleto), erro, e pronto — o mesmo padrão já
 * usado em ContaDetalhe.tsx.
 */

import { useEffect, useState, type ReactNode } from 'react'

import { useAuth } from '../auth/useAuth'
import { useDefinirCabecalho } from '../componentes/useCabecalho'
import { IconeChevronDireita } from '../componentes/icones'
import { rotuloMes } from '../lib/datas'
import { ErroApi } from '../lib/http'
import { formatarDinheiro } from '../lib/moedas'
import {
  obterDetalheGrupo,
  obterResumo,
  type GrupoDetalhe,
  type GrupoResumo,
  type Resumo,
} from '../lib/resumo'
import estilos from './Inicio.module.css'

// Quantas categorias mostrar antes de "Ver mais" — as maiores já vêm
// primeiro (o backend ordena por valor decrescente), por isso cortar
// aqui mostra sempre as mais relevantes.
const LIMITE_CATEGORIAS = 5

type Direcao = 'entrada' | 'saida'

// O detalhe de um grupo (GET /resumo/categorias/{grupo_id}) ainda não
// pedido nunca aparece no dicionário "detalhes" (undefined implícito);
// só depois de pedido é que passa a "a-carregar", e por fim ao resultado
// ou a "erro".
type EstadoDetalhe = GrupoDetalhe | 'a-carregar' | 'erro'

/** Formata um valor SEM o sinal negativo — usado nas Saídas: dentro do
 *  controlo segmentado já activo em "Saídas", com a tinta vermelha já a
 *  identificar a direcção, o "-" à frente de cada valor era redundante
 *  com o contexto e só ocupava espaço. As Entradas nunca precisam disto
 *  (um valor de entrada nunca é negativo). */
function formatarSemSinal(valor: string, moeda: string): string {
  return formatarDinheiro(String(Math.abs(Number(valor))), moeda)
}

/** Esqueleto mostrado enquanto o resumo carrega: o bloco do cartão de
 *  saldo, o título do mês, o controlo segmentado e algumas barras de
 *  categoria — a pulsar devagar, o mesmo padrão usado nas outras páginas
 *  da app (ex.: Contas.tsx, ContaDetalhe.tsx). */
function Esqueleto() {
  return (
    <div role="status" aria-label="A carregar o resumo">
      <div className={`${estilos.cartaoSaldo} ${estilos.cartaoSaldoEsq}`}>
        <span className={`${estilos.esq} ${estilos.esqRotulo}`} />
        <span className={`${estilos.esq} ${estilos.esqSaldo}`} />
      </div>
      <span className={`${estilos.esq} ${estilos.esqTitulo}`} />
      <span className={`${estilos.esq} ${estilos.esqSegmentado}`} />
      {[0, 1, 2].map((indice) => (
        <span key={indice} className={`${estilos.esq} ${estilos.esqBarraCategoria}`} />
      ))}
    </div>
  )
}

/** Nome + valor em cima, a barra preenchida por baixo — o corpo comum a
 *  uma linha de GRUPO (dentro do botão que a abre, em BarraCategoria) e
 *  a uma linha de SUBCATEGORIA (dentro do grupo aberto). A PROPORÇÃO (a
 *  "percentagem" já calculada pelo backend) fica só na largura da barra,
 *  sem a repetir em texto (ver caderno/decisoes.md, secção "Resumo").
 *  "cor" escolhe entre as duas tintas semânticas já estabelecidas (nunca
 *  uma terceira); "indicador", quando dado, aparece depois do valor (o
 *  chevron de abrir/fechar, só nas linhas de grupo). */
function LinhaValorBarra({
  nome,
  valor,
  moeda,
  percentagem,
  cor,
  indicador,
}: {
  nome: string
  valor: string
  moeda: string
  percentagem: number
  cor: Direcao
  indicador?: ReactNode
}) {
  return (
    <>
      <div className={estilos.categoriaCabecalho}>
        <span className={estilos.categoriaNome}>{nome}</span>
        <span className={estilos.categoriaValor}>
          {cor === 'entrada' ? formatarDinheiro(valor, moeda) : formatarSemSinal(valor, moeda)}
        </span>
        {indicador}
      </div>
      <div className={estilos.categoriaBarraFundo}>
        <span
          className={cor === 'entrada' ? estilos.categoriaBarraEntrada : estilos.categoriaBarraSaida}
          style={{ width: `${percentagem}%` }}
        />
      </div>
    </>
  )
}

/** Uma barra de GRUPO: toca-se para abrir/fechar a sua repartição por
 *  subcategoria (ver a nota "QUARTA FATIA" no topo do ficheiro). O
 *  chevron aponta para o lado fechado, para baixo aberto — a mesma
 *  rotação já usada em CampoSelecao.tsx para o mesmo significado. */
function BarraCategoria({
  grupo,
  moeda,
  cor,
  aberto,
  aoAlternar,
  detalhe,
}: {
  grupo: GrupoResumo
  moeda: string
  cor: Direcao
  aberto: boolean
  aoAlternar: () => void
  detalhe: EstadoDetalhe | undefined
}) {
  return (
    // Sem "className" aqui: este invólucro só empilha o botão e, quando
    // aberto, o painel de subcategorias por baixo — nenhum estilo
    // próprio (a margem entre os dois vem de ".subcategorias").
    <div>
      <button
        type="button"
        className={estilos.categoriaBotao}
        aria-expanded={aberto}
        onClick={aoAlternar}
      >
        <LinhaValorBarra
          nome={grupo.nome}
          valor={grupo.valor}
          moeda={moeda}
          percentagem={grupo.percentagem}
          cor={cor}
          indicador={
            <span
              className={
                aberto
                  ? `${estilos.categoriaSeta} ${estilos.categoriaSetaAberta}`
                  : estilos.categoriaSeta
              }
              aria-hidden="true"
            >
              <IconeChevronDireita tamanho={14} />
            </span>
          }
        />
      </button>

      {aberto && (
        <div className={estilos.subcategorias}>
          {detalhe === undefined || detalhe === 'a-carregar' ? (
            <div
              role="status"
              aria-label={`A carregar ${grupo.nome}`}
              className={estilos.subcategoriasEsq}
            >
              {[0, 1].map((indice) => (
                <span key={indice} className={`${estilos.esq} ${estilos.esqSubcategoria}`} />
              ))}
            </div>
          ) : detalhe === 'erro' ? (
            <p className={estilos.subcategoriaNota}>Não foi possível carregar.</p>
          ) : detalhe.subcategorias.length === 0 ? (
            <p className={estilos.subcategoriaNota}>Sem detalhe este mês.</p>
          ) : (
            detalhe.subcategorias.map((sub) => (
              <div key={sub.subcategoria_id} className={estilos.subcategoria}>
                <LinhaValorBarra
                  nome={sub.nome}
                  valor={sub.valor}
                  moeda={moeda}
                  percentagem={sub.percentagem}
                  cor={cor}
                />
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}

export function Inicio() {
  const { utilizador } = useAuth()
  const [resumo, setResumo] = useState<Resumo | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  // Qual direcção o controlo segmentado mostra — "saida" por omissão:
  // é a que mais se costuma consultar numa análise de gastos (o mesmo
  // ponto de partida da Revolut/N26, por exemplo).
  const [direcaoActiva, setDirecaoActiva] = useState<Direcao>('saida')
  // Só as LIMITE_CATEGORIAS maiores, por omissão — "Ver mais" expande.
  const [expandido, setExpandido] = useState(false)
  // O grupo actualmente aberto (a mostrar a sua repartição por
  // subcategoria) — só um de cada vez; "null" é "nenhum aberto".
  const [grupoAberto, setGrupoAberto] = useState<string | null>(null)
  // grupo_id -> o seu detalhe, ou o estado do pedido — ver EstadoDetalhe.
  // Guardado por grupo (não substituído a cada abertura) para reabrir o
  // MESMO grupo não pedir outra vez os dados.
  const [detalhes, setDetalhes] = useState<Record<string, EstadoDetalhe>>({})

  // Repõe o cabeçalho partilhado (sem "voltar", sem ação) — ver a nota
  // "DESENHO DELIBERADAMENTE DIFERENTE" no topo do ficheiro sobre porquê
  // esta página não usa <CabecalhoPagina> para o seu título visível.
  const definirCabecalho = useDefinirCabecalho()
  useEffect(() => {
    definirCabecalho?.({ titulo: 'Início' })
  }, [definirCabecalho])

  useEffect(() => {
    let activo = true
    obterResumo()
      .then((r) => {
        if (activo) setResumo(r)
      })
      .catch((e) => {
        if (activo) {
          setErro(e instanceof ErroApi ? e.message : 'Não foi possível carregar o resumo.')
        }
      })
    return () => {
      activo = false
    }
  }, [])

  // Reposto sempre que se muda de direcção — para a aba nova começar
  // sempre recolhida e sem nenhum grupo aberto, nunca a herdar o estado
  // da aba anterior (um grupo de Saídas aberto não faz sentido depois de
  // trocar para Entradas).
  function mudarDirecao(nova: Direcao) {
    setDirecaoActiva(nova)
    setExpandido(false)
    setGrupoAberto(null)
  }

  // Reposto ao mesmo tempo que "expandido" (ver mudarDirecao, acima, para
  // a mesma ideia ao trocar de direcção): "Ver menos" pode esconder uma
  // categoria (a 6ª em diante) que estava aberta — sem isto, o grupo
  // ficava "aberto" em memória, invisível, e reaparecia já expandido ao
  // clicar "Ver mais" outra vez, o que seria uma surpresa para quem já
  // não via essa categoria há um instante.
  function alternarExpandido() {
    setExpandido((actual) => !actual)
    setGrupoAberto(null)
  }

  function alternarGrupo(grupoId: string) {
    if (grupoAberto === grupoId) {
      setGrupoAberto(null)
      return
    }
    setGrupoAberto(grupoId)
    // Só pede o detalhe se ainda não foi pedido, ou se a última vez
    // FALHOU — um sucesso já guardado em "detalhes" não é repetido ao
    // reabrir, mas um "erro" não pode ficar preso para sempre: sem esta
    // segunda condição, uma falha transitória (ex.: rede) nunca mais
    // teria outra oportunidade sem recarregar a página inteira.
    if (detalhes[grupoId] !== undefined && detalhes[grupoId] !== 'erro') return
    setDetalhes((actual) => ({ ...actual, [grupoId]: 'a-carregar' }))
    obterDetalheGrupo(grupoId)
      .then((d) => setDetalhes((actual) => ({ ...actual, [grupoId]: d })))
      .catch(() => setDetalhes((actual) => ({ ...actual, [grupoId]: 'erro' })))
  }

  // "?? 'EUR'" só entra em jogo enquanto "utilizador" ainda é null — na
  // app real isto nunca acontece (esta rota vive sempre dentro de
  // RotaProtegida); o alçapão existe só para um teste que monte esta
  // página sozinha, sem essa guarda (o mesmo padrão de Contas.tsx).
  const moeda = utilizador?.moeda_principal ?? 'EUR'

  const categorias = resumo
    ? direcaoActiva === 'entrada'
      ? resumo.categorias_entradas
      : resumo.categorias_saidas
    : []
  const categoriasVisiveis = expandido ? categorias : categorias.slice(0, LIMITE_CATEGORIAS)
  const restantes = categorias.length - categoriasVisiveis.length

  return (
    <div>
      {erro ? (
        <p role="alert" className={estilos.nota}>
          {erro}
        </p>
      ) : !resumo ? (
        <Esqueleto />
      ) : (
        <>
          {/* Saldo Total: o herói da página, num cartão (fundo
              destacado) — não depende de nenhum período. */}
          <div className={estilos.cartaoSaldo}>
            <span className={estilos.rotulo}>Saldo total</span>
            <span
              className={
                Number(resumo.saldo_total) < 0
                  ? `${estilos.saldo} ${estilos.negativo}`
                  : estilos.saldo
              }
            >
              {formatarDinheiro(resumo.saldo_total, moeda)}
            </span>
          </div>

          <section className={estilos.seccao}>
            <div className={estilos.cabecalhoFluxo}>
              {/* O mês vem de "periodo_inicio" (ex.: "2026-09-01" ->
                  "Setembro 2026") — nunca recalculado aqui: é o BACKEND
                  que decide o período (ver a nota no topo do ficheiro),
                  esta página só o mostra. */}
              <h2 className={estilos.seccaoTitulo}>
                {rotuloMes(resumo.periodo_inicio.slice(0, 7))}
              </h2>
              <span
                className={
                  Number(resumo.liquido) < 0
                    ? `${estilos.liquidoInline} ${estilos.negativo}`
                    : `${estilos.liquidoInline} ${estilos.positivo}`
                }
              >
                Líquido {formatarDinheiro(resumo.liquido, moeda)}
              </span>
            </div>

            <div className={estilos.segmentado}>
              <button
                type="button"
                className={
                  direcaoActiva === 'entrada'
                    ? `${estilos.segmentoBotao} ${estilos.segmentoActivo}`
                    : estilos.segmentoBotao
                }
                aria-pressed={direcaoActiva === 'entrada'}
                onClick={() => mudarDirecao('entrada')}
              >
                Entradas
              </button>
              <button
                type="button"
                className={
                  direcaoActiva === 'saida'
                    ? `${estilos.segmentoBotao} ${estilos.segmentoActivo}`
                    : estilos.segmentoBotao
                }
                aria-pressed={direcaoActiva === 'saida'}
                onClick={() => mudarDirecao('saida')}
              >
                Saídas
              </button>
            </div>

            <span
              className={`${estilos.totalDirecao} ${direcaoActiva === 'entrada' ? estilos.positivo : estilos.negativo}`}
            >
              {direcaoActiva === 'entrada'
                ? formatarDinheiro(resumo.entradas, moeda)
                : formatarSemSinal(resumo.saidas, moeda)}
            </span>

            {categorias.length === 0 ? (
              <p className={estilos.semCategorias}>
                Sem {direcaoActiva === 'entrada' ? 'entradas' : 'saídas'} este mês.
              </p>
            ) : (
              <>
                <div className={estilos.listaCategorias}>
                  {categoriasVisiveis.map((grupo) => (
                    <BarraCategoria
                      key={grupo.grupo_id}
                      grupo={grupo}
                      moeda={moeda}
                      cor={direcaoActiva}
                      aberto={grupoAberto === grupo.grupo_id}
                      aoAlternar={() => alternarGrupo(grupo.grupo_id)}
                      detalhe={detalhes[grupo.grupo_id]}
                    />
                  ))}
                </div>
                {categorias.length > LIMITE_CATEGORIAS && (
                  <button
                    type="button"
                    className={estilos.verMais}
                    onClick={alternarExpandido}
                  >
                    {expandido ? 'Ver menos' : `Ver mais ${restantes}`}
                  </button>
                )}
              </>
            )}
          </section>
        </>
      )}
    </div>
  )
}
