/*
 * PÁGINA CONTAS
 * =============
 *
 * É uma página de GESTÃO de contas (nível 2, uso ocasional). Não tem
 * análise: nada de saldo total agregado, nem subtotais por grupo — o
 * saldo total vive no Início. (Um total por baixo do título e subtotais
 * nos grupos chegaram a ser implementados e foram retirados: um número a
 * competir com o título, e demasiados números na coluna da direita.)
 *
 * Estrutura: na barra de topo (sempre visível), um "⋯" (menu de
 * ordenar/agrupar/sincronizar) e o "+" (nova conta); no conteúdo, o título
 * "Contas" (sem nada por baixo), um campo de PROCURA e a seguir as contas
 * numa LISTA que ocupa a largura do ecrã (sem cartão), com linhas
 * separadas por um traço fino. Cada linha tem o monograma do banco à
 * esquerda, o nome da conta e o saldo à direita; sem chevron — a linha
 * inteira é tocável. Tocar numa linha abre o detalhe (/contas/:id), onde
 * se edita ou apaga. Uma conta ligada ao banco tem, sobre o monograma, um
 * pequeno ícone com o ESTADO da ligação (ver SeloLigacao, abaixo).
 *
 * A procura filtra por nome, banco ou tipo. O menu "⋯" abre ao estilo do
 * menu da app Notas do iOS: primeiro mostra duas linhas — "Ordenar por" e
 * "Agrupar por", cada uma com um chevron; tocar numa delas troca o
 * conteúdo do mesmo painel pela lista de opções dessa secção (com uma
 * linha "‹" no topo para voltar). Ordenar tem o campo (nome ou saldo) e a
 * direção (ascendente ou descendente); agrupar tem não agrupar · por tipo
 * · por banco (o cabeçalho de cada grupo mostra só o nome do grupo).
 * Escolher uma opção fecha o menu. As escolhas ficam guardadas no browser
 * (localStorage). Por baixo, separado por uma linha, "Sincronizar agora"
 * pede ao banco os movimentos novos de todas as contas com a ligação ainda
 * válida (desativado, com a razão por baixo, quando não há nenhuma).
 *
 * MODO DE PESQUISA (só em telemóvel): ao tocar no campo de procura, o
 * título e a barra de topo (☰, ⋯, +) saem de cena e o campo SOBE até ao
 * topo do ecrã, onde fica fixo, com um "‹" à esquerda para sair — o
 * padrão do WhatsApp e das apps do iOS, que dá todo o ecrã aos
 * resultados. Ver ModoPesquisa, mais abaixo, e a nota no componente.
 *
 * Estados: a carregar (esqueleto), erro (com "Tentar outra vez"), sem
 * contas (estado vazio, com os dois caminhos de "Nova conta"), sem
 * resultados de pesquisa (com "Ver todas as contas"), e a lista. Os três
 * estados com mensagem partilham a mesma forma: um ícone num círculo, um
 * título, um texto e os botões da aplicação (Botao/LinkBotao).
 *
 * Desenho decidido no canvas de design de Contas («1 · Contas»).
 */

import { useQueryClient } from '@tanstack/react-query'
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

import { Link } from 'react-router-dom'

import { useAuth } from '../auth/useAuth'
import { useContas } from '../hooks/useContas'
import { CHAVES } from '../lib/consultas'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { Avatar } from '../componentes/Avatar'
import { Botao } from '../componentes/Botao'
import { CabecalhoPagina } from '../componentes/CabecalhoPagina'
import { CampoPesquisa } from '../componentes/CampoPesquisa'
import {
  IconeAlerta,
  IconeBanco,
  IconeCamadas,
  IconeChevronDireita,
  IconeChevronEsquerda,
  IconeLigacao,
  IconeLigacaoPartida,
  IconeLupa,
  IconeMais,
  IconeOrdenar,
  IconeReticencias,
  IconeSincronizar,
} from '../componentes/icones'
import { LinkBotao } from '../componentes/LinkBotao'
import { Menu, MenuItem, MenuSeparador } from '../componentes/Menu'
import {
  estadoLigacao,
  valorParaComparar,
  type Conta,
  type EstadoLigacao,
} from '../lib/contas'
import { formatarDinheiro } from '../lib/moedas'
import { ErroApi } from '../lib/http'
import { sincronizar } from '../lib/openBanking'
import estilos from './Contas.module.css'
import { DURACAO_DESLOCAR_MS } from '../lib/movimento'

type Estado =
  | { fase: 'a-carregar' }
  | { fase: 'erro'; mensagem: string }
  | { fase: 'pronto'; contas: Conta[] }

// --- Opções de visualização: ordenar e agrupar ---

// Ordenar tem duas escolhas independentes: o CAMPO (por que se ordena) e a
// DIREÇÃO (crescente/decrescente). Combinadas, dão 4 ordens possíveis.
const CAMPOS_ORDEM = ['nome', 'saldo'] as const
type CampoOrdem = (typeof CAMPOS_ORDEM)[number]
const ROTULO_CAMPO: Record<CampoOrdem, string> = {
  nome: 'Nome',
  saldo: 'Saldo',
}

const DIRECOES = ['asc', 'desc'] as const
type Direcao = (typeof DIRECOES)[number]
const ROTULO_DIRECAO: Record<Direcao, string> = {
  asc: 'Ascendente',
  desc: 'Descendente',
}

const AGRUPAMENTOS = ['nenhum', 'tipo', 'banco'] as const
type Agrupamento = (typeof AGRUPAMENTOS)[number]
const ROTULO_AGRUPAMENTO: Record<Agrupamento, string> = {
  nenhum: 'Não agrupar',
  tipo: 'Por tipo',
  banco: 'Por banco',
}

// Chaves onde as escolhas ficam guardadas no browser.
const CHAVE_CAMPO = 'contasOrdemCampo'
const CHAVE_DIRECAO = 'contasOrdemDirecao'
const CHAVE_AGRUPAMENTO = 'contasAgrupamento'

// O acesso ao localStorage vai sempre dentro de try/catch: pode não estar
// disponível (janela privada, armazenamento desativado) e nesses casos
// lança excepção. "validos" filtra um valor guardado que já não exista.
function lerPreferencia<T extends string>(
  chave: string,
  validos: readonly T[],
  omissao: T,
): T {
  try {
    const guardado = localStorage.getItem(chave)
    return validos.includes(guardado as T) ? (guardado as T) : omissao
  } catch {
    return omissao
  }
}

function guardarPreferencia(chave: string, valor: string): void {
  try {
    localStorage.setItem(chave, valor)
  } catch {
    // Sem localStorage — a preferência simplesmente não persiste.
  }
}

/** Devolve uma cópia das contas ordenadas pelo campo escolhido (nome ou
 *  saldo), na direção escolhida (ascendente ou descendente).
 *
 *  Por SALDO compara-se o saldo CONVERTIDO para a moeda principal do
 *  utilizador (a definida em Perfil › Preferências — ver
 *  valorParaComparar, em src/lib/contas.ts), nunca o saldo na moeda de
 *  cada conta: comparar 640 dólares com 600 euros pelos números puros
 *  daria uma ordem errada. Uma conta sem taxa de câmbio (sem valor
 *  convertido) não tem com que se comparar — vai sempre para o FIM, em
 *  qualquer direção, por ordem de nome entre si. */
function ordenarContas(contas: Conta[], campo: CampoOrdem, direcao: Direcao): Conta[] {
  const sinal = direcao === 'desc' ? -1 : 1
  return [...contas].sort((a, b) => {
    if (campo === 'saldo') {
      const va = valorParaComparar(a)
      const vb = valorParaComparar(b)
      if (va === null || vb === null) {
        if (va === null && vb === null) return a.nome.localeCompare(b.nome, 'pt')
        return va === null ? 1 : -1
      }
      return sinal * (va - vb)
    }
    return sinal * a.nome.localeCompare(b.nome, 'pt')
  })
}

/** Reparte as contas em grupos (por tipo ou por banco), cada grupo por
 *  ordem alfabética do seu nome; a ordem das contas DENTRO de cada grupo é
 *  a que vier (já ordenada). "nenhum" devolve um único grupo sem nome.
 *  Contas sem o campo caem num grupo "Sem tipo" / "Sem banco". */
function agruparContas(contas: Conta[], agrupamento: Agrupamento): [string, Conta[]][] {
  if (agrupamento === 'nenhum') return [['', contas]]
  const semRotulo = agrupamento === 'tipo' ? 'Sem tipo' : 'Sem banco'
  const grupos = new Map<string, Conta[]>()
  for (const conta of contas) {
    const chave = (agrupamento === 'tipo' ? conta.tipo : conta.banco) || semRotulo
    const lista = grupos.get(chave) ?? []
    lista.push(conta)
    grupos.set(chave, lista)
  }
  return [...grupos.entries()].sort(([a], [b]) => a.localeCompare(b, 'pt'))
}

/** "1 movimento novo" / "N movimentos novos" — o resultado de
 *  "Sincronizar agora". */
function textoMovimentosNovos(n: number): string {
  if (n === 0) return 'Atualizado · sem movimentos novos'
  return n === 1 ? 'Atualizado · 1 movimento novo' : `Atualizado · ${n} movimentos novos`
}

/** Tira acentos e passa a minúsculas — para a pesquisa ignorar maiúsculas
 *  e acentos ("à ordem" encontra-se com "a ordem"). */
function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

/** Uma conta corresponde à pesquisa se o texto aparecer no nome, no banco
 *  ou no tipo. */
function corresponde(conta: Conta, pesquisa: string): boolean {
  const alvo = normalizar([conta.nome, conta.banco, conta.tipo].filter(Boolean).join(' '))
  return alvo.includes(normalizar(pesquisa))
}

/** Esqueleto mostrado enquanto as contas carregam: três linhas de exemplo,
 *  cada uma com um círculo (o lugar do monograma) e uma barra cinzenta (o
 *  lugar do nome), a pulsar devagar. */
function Esqueleto() {
  return (
    <div className={estilos.lista} role="status" aria-label="A carregar contas">
      {[0, 1, 2].map((indice) => (
        <div key={indice} className={estilos.cartao}>
          <span className={`${estilos.esqueleto} ${estilos.esqueletoAvatar}`} />
          <span className={`${estilos.esqueleto} ${estilos.esqueletoNome}`} />
        </div>
      ))}
    </div>
  )
}

/** O que o leitor de ecrã ouve sobre o estado da ligação de uma conta —
 *  o ícone (SeloLigacao) é só visual. */
const DESCRICAO_LIGACAO: Record<EstadoLigacao, string> = {
  ligada: 'ligada ao banco',
  'a-expirar': 'ligação ao banco a expirar',
  expirada: 'ligação ao banco expirada',
}

/** O pequeno ícone sobre o monograma de uma conta ligada ao banco, com o
 *  estado da ligação (ver estadoLigacao, em src/lib/contas.ts):
 *  - "ligada": círculo escuro com dois elos de corrente;
 *  - "a-expirar" (7 dias ou menos de validade): âmbar, com "!";
 *  - "expirada": vermelho, com a corrente partida.
 *  Só o ícone, sem texto na linha — decisão de desenho: a lista fica
 *  limpa, e a página da conta (onde o mesmo estado aparece por extenso,
 *  com as mesmas cores e símbolos) explica o que significa. É decorativo
 *  para leitores de ecrã ("aria-hidden"): o estado vai, em texto, dentro
 *  da própria linha (ver CartaoConta). */
function SeloLigacao({ estado }: { estado: EstadoLigacao }) {
  const classe = {
    ligada: estilos.seloLigada,
    'a-expirar': estilos.seloAExpirar,
    expirada: estilos.seloExpirada,
  }[estado]
  return (
    <span className={`${estilos.selo} ${classe}`} aria-hidden="true">
      {estado === 'ligada' && <IconeLigacao tamanho={10} traco={3} />}
      {estado === 'a-expirar' && <span className={estilos.seloExclamacao}>!</span>}
      {estado === 'expirada' && <IconeLigacaoPartida tamanho={10} traco={3} />}
    </span>
  )
}

/** Uma linha da lista: o monograma do banco (círculo colorido com a
 *  inicial), o nome da conta + o código da sua moeda por baixo, e o saldo
 *  à direita. O mesmo monograma aparece na página de detalhe da conta,
 *  para a identidade visual ser a mesma nos dois sítios.
 *
 *  Sem banco nem tipo por baixo do nome (só a moeda): banco e tipo servem
 *  para procurar e agrupar, e ter tudo em cada linha carregava a lista de
 *  informação a mais. Sem chevron: numa lista de lado a lado, sem cartão,
 *  a linha inteira lê-se como tocável e o realce ao toque confirma-o.
 *
 *  O código da moeda ("EUR", "USD") aparece SEMPRE por baixo do nome,
 *  mesmo quando é igual à moeda principal — para todas as linhas terem a
 *  mesma forma (nome + moeda), em vez de umas terem uma segunda linha e
 *  outras não, consoante a conta.
 *
 *  CONVERSÃO: já do lado do saldo — quando a moeda da conta é diferente
 *  da moeda principal do utilizador (ver PerfilPreferencias.tsx) e o
 *  backend conseguiu calcular a conversão (saldo_convertido não é null —
 *  falta de taxas de câmbio, por exemplo, é o único caso em que é), o
 *  saldo a negrito passa a ser o CONVERTIDO, com o valor original por
 *  baixo, mais pequeno. Sem conversão disponível (mesma moeda, ou sem
 *  taxa), mostra-se só o saldo, sem essa segunda linha — mostrar o mesmo
 *  valor duas vezes seria só ruído. */
function CartaoConta({ conta }: { conta: Conta }) {
  const { utilizador } = useAuth()
  const negativo = Number(conta.saldo) < 0
  const moedaPrincipal = utilizador?.moeda_principal ?? 'EUR'
  const mostraConversao = conta.moeda !== moedaPrincipal && conta.saldo_convertido !== null
  const ligacao = conta.ligacao ? estadoLigacao(conta.ligacao.valido_ate) : null

  return (
    <Link to={`/contas/${conta.id}`} className={estilos.cartao}>
      {/* O invólucro "marca" é o ponto de referência (position: relative)
          para o ícone do estado da ligação, colado ao canto do monograma. */}
      <span className={estilos.marca}>
        <Avatar nome={conta.banco || conta.nome} />
        {ligacao && <SeloLigacao estado={ligacao} />}
      </span>
      <span className={estilos.cartaoIdentidade}>
        <span className={estilos.cartaoNome}>{conta.nome}</span>
        <span className={estilos.cartaoMoeda}>{conta.moeda}</span>
        {/* Invisível no ecrã, lido pelos leitores de ecrã como parte do
            link: o equivalente em texto do ícone do estado da ligação. */}
        {ligacao && <span className={estilos.apenasLeitor}>, {DESCRICAO_LIGACAO[ligacao]}</span>}
      </span>
      <span className={estilos.cartaoValores}>
        <span
          className={
            negativo ? `${estilos.cartaoSaldo} ${estilos.negativo}` : estilos.cartaoSaldo
          }
        >
          {mostraConversao
            ? formatarDinheiro(conta.saldo_convertido as string, moedaPrincipal)
            : formatarDinheiro(conta.saldo, conta.moeda)}
        </span>
        {mostraConversao && (
          <span className={estilos.cartaoSaldoOriginal}>
            {formatarDinheiro(conta.saldo, conta.moeda)}
          </span>
        )}
      </span>
    </Link>
  )
}

/** O menu "⋯" da barra de topo — ordenar e agrupar num só painel, ao
 *  estilo do menu da app Notas do iOS.
 *
 *  O painel tem três "vistas", controladas pelo estado "seccao":
 *  - null: as duas linhas-raiz, "Ordenar por" e "Agrupar por", cada uma
 *    com um chevron à direita. Têm "mantemAberto", por isso tocar numa
 *    NÃO fecha o menu — só troca a vista.
 *  - 'ordenar': linha "‹ Ordenar por" (volta a null; também "mantemAberto")
 *    seguida do campo (nome/saldo) e da direção (ascendente/descendente).
 *  - 'agrupar': linha "‹ Agrupar por" seguida de não agrupar / por tipo /
 *    por banco.
 *  As linhas de opção não têm "mantemAberto": ao serem tocadas, aplicam a
 *  escolha e o menu fecha (o painel fecha a qualquer clique que lhe chegue
 *  por propagação).
 *
 *  "seccao" volta a null sempre que o gatilho é tocado, para o menu abrir
 *  sempre na vista-raiz.
 *
 *  Alinhamento do painel: em mobile é "pagina" (o painel ancora-se à
 *  margem direita da PÁGINA, porque o gatilho vive na barra de topo fixa);
 *  em ecrã largo, onde o gatilho está no cabeçalho normal e não há barra
 *  fixa por perto, usa-se "direita" (painel ancorado ao próprio gatilho).
 *  Sem esta distinção, em desktop o painel "pagina" posicionava-se
 *  relativo à moldura fixa e caía fora do ecrã. */
function MenuOrdenarAgrupar({
  campoOrdem,
  direcao,
  agrupamento,
  aoMudarCampo,
  aoMudarDirecao,
  aoMudarAgrupamento,
  semSincronizar,
  aoSincronizar,
}: {
  campoOrdem: CampoOrdem
  direcao: Direcao
  agrupamento: Agrupamento
  aoMudarCampo: (valor: CampoOrdem) => void
  aoMudarDirecao: (valor: Direcao) => void
  aoMudarAgrupamento: (valor: Agrupamento) => void
  // A razão por que "Sincronizar agora" está indisponível (ex.: "Nenhuma
  // conta ligada"), ou null quando está disponível.
  semSincronizar: string | null
  aoSincronizar: () => void
}) {
  const [seccao, setSeccao] = useState<'ordenar' | 'agrupar' | null>(null)
  // "true" quando a vista-raiz aparece por se ter RECUADO de um submenu —
  // só então desliza (ao abrir o menu, já é o painel inteiro que entra).
  const [recuou, setRecuou] = useState(false)
  const eMobile = useMediaQuery('(max-width: 768px)')

  return (
    <Menu
      posicao="baixo"
      alinhamento={eMobile ? 'pagina' : 'direita'}
      gatilho={({ aberto, alternar }) => (
        <button
          type="button"
          className={estilos.acaoIcone}
          // "Mais opções" e não "Ordenar e agrupar": o menu também tem
          // "Sincronizar agora".
          aria-label="Mais opções"
          aria-haspopup="menu"
          aria-expanded={aberto}
          onClick={() => {
            setSeccao(null)
            setRecuou(false)
            alternar()
          }}
        >
          <IconeReticencias tamanho={22} />
        </button>
      )}
    >
      {/* Cada vista do painel vive num invólucro com "key" própria: ao
          trocar de vista, o React cria um elemento novo e a animação de
          entrada (".menuVista") corre — a vista nova entra a desvanecer e
          a deslizar ligeiramente do lado para onde se navega, em vez de
          substituir a anterior de golpe. */}
      {seccao === null && (
        <div
          key="raiz"
          className={recuou ? `${estilos.menuVista} ${estilos.menuVistaRecua}` : estilos.menuVistaFixa}
        >
          {/* Os três itens têm ícone — numa mesma lista, ou todos têm ou
              nenhum tem, para os rótulos ficarem alinhados. */}
          <MenuItem
            mantemAberto
            icone={<IconeOrdenar />}
            sufixo={<IconeChevronDireita tamanho={16} />}
            onClick={() => setSeccao('ordenar')}
          >
            Ordenar por
          </MenuItem>
          <MenuItem
            mantemAberto
            icone={<IconeCamadas />}
            sufixo={<IconeChevronDireita tamanho={16} />}
            onClick={() => setSeccao('agrupar')}
          >
            Agrupar por
          </MenuItem>
          <MenuSeparador />
          {/* Sempre visível — mesmo sem contas ligadas, para ensinar que
              existe; nesse caso fica desativado e diz porquê por baixo. */}
          <MenuItem
            icone={<IconeSincronizar />}
            desativado={semSincronizar !== null}
            descricao={semSincronizar ?? undefined}
            onClick={aoSincronizar}
          >
            Sincronizar agora
          </MenuItem>
        </div>
      )}

      {seccao === 'ordenar' && (
        <div key="ordenar" className={estilos.menuVista}>
          <MenuItem
            mantemAberto
            onClick={() => {
              setSeccao(null)
              setRecuou(true)
            }}
          >
            <span className={estilos.menuVoltar}>
              <IconeChevronEsquerda tamanho={16} />
              Ordenar por
            </span>
          </MenuItem>
          <MenuSeparador />
          {CAMPOS_ORDEM.map((opcao) => (
            <MenuItem
              key={opcao}
              onClick={() => aoMudarCampo(opcao)}
              selecionado={opcao === campoOrdem}
            >
              {ROTULO_CAMPO[opcao]}
            </MenuItem>
          ))}
          <MenuSeparador />
          {DIRECOES.map((opcao) => (
            <MenuItem
              key={opcao}
              onClick={() => aoMudarDirecao(opcao)}
              selecionado={opcao === direcao}
            >
              {ROTULO_DIRECAO[opcao]}
            </MenuItem>
          ))}
        </div>
      )}

      {seccao === 'agrupar' && (
        <div key="agrupar" className={estilos.menuVista}>
          <MenuItem
            mantemAberto
            onClick={() => {
              setSeccao(null)
              setRecuou(true)
            }}
          >
            <span className={estilos.menuVoltar}>
              <IconeChevronEsquerda tamanho={16} />
              Agrupar por
            </span>
          </MenuItem>
          <MenuSeparador />
          {AGRUPAMENTOS.map((opcao) => (
            <MenuItem
              key={opcao}
              onClick={() => aoMudarAgrupamento(opcao)}
              selecionado={opcao === agrupamento}
            >
              {ROTULO_AGRUPAMENTO[opcao]}
            </MenuItem>
          ))}
        </div>
      )}
    </Menu>
  )
}

/** A forma comum dos estados com mensagem (erro, sem contas, procura sem
 *  resultados): um ícone num círculo, um título, um texto curto e, por
 *  baixo, os botões. Uma só peça para os três estados terem sempre o mesmo
 *  aspecto — ícone no mesmo círculo, botões da aplicação (Botao/LinkBotao)
 *  com o mesmo raio. "papel" põe role="alert" no erro, para um leitor de
 *  ecrã o anunciar logo. */
function EstadoMensagem({
  icone,
  titulo,
  texto,
  acoes,
  papel,
}: {
  icone: ReactNode
  titulo: string
  texto: string
  acoes: ReactNode
  papel?: 'alert'
}) {
  return (
    <div className={estilos.estado} role={papel}>
      <span className={estilos.estadoIcone} aria-hidden="true">
        {icone}
      </span>
      <p className={estilos.estadoTitulo}>{titulo}</p>
      <p className={estilos.estadoTexto}>{texto}</p>
      <div className={estilos.estadoAcoes}>{acoes}</div>
    </div>
  )
}

/* MODO DE PESQUISA — as quatro fases de uma ida e volta:
 *   "normal"   → o campo está no seu sítio, por baixo do título;
 *   "a-entrar" → o campo acabou de passar a FIXO no topo do ecrã, mas é
 *                desenhado (por um instante, sem animação) exactamente
 *                onde estava, e a seguir desliza até ao topo;
 *   "pesquisa" → fixo no topo, com "‹" para sair;
 *   "a-sair"   → desliza de volta para onde estava; no fim, "normal".
 *
 * PORQUÊ O MESMO CAMPO, e não um campo novo no topo: trocar o elemento
 * fecharia o teclado no iPhone (o foco perde-se quando o <input>
 * desaparece). Por isso é o MESMO elemento que muda de "position" — e a
 * animação usa a técnica FLIP ("First, Last, Invert, Play"): mede-se onde
 * o campo estava (First) e onde ficou (Last), desenha-se deslocado pela
 * diferença (Invert) e anima-se esse deslocamento até zero (Play). Assim
 * anima-se só "transform", que o browser consegue animar suavemente, em
 * vez de "top" ou "height". */
type ModoPesquisa = 'normal' | 'a-entrar' | 'pesquisa' | 'a-sair'

// Duração do deslizar — a de "deslocar" (src/lib/movimento.ts, igual à
// variável --movimento-deslocar usada em Contas.module.css, ".procuraFixa",
// e na barra de topo a sair).
const DURACAO_PESQUISA = DURACAO_DESLOCAR_MS

export function Contas() {
  // As contas vêm da cache partilhada (hooks/useContas.ts, e a explicação
  // da cache em lib/consultas.ts). Esta página fica montada por baixo do
  // detalhe e da "Nova conta" (a pilha de páginas); quando lá em cima se
  // cria, edita ou elimina uma conta, quem o faz invalida a chave
  // ['contas'], e esta lista actualiza-se sozinha — sem refresh e sem
  // voltar ao esqueleto de carregamento (a lista antiga fica à vista até
  // chegar a nova).
  const consultaContas = useContas()
  // O "estado" que o resto da página usa, derivado da consulta:
  //   - com dados (mesmo que uma actualização em segundo plano tenha
  //     falhado), mostra-os;
  //   - sem dados e com erro (e sem novo pedido a decorrer), o erro;
  //   - senão, a carregar (o primeiro pedido, ou "Tentar outra vez").
  const estado: Estado = consultaContas.data
    ? { fase: 'pronto', contas: consultaContas.data }
    : consultaContas.error && !consultaContas.isFetching
      ? {
          fase: 'erro',
          mensagem:
            consultaContas.error instanceof ErroApi
              ? consultaContas.error.message
              : 'Não foi possível carregar as contas.',
        }
      : { fase: 'a-carregar' }
  const clienteConsultas = useQueryClient()
  const [pesquisa, setPesquisa] = useState('')

  // --- Modo de pesquisa (ver a nota MODO DE PESQUISA, acima) ---
  const eMobile = useMediaQuery('(max-width: 768px)')
  const [modo, setModo] = useState<ModoPesquisa>('normal')
  // O invólucro do campo (o elemento que passa a fixo e desliza).
  const procuraRef = useRef<HTMLDivElement>(null)
  // Onde o campo estava antes de subir (distância ao topo do ecrã) —
  // guardado ao entrar, para o "Invert". É uma "ref" (não estado) porque
  // só é lida no efeito da animação, nunca para desenhar a página.
  const origemTopoRef = useRef(0)
  // A altura que o campo ocupava — essa sim desenhada (é a do espaço
  // reservado no seu lugar, ver ".procuraEspaco"), por isso é estado.
  const [alturaProcura, setAlturaProcura] = useState(0)
  // Deslocamento usado no "Invert" — guardado para a viagem de volta.
  const deslocamentoRef = useRef(0)

  function entrarNaPesquisa() {
    if (!eMobile || modo !== 'normal' || !procuraRef.current) return
    const caixa = procuraRef.current.getBoundingClientRect()
    origemTopoRef.current = caixa.top
    setAlturaProcura(caixa.height)
    setModo('a-entrar')
  }

  function sairDaPesquisa() {
    if (modo !== 'pesquisa') return
    setPesquisa('')
    // Tira o foco do campo — fecha o teclado.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    // A lista pode ter sido rolada durante a pesquisa: volta-se ao topo,
    // para o campo regressar ao sítio exacto de onde partiu.
    procuraRef.current?.closest('main')?.scrollTo({ top: 0 })
    setModo('a-sair')
  }

  // O espaço reservado no lugar do campo (ver ".procuraEspaco"). A sua
  // altura é gerida aqui, directamente no elemento, e não pelo React — tem
  // de mudar no MESMO instante em que o campo começa a deslizar (ver o
  // efeito abaixo); passando pelo estado do React, mudava um quadro
  // depois, e a lista e o campo arrancavam fora de tempo.
  const espacoRef = useRef<HTMLDivElement>(null)
  // A fase anterior — para saber, ao chegar a "normal", se se vem de
  // "a-sair" (e é preciso arrumar os estilos da animação).
  const modoAnteriorRef = useRef<ModoPesquisa>('normal')

  // FLIP: corre depois de o React aplicar as classes da nova fase, mas
  // ANTES de o browser pintar — por isso nenhum estado intermédio chega a
  // ver-se. Mexe directamente no estilo dos elementos (e não em estado
  // React): são valores de animação de um só instante, não parte do que a
  // página mostra.
  //
  // A técnica de cada arranque: (1) pôr o elemento no ponto de partida SEM
  // transição; (2) forçar o browser a calcular esse estado já (ler
  // "offsetHeight" obriga-o a isso — "reflow"); (3) repor a transição e
  // pôr o valor final. Como o browser já "viu" o ponto de partida, anima
  // dele até ao final — no próximo quadro, sem esperar quadros a mais.
  useLayoutEffect(() => {
    const elemento = procuraRef.current
    const espaco = espacoRef.current
    const anterior = modoAnteriorRef.current
    modoAnteriorRef.current = modo
    if (!elemento) return

    if (modo === 'a-entrar') {
      // "Last": onde o campo ficou, já fixo no topo. O "padding-top" do
      // campo fixo (a margem da barra de estado do iPhone, mais um pouco)
      // não existia no sítio de origem — desconta-se, para o CAMPO (e não
      // a caixa à volta) partir exactamente de onde estava.
      const fixo = elemento.getBoundingClientRect()
      const margemTopo = parseFloat(getComputedStyle(elemento).paddingTop) || 0
      deslocamentoRef.current = origemTopoRef.current - fixo.top - margemTopo
      // (1) "Invert": o campo de volta onde estava; o espaço reservado com
      // a altura que o campo ocupava.
      elemento.style.transition = 'none'
      elemento.style.transform = `translateY(${deslocamentoRef.current}px)`
      if (espaco) {
        espaco.style.transition = 'none'
        espaco.style.height = `${alturaProcura}px`
      }
      // (2) Obrigar o browser a calcular este ponto de partida.
      void elemento.offsetHeight
      // (3) "Play": tudo a caminho do lugar final, a partir do mesmo
      // quadro — o campo sobe, o espaço reservado encolhe (e a lista sobe
      // com ele), o título recolhe-se (pela classe, já aplicada).
      elemento.style.transition = ''
      elemento.style.transform = ''
      if (espaco) {
        espaco.style.transition = ''
        espaco.style.height = '0px'
      }
      // "pesquisa" já não muda nada visível — só marca que a entrada
      // acabou de arrancar (e que "‹" pode sair).
      const quadro = requestAnimationFrame(() => setModo('pesquisa'))
      return () => cancelAnimationFrame(quadro)
    }

    if (modo === 'a-sair') {
      // O caminho inverso: o campo desce até onde estava, o espaço
      // reservado volta a crescer, o título reaparece (pela classe).
      elemento.style.transform = `translateY(${deslocamentoRef.current}px)`
      if (espaco) espaco.style.height = `${alturaProcura}px`
      const temporizador = window.setTimeout(() => setModo('normal'), DURACAO_PESQUISA)
      return () => window.clearTimeout(temporizador)
    }

    if (modo === 'normal' && anterior === 'a-sair') {
      // O campo voltou a ser um elemento normal da página (a classe "fixa"
      // já saiu). Tira-se o deslocamento que lhe sobrava SEM transição:
      // com transição, o browser animava esse resto e o campo dava um
      // salto de ~120px para baixo antes de voltar ao sítio — era o
      // "comportamento estranho" no fim da saída.
      elemento.style.transition = 'none'
      elemento.style.transform = ''
      void elemento.offsetHeight
      elemento.style.transition = ''
    }
  }, [modo, alturaProcura])

  const emPesquisa = modo !== 'normal'
  // Título e barra de topo recolhidos durante a ida e a estadia no topo;
  // na volta ("a-sair") reaparecem em simultâneo com o campo a descer.
  const recolhido = modo === 'a-entrar' || modo === 'pesquisa'

  // Ao rolar para além do título grande (ver "colapsavel" em
  // <CabecalhoPagina>, mais abaixo), o campo de procura desvanece-se em
  // sincronia com ele — os dois "desaparecem" como um só gesto.
  const [cabecalhoColapsado, setCabecalhoColapsado] = useState(false)

  // Ordenação e agrupamento: valor inicial lido do browser, uma vez.
  const [campoOrdem, setCampoOrdem] = useState<CampoOrdem>(() =>
    lerPreferencia(CHAVE_CAMPO, CAMPOS_ORDEM, 'nome'),
  )
  const [direcao, setDirecao] = useState<Direcao>(() =>
    lerPreferencia(CHAVE_DIRECAO, DIRECOES, 'asc'),
  )
  const [agrupamento, setAgrupamento] = useState<Agrupamento>(() =>
    lerPreferencia(CHAVE_AGRUPAMENTO, AGRUPAMENTOS, 'nenhum'),
  )

  function mudarCampoOrdem(novo: CampoOrdem) {
    setCampoOrdem(novo)
    guardarPreferencia(CHAVE_CAMPO, novo)
  }

  function mudarDirecao(nova: Direcao) {
    setDirecao(nova)
    guardarPreferencia(CHAVE_DIRECAO, nova)
  }

  function mudarAgrupamento(novo: Agrupamento) {
    setAgrupamento(novo)
    guardarPreferencia(CHAVE_AGRUPAMENTO, novo)
  }

  // "Sincronizar agora": o aviso no fundo do ecrã — "a decorrer" fica
  // visível até terminar; o resultado desaparece sozinho (animação CSS).
  // "chave" muda a cada aviso novo, para a animação recomeçar.
  const [aviso, setAviso] = useState<{ texto: string; aDecorrer: boolean; chave: number } | null>(
    null,
  )

  // "Tentar outra vez" (no estado de erro): pede a lista de novo.
  function tentarOutraVez() {
    void consultaContas.refetch()
  }

  const temContas = estado.fase === 'pronto' && estado.contas.length > 0
  // Contas que se podem sincronizar: ligadas ao banco e com a ligação
  // ainda válida (uma ligação expirada já não recebe nada do banco: é
  // preciso voltar a autorizar o banco, em Nova conta › Ligar um banco, e
  // a ligação dessa conta renova-se sozinha).
  const contasLigadas =
    estado.fase === 'pronto' ? estado.contas.filter((conta) => conta.ligacao !== null) : []
  const contasSincronizaveis = contasLigadas.filter(
    (conta) => conta.ligacao && estadoLigacao(conta.ligacao.valido_ate) !== 'expirada',
  )
  // A razão por que "Sincronizar agora" está indisponível, ou null.
  const semSincronizar =
    contasLigadas.length === 0
      ? 'Nenhuma conta ligada'
      : contasSincronizaveis.length === 0
        ? 'Todas as ligações expiraram'
        : null

  // Pede ao banco os movimentos novos de cada conta ligada, uma de cada
  // vez (em sequência, não em paralelo: são poucas contas, e pedidos em
  // simultâneo ao mesmo banco arriscam ser recusados). Uma conta que
  // falhe não impede as seguintes. No fim, recarrega a lista (os saldos
  // mudaram) e diz o resultado.
  async function sincronizarTodas() {
    if (semSincronizar !== null || aviso?.aDecorrer) return
    const n = contasSincronizaveis.length
    // "chave": um contador (a do aviso anterior + 1) — só tem de ser
    // diferente da anterior, para a animação recomeçar.
    setAviso((anterior) => ({
      texto: n === 1 ? 'A sincronizar 1 conta…' : `A sincronizar ${n} contas…`,
      aDecorrer: true,
      chave: (anterior?.chave ?? 0) + 1,
    }))
    let novos = 0
    let falhas = 0
    for (const conta of contasSincronizaveis) {
      try {
        const resultado = await sincronizar((conta.ligacao as NonNullable<Conta['ligacao']>).conta_ligada_id)
        novos += resultado.movimentos_importados
      } catch {
        falhas += 1
      }
    }
    setAviso((anterior) => ({
      texto:
        falhas === 0
          ? textoMovimentosNovos(novos)
          : falhas === 1
            ? 'Não foi possível sincronizar 1 conta'
            : `Não foi possível sincronizar ${falhas} contas`,
      aDecorrer: false,
      chave: (anterior?.chave ?? 0) + 1,
    }))
    // Os saldos mudaram: invalida as contas (a lista e o detalhe de cada
    // uma — ver CHAVES em lib/consultas.ts).
    void clienteConsultas.invalidateQueries({ queryKey: CHAVES.contas })
  }
  // Filtrar pela pesquisa → ordenar → repartir em grupos.
  const resultados =
    estado.fase === 'pronto'
      ? estado.contas.filter((conta) => corresponde(conta, pesquisa))
      : []
  const grupos = agruparContas(ordenarContas(resultados, campoOrdem, direcao), agrupamento)

  return (
    <div>
      {/* Invólucro do título: recolhe-se (altura até zero, e desvanece) no
          modo de pesquisa — é o que faz a lista subir para debaixo do
          campo, já no topo. Ver ".cabecalhoRecolhivel" no .module.css. */}
      <div
        className={
          recolhido
            ? `${estilos.cabecalhoRecolhivel} ${estilos.cabecalhoRecolhido}`
            : estilos.cabecalhoRecolhivel
        }
      >
        <div
          className={
            emPesquisa
              ? `${estilos.cabecalhoRecolhivelInterior} ${estilos.cabecalhoRecortado}`
              : estilos.cabecalhoRecolhivelInterior
          }
        >
          <CabecalhoPagina
            titulo="Contas"
            // Ao rolar para além do título, este passa a aparecer compacto na
            // barra de topo, ao lado do ☰ (ver a nota em useColapsarAoRolar.ts
            // e em BarraTopoMobile.tsx). "aoColapsar" sincroniza o campo de
            // procura, mais abaixo, com o mesmo momento.
            colapsavel
            aoColapsar={setCabecalhoColapsado}
            // No modo de pesquisa, a barra de topo sai de cena — o campo de
            // procura ocupa o seu lugar.
            barraEscondida={recolhido}
            // Durante a pesquisa, o título grande recolhe-se — e, para o
            // cabeçalho, isso parecia "ter rolado para baixo": mostrava o
            // título compacto na barra de topo, que se via de relance ao
            // sair da pesquisa. Suspende-se o colapso enquanto ela dura.
            suspenderColapso={emPesquisa}
            acao={
              temContas ? (
                <>
                  <MenuOrdenarAgrupar
                    campoOrdem={campoOrdem}
                    direcao={direcao}
                    agrupamento={agrupamento}
                    aoMudarCampo={mudarCampoOrdem}
                    aoMudarDirecao={mudarDirecao}
                    aoMudarAgrupamento={mudarAgrupamento}
                    semSincronizar={semSincronizar}
                    aoSincronizar={sincronizarTodas}
                  />
                  <LinkBotao para="/contas/nova" apenasIcone titulo="Nova conta">
                    <IconeMais tamanho={22} />
                  </LinkBotao>
                </>
              ) : undefined
            }
          />
        </div>
      </div>

      {estado.fase === 'a-carregar' && <Esqueleto />}

      {estado.fase === 'erro' && (
        <EstadoMensagem
          papel="alert"
          icone={<IconeAlerta tamanho={26} />}
          titulo="Não foi possível carregar as contas"
          texto={estado.mensagem}
          acoes={<Botao onClick={tentarOutraVez}>Tentar outra vez</Botao>}
        />
      )}

      {/* Sem contas: os mesmos dois caminhos de "Nova conta", com o banco
          primeiro (o recomendado). "via" na query string abre "Nova conta"
          já dentro do caminho escolhido (ver ContaNova.tsx). */}
      {estado.fase === 'pronto' && estado.contas.length === 0 && (
        <EstadoMensagem
          icone={<IconeBanco tamanho={26} />}
          titulo="Ainda não tens contas"
          texto="Liga o teu banco e os movimentos passam a entrar sozinhos. Também podes adicionar uma conta à mão, por exemplo a carteira."
          acoes={
            <>
              <LinkBotao para="/contas/nova?via=banco">Ligar um banco</LinkBotao>
              <LinkBotao para="/contas/nova?via=manual" variante="secundario">
                Adicionar manualmente
              </LinkBotao>
            </>
          }
        />
      )}

      {estado.fase === 'pronto' && estado.contas.length > 0 && (
        <>
          {/* Campo de procura, a ocupar a linha toda. Desvanece-se em
              sincronia com o título grande ao rolar para baixo (ver
              "aoColapsar" no <CabecalhoPagina>, acima) — o espaço que
              ocupa fica reservado, tal como o do título (ver a nota em
              useColapsarAoRolar.ts sobre o porquê de não se animar
              também a altura). "inert": enquanto invisível, o campo não
              deve continuar alcançável por Tab nem por um leitor de
              ecrã — tira-o da árvore de acessibilidade E da ordem de
              tabulação de uma só vez (ao contrário de "aria-hidden"
              sozinho, que não impede o foco por teclado). */}
          {/* No modo de pesquisa, o campo passa a fixo no topo e este
              espaço reservado ocupa o lugar que ele deixou — e encolhe a
              par com o título, para a lista subir suavemente (sem ele, a
              lista saltava de uma vez a altura do campo). */}
          {emPesquisa && <div ref={espacoRef} className={estilos.procuraEspaco} />}
          <div
            ref={procuraRef}
            className={[
              estilos.procura,
              emPesquisa && estilos.procuraFixa,
              // Ao rolar (fora do modo de pesquisa), desvanece com o título.
              !emPesquisa && cabecalhoColapsado && estilos.procuraEscondida,
            ]
              .filter(Boolean)
              .join(' ')}
            inert={!emPesquisa && cabecalhoColapsado}
            // Escape sai do modo de pesquisa, como o "‹".
            onKeyDown={(evento) => {
              if (evento.key === 'Escape') sairDaPesquisa()
            }}
          >
            {emPesquisa && (
              <button
                type="button"
                className={
                  modo === 'a-sair'
                    ? `${estilos.procuraSair} ${estilos.procuraSairASair}`
                    : estilos.procuraSair
                }
                aria-label="Sair da pesquisa"
                onClick={sairDaPesquisa}
              >
                <IconeChevronEsquerda tamanho={22} />
              </button>
            )}
            <div className={estilos.procuraCampo}>
              <CampoPesquisa
                valor={pesquisa}
                aoMudar={setPesquisa}
                placeholder="Procurar conta…"
                rotulo="Procurar conta"
                aoFocar={entrarNaPesquisa}
              />
            </div>
          </div>

          {/* Na saída da pesquisa, as contas que a pesquisa escondia voltam
              de uma vez — o invólucro faz a lista aparecer a desvanecer,
              em vez de surgir de golpe enquanto o resto ainda desliza. */}
          <div className={modo === 'a-sair' ? estilos.listaAReaparecer : undefined}>
            {resultados.length === 0 ? (
              <EstadoMensagem
                icone={<IconeLupa tamanho={26} />}
                titulo={`Nenhuma conta com «${pesquisa.trim()}»`}
                texto="Procura por nome, banco ou tipo."
                // "Ver todas as contas" (e não "Limpar pesquisa"): o campo de
                // procura já tem um "✕" com esse nome — dois botões com o
                // mesmo nome confundem quem usa um leitor de ecrã — e este
                // texto diz o resultado, não o mecanismo.
                acoes={
                  <Botao
                    variante="secundario"
                    // No modo de pesquisa (telemóvel), sai dele — de volta
                    // à página normal, com o título e a barra de topo;
                    // ficar com o campo vazio fixo no topo, sem foco, era
                    // estranho. Fora dele (ecrã largo), basta limpar.
                    onClick={() => (modo === 'pesquisa' ? sairDaPesquisa() : setPesquisa(''))}
                  >
                    Ver todas as contas
                  </Botao>
                }
              />
            ) : agrupamento === 'nenhum' ? (
              <div className={estilos.lista}>
                {grupos[0][1].map((conta) => (
                  <CartaoConta key={conta.id} conta={conta} />
                ))}
              </div>
            ) : (
              <div className={estilos.grupos}>
                {grupos.map(([nome, contasGrupo]) => (
                  <section key={nome} className={estilos.grupo}>
                    <div className={estilos.grupoCabecalho}>
                      <span className={estilos.grupoNome}>{nome}</span>
                    </div>
                    <div className={estilos.lista}>
                      {contasGrupo.map((conta) => (
                        <CartaoConta key={conta.id} conta={conta} />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* Aviso de "Sincronizar agora". "key" muda a cada aviso novo, para o
          React criar um elemento novo e a animação de saída recomeçar. */}
      {aviso && (
        <div
          key={aviso.chave}
          className={aviso.aDecorrer ? `${estilos.aviso} ${estilos.avisoADecorrer}` : estilos.aviso}
          role="status"
        >
          {aviso.aDecorrer ? (
            <span className={estilos.avisoRoda} aria-hidden="true" />
          ) : (
            <IconeSincronizar tamanho={16} />
          )}
          {aviso.texto}
        </div>
      )}
    </div>
  )
}
