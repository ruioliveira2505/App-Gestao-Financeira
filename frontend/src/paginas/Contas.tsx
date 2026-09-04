/*
 * PÁGINA CONTAS
 * =============
 *
 * É uma página de GESTÃO de contas (nível 2, uso ocasional). Não tem
 * análise: nada de saldo total agregado — isso vive no Início.
 *
 * Estrutura: na barra de topo (sempre visível), um "⋯" (menu de
 * ordenar/agrupar) e o "+" (nova conta); no conteúdo, o título "Contas"
 * com a contagem total por baixo, um campo de PROCURA e a seguir as contas
 * numa LISTA que ocupa a largura do ecrã (sem cartão), com linhas
 * separadas por um traço fino. Cada linha tem o monograma do banco à
 * esquerda, o nome da conta e o saldo à direita; sem chevron — a linha
 * inteira é tocável. Tocar numa linha abre o detalhe (/contas/:id), onde
 * se edita ou apaga.
 *
 * A procura filtra por nome, banco ou tipo. O menu "⋯" abre ao estilo do
 * menu da app Notas do iOS: primeiro mostra duas linhas — "Ordenar por" e
 * "Agrupar por", cada uma com um chevron; tocar numa delas troca o
 * conteúdo do mesmo painel pela lista de opções dessa secção (com uma
 * linha "‹" no topo para voltar). Ordenar tem o campo (nome ou saldo) e a
 * direção (ascendente ou descendente); agrupar tem não agrupar · por tipo
 * · por banco (o cabeçalho de cada grupo mostra a contagem de contas).
 * Escolher uma opção fecha o menu. As escolhas ficam guardadas no browser
 * (localStorage).
 *
 * Estados: a carregar (esqueleto), erro, sem contas (estado vazio), sem
 * resultados de pesquisa, e a lista.
 */

import { useEffect, useState } from 'react'

import { Link } from 'react-router-dom'

import { useMediaQuery } from '../hooks/useMediaQuery'
import { Avatar } from '../componentes/Avatar'
import { CabecalhoPagina } from '../componentes/CabecalhoPagina'
import {
  IconeChevronDireita,
  IconeChevronEsquerda,
  IconeLupa,
  IconeMais,
  IconeReticencias,
} from '../componentes/icones'
import { LinkBotao } from '../componentes/LinkBotao'
import { Menu, MenuItem, MenuSeparador } from '../componentes/Menu'
import { listarContas, type Conta } from '../lib/contas'
import { formatarDinheiro } from '../lib/moedas'
import { ErroApi } from '../lib/http'
import estilos from './Contas.module.css'

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
 *  saldo), na direção escolhida (ascendente ou descendente). */
function ordenarContas(contas: Conta[], campo: CampoOrdem, direcao: Direcao): Conta[] {
  const sinal = direcao === 'desc' ? -1 : 1
  return [...contas].sort((a, b) => {
    const base =
      campo === 'saldo'
        ? Number(a.saldo) - Number(b.saldo)
        : a.nome.localeCompare(b.nome, 'pt')
    return sinal * base
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

/** "1 conta" / "N contas" — usado no subtítulo da página (total) e à
 *  direita do cabeçalho de cada grupo (contas do grupo). */
function contagemGrupo(contas: Conta[]): string {
  return contas.length === 1 ? '1 conta' : `${contas.length} contas`
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

/** Uma linha da lista: o monograma do banco (círculo colorido com a
 *  inicial), o nome da conta e o saldo à direita. O mesmo monograma
 *  aparece na página de detalhe da conta, para a identidade visual ser a
 *  mesma nos dois sítios.
 *
 *  Só o nome, sem banco nem tipo por baixo: banco e tipo servem para
 *  procurar e agrupar, e ter tudo em cada linha carregava a lista de
 *  informação a mais. Sem chevron: numa lista de lado a lado, sem cartão,
 *  a linha inteira lê-se como tocável e o realce ao toque confirma-o.
 *
 *  A moeda da conta só aparecerá aqui quando houver conversão de câmbios
 *  (nessa altura, junto ao saldo, o valor na moeda da conta; o valor a
 *  negrito passa a ser o convertido). */
function CartaoConta({ conta }: { conta: Conta }) {
  const negativo = Number(conta.saldo) < 0

  return (
    <Link to={`/contas/${conta.id}`} className={estilos.cartao}>
      <Avatar nome={conta.banco || conta.nome} />
      <span className={estilos.cartaoNome}>{conta.nome}</span>
      <span
        className={
          negativo ? `${estilos.cartaoSaldo} ${estilos.negativo}` : estilos.cartaoSaldo
        }
      >
        {formatarDinheiro(conta.saldo, conta.moeda)}
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
}: {
  campoOrdem: CampoOrdem
  direcao: Direcao
  agrupamento: Agrupamento
  aoMudarCampo: (valor: CampoOrdem) => void
  aoMudarDirecao: (valor: Direcao) => void
  aoMudarAgrupamento: (valor: Agrupamento) => void
}) {
  const [seccao, setSeccao] = useState<'ordenar' | 'agrupar' | null>(null)
  const eMobile = useMediaQuery('(max-width: 768px)')

  return (
    <Menu
      posicao="baixo"
      alinhamento={eMobile ? 'pagina' : 'direita'}
      gatilho={({ aberto, alternar }) => (
        <button
          type="button"
          className={estilos.acaoIcone}
          aria-label="Ordenar e agrupar"
          aria-haspopup="menu"
          aria-expanded={aberto}
          onClick={() => {
            setSeccao(null)
            alternar()
          }}
        >
          <IconeReticencias tamanho={22} />
        </button>
      )}
    >
      {seccao === null && (
        <>
          <MenuItem
            mantemAberto
            sufixo={<IconeChevronDireita tamanho={16} />}
            onClick={() => setSeccao('ordenar')}
          >
            Ordenar por
          </MenuItem>
          <MenuItem
            mantemAberto
            sufixo={<IconeChevronDireita tamanho={16} />}
            onClick={() => setSeccao('agrupar')}
          >
            Agrupar por
          </MenuItem>
        </>
      )}

      {seccao === 'ordenar' && (
        <>
          <MenuItem mantemAberto onClick={() => setSeccao(null)}>
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
        </>
      )}

      {seccao === 'agrupar' && (
        <>
          <MenuItem mantemAberto onClick={() => setSeccao(null)}>
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
        </>
      )}
    </Menu>
  )
}

export function Contas() {
  const [estado, setEstado] = useState<Estado>({ fase: 'a-carregar' })
  const [pesquisa, setPesquisa] = useState('')

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

  useEffect(() => {
    let activo = true
    listarContas()
      .then((contas) => {
        if (activo) setEstado({ fase: 'pronto', contas })
      })
      .catch((erro) => {
        if (!activo) return
        const mensagem =
          erro instanceof ErroApi ? erro.message : 'Não foi possível carregar as contas.'
        setEstado({ fase: 'erro', mensagem })
      })
    return () => {
      activo = false
    }
  }, [])

  const temContas = estado.fase === 'pronto' && estado.contas.length > 0
  // Filtrar pela pesquisa → ordenar → repartir em grupos.
  const resultados =
    estado.fase === 'pronto'
      ? estado.contas.filter((conta) => corresponde(conta, pesquisa))
      : []
  const grupos = agruparContas(ordenarContas(resultados, campoOrdem, direcao), agrupamento)

  return (
    <div>
      <CabecalhoPagina
        titulo="Contas"
        // Contagem total de contas (não a filtrada) por baixo do título —
        // é informação de gestão, não de análise, por isso cabe aqui. A
        // condição repete a de "temContas" para o TypeScript estreitar o
        // tipo de "estado" e deixar aceder a "estado.contas".
        subtitulo={
          estado.fase === 'pronto' && estado.contas.length > 0
            ? contagemGrupo(estado.contas)
            : undefined
        }
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
              />
              <LinkBotao para="/contas/nova" apenasIcone titulo="Nova conta">
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

      {estado.fase === 'pronto' && estado.contas.length === 0 && (
        <div className={estilos.vazio}>
          <p className={estilos.vazioTitulo}>Ainda não tens contas.</p>
          <p>Adiciona as tuas contas para as acompanhares e alimentares a análise no Início.</p>
          <LinkBotao para="/contas/nova">Criar a primeira</LinkBotao>
        </div>
      )}

      {estado.fase === 'pronto' && estado.contas.length > 0 && (
        <>
          {/* Campo de procura, a ocupar a linha toda. Está no fluxo normal
              do conteúdo: ao rolar a lista para baixo, sai do ecrã por
              baixo da barra de topo (opaca) e reaparece ao voltar ao topo. */}
          <div className={estilos.pesquisa}>
            <span className={estilos.pesquisaIcone} aria-hidden="true">
              <IconeLupa tamanho={18} />
            </span>
            <input
              type="search"
              className={estilos.pesquisaInput}
              placeholder="Procurar conta…"
              value={pesquisa}
              onChange={(evento) => setPesquisa(evento.target.value)}
              aria-label="Procurar conta"
            />
          </div>

          {resultados.length === 0 ? (
            <p className={estilos.semResultados}>
              Nenhuma conta corresponde a «{pesquisa.trim()}».
            </p>
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
                    <span className={estilos.grupoContagem}>
                      {contagemGrupo(contasGrupo)}
                    </span>
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
        </>
      )}
    </div>
  )
}
