/*
 * FiltroMovimentos — O BOTÃO E A FOLHA DE FILTROS DA LISTA DE MOVIMENTOS
 * =====================================================================
 *
 * Um só botão (funil), na barra de topo ao lado do "+". Um pontinho no
 * canto avisa que há filtros ativos (e o "aria-label" muda). Toca-se e
 * abre a folha de filtros — de baixo para cima —, uma lista curta de
 * LINHAS-SELETOR:
 *
 *   Contas   Todas             ›
 *   Tipo     Saídas            ›
 *   Datas    Últimos 30 dias   ›
 *          Limpar filtros
 *
 * Cada linha mostra o filtro e o seu valor atual; tocá-la abre uma folha
 * que entra DA DIREITA com as opções desse filtro (o mesmo padrão do campo
 * "Conta" no formulário de movimento). Assim a folha principal fica só com
 * linhas limpas (a de Contas não aparece com uma só conta). Uma linha com
 * filtro ATIVO ganha um traço vertical preto no lado esquerdo. O seletor
 * de Datas mostra sempre no topo o intervalo a que a escolha atual dá;
 * "Mês específico" e "Data personalizada" revelam os seus campos, os
 * outros atalhos não. O de CATEGORIAS mostra as subcategorias agrupadas
 * por grupo com um cabeçalho — como o seletor do formulário de movimento,
 * mas em multi-escolha (como Contas): escolher TODAS as subcategorias,
 * uma a uma, colapsa de volta para "Todas"; TOCAR NO CABEÇALHO de um grupo
 * marca/desmarca de uma vez todas as suas subcategorias (em vez de uma a
 * uma), e o resumo da linha reconhece esse caso e mostra o nome do grupo.
 *
 * TIPO RESTRINGE CATEGORIAS, nunca ao contrário: com Tipo="Saída", o
 * seletor de Categorias só mostra os grupos de saída (a mesma restrição
 * do seletor do formulário de movimento) — e "Todas", aí, refere-se só às
 * categorias visíveis. Mudar de Tipo tira da escolha qualquer categoria
 * que já lá estivesse e deixe de bater certo com a nova direção. Não há
 * regra na direção inversa (Categorias nunca muda o Tipo): sendo
 * Categorias multi-escolha, uma seleção mista (entrada + saída) é válida
 * e não haveria um único Tipo para onde "colapsar" — mas nunca se chega a
 * uma seleção mista senão com Tipo="Todos" (só aí as duas direções estão
 * visíveis ao mesmo tempo), por isso o problema nunca chega a existir.
 *
 * Tal como "Nova conta" / "Novo movimento", a folha principal fornece o
 * ContextoFolha: arrastar um desses seletores PARA BAIXO desce as duas
 * folhas juntas e, passado o limiar, fecha os filtros por completo.
 *
 * A ordem (contas → tipo → categorias → datas) acompanha a do formulário
 * de adicionar/editar um movimento (conta → tipo → categoria → …), para o
 * modelo mental ser o mesmo nos dois sítios.
 *
 * NÃO há filtro por VALOR: as contas podem estar em moedas diferentes (ver
 * a nota em src/lib/filtrosMovimentos.ts). Volta com uma moeda base.
 *
 * Aplica AO VIVO: cada mudança chama "aoMudar" (que, em Movimentos.tsx,
 * escreve os filtros no URL). Tudo o que é "aberto/fechado" (a folha, cada
 * seletor, o "personalizado" das datas) é estado local; os VALORES dos
 * filtros vêm sempre de fora.
 */

import { Fragment, useMemo, useState, type ReactNode } from 'react'

import { Avatar } from './Avatar'
import { CampoTexto } from './CampoTexto'
import { ContextoFolha } from './contextoFolha'
import { Folha } from './Folha'
import { IconeCheck, IconeChevronDireita, IconeFechar, IconeFunil } from './icones'
import { PontoCategoria } from './PontoCategoria'
import { direcaoDaCategoria, type GrupoArvore } from '../lib/categorias'
import type { Conta } from '../lib/contas'
import { formatarData, formatarIntervalo, rotuloMes } from '../lib/datas'
import {
  contarFiltrosAtivos,
  FILTROS_VAZIOS,
  intervaloDoMes,
  intervaloDoPreset,
  mesDeIntervalo,
  PRESETS,
  presetAtivo,
  ROTULO_PRESET,
  type Filtros,
  type Preset,
} from '../lib/filtrosMovimentos'
import estilos from './FiltroMovimentos.module.css'

type Props = {
  filtros: Filtros
  aoMudar: (filtros: Filtros) => void
  contas: Conta[]
  arvore: GrupoArvore[]
}

export function FiltroMovimentos({ filtros, aoMudar, contas, arvore }: Props) {
  const [aberto, setAberto] = useState(false)
  const ativos = contarFiltrosAtivos(filtros)

  return (
    <>
      <button
        type="button"
        className={estilos.gatilho}
        aria-label={ativos > 0 ? 'Filtros (ativos)' : 'Filtros'}
        aria-haspopup="dialog"
        onClick={() => setAberto(true)}
      >
        <IconeFunil tamanho={20} />
        {ativos > 0 && <span className={estilos.ponto} aria-hidden="true" />}
      </button>

      {aberto && (
        <FolhaFiltros
          filtros={filtros}
          aoMudar={aoMudar}
          contas={contas}
          arvore={arvore}
          ativos={ativos}
          aoFechar={() => setAberto(false)}
        />
      )}
    </>
  )
}

/**
 * A folha de filtros em si. Componente à parte (montado só enquanto está
 * aberta) por causa do ContextoFolha: quando um seletor de filtro (folha
 * que entra da direita) é arrastado PARA BAIXO, o deslocamento é espelhado
 * aqui para as duas folhas descerem juntas, e um arrasto para lá do limiar
 * abandona o fluxo todo — o mesmo que "Nova conta" / "Novo movimento".
 * Montar isto só quando aberto garante que o estado do espelho arranca
 * limpo em cada abertura.
 */
function FolhaFiltros({
  filtros,
  aoMudar,
  contas,
  arvore,
  ativos,
  aoFechar,
}: Props & { ativos: number; aoFechar: () => void }) {
  const [espelhoY, setEspelhoY] = useState(0)
  const [aEspelhar, setAEspelhar] = useState(false)
  const [aAbandonar, setAAbandonar] = useState(false)

  const contextoFolha = useMemo(
    () => ({
      espelharDeslocamento: (y: number) => {
        setAEspelhar(true)
        setEspelhoY(y > 0 ? y : 0)
      },
      concluirArrasto: (descartar: boolean) => {
        setAEspelhar(false)
        if (descartar) setAAbandonar(true)
        else setEspelhoY(0)
      },
    }),
    [],
  )

  return (
    <ContextoFolha.Provider value={contextoFolha}>
      <Folha
        titulo="Filtros"
        direcao="baixo"
        varianteFechar="circulo"
        iconeFechar={<IconeFechar tamanho={22} />}
        rotuloFechar="Fechar"
        deslocamentoExterno={espelhoY}
        aSeguirExterno={aEspelhar}
        aExternamenteASair={aAbandonar}
        aoDispensar={aoFechar}
      >
        {() => (
          <div className={estilos.conteudo}>
            {/* Com uma só conta não há nada para filtrar. */}
            {contas.length > 1 && (
              <LinhaSeletor
                titulo="Contas"
                resumo={resumoContas(filtros, contas)}
                ativa={filtros.contas.length > 0}
              >
                <ListaContas filtros={filtros} aoMudar={aoMudar} contas={contas} />
              </LinhaSeletor>
            )}

            <LinhaSeletor
              titulo="Tipo"
              resumo={resumoTipo(filtros)}
              ativa={filtros.tipo !== null}
            >
              <ListaTipo filtros={filtros} aoMudar={aoMudar} arvore={arvore} />
            </LinhaSeletor>

            <LinhaSeletor
              titulo="Categorias"
              resumo={resumoCategorias(filtros, arvore)}
              ativa={filtros.categorias.length > 0}
            >
              <ListaCategorias filtros={filtros} aoMudar={aoMudar} arvore={arvore} />
            </LinhaSeletor>

            <LinhaSeletor
              titulo="Datas"
              resumo={resumoDatas(filtros)}
              ativa={Boolean(filtros.de || filtros.ate)}
            >
              <ListaDatas filtros={filtros} aoMudar={aoMudar} />
            </LinhaSeletor>

            {ativos > 0 && (
              <button
                type="button"
                className={estilos.limpar}
                onClick={() => aoMudar(FILTROS_VAZIOS)}
              >
                Limpar filtros
              </button>
            )}
          </div>
        )}
      </Folha>
    </ContextoFolha.Provider>
  )
}

/** Uma linha da lista de filtros: nome + valor atual + "›". Toca-se e abre
 *  uma folha que entra da direita com as opções (children). O seu próprio
 *  estado guarda só se essa folha está aberta. Com filtro ativo, a linha
 *  ganha o traço vertical (".linhaAtiva"). */
function LinhaSeletor({
  titulo,
  resumo,
  ativa,
  children,
}: {
  titulo: string
  resumo: string
  ativa: boolean
  children: ReactNode
}) {
  const [aberto, setAberto] = useState(false)

  return (
    <>
      <button
        type="button"
        className={ativa ? `${estilos.linhaSeletor} ${estilos.linhaAtiva}` : estilos.linhaSeletor}
        aria-haspopup="dialog"
        // Os dois <span> ficam colados no nome acessível ("ContasTodas") —
        // um "aria-label" explícito separa-os.
        aria-label={`${titulo}: ${resumo}`}
        onClick={() => setAberto(true)}
      >
        <span className={estilos.linhaSeletorTitulo}>{titulo}</span>
        <span className={estilos.linhaSeletorResumo}>{resumo}</span>
        <IconeChevronDireita tamanho={16} />
      </button>

      {aberto && (
        <Folha
          titulo={titulo}
          direcao="direita"
          varianteFechar="circulo"
          aoRecuar={() => setAberto(false)}
          aoDispensar={() => setAberto(false)}
        >
          {() => <div className={estilos.painelSeletor}>{children}</div>}
        </Folha>
      )}
    </>
  )
}

// --- Resumos (o valor atual de cada filtro, na linha da lista) ---

function resumoContas(filtros: Filtros, contas: Conta[]): string {
  const n = filtros.contas.length
  if (n === 0) return 'Todas'
  if (n === 1) return contas.find((conta) => conta.id === filtros.contas[0])?.nome ?? '1 conta'
  return `${n} contas`
}

function resumoTipo(filtros: Filtros): string {
  if (filtros.tipo === 'entrada') return 'Entradas'
  if (filtros.tipo === 'saida') return 'Saídas'
  return 'Todos'
}

function resumoCategorias(filtros: Filtros, arvore: GrupoArvore[]): string {
  const n = filtros.categorias.length
  if (n === 0) return 'Todas'
  // Reconhece quando a seleção é exatamente um grupo inteiro (feito com o
  // toque no cabeçalho, ou subcategoria a subcategoria — dá no mesmo) e
  // mostra o nome do grupo, em vez de "N categorias".
  for (const grupo of arvore) {
    const ids = grupo.subcategorias.map((sub) => sub.id)
    if (ids.length > 0 && ids.length === n && ids.every((id) => filtros.categorias.includes(id))) {
      return grupo.nome
    }
  }
  if (n === 1) {
    for (const grupo of arvore) {
      const sub = grupo.subcategorias.find((s) => s.id === filtros.categorias[0])
      if (sub) return sub.nome
    }
    return '1 categoria'
  }
  return `${n} categorias`
}

function resumoDatas(filtros: Filtros): string {
  const preset = presetAtivo(filtros)
  if (preset) return ROTULO_PRESET[preset]
  const mes = mesDeIntervalo(filtros)
  if (mes) return rotuloMes(mes)
  if (filtros.de && filtros.ate) {
    return `${formatarData(filtros.de)} – ${formatarData(filtros.ate)}`
  }
  if (filtros.de) return `Desde ${formatarData(filtros.de)}`
  if (filtros.ate) return `Até ${formatarData(filtros.ate)}`
  return 'Todo o período'
}

// --- Opções de cada filtro (dentro da folha que entra da direita) ---

type SubProps = {
  filtros: Filtros
  aoMudar: (filtros: Filtros) => void
}

/** Uma linha de opção: um elemento opcional à esquerda (o avatar de uma
 *  conta), a etiqueta, e um "✓" à direita quando está escolhida. Nas listas
 *  de escolha única (Tipo, Datas) marca-se com "aria-current"; na de
 *  multi-escolha (Contas) com "aria-pressed". */
function LinhaOpcao({
  etiqueta,
  selecionada,
  aoTocar,
  antes,
  multi = false,
}: {
  etiqueta: string
  selecionada: boolean
  aoTocar: () => void
  antes?: ReactNode
  multi?: boolean
}) {
  return (
    <button
      type="button"
      className={estilos.linha}
      aria-current={!multi && selecionada ? 'true' : undefined}
      aria-pressed={multi ? selecionada : undefined}
      onClick={aoTocar}
    >
      {antes && <span className={estilos.linhaAntes}>{antes}</span>}
      <span className={estilos.linhaEtiqueta}>{etiqueta}</span>
      {selecionada && <IconeCheck tamanho={18} />}
    </button>
  )
}

/** CONTAS — multi-escolha, cada linha com o monograma da conta (o mesmo da
 *  lista de contas e da linha do movimento). "Todas" no topo, marcada
 *  quando não há nenhuma conta escolhida (o estado canónico de "sem filtro
 *  de conta"): tocá-la limpa a escolha, e marcar TODAS as contas uma a uma
 *  colapsa de volta para esse estado. Mostram-se sempre todas (são
 *  poucas). */
function ListaContas({ filtros, aoMudar, contas }: SubProps & { contas: Conta[] }) {
  const ordenadas = [...contas].sort((a, b) => a.nome.localeCompare(b.nome))

  function alternar(id: string) {
    const escolhidas = filtros.contas
    const proximas = escolhidas.includes(id)
      ? escolhidas.filter((outro) => outro !== id)
      : [...escolhidas, id]
    const todas = contas.every((conta) => proximas.includes(conta.id))
    aoMudar({ ...filtros, contas: todas ? [] : proximas })
  }

  return (
    <div className={estilos.lista}>
      <LinhaOpcao
        multi
        etiqueta="Todas"
        selecionada={filtros.contas.length === 0}
        aoTocar={() => aoMudar({ ...filtros, contas: [] })}
      />
      {ordenadas.map((conta) => (
        <LinhaOpcao
          key={conta.id}
          multi
          etiqueta={conta.nome}
          antes={<Avatar nome={conta.banco || conta.nome} />}
          selecionada={filtros.contas.includes(conta.id)}
          aoTocar={() => alternar(conta.id)}
        />
      ))}
    </div>
  )
}

/** TIPO — escolha única: Todos / Entradas / Saídas. "Todos" = sem filtro
 *  (tipo a null). Mudar de Tipo tira da escolha de Categorias qualquer
 *  subcategoria que já lá estivesse e deixe de bater certo com a nova
 *  direção (ver a nota TIPO RESTRINGE CATEGORIAS no topo do ficheiro) —
 *  sem isto, uma categoria "escolhida" mas já invisível no seu próprio
 *  seletor continuaria, silenciosamente, a filtrar a lista. */
function ListaTipo({ filtros, aoMudar, arvore }: SubProps & { arvore: GrupoArvore[] }) {
  const atual = filtros.tipo ?? 'todos'
  const opcoes: { valor: 'todos' | 'entrada' | 'saida'; etiqueta: string }[] = [
    { valor: 'todos', etiqueta: 'Todos' },
    { valor: 'entrada', etiqueta: 'Entradas' },
    { valor: 'saida', etiqueta: 'Saídas' },
  ]

  function escolher(valor: 'todos' | 'entrada' | 'saida') {
    const novoTipo = valor === 'todos' ? null : valor
    const categorias = novoTipo
      ? filtros.categorias.filter((id) => direcaoDaCategoria(arvore, id) === novoTipo)
      : filtros.categorias
    aoMudar({ ...filtros, tipo: novoTipo, categorias })
  }

  return (
    <div className={estilos.lista}>
      {opcoes.map((opcao) => (
        <LinhaOpcao
          key={opcao.valor}
          etiqueta={opcao.etiqueta}
          selecionada={atual === opcao.valor}
          aoTocar={() => escolher(opcao.valor)}
        />
      ))}
    </div>
  )
}

/** CATEGORIAS — multi-escolha, como Contas, mas com um cabeçalho de grupo
 *  antes da primeira subcategoria de cada grupo — a mesma ideia do
 *  seletor de categoria no formulário de movimento (ver
 *  MovimentoFormulario.tsx e a nota OPÇÕES AGRUPADAS em ListaDeOpcoes.tsx),
 *  só que aqui em multi-escolha. Restringido pelo Tipo já escolhido (ver a
 *  nota TIPO RESTRINGE CATEGORIAS no topo do ficheiro): com Tipo="Todos",
 *  mostra os grupos das duas direções; caso contrário, só os da direção
 *  escolhida — e é sobre essas opções VISÍVEIS que "Todas" e o colapso
 *  automático (marcar tudo, uma a uma, volta a "Todas") se aplicam.
 *
 *  O CABEÇALHO DE CADA GRUPO é ele próprio tocável: marca ou desmarca de
 *  uma vez todas as subcategorias desse grupo (fica em tinta de acento
 *  quando estão todas marcadas), para não obrigar a marcar uma a uma um
 *  grupo inteiro (ex.: as 8 subcategorias de Habitação). As subcategorias
 *  continuam escolhíveis à parte, para quem quiser só algumas. */
function ListaCategorias({ filtros, aoMudar, arvore }: SubProps & { arvore: GrupoArvore[] }) {
  const gruposVisiveis = filtros.tipo ? arvore.filter((grupo) => grupo.direcao === filtros.tipo) : arvore
  const todosOsIds = gruposVisiveis.flatMap((grupo) => grupo.subcategorias.map((sub) => sub.id))

  function aplicar(proximas: string[]) {
    const todas = todosOsIds.length > 0 && todosOsIds.every((id) => proximas.includes(id))
    aoMudar({ ...filtros, categorias: todas ? [] : proximas })
  }

  function alternar(id: string) {
    const escolhidas = filtros.categorias
    aplicar(
      escolhidas.includes(id) ? escolhidas.filter((outro) => outro !== id) : [...escolhidas, id],
    )
  }

  function alternarGrupo(grupo: GrupoArvore) {
    const idsGrupo = grupo.subcategorias.map((sub) => sub.id)
    const grupoTodoMarcado = idsGrupo.length > 0 && idsGrupo.every((id) => filtros.categorias.includes(id))
    const semEsteGrupo = filtros.categorias.filter((id) => !idsGrupo.includes(id))
    aplicar(grupoTodoMarcado ? semEsteGrupo : [...semEsteGrupo, ...idsGrupo])
  }

  return (
    <div className={estilos.lista}>
      <LinhaOpcao
        multi
        etiqueta="Todas"
        selecionada={filtros.categorias.length === 0}
        aoTocar={() => aoMudar({ ...filtros, categorias: [] })}
      />
      {gruposVisiveis.map((grupo) => {
        const idsGrupo = grupo.subcategorias.map((sub) => sub.id)
        const grupoTodoMarcado = idsGrupo.length > 0 && idsGrupo.every((id) => filtros.categorias.includes(id))
        return (
          <Fragment key={grupo.id}>
            <button
              type="button"
              className={estilos.cabecalhoGrupo}
              aria-pressed={grupoTodoMarcado}
              onClick={() => alternarGrupo(grupo)}
            >
              {grupo.nome}
            </button>
            {grupo.subcategorias.map((sub) => (
              <LinhaOpcao
                key={sub.id}
                multi
                etiqueta={sub.nome}
                antes={<PontoCategoria nomeGrupo={grupo.nome} />}
                selecionada={filtros.categorias.includes(sub.id)}
                aoTocar={() => alternar(sub.id)}
              />
            ))}
          </Fragment>
        )
      })}
    </div>
  )
}

/**
 * DATAS.
 *
 *   ── 8 set – 7 out 2026 ──       ← mostrador, sempre no topo, do intervalo
 *                                     a que a escolha atual dá ("Sem limite
 *                                     de datas" em "Todo o período")
 *   Todo o período                 limpa as datas
 *   Últimos 7 / 30 / 90 dias       janela móvel a acabar hoje
 *   Mês específico                 revela um <input type="month">
 *   Data personalizada            revela os campos De / Até
 *
 * "escolha" é a linha selecionada — dá o "✓" e decide que campos aparecem.
 * Arranca derivada dos filtros (URL) e a partir daí segue os toques. Os
 * atalhos escrevem datas concretas em "de"/"ate"; os campos de Mês /
 * De-Até (só visíveis nas linhas próprias) editam-nos sem mudar de linha.
 */
type EscolhaDatas = Preset | 'qualquer' | 'mes' | 'personalizado'

function ListaDatas({ filtros, aoMudar }: SubProps) {
  const [escolha, setEscolha] = useState<EscolhaDatas>(() => {
    const preset = presetAtivo(filtros)
    if (preset) return preset
    if (mesDeIntervalo(filtros)) return 'mes'
    if (filtros.de || filtros.ate) return 'personalizado'
    return 'qualquer'
  })

  function escolherQualquer() {
    setEscolha('qualquer')
    aoMudar({ ...filtros, de: null, ate: null })
  }

  function escolherPreset(alvo: Preset) {
    setEscolha(alvo)
    const intervalo = intervaloDoPreset(alvo)
    aoMudar({ ...filtros, de: intervalo.de, ate: intervalo.ate })
  }

  const mostrador = formatarIntervalo(filtros.de, filtros.ate) || 'Sem limite de datas'

  return (
    <>
      <p className={estilos.intervalo}>{mostrador}</p>

      <div className={estilos.lista}>
        <LinhaOpcao
          etiqueta="Todo o período"
          selecionada={escolha === 'qualquer'}
          aoTocar={escolherQualquer}
        />
        {PRESETS.map((atalho) => (
          <LinhaOpcao
            key={atalho}
            etiqueta={ROTULO_PRESET[atalho]}
            selecionada={escolha === atalho}
            aoTocar={() => escolherPreset(atalho)}
          />
        ))}
        <LinhaOpcao
          etiqueta="Mês específico"
          selecionada={escolha === 'mes'}
          aoTocar={() => setEscolha('mes')}
        />
        <LinhaOpcao
          etiqueta="Data personalizada"
          selecionada={escolha === 'personalizado'}
          aoTocar={() => setEscolha('personalizado')}
        />
      </div>

      {escolha === 'mes' && (
        <div className={estilos.personalizado}>
          <CampoTexto
            disposicao="linha"
            etiqueta="Mês"
            tipo="month"
            valor={mesDeIntervalo(filtros) ?? ''}
            aoMudar={(valor) => {
              if (!valor) {
                aoMudar({ ...filtros, de: null, ate: null })
                return
              }
              const intervalo = intervaloDoMes(valor)
              aoMudar({ ...filtros, de: intervalo.de, ate: intervalo.ate })
            }}
          />
        </div>
      )}

      {escolha === 'personalizado' && (
        <div className={estilos.personalizado}>
          <CampoTexto
            disposicao="linha"
            etiqueta="De"
            tipo="date"
            valor={filtros.de ?? ''}
            aoMudar={(valor) => aoMudar({ ...filtros, de: valor || null })}
          />
          <CampoTexto
            disposicao="linha"
            etiqueta="Até"
            tipo="date"
            valor={filtros.ate ?? ''}
            aoMudar={(valor) => aoMudar({ ...filtros, ate: valor || null })}
          />
        </div>
      )}
    </>
  )
}
