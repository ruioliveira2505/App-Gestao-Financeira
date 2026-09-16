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
 * contínuo por data que esta página persegue.
 *
 * PAGINAÇÃO POR CURSOR (scroll infinito): a lista NÃO carrega o histórico
 * completo de uma vez — pede uma primeira JANELA de LIMITE_PAGINA
 * movimentos a listarMovimentos (src/lib/movimentos.ts) e, à medida que o
 * utilizador se aproxima do fim da lista já carregada, pede mais uma
 * janela, a continuar exactamente onde a anterior ficou (o "cursor" do
 * último movimento recebido — ver a nota PAGINAÇÃO POR CURSOR em
 * app/routers/movimentos.py, no backend). Detectar essa aproximação é
 * feito com um IntersectionObserver sobre uma pequena sentinela invisível
 * no fim da lista (ver a função Movimentos, mais abaixo): assim que ela
 * entra no ecrã, pede-se a página seguinte — sem ouvir eventos de
 * "scroll" à mão, nem calcular posições. Uma resposta mais curta do que
 * LIMITE_PAGINA é o sinal de que já não há mais — a sentinela deixa
 * então de ser desenhada, e o observador larga-a.
 *
 * FILTROS (contas, tipo, categorias, datas) E PESQUISA são todos, agora,
 * parâmetros do próprio pedido a listarMovimentos — aplicados em SQL no
 * backend, não em JavaScript sobre uma lista já carregada (deixou de ser
 * possível a partir do momento em que "o que está carregado" é só uma
 * janela, não o histórico completo). Os filtros vivem no URL (ver
 * src/lib/filtrosMovimentos.ts); a pesquisa por texto é DEBOUNCED (300ms)
 * antes de disparar um novo pedido — sem isso, cada tecla escrita faria
 * uma chamada à API. Qualquer mudança nos filtros OU na pesquisa (já
 * debounced) reinicia a paginação: pede-se de novo a PRIMEIRA página,
 * com o novo critério — nunca se continua a paginar dentro de um critério
 * que já não é o actual.
 *
 * RESPOSTAS FORA DE ORDEM: como há TRÊS sítios que podem substituir a
 * lista de movimentos (a busca da primeira página, "carregarMais" e
 * "recarregar", mais abaixo) e todos são assíncronos, uma resposta pode
 * chegar depois de outra mais recente já ter mudado o estado — ex.:
 * pedir mais uma página perto do fim da lista e, antes de ela responder,
 * mudar de filtro; sem cuidado, a página antiga acabaria por ser anexada
 * à lista NOVA (de outro critério), uma mistura silenciosa e incorrecta.
 * "geracaoMovimentosRef" é um contador simples que resolve isto: a busca
 * da primeira página e "recarregar" avançam-no ANTES de pedir (tornam-se
 * a nova geração "autoritativa"); "carregarMais" só o lê (pertence à
 * geração actual, nunca cria uma nova). Quando uma resposta chega,
 * compara-se o número que guardou no início com o valor actual do
 * contador — se já não for o mesmo, uma busca mais recente já aconteceu
 * entretanto, e a resposta (tardia) é simplesmente ignorada.
 *
 * Estrutura: na barra de topo, uma PÍLULA com dois botões — "Selecionar"
 * (ver a nota MODO DE SELEÇÃO MÚLTIPLA, mais abaixo) e "Filtros" — e o "+"
 * (novo movimento) — não há "⋯" de ordenar/agrupar, a ordem é fixa. Os
 * dois botões da pílula continuam directos (um toque cada, sem menu a
 * abrir primeiro), mas partilham um único contorno arredondado — três
 * círculos soltos lado a lado (Selecionar, Filtros, "+") foi a primeira
 * versão desta fatia, achada demasiado cheia; escondê-los os dois dentro
 * de um "⋯" foi a segunda, e resolvia a mesma questão à custa de um toque
 * extra sempre que se usa qualquer um dos dois. A pílula é o meio-termo:
 * lê-se como um grupo só (menos "peso" visual do que dois círculos
 * soltos), sem esconder nenhuma das duas ações atrás de mais um toque.
 * No conteúdo: o título com a contagem por baixo, um campo de PROCURA
 * (por descrição ou pelo nome da conta), e a lista, agrupada por dia, sem
 * cartão, linhas separadas por um traço fino. Tocar numa linha abre-a
 * directamente para EDITAR (folha, de baixo para cima) — ao contrário de
 * Contas, não há aqui uma página de detalhe intermédia: um movimento tem
 * poucos campos, todos já visíveis na própria linha, e nada mais para
 * "detalhar".
 *
 * FILTROS: toda a interface deles é a folha do FiltroMovimentos — hoje
 * CONTROLADA por esta página ("aberto"/"aoFechar"; ver a nota no topo de
 * FiltroMovimentos.tsx), aberta a partir do "Filtros" da pílula. A
 * página em si NÃO mostra os filtros — só um pontinho no botão avisa que
 * há um subconjunto à vista (o mesmo pontinho que estava antes ancorado
 * ao botão do funil, quando era um círculo à parte). Não se põe aqui uma
 * contagem de resultados: mudaria a cada tecla e fazia a barra de procura
 * "saltar"; o caso sem resultados já tem a sua própria mensagem. (Falta o
 * filtro de Valor: precisa de uma moeda base — as contas podem estar em
 * moedas diferentes.)
 *
 * Cada linha mostra, à esquerda, um PONTO COLORIDO — a cor do GRUPO da
 * categoria do movimento (PontoCategoria, tamanho "md"; ver a nota em
 * src/componentes/PontoCategoria.tsx). Substitui o avatar da conta que
 * esteve aqui antes das categorias existirem, e a seguir a esse — uma
 * seta na diagonal, provisória — que existiu enquanto elas ainda não
 * tinham cor nenhuma para mostrar.
 *
 * Por baixo do valor de cada movimento, o SALDO DA CONTA logo a seguir a
 * esse movimento ("saldo_apos", já calculado pelo backend — ver a nota
 * SALDO REMANESCENTE em app/routers/movimentos.py — sobre o histórico
 * COMPLETO da conta, mesmo quando um filtro está a esconder outros
 * movimentos dela) — o "saldo remanescente" de um livro de cheques. Já
 * não é calculado aqui: antes da paginação, esta página tinha a lista
 * completa de cada conta em memória e conseguia somar isto sozinha; deixou
 * de ser possível a partir do momento em que só se vê uma janela do
 * histórico de cada vez.
 *
 * Estados: a carregar (esqueleto), erro, sem contas nenhumas (pede para
 * criar uma primeiro — sem conta não há onde lançar um movimento), sem
 * movimentos (estado vazio), sem resultados (de pesquisa OU de filtros —
 * mensagens diferentes), e a lista. "Sem movimentos nenhuns" (o estado
 * vazio "Ainda não tens movimentos") só se distingue de "sem resultados
 * para este filtro/pesquisa" por não haver filtro nem pesquisa activos —
 * já não há, do lado do cliente, uma contagem TOTAL de movimentos para
 * comparar (só se vê uma janela de cada vez): sem filtro nem pesquisa, uma
 * primeira página vazia só pode significar que a conta não tem movimento
 * nenhum.
 *
 * MODO DE SELEÇÃO MÚLTIPLA: entra-se por "Selecionar", o primeiro botão
 * da pílula do cabeçalho (ver a nota ESTRUTURA, no topo do ficheiro) —
 * NÃO por pressão prolongada (long-press): numa lista de <Link>, o
 * Safari do iPhone intercepta esse gesto para a sua própria
 * pré-visualização da página de destino, o que tornava a experiência
 * muito estranha (tentado e revertido nesta fatia). Um botão directo
 * resolve isso sem gesto nenhum para o Safari interceptar, e funciona
 * sem diferença nenhuma entre mobile e desktop.
 *
 * Uma vez dentro, um toque/clique numa linha alterna a sua seleção em vez
 * de abrir a edição. As mudanças de aspeto são deliberadamente pequenas —
 * o objectivo, em cada uma, é nada "saltar" visualmente ao entrar/sair do
 * modo, porque é uma mudança de MODO, não de conteúdo:
 *   - O TÍTULO passa de "Movimentos" a "N selecionados" — sem parágrafo
 *     novo a empurrar o resto do conteúdo.
 *   - O CAMPO DE PESQUISA fica esbatido e para de aceitar escrita, mas
 *     continua no mesmo lugar, com o mesmo espaço reservado (escondê-lo
 *     por completo foi tentado e revertido).
 *   - CADA LINHA ganha um checkbox pequeno à esquerda do ponto colorido
 *     da categoria (LinhaMovimento, mais abaixo) — o ponto, a descrição,
 *     a conta e os valores continuam exactamente como estavam, só
 *     empurrados para a direita; nada troca de aspeto nem desaparece
 *     (um design anterior substituía o ponto por um checkbox do mesmo
 *     tamanho — mudava o símbolo da linha em vez de só acrescentar algo).
 * O ☰ da barra de topo FICA VISÍVEL, mesmo em modo seleção — chegou a
 * ficar escondido nesse modo (CabecalhoPagina tinha um "semMenu"), mas
 * foi posto de volta a pedido explícito.
 * A pílula e o "+" dão lugar a um "X" (círculo branco com sombra, o mesmo
 * aspeto do botão "fechar" da Folha — ver a variante "circulo" em
 * Folha.module.css), a única forma de sair do modo. Era texto ("Cancelar")
 * numa primeira versão desta fatia — o único botão de acão de cabeçalho de
 * toda a app que não era um ícone; passou a ícone só por consistência.
 *
 * Uma barra de ações fixa no fundo do ecrã (só existe neste modo) mostra
 * "Eliminar" e "Categorizar" — as duas únicas ações em lote (mover para
 * outra conta ficou fora, menos comum), no mesmo formato de cartão
 * arredondado da Folha e botões "texto só" da Confirmacao. "Categorizar"
 * só fica disponível quando a seleção é toda da MESMA direção (entrada ou
 * saída): senão não haveria categorias que servissem para todos ao mesmo
 * tempo (ver _validar_direcao, no backend) — nesse caso o botão fica
 * desativado, sem tentar e falhar.
 */

import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react'

import { Link, useLocation, useSearchParams } from 'react-router-dom'

import { CabecalhoPagina } from '../componentes/CabecalhoPagina'
import { CaixaErro } from '../componentes/CaixaErro'
import { CampoPesquisa } from '../componentes/CampoPesquisa'
import { Confirmacao } from '../componentes/Confirmacao'
import { FiltroMovimentos } from '../componentes/FiltroMovimentos'
import { Folha } from '../componentes/Folha'
import { IconeCheck, IconeChecklist, IconeFechar, IconeFunil, IconeMais } from '../componentes/icones'
import { LinkBotao } from '../componentes/LinkBotao'
import { ListaDeOpcoes, type OpcaoLista } from '../componentes/ListaDeOpcoes'
import { PontoCategoria } from '../componentes/PontoCategoria'
import { obterArvoreCategorias, type GrupoArvore } from '../lib/categorias'
import { listarContas, type Conta } from '../lib/contas'
import { rotuloDiaRelativo } from '../lib/datas'
import {
  contarFiltrosAtivos,
  escreverFiltros,
  FILTROS_VAZIOS,
  lerFiltros,
  type Filtros,
} from '../lib/filtrosMovimentos'
import { ErroApi } from '../lib/http'
import { formatarDinheiro } from '../lib/moedas'
import {
  eliminarMovimentosEmLote,
  listarMovimentos,
  recategorizarMovimentosEmLote,
  type CursorMovimentos,
  type Movimento,
} from '../lib/movimentos'
import estilos from './Movimentos.module.css'

const MENSAGEM_ERRO_GENERICA = 'Não foi possível concluir. Tenta novamente.'

// Quantos movimentos pedir de cada vez — ver a nota PAGINAÇÃO POR CURSOR,
// no topo do ficheiro. O mesmo valor por omissão do backend (só explícito
// aqui para "temMais" poder comparar contra um número que o próprio
// pedido garante, em vez de depender de nunca mudarmos o omitido no
// backend sem dar por isso).
const LIMITE_PAGINA = 30

// A espera antes de a pesquisa disparar um pedido — sem isto, cada tecla
// escrita faria uma chamada à API.
const ATRASO_PESQUISA_MS = 300

/** O estado das CONTAS e da ÁRVORE DE CATEGORIAS — carregadas uma vez por
 *  visita à página (não dependem de filtros nem paginam). Separado do
 *  estado dos MOVIMENTOS (ver EstadoMovimentos, abaixo) porque um muda com
 *  filtros/pesquisa/scroll e o outro não. */
type EstadoBase =
  | { fase: 'a-carregar' }
  | { fase: 'erro'; mensagem: string }
  | { fase: 'pronto'; contas: Conta[]; arvore: GrupoArvore[] }

/** O estado da LISTA de movimentos — a única parte da página que pagina.
 *  "cursor" é o do ÚLTIMO movimento já recebido (null só quando a página
 *  actual está vazia); "temMais" diz se vale a pena desenhar a sentinela
 *  do scroll infinito. */
type EstadoMovimentos =
  | { fase: 'a-carregar' }
  | { fase: 'erro'; mensagem: string }
  | { fase: 'pronto'; itens: Movimento[]; cursor: CursorMovimentos | null; temMais: boolean }

/** O nome do grupo de cada subcategoria, a partir da árvore de categorias
 *  — é o que dá a cor ao PontoCategoria de cada linha (a cor deriva do
 *  nome do GRUPO, nunca da subcategoria, para as subcategorias do mesmo
 *  grupo partilharem cor). */
function nomeGrupoPorCategoria(arvore: GrupoArvore[]): Map<string, string> {
  const mapa = new Map<string, string>()
  for (const grupo of arvore) {
    for (const sub of grupo.subcategorias) {
      mapa.set(sub.id, grupo.nome)
    }
  }
  return mapa
}

/** Ordena os movimentos por data descendente — a única ordem que esta
 *  página usa. A desempatar (vários movimentos no mesmo dia), created_at
 *  descendente — o mesmo desempate que a API já usa em GET /movimentos.
 *  Redundante em relação ao que o backend já devolve (cada página já vem
 *  nesta ordem) — mantido por segurança ao juntar várias páginas: um
 *  "sort" estável sobre dados já ordenados não muda nada. */
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

/** O cursor da página seguinte, a partir do último movimento de uma
 *  página já recebida. null quando a página está vazia (não há onde
 *  continuar). */
function cursorDoUltimo(itens: Movimento[]): CursorMovimentos | null {
  const ultimo = itens[itens.length - 1]
  return ultimo ? { data: ultimo.data, criadoEm: ultimo.created_at, id: ultimo.id } : null
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

/** Uma linha da lista: um ponto colorido à esquerda (a cor do grupo da
 *  categoria — PontoCategoria, tamanho "md"), a descrição (a negrito,
 *  âncora da linha) com o nome da conta por baixo, e à direita o valor (a
 *  cores: verde entrada, vermelho saída) com o saldo remanescente da
 *  conta por baixo ("saldo_apos", já vindo do backend). Tocar leva direto
 *  à folha de editar — sem chevron, a linha inteira é tocável, tal como em
 *  Contas.
 *
 *  "nomeGrupo" pode faltar só num caso raro: um movimento cuja categoria
 *  foi entretanto eliminada sem migração (não deveria acontecer, ver
 *  DELETE /categorias no backend — mas um valor de recurso evita que a
 *  linha fique sem símbolo nenhum caso aconteça).
 *
 *  MODO DE SELEÇÃO (ver a nota no topo do ficheiro): um checkbox pequeno
 *  aparece à esquerda do ponto colorido — que fica, ele, tal e qual como
 *  está fora do modo — empurrando o resto da linha para a direita; nada
 *  desaparece nem troca de aspeto, só entra mais uma coisa. Qualquer
 *  toque na linha alterna a seleção em vez de abrir a edição. Entrar no
 *  modo é sempre feito pelo botão "Selecionar" do cabeçalho (Movimentos,
 *  mais abaixo) — esta linha só reage a ele já estando activo. */
function LinhaMovimento({
  movimento,
  conta,
  nomeGrupo,
  modoSelecao,
  selecionado,
  aoAlternarSelecao,
}: {
  movimento: Movimento
  conta: Conta | undefined
  nomeGrupo: string | undefined
  modoSelecao: boolean
  selecionado: boolean
  aoAlternarSelecao: () => void
}) {
  const entrada = Number(movimento.valor) >= 0

  function aoClicarLinha(evento: MouseEvent) {
    if (!modoSelecao) return
    evento.preventDefault()
    aoAlternarSelecao()
  }

  return (
    <Link
      to={`/movimentos/${movimento.id}/editar`}
      className={estilos.linha}
      aria-pressed={modoSelecao ? selecionado : undefined}
      onClick={aoClicarLinha}
    >
      {modoSelecao && (
        <span
          className={
            selecionado ? `${estilos.checkbox} ${estilos.checkboxSelecionado}` : estilos.checkbox
          }
          aria-hidden="true"
        >
          {selecionado && <IconeCheck tamanho={12} />}
        </span>
      )}
      <PontoCategoria nomeGrupo={nomeGrupo ?? 'Sem categoria'} tamanho="md" />
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
        {conta && movimento.saldo_apos !== null && (
          <span className={estilos.linhaSaldoApos}>
            {formatarDinheiro(movimento.saldo_apos, conta.moeda)}
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

  const [estado, setEstado] = useState<EstadoBase>({ fase: 'a-carregar' })
  const [estadoMovimentos, setEstadoMovimentos] = useState<EstadoMovimentos>({ fase: 'a-carregar' })
  const [aCarregarMais, setACarregarMais] = useState(false)
  const [erroCarregarMais, setErroCarregarMais] = useState<string | null>(null)

  const [pesquisa, setPesquisa] = useState('')
  // A pesquisa só dispara um pedido 300ms depois de o utilizador parar de
  // escrever — ver a nota PAGINAÇÃO POR CURSOR/FILTROS, no topo do
  // ficheiro. O campo em si mostra sempre "pesquisa" (o que está
  // escrito); é só o PEDIDO à API que espera por "pesquisaDebounced".
  const [pesquisaDebounced, setPesquisaDebounced] = useState('')
  useEffect(() => {
    const temporizador = setTimeout(() => setPesquisaDebounced(pesquisa), ATRASO_PESQUISA_MS)
    return () => clearTimeout(temporizador)
  }, [pesquisa])

  // A folha de filtros — hoje controlada por esta página (ver a nota no
  // topo de FiltroMovimentos.tsx), para poder ser aberta a partir do
  // "Filtros" da pílula (ver o cabeçalho, mais abaixo).
  const [filtrosAbertos, setFiltrosAbertos] = useState(false)

  // Ao rolar para além do título grande (ver "colapsavel" em
  // <CabecalhoPagina>, mais abaixo), a barra de procura desvanece-se em
  // sincronia com ele.
  const [cabecalhoColapsado, setCabecalhoColapsado] = useState(false)

  // --- Modo de seleção múltipla (ver a nota MODO DE SELEÇÃO MÚLTIPLA, no
  // topo do ficheiro) ---
  const [modoSelecao, setModoSelecao] = useState(false)
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set())
  const [aConfirmarEliminarLote, setAConfirmarEliminarLote] = useState(false)
  const [aEliminarLote, setAEliminarLote] = useState(false)
  const [aCategorizarLote, setACategorizarLote] = useState(false)
  const [erroLote, setErroLote] = useState<string | null>(null)

  // Os filtros vivem no URL (?tipo=…&contas=…&de=…&ate=…) — sobrevivem a
  // ir editar um movimento e voltar. "replace: true" para cada ajuste de
  // filtro não empilhar uma entrada no histórico.
  const [parametros, setParametros] = useSearchParams()
  const filtros = lerFiltros(parametros)
  function aoMudarFiltros(novos: Filtros) {
    setParametros(escreverFiltros(novos), { replace: true })
  }

  // Carrega contas + árvore de categorias uma vez por visita — não dependem
  // de filtros nem de paginação.
  useEffect(() => {
    let activo = true
    Promise.all([listarContas(), obterArvoreCategorias()])
      .then(([contas, arvore]) => {
        if (activo) setEstado({ fase: 'pronto', contas, arvore })
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

  // O contador de geração — ver a nota RESPOSTAS FORA DE ORDEM, no topo
  // do ficheiro.
  const geracaoMovimentosRef = useRef(0)

  // Pede a PRIMEIRA página de movimentos sempre que os filtros (no URL) ou
  // a pesquisa (já debounced) mudam — ou ao voltar a esta rota. Usa
  // "parametros.toString()" em vez de "filtros" na lista de dependências:
  // "filtros" é um objeto novo a cada render (lerFiltros cria arrays
  // novos), o que faria este efeito correr sempre; a representação em
  // texto do URL só muda quando o conteúdo muda de facto.
  //
  // Sem repor "a-carregar" aqui: a lista anterior fica visível até a nova
  // chegar e a substituir (evita o esqueleto a piscar a cada filtro/tecla
  // escrita) — só a primeira vez (estado ainda "a-carregar", vindo do
  // useState acima) é que se vê o esqueleto.
  useEffect(() => {
    // Esta busca torna-se a nova geração autoritativa — invalida
    // automaticamente qualquer "carregarMais" ainda em curso de um
    // critério anterior (ver a nota RESPOSTAS FORA DE ORDEM).
    const minhaGeracao = ++geracaoMovimentosRef.current
    listarMovimentos({
      tipo: filtros.tipo,
      contas: filtros.contas,
      categorias: filtros.categorias,
      de: filtros.de,
      ate: filtros.ate,
      pesquisa: pesquisaDebounced.trim() || undefined,
      limite: LIMITE_PAGINA,
    })
      .then((itens) => {
        if (geracaoMovimentosRef.current !== minhaGeracao) return
        setEstadoMovimentos({
          fase: 'pronto',
          itens,
          cursor: cursorDoUltimo(itens),
          temMais: itens.length === LIMITE_PAGINA,
        })
      })
      .catch((erro) => {
        if (geracaoMovimentosRef.current !== minhaGeracao) return
        const mensagem =
          erro instanceof ErroApi ? erro.message : 'Não foi possível carregar os movimentos.'
        setEstadoMovimentos({ fase: 'erro', mensagem })
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localizacao.key, parametros.toString(), pesquisaDebounced])

  // Pede a página SEGUINTE, a continuar do cursor da última recebida — ver
  // a nota PAGINAÇÃO POR CURSOR, no topo do ficheiro. Ignorado se já não
  // há mais, se já há um pedido em curso, ou se a página actual ainda não
  // chegou. Chamado pela sentinela do IntersectionObserver, mais abaixo.
  //
  // "minhaGeracao" (ver a nota RESPOSTAS FORA DE ORDEM) é lido, não
  // avançado: este pedido pertence à geração actual, e só continua a ser
  // válido enquanto nada mais a tiver substituído entretanto. O
  // "aCarregarMais" desliga-se sempre, mesmo numa resposta já obsoleta —
  // é só o indicador de "há um pedido em curso", não algo que dependa da
  // geração.
  async function carregarMais() {
    if (estadoMovimentos.fase !== 'pronto' || !estadoMovimentos.temMais || aCarregarMais) return
    const minhaGeracao = geracaoMovimentosRef.current
    setACarregarMais(true)
    setErroCarregarMais(null)
    try {
      const novos = await listarMovimentos({
        tipo: filtros.tipo,
        contas: filtros.contas,
        categorias: filtros.categorias,
        de: filtros.de,
        ate: filtros.ate,
        pesquisa: pesquisaDebounced.trim() || undefined,
        cursor: estadoMovimentos.cursor,
        limite: LIMITE_PAGINA,
      })
      if (geracaoMovimentosRef.current !== minhaGeracao) return
      setEstadoMovimentos((atual) =>
        atual.fase === 'pronto'
          ? {
              fase: 'pronto',
              itens: [...atual.itens, ...novos],
              cursor: cursorDoUltimo(novos) ?? atual.cursor,
              temMais: novos.length === LIMITE_PAGINA,
            }
          : atual,
      )
    } catch (erro) {
      if (geracaoMovimentosRef.current === minhaGeracao) {
        setErroCarregarMais(erro instanceof ErroApi ? erro.message : MENSAGEM_ERRO_GENERICA)
      }
    } finally {
      setACarregarMais(false)
    }
  }

  // "carregarMais" fecha sobre filtros/pesquisa/cursor do render em que
  // foi criada — uma ref mantém sempre a versão mais recente acessível ao
  // observador (definido uma só vez, mais abaixo), sem precisar de o
  // recriar a cada render. Actualizada num efeito (nunca directamente
  // durante o render): mexer numa ref a meio do render é o género de
  // efeito secundário que os hooks de React não esperam ali.
  const carregarMaisRef = useRef(carregarMais)
  useEffect(() => {
    carregarMaisRef.current = carregarMais
  })

  // A sentinela do scroll infinito: uma "callback ref" (em vez de um
  // useEffect com useRef) para o observador nascer e morrer exactamente
  // quando o próprio elemento aparece/desaparece do DOM — o que acontece
  // sempre que "temMais" passa a false (já não há mais para carregar) ou a
  // lista está vazia, casos em que este componente nem chega a desenhar a
  // sentinela.
  const observadorRef = useRef<IntersectionObserver | null>(null)
  const sentinelaRef = useCallback((no: HTMLDivElement | null) => {
    observadorRef.current?.disconnect()
    observadorRef.current = null
    if (!no) return
    const observador = new IntersectionObserver((entradas) => {
      if (entradas[0]?.isIntersecting) carregarMaisRef.current()
    })
    observador.observe(no)
    observadorRef.current = observador
  }, [])

  // Recarrega tudo depois de uma ação em lote (eliminar/recategorizar) —
  // contas (os saldos mudam) e a PRIMEIRA página de movimentos com o
  // filtro/pesquisa actuais (nunca continua a paginar a partir de onde
  // estava: depois de eliminar linhas, o que era a página 2 pode já não
  // existir tal como estava). O mesmo padrão de "recarregar()" em
  // CategoriaGrupo.tsx — pede tudo de novo em vez de simular localmente o
  // que o servidor fez.
  //
  // Também avança a geração (ver a nota RESPOSTAS FORA DE ORDEM): invalida
  // qualquer "carregarMais" ainda em curso nesse preciso momento, para a
  // sua resposta (tardia) não se anexar a esta lista já recarregada.
  async function recarregar() {
    const minhaGeracao = ++geracaoMovimentosRef.current
    const [[contas, arvore], itens] = await Promise.all([
      Promise.all([listarContas(), obterArvoreCategorias()]),
      listarMovimentos({
        tipo: filtros.tipo,
        contas: filtros.contas,
        categorias: filtros.categorias,
        de: filtros.de,
        ate: filtros.ate,
        pesquisa: pesquisaDebounced.trim() || undefined,
        limite: LIMITE_PAGINA,
      }),
    ])
    setEstado({ fase: 'pronto', contas, arvore })
    if (geracaoMovimentosRef.current !== minhaGeracao) return
    setEstadoMovimentos({
      fase: 'pronto',
      itens,
      cursor: cursorDoUltimo(itens),
      temMais: itens.length === LIMITE_PAGINA,
    })
  }

  const carregandoInicial = estado.fase === 'a-carregar' || estadoMovimentos.fase === 'a-carregar'
  const erroCarregar =
    estado.fase === 'erro'
      ? estado.mensagem
      : estadoMovimentos.fase === 'erro'
        ? estadoMovimentos.mensagem
        : null
  const pronto = estado.fase === 'pronto' && estadoMovimentos.fase === 'pronto'

  const contas = estado.fase === 'pronto' ? estado.contas : []
  const temContas = contas.length > 0
  const arvore = estado.fase === 'pronto' ? estado.arvore : []

  const itens = estadoMovimentos.fase === 'pronto' ? estadoMovimentos.itens : []
  const temMais = estadoMovimentos.fase === 'pronto' && estadoMovimentos.temMais

  const contaPorId = new Map(contas.map((conta) => [conta.id, conta]))
  const grupoPorCategoriaId = nomeGrupoPorCategoria(arvore)

  const grupos = agruparPorDia(ordenarPorData(itens))
  const filtrosAtivos = contarFiltrosAtivos(filtros)

  // "A conta não tem movimento nenhum" só se distingue de "sem resultados
  // para este filtro/pesquisa" quando nem filtro nem pesquisa estão
  // ativos — ver a nota Estados, no topo do ficheiro. Usa
  // "pesquisaDebounced" (o que já foi de facto pedido, e portanto o que
  // "itens" reflecte), não "pesquisa" (o que está escrito agora mesmo):
  // ao limpar rapidamente o campo, "pesquisa" já é '' antes de a resposta
  // dessa mudança chegar — usar "pesquisa" aqui mostraria por instantes
  // "Ainda não tens movimentos" (o estado de conta vazia) só porque o
  // texto mudou, mesmo com a conta cheia de movimentos.
  const semFiltroOuPesquisa = filtrosAtivos === 0 && pesquisaDebounced.trim() === ''
  const semMovimentosDeTodo = itens.length === 0 && semFiltroOuPesquisa

  function abrirSelecao() {
    setModoSelecao(true)
    setSelecionados(new Set())
  }

  function alternarSelecao(id: string) {
    setSelecionados((atual) => {
      const novo = new Set(atual)
      if (novo.has(id)) novo.delete(id)
      else novo.add(id)
      return novo
    })
  }

  function sairSelecao() {
    setModoSelecao(false)
    setSelecionados(new Set())
    setErroLote(null)
  }

  // Os movimentos selecionados e a sua direção (a partir do sinal do
  // valor, tal como em LinhaMovimento — nunca da categoria, que é
  // precisamente o que "Categorizar" vai mudar). A seleção só pode conter
  // ids de linhas VISÍVEIS (a página actual de "itens") — o checkbox só
  // existe em linhas desenhadas. "direcaoUnica" só tem valor quando a
  // seleção inteira é da MESMA direção — condição para "Categorizar" estar
  // disponível (ver a nota no topo do ficheiro).
  const movimentosSelecionados = itens.filter((m) => selecionados.has(m.id))
  const direcoesSelecionadas = new Set(
    movimentosSelecionados.map((m) => (Number(m.valor) >= 0 ? 'entrada' : 'saida')),
  )
  const direcaoUnica = direcoesSelecionadas.size === 1 ? [...direcoesSelecionadas][0] : null

  // As opções do seletor de categoria do "Categorizar" em lote — a mesma
  // forma (agrupada pelo grupo) do seletor de categoria do formulário de
  // movimento, só que restrita à direção partilhada pela seleção.
  const opcoesCategoriaLote: OpcaoLista[] = direcaoUnica
    ? arvore
        .filter((grupo) => grupo.direcao === direcaoUnica)
        .flatMap((grupo) =>
          grupo.subcategorias.map((sub) => ({
            valor: sub.id,
            etiqueta: sub.nome,
            grupo: grupo.nome,
            avatar: <PontoCategoria nomeGrupo={grupo.nome} />,
          })),
        )
    : []

  async function confirmarEliminarLote() {
    setAEliminarLote(true)
    setErroLote(null)
    try {
      await eliminarMovimentosEmLote([...selecionados])
      await recarregar()
      setAConfirmarEliminarLote(false)
      sairSelecao()
    } catch (erro) {
      setAConfirmarEliminarLote(false)
      setErroLote(erro instanceof ErroApi ? erro.message : MENSAGEM_ERRO_GENERICA)
    } finally {
      setAEliminarLote(false)
    }
  }

  async function confirmarCategorizarLote(categoriaId: string) {
    setErroLote(null)
    try {
      await recategorizarMovimentosEmLote([...selecionados], categoriaId)
      await recarregar()
      setACategorizarLote(false)
      sairSelecao()
    } catch (erro) {
      // Mostrado DENTRO da folha "Categorizar" — que continua aberta —,
      // não numa caixa qualquer da página por trás dela.
      setErroLote(erro instanceof ErroApi ? erro.message : MENSAGEM_ERRO_GENERICA)
    }
  }

  return (
    <div className={modoSelecao ? estilos.paginaComBarraLote : undefined}>
      <CabecalhoPagina
        titulo={
          modoSelecao
            ? `${selecionados.size} selecionado${selecionados.size === 1 ? '' : 's'}`
            : 'Movimentos'
        }
        // Ao rolar para além do título, este passa a aparecer compacto na
        // barra de topo, ao lado do ☰ (ver a nota em useColapsarAoRolar.ts
        // e em BarraTopoMobile.tsx). "aoColapsar" sincroniza a barra de
        // procura, mais abaixo, com o mesmo momento.
        colapsavel
        aoColapsar={setCabecalhoColapsado}
        acao={
          pronto && !semMovimentosDeTodo ? (
            modoSelecao ? (
              <button
                type="button"
                className={estilos.botaoCancelarSelecao}
                aria-label="Cancelar"
                onClick={sairSelecao}
              >
                <IconeFechar tamanho={22} />
              </button>
            ) : (
              <>
                {/* "Selecionar" e "Filtros" — dois botões directos (um
                    toque cada, sem menu a abrir primeiro), mas visualmente
                    unidos numa só pílula — ver a nota ESTRUTURA, no topo
                    do ficheiro: nenhum dos dois é frequente o suficiente
                    para dois círculos soltos, mas cada um continua a
                    merecer um toque directo, não escondido num "⋯". */}
                <div className={estilos.grupoAcoes}>
                  {/* A sombra vive no invólucro exterior (".grupoAcoes"),
                      sem "overflow"; o recorte aos cantos arredondados
                      (o fundo de toque de cada botão) vive aqui dentro,
                      num invólucro à parte — juntar as duas coisas no
                      mesmo elemento cortava a própria sombra (ver a nota
                      em Movimentos.module.css). */}
                  <div className={estilos.grupoAcoesInterior}>
                    <button
                      type="button"
                      className={estilos.botaoGrupoAcoes}
                      aria-label="Selecionar"
                      onClick={abrirSelecao}
                    >
                      <IconeChecklist tamanho={22} />
                    </button>
                    <button
                      type="button"
                      className={estilos.botaoGrupoAcoes}
                      aria-label={filtrosAtivos > 0 ? 'Filtros (ativos)' : 'Filtros'}
                      aria-haspopup="dialog"
                      onClick={() => setFiltrosAbertos(true)}
                    >
                      <IconeFunil tamanho={22} />
                      {filtrosAtivos > 0 && <span className={estilos.ponto} aria-hidden="true" />}
                    </button>
                  </div>
                </div>
                <LinkBotao para="/movimentos/novo" apenasIcone titulo="Novo movimento">
                  <IconeMais tamanho={22} />
                </LinkBotao>
              </>
            )
          ) : undefined
        }
      />

      {carregandoInicial && <Esqueleto />}

      {erroCarregar !== null && (
        <p role="alert" className={estilos.nota}>
          {erroCarregar}
        </p>
      )}

      {/* Sem nenhuma conta ainda: não há onde lançar um movimento — o
          convite é para criar uma conta primeiro, não um movimento. */}
      {pronto && !temContas && (
        <div className={estilos.vazio}>
          <p className={estilos.vazioTitulo}>Precisas de uma conta primeiro.</p>
          <p>Os movimentos pertencem sempre a uma conta — cria a tua primeira conta.</p>
          <LinkBotao para="/contas/nova">Criar conta</LinkBotao>
        </div>
      )}

      {pronto && temContas && semMovimentosDeTodo && (
        <div className={estilos.vazio}>
          <p className={estilos.vazioTitulo}>Ainda não tens movimentos.</p>
          <p>Regista as tuas entradas e saídas para acompanhares o saldo de cada conta.</p>
          <LinkBotao para="/movimentos/novo">Criar o primeiro</LinkBotao>
        </div>
      )}

      {pronto && temContas && !semMovimentosDeTodo && (
        <>
          {/* Continua no DOM (e no mesmo espaço) em modo seleção — só
              fica com aspeto esbatido e para de aceitar escrita (ver a
              nota MODO DE SELEÇÃO MÚLTIPLA, no topo do ficheiro).
              Desvanece-se, à parte, em sincronia com o título grande ao
              rolar para baixo (ver "aoColapsar" no <CabecalhoPagina>,
              acima) — o espaço que ocupa fica reservado, tal como o do
              título. "inert" (não só "pointer-events: none" no CSS):
              enquanto invisível, o campo não deve continuar alcançável
              por Tab nem por um leitor de ecrã — "inert" tira-o da
              árvore de acessibilidade E da ordem de tabulação de uma só
              vez (ao contrário de "aria-hidden" sozinho, que não impede
              o foco por teclado). */}
          <div
            className={
              cabecalhoColapsado
                ? `${estilos.procura} ${estilos.procuraEscondida}`
                : estilos.procura
            }
            inert={cabecalhoColapsado}
          >
            <CampoPesquisa
              valor={pesquisa}
              aoMudar={setPesquisa}
              placeholder="Procurar movimento…"
              rotulo="Procurar movimento"
              desativado={modoSelecao}
            />
          </div>

          {itens.length === 0 ? (
            // "pesquisaDebounced" (o que "itens" reflecte de facto), não
            // "pesquisa" — mesma razão de "semFiltroOuPesquisa", acima.
            pesquisaDebounced.trim() !== '' ? (
              <p className={estilos.semResultados}>
                Nenhum movimento corresponde a «{pesquisaDebounced.trim()}».
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
            <>
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
                          nomeGrupo={grupoPorCategoriaId.get(movimento.categoria_id)}
                          modoSelecao={modoSelecao}
                          selecionado={selecionados.has(movimento.id)}
                          aoAlternarSelecao={() => alternarSelecao(movimento.id)}
                        />
                      ))}
                    </div>
                  </section>
                ))}
              </div>

              {/* A sentinela do scroll infinito — ver a nota PAGINAÇÃO POR
                  CURSOR, no topo do ficheiro. Só existe enquanto "temMais"
                  for true; ao desaparecer (chegou ao fim), o próprio
                  callback ref desliga o observador. "role=status" (o
                  mesmo do Esqueleto, mais acima) porque é exactamente
                  isso — uma região que anuncia o carregamento de mais
                  conteúdo — e dá à sentinela um alvo estável para os
                  testes, sem precisar de um "data-testid". */}
              {temMais && (
                <div
                  ref={sentinelaRef}
                  className={estilos.sentinela}
                  role="status"
                  aria-label="A carregar mais movimentos"
                >
                  {aCarregarMais && (
                    <span className={estilos.sentinelaTexto}>A carregar mais…</span>
                  )}
                  {erroCarregarMais !== null && (
                    <button
                      type="button"
                      className={estilos.sentinelaTentarNovamente}
                      onClick={carregarMais}
                    >
                      Não foi possível carregar mais. Tentar novamente.
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* Barra de ações do modo de seleção — só existe neste modo, presa
          ao fundo do ecrã (ver a nota sobre ".painel" em
          LayoutApp.module.css), no mesmo formato de cartão arredondado da
          Folha e da Confirmacao — texto só, sem ícones, tal como os
          botões dessas duas. */}
      {modoSelecao && (
        <div className={estilos.barraAcoesLote}>
          {/* A sombra vive no invólucro exterior, sem "overflow" — ver a
              nota em Movimentos.module.css sobre o mesmo cuidado na
              pílula "Selecionar"/"Filtros", mais acima. */}
          <div className={estilos.barraAcoesLoteInterior}>
            <button
              type="button"
              className={`${estilos.botaoAcaoLote} ${estilos.botaoAcaoLotePerigo}`}
              disabled={selecionados.size === 0}
              onClick={() => setAConfirmarEliminarLote(true)}
            >
              Eliminar
            </button>
            <button
              type="button"
              className={estilos.botaoAcaoLote}
              disabled={selecionados.size === 0 || direcaoUnica === null}
              onClick={() => setACategorizarLote(true)}
            >
              Categorizar
            </button>
          </div>
        </div>
      )}

      {aConfirmarEliminarLote && (
        <Confirmacao
          titulo="Eliminar movimentos"
          textoConfirmar="Eliminar"
          aConfirmar={aEliminarLote}
          aoConfirmar={confirmarEliminarLote}
          aoCancelar={() => setAConfirmarEliminarLote(false)}
        >
          {erroLote !== null && <CaixaErro>{erroLote}</CaixaErro>}
          <p>
            {selecionados.size === 1
              ? '1 movimento será eliminado.'
              : `${selecionados.size} movimentos serão eliminados.`}
          </p>
          <p>Esta ação é irreversível.</p>
        </Confirmacao>
      )}

      {/* "Categorizar" em lote — a mesma lista agrupada do seletor de
          categoria do formulário de movimento, restrita à direção da
          seleção (só chega aqui a existir com direcaoUnica != null: o
          botão que a abre fica desativado caso contrário). */}
      {aCategorizarLote && (
        <Folha
          titulo="Categorizar"
          direcao="baixo"
          varianteFechar="circulo"
          aoDispensar={() => {
            setACategorizarLote(false)
            setErroLote(null)
          }}
        >
          {() => (
            <>
              {erroLote !== null && <CaixaErro>{erroLote}</CaixaErro>}
              <ListaDeOpcoes
                opcoes={opcoesCategoriaLote}
                valor=""
                aoEscolher={confirmarCategorizarLote}
              />
            </>
          )}
        </Folha>
      )}

      {/* Controlada por esta página — ver a nota no topo de
          FiltroMovimentos.tsx —, aberta a partir do "Filtros" da pílula. */}
      <FiltroMovimentos
        filtros={filtros}
        aoMudar={aoMudarFiltros}
        contas={contas}
        arvore={arvore}
        aberto={filtrosAbertos}
        aoFechar={() => setFiltrosAbertos(false)}
      />
    </div>
  )
}
