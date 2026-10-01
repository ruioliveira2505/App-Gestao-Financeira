/*
 * "NOVA CONTA" (/contas/nova) — O FLUXO COMPLETO DE ADICIONAR UMA CONTA
 * =====================================================================
 *
 * Duas formas de criar uma conta, com o mesmo aspecto e a mesma lógica de
 * formulário (ver ContaFormulario e ContaLigadaFormulario, que usam as
 * mesmas fichas):
 *
 *   MANUAL:  escolha → formulário → (cria) → detalhe da conta, com o aviso
 *            "Conta criada".
 *   BANCO:   escolha → lista de bancos → permissões → (sai para o site do
 *            banco) → volta aqui → escolher contas (só se houver mais do
 *            que uma) → configurar → a importar → concluído.
 *
 * FOLHAS (o componente Folha), até três ao mesmo tempo, cada uma por cima
 * da anterior:
 *
 *   - A folha de BASE, direcao="baixo" (sobe do fundo — uma tarefa nova).
 *     O seu conteúdo depende de "passo":
 *       · "escolha" — dois cartões: "Ligar um banco" (primeiro, com o selo
 *         "Recomendado": é a forma que poupa trabalho) e "Adicionar
 *         manualmente". Também é o que fica por trás da folha aninhada
 *         enquanto se preenche o manual ou se escolhe o banco.
 *       · "confirmar" — para onde o browser volta depois do banco: GET
 *         /open-banking/callback reencaminha para "/contas/nova?ligacao=
 *         <id>". Tem as suas próprias "fases" (ver FASES, abaixo).
 *       · "erro" — o backend também pode reencaminhar para
 *         "/contas/nova?erro=<mensagem>" (autorização recusada, sessão
 *         expirada…): explica, e oferece tentar outra vez ou fazer à mão.
 *
 *   - A folha ANINHADA, direcao="direita" (avançar um nível dentro do
 *     mesmo fluxo), com o "‹" a sério no cabeçalho (mecanismo "aoRecuar"
 *     do Folha): o formulário manual, a lista de bancos, ou — quando o
 *     banco devolveu várias contas — o formulário de configurá-las, por
 *     cima da lista onde foram escolhidas.
 *
 *   - A folha de PERMISSÕES, por cima da lista de bancos: o que vai ser
 *     lido, o que nunca é possível, quanto tempo dura o consentimento, e
 *     um botão largo "Continuar para <banco>" — o padrão dos ecrãs de
 *     consentimento (dizer, no botão, para onde se vai). Ao tocar, o mesmo
 *     ecrã passa a "A abrir <banco>…" e só então a app sai para o site do
 *     banco (iniciarLigacao, em src/lib/openBanking.ts).
 *
 *   Cada "‹" recua só um nível. Os "‹" só podem ter alcances diferentes
 *   por serem folhas a sério: o "aoRecuar" do Folha pressupõe que recuar
 *   DESMONTA a folha, revelando o que já estava por trás — usado numa folha
 *   que não desmonta, a folha animava a sair e nunca voltava a entrar.
 *
 * FASES DO PASSO "confirmar" (estado "fase"):
 *   - "contas": escolher QUAIS das contas descobertas acompanhar. SÓ
 *     aparece se houver mais do que uma por associar — com uma só, não há
 *     nada a decidir, e salta-se directamente para configurar. O banco já
 *     delimita, na sua própria autenticação, que contas ficam autorizadas;
 *     este passo pergunta outra coisa: das autorizadas, quais trazer.
 *   - "configurar": ContaLigadaFormulario (nome, tipo, e desde quando
 *     importar). Com uma conta, é o conteúdo da própria folha de base;
 *     com várias, abre na folha aninhada, por cima da lista — o "‹" volta
 *     à escolha de contas.
 *   - "importar": cria as contas uma a uma (associarNovaConta — cada uma
 *     já importa os seus movimentos no backend), mostrando o progresso.
 *   - "concluido": resumo (quantos movimentos entraram em cada conta), ou
 *     o que falhou.
 *
 * COORDENAÇÃO DE ARRASTO (ContextoFolha): uma folha arrastada para baixo
 * arrasta consigo a que está por trás. "contextoParaAninhada" liga
 * qualquer coisa aberta por cima da folha de BASE (a folha aninhada, ou um
 * seletor aberto no conteúdo da base) à base; "contextoParaSeletor" liga o
 * que abre por cima da folha ANINHADA (seletores de moeda/tipo/país, a
 * folha de permissões) à aninhada. A folha de base em si nunca fica
 * dentro de um Provider — não tem nada por trás.
 *
 * O passo inicial lê-se da query string, uma vez, ao montar. O URL
 * mantém-se (/contas/nova). Ao SAIR sem criar, recua no histórico (ou vai
 * para "/contas" se a rota foi aberta directamente); ao CRIAR, vai para
 * o detalhe da conta (ou para a lista, se foram várias), levando no
 * "state" da navegação o aviso a mostrar lá ("Conta criada").
 */

import { useEffect, useMemo, useRef, useState } from 'react'

import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'

import { Botao } from '../componentes/Botao'
import { CaixaErro } from '../componentes/CaixaErro'
import { CampoSelecao } from '../componentes/CampoSelecao'
import { ContaFormulario, type DadosConta } from '../componentes/ContaFormulario'
import {
  ContaLigadaFormulario,
  type DadosContasLigadas,
} from '../componentes/ContaLigadaFormulario'
import { ContextoFolha } from '../componentes/contextoFolha'
import { Folha } from '../componentes/Folha'
import { IconeBanco, IconeCheck, IconeFechar, IconeLapis } from '../componentes/icones'
import { ListaDeOpcoes, type OpcaoLista } from '../componentes/ListaDeOpcoes'
import { criarConta } from '../lib/contas'
import { formatarData } from '../lib/datas'
import { ErroApi } from '../lib/http'
import {
  associarNovaConta,
  iniciarLigacao,
  listarBancos,
  listarContasLigadas,
  type Banco,
  type ContaLigada,
} from '../lib/openBanking'
import estilos from './ContaNova.module.css'

// "id" dos <form> — o "✓" do cabeçalho submete-os com <button form={id}>.
const ID_FORM_MANUAL = 'form-nova-conta'
const ID_FORM_LIGADA = 'form-contas-ligadas'

// Países oferecidos no passo "banco" (ISO 3166, duas letras — o formato de
// GET /open-banking/bancos). Curta de propósito: por confirmar ao vivo,
// um a um, que a Enable Banking devolve mesmo bancos para cada um.
const OPCOES_PAIS: OpcaoLista[] = [
  { valor: 'PT', etiqueta: 'Portugal' },
  { valor: 'ES', etiqueta: 'Espanha' },
  { valor: 'FR', etiqueta: 'França' },
  { valor: 'DE', etiqueta: 'Alemanha' },
]

type Passo =
  | { tipo: 'escolha' }
  | { tipo: 'manual' }
  | { tipo: 'banco' }
  | { tipo: 'confirmar'; ligacaoId: string }
  | { tipo: 'erro'; mensagem: string }

type Fase = 'contas' | 'configurar' | 'importar' | 'concluido'

type Resultado = {
  id: string
  nome: string
  estado: 'a-importar' | 'feito' | 'erro'
  contaId?: string
  movimentos?: number
  // Data do movimento mais antigo que o banco disponibilizou (AAAA-MM-DD)
  // — ver textoResultado, abaixo.
  desde?: string
  mensagem?: string
}

// A letra de secção de um banco na lista ("Caixa…" → "C"; "Ábaco" → "A"):
// sem acentos, para "Á" e "A" caírem na mesma secção.
function letraDe(nome: string): string {
  const primeira = nome.normalize('NFD').replace(/[̀-ͯ]/g, '').charAt(0).toUpperCase()
  return /[A-Z]/.test(primeira) ? primeira : '#'
}

// "••4021" — o bastante para distinguir contas do mesmo banco.
function ibanCurto(iban: string | null): string {
  return iban ? `••${iban.replace(/\s+/g, '').slice(-4)}` : ''
}

function textoMovimentos(n: number | undefined): string {
  if (n === undefined) return ''
  return n === 1 ? '1 movimento' : `${n} movimentos`
}

// O detalhe de uma conta importada: quantos movimentos entraram e desde
// quando ("12 movimentos desde 26/08/2026"). O "desde" é a resposta
// honesta à pergunta "porque é que só tenho isto?": cada banco decide
// quanto histórico disponibiliza por Open Banking (muitos só os últimos
// ~90 dias, pela regra do PSD2 — a directiva europeia que regula este
// acesso), e essa profundidade não se sabe de antemão — a API da Enable
// Banking não a indica em lado nenhum. Só se descobre depois de pedir,
// por isso mostra-se aqui, com o que de facto veio. Sem movimentos, não
// há "desde" a mostrar (a data devolvida seria apenas a de hoje).
function textoResultado(movimentos: number | undefined, desde: string | undefined): string {
  const texto = textoMovimentos(movimentos)
  if (!movimentos || !desde) return texto
  return `${texto} desde ${formatarData(desde)}`
}

export function ContaNova() {
  const navegar = useNavigate()
  const localizacao = useLocation()
  const [parametros] = useSearchParams()

  const [passo, setPasso] = useState<Passo>(() => {
    const ligacao = parametros.get('ligacao')
    const erro = parametros.get('erro')
    if (ligacao) return { tipo: 'confirmar', ligacaoId: ligacao }
    if (erro) return { tipo: 'erro', mensagem: erro }
    return { tipo: 'escolha' }
  })

  function irPara(novoPasso: Passo) {
    setPasso(novoPasso)
  }

  // --- Passo "manual" ---
  const [aSubmeter, setASubmeter] = useState(false)
  const [valido, setValido] = useState(false)

  // --- Passo "banco": país, lista, banco escolhido (por confirmar nas
  // permissões) e se já se tocou em "Continuar para <banco>" ---
  const [bancos, setBancos] = useState<Banco[] | null>(null)
  const [erroBancos, setErroBancos] = useState<string | null>(null)
  const [paisBanco, setPaisBanco] = useState('PT')
  const [bancoParaConfirmar, setBancoParaConfirmar] = useState<string | null>(null)
  const [aAbrirBanco, setAAbrirBanco] = useState(false)

  // --- Passo "confirmar" (ver FASES, no topo do ficheiro) ---
  const [contasLigadas, setContasLigadas] = useState<ContaLigada[] | null>(null)
  const [erroContasLigadas, setErroContasLigadas] = useState<string | null>(null)
  const [fase, setFase] = useState<Fase>('contas')
  // Por omissão, todas as contas descobertas vêm marcadas — guarda-se o
  // que o utilizador DESmarcou.
  const [desmarcadas, setDesmarcadas] = useState<string[]>([])
  const [configValida, setConfigValida] = useState(false)
  const [resultados, setResultados] = useState<Resultado[]>([])

  // Arrasto espelhado — ver COORDENAÇÃO DE ARRASTO, no topo do ficheiro.
  const [espelhoBase, setEspelhoBase] = useState(0)
  const [aEspelharBase, setAEspelharBase] = useState(false)
  const [aAbandonarBase, setAAbandonarBase] = useState(false)
  const contextoParaAninhada = useMemo(
    () => ({
      espelharDeslocamento: (y: number) => {
        setAEspelharBase(true)
        setEspelhoBase(y > 0 ? y : 0)
      },
      concluirArrasto: (descartar: boolean) => {
        setAEspelharBase(false)
        if (descartar) setAAbandonarBase(true)
        else setEspelhoBase(0)
      },
    }),
    [],
  )

  const [espelhoAninhada, setEspelhoAninhada] = useState(0)
  const [aEspelharAninhada, setAEspelharAninhada] = useState(false)
  const [aAbandonarAninhada, setAAbandonarAninhada] = useState(false)
  const contextoParaSeletor = useMemo(
    () => ({
      espelharDeslocamento: (y: number) => {
        setAEspelharAninhada(true)
        setEspelhoAninhada(y > 0 ? y : 0)
      },
      concluirArrasto: (descartar: boolean) => {
        setAEspelharAninhada(false)
        if (descartar) setAAbandonarAninhada(true)
        else setEspelhoAninhada(0)
      },
    }),
    [],
  )

  // Para onde navegar quando a folha acabar de sair, e o que levar no
  // "state" da navegação (o aviso a mostrar no destino).
  const destino = useRef<string | number>(localizacao.key === 'default' ? '/contas' : -1)
  const estadoDestino = useRef<{ aviso: string } | undefined>(undefined)

  function aoSair() {
    if (typeof destino.current === 'number') navegar(destino.current)
    else navegar(destino.current, { state: estadoDestino.current })
  }

  // Voltar do site do banco com o botão "atrás" do browser pode restaurar
  // esta página tal como ficou (a "bfcache"), presa em "A abrir…" — ao
  // voltar a mostrá-la, repõe-se o ecrã de permissões.
  useEffect(() => {
    function aoMostrarPagina(evento: PageTransitionEvent) {
      if (evento.persisted) setAAbrirBanco(false)
    }
    window.addEventListener('pageshow', aoMostrarPagina)
    return () => window.removeEventListener('pageshow', aoMostrarPagina)
  }, [])

  // Criar com sucesso tem de SAIR DO FLUXO TODO (navegar para o detalhe),
  // nunca só recuar à "escolha" — por isso chama "aoSair" directamente e
  // não o "fechar" da folha aninhada (que, tendo "aoRecuar", recuaria).
  async function guardarManual(dados: DadosConta) {
    const conta = await criarConta(dados)
    destino.current = `/contas/${conta.id}`
    estadoDestino.current = { aviso: 'Conta criada' }
    aoSair()
  }

  function carregarBancos(pais: string) {
    setBancos(null)
    setErroBancos(null)
    listarBancos(pais)
      .then(setBancos)
      .catch((erroApanhado) => {
        setErroBancos(
          erroApanhado instanceof ErroApi
            ? erroApanhado.message
            : 'Não foi possível obter a lista de bancos.',
        )
      })
  }

  function abrirPassoBanco() {
    irPara({ tipo: 'banco' })
    setBancoParaConfirmar(null)
    setAAbrirBanco(false)
    carregarBancos(paisBanco)
  }

  function mudarPais(novoPais: string) {
    setPaisBanco(novoPais)
    setBancoParaConfirmar(null)
    carregarBancos(novoPais)
  }

  function continuarParaBanco(banco: string) {
    setAAbrirBanco(true)
    // Um instante para o ecrã "A abrir…" chegar a ser pintado antes de o
    // browser começar a sair da app.
    window.setTimeout(() => iniciarLigacao(banco, paisBanco), 60)
  }

  // Carrega as contas descobertas assim que se entra no passo "confirmar".
  if (passo.tipo === 'confirmar' && contasLigadas === null && erroContasLigadas === null) {
    listarContasLigadas(passo.ligacaoId)
      .then(setContasLigadas)
      .catch((erroApanhado) => {
        setErroContasLigadas(
          erroApanhado instanceof ErroApi
            ? erroApanhado.message
            : 'Não foi possível obter as contas descobertas.',
        )
      })
  }

  // Contas ainda por associar, e as que o utilizador quer trazer.
  const pendentes = (contasLigadas ?? []).filter((c) => c.conta_id === null)
  const variasPendentes = pendentes.length > 1
  const aConfigurar = variasPendentes
    ? pendentes.filter((c) => !desmarcadas.includes(c.id))
    : pendentes
  const nomeBancoLigado = contasLigadas?.[0]?.banco ?? 'o banco'

  function alternarConta(id: string) {
    setDesmarcadas((atual) =>
      atual.includes(id) ? atual.filter((x) => x !== id) : [...atual, id],
    )
  }

  // Cria as contas uma a uma — cada associarNovaConta já importa os
  // movimentos no backend. Uma que falhe não impede as seguintes.
  async function importar(dados: DadosContasLigadas) {
    setFase('importar')
    setResultados(dados.contas.map((c) => ({ id: c.id, nome: c.nome, estado: 'a-importar' })))
    for (const c of dados.contas) {
      try {
        const criada = await associarNovaConta(c.id, c.nome, dados.dataDe ?? undefined, c.tipo)
        setResultados((atual) =>
          atual.map((r) =>
            r.id === c.id
              ? {
                  ...r,
                  estado: 'feito',
                  contaId: criada.conta_id,
                  movimentos: criada.movimentos_importados,
                  // A data-âncora é a do movimento mais antigo importado
                  // (ou hoje, sem movimentos — ver textoResultado).
                  desde: criada.data_ancora,
                }
              : r,
          ),
        )
      } catch (erroApanhado) {
        const mensagem =
          erroApanhado instanceof ErroApi ? erroApanhado.message : 'Não foi possível criar a conta.'
        setResultados((atual) =>
          atual.map((r) => (r.id === c.id ? { ...r, estado: 'erro', mensagem } : r)),
        )
      }
    }
    setFase('concluido')
  }

  // A lista do passo "banco": alfabética (a Enable Banking não promete
  // ordem), com uma secção por letra — o padrão das listas longas
  // alfabéticas (os contactos do telemóvel).
  const opcoesBanco: OpcaoLista[] = (bancos ?? [])
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, 'pt'))
    .map((banco) => ({ valor: banco.name, etiqueta: banco.name, grupo: letraDe(banco.name) }))

  const configNaAninhada = passo.tipo === 'confirmar' && fase === 'configurar' && variasPendentes
  const aninhadaAberta = passo.tipo === 'manual' || passo.tipo === 'banco' || configNaAninhada
  // Uma conta só: o formulário de configurar está na própria base, logo
  // desde o início (a escolha de contas nem chega a existir) — por isso
  // não depende de "fase" ser "configurar", só de não ter começado a
  // importação.
  const configNaBase =
    passo.tipo === 'confirmar' &&
    pendentes.length === 1 &&
    (fase === 'contas' || fase === 'configurar')

  // Título da folha de BASE — nunca igual ao da aninhada, quando as duas
  // estão montadas (duas "role=dialog" com o mesmo nome seriam ambíguas
  // para quem usa leitor de ecrã, mesmo com a de base tapada).
  let tituloBase = 'Nova conta'
  if (passo.tipo === 'confirmar') {
    if (fase === 'importar') tituloBase = 'A importar'
    else if (fase === 'concluido') tituloBase = 'Concluído'
    else if (configNaBase) tituloBase = 'Nova conta'
    else tituloBase = 'Contas encontradas'
  } else if (aninhadaAberta) {
    tituloBase = 'Nova conta — escolha'
  }

  const tituloAninhada =
    passo.tipo === 'banco' ? 'Escolher banco' : configNaAninhada ? 'Configurar contas' : 'Nova conta'

  // O "✓" da folha de base: só quando ela própria mostra o formulário de
  // configurar (uma conta só).
  const acaoBase =
    configNaBase ? (
      <button
        type="submit"
        form={ID_FORM_LIGADA}
        className={estilos.botaoConfirmar}
        disabled={!configValida}
        aria-label="Adicionar conta"
      >
        <IconeCheck tamanho={22} />
      </button>
    ) : undefined

  function conteudoConfirmar(fechar: () => void) {
    if (erroContasLigadas !== null) {
      return (
        <div className={estilos.formulario}>
          <CaixaErro>{erroContasLigadas}</CaixaErro>
        </div>
      )
    }
    if (contasLigadas === null) {
      return <p className={`${estilos.formulario} ${estilos.nota}`}>A carregar…</p>
    }

    if (fase === 'importar' || fase === 'concluido') {
      const feitos = resultados.filter((r) => r.estado === 'feito')
      const concluido = fase === 'concluido'
      const falhouTudo = concluido && feitos.length === 0

      return (
        <div className={`${estilos.formulario} ${estilos.ecraCentral}`}>
          <div className={estilos.heroi}>
            {concluido && (
              <span
                className={`${estilos.heroiIcone} ${falhouTudo ? estilos.heroiIconeErro : estilos.heroiIconeOk}`}
              >
                {falhouTudo ? <span aria-hidden="true">!</span> : <IconeCheck tamanho={30} />}
              </span>
            )}
            <h2 className={estilos.heroiTitulo}>
              {!concluido
                ? 'A trazer os teus movimentos'
                : falhouTudo
                  ? 'Não foi possível adicionar'
                  : feitos.length === 1
                    ? 'Conta adicionada'
                    : `${feitos.length} contas adicionadas`}
            </h2>
            <p className={estilos.heroiTexto}>
              {!concluido
                ? 'Isto demora alguns segundos.'
                : falhouTudo
                  ? 'Nada foi guardado. Podes tentar outra vez.'
                  : 'Os movimentos importados ficam em "Outras entradas" e "Outras saídas" até os categorizares.'}
            </p>
          </div>

          <ul className={estilos.cartaoLista}>
            {resultados.map((r) => (
              <li key={r.id} className={estilos.linhaResultado}>
                {r.estado === 'a-importar' && (
                  <span className={estilos.roda} role="status" aria-label="A importar" />
                )}
                {r.estado === 'feito' && (
                  <span className={`${estilos.estado} ${estilos.estadoOk}`} aria-hidden="true">
                    <IconeCheck tamanho={12} />
                  </span>
                )}
                {r.estado === 'erro' && (
                  <span className={`${estilos.estado} ${estilos.estadoErro}`} aria-hidden="true">
                    !
                  </span>
                )}
                <span className={estilos.linhaResultadoNome}>{r.nome}</span>
                <span className={estilos.linhaResultadoDetalhe}>
                  {r.estado === 'a-importar'
                    ? 'A importar…'
                    : r.estado === 'feito'
                      ? textoResultado(r.movimentos, r.desde)
                      : r.mensagem}
                </span>
              </li>
            ))}
          </ul>

          {concluido && (
            <div className={estilos.accoes}>
              {falhouTudo ? (
                <Botao onClick={() => setFase('configurar')}>Tentar outra vez</Botao>
              ) : (
                <Botao
                  onClick={() => {
                    if (feitos.length === 1) {
                      destino.current = `/contas/${feitos[0].contaId}`
                      estadoDestino.current = { aviso: 'Conta ligada' }
                    } else {
                      destino.current = '/contas'
                    }
                    fechar()
                  }}
                >
                  {feitos.length === 1 ? 'Ver conta' : 'Ver contas'}
                </Botao>
              )}
            </div>
          )}
        </div>
      )
    }

    if (pendentes.length === 0) {
      return (
        <div className={`${estilos.formulario} ${estilos.ecraCentral}`}>
          <div className={estilos.heroi}>
            <h2 className={estilos.heroiTitulo}>Já está tudo adicionado</h2>
            <p className={estilos.heroiTexto}>
              As contas desta ligação já estão na Gestão Financeira.
            </p>
          </div>
          <div className={estilos.accoes}>
            <Botao
              onClick={() => {
                destino.current = '/contas'
                fechar()
              }}
            >
              Ver contas
            </Botao>
          </div>
        </div>
      )
    }

    // Uma conta só: configura-se aqui mesmo, sem escolha nenhuma.
    if (!variasPendentes) {
      return (
        <div className={estilos.formulario}>
          <ContaLigadaFormulario
            contas={pendentes}
            idFormulario={ID_FORM_LIGADA}
            aoConfirmar={importar}
            aoMudarValidez={setConfigValida}
          />
        </div>
      )
    }

    // Várias: escolher quais (e, por cima, a folha aninhada de configurar).
    const n = aConfigurar.length
    return (
      <div className={estilos.formulario}>
        <p className={estilos.introducao}>
          Encontrámos {pendentes.length} contas no {nomeBancoLigado}. Escolhe as que queres
          acompanhar.
        </p>
        <ul className={estilos.cartaoLista}>
          {pendentes.map((c) => {
            const marcada = !desmarcadas.includes(c.id)
            return (
              <li key={c.id}>
                <button
                  type="button"
                  className={estilos.linhaConta}
                  aria-pressed={marcada}
                  onClick={() => alternarConta(c.id)}
                >
                  <span className={`${estilos.marca} ${marcada ? estilos.marcaOn : ''}`} aria-hidden="true">
                    <IconeCheck tamanho={13} />
                  </span>
                  <span className={estilos.linhaContaTexto}>
                    <span>Conta {c.moeda}</span>
                    <span className={estilos.linhaContaDetalhe}>
                      {[ibanCurto(c.iban), c.nome_titular].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
        <div className={estilos.accoes}>
          <Botao disabled={n === 0} onClick={() => setFase('configurar')}>
            {n === 0 ? 'Escolhe pelo menos uma' : n === 1 ? 'Continuar com 1 conta' : `Continuar com ${n} contas`}
          </Botao>
        </div>
      </div>
    )
  }

  function conteudoBanco() {
    return (
      <>
        <div className={estilos.formulario}>
          <div className={estilos.campoPais}>
            <CampoSelecao
              disposicao="linha"
              etiqueta="País"
              valor={paisBanco}
              aoMudar={mudarPais}
              opcoes={OPCOES_PAIS}
              direcaoPainel="direita"
            />
          </div>

          {erroBancos !== null ? (
            <CaixaErro>{erroBancos}</CaixaErro>
          ) : bancos === null ? (
            <p className={estilos.nota}>A carregar bancos…</p>
          ) : opcoesBanco.length === 0 ? (
            <p className={estilos.nota}>Este país ainda não tem bancos suportados.</p>
          ) : (
            <ListaDeOpcoes opcoes={opcoesBanco} valor="" aoEscolher={setBancoParaConfirmar} />
          )}
        </div>

        {bancoParaConfirmar !== null && (
          <Folha
            titulo="Permissões"
            direcao="direita"
            varianteFechar="circulo"
            // "Voltar à lista", não o "Voltar" por omissão: a folha por
            // baixo desta também tem um "Voltar", e as duas estão montadas
            // ao mesmo tempo.
            rotuloFechar="Voltar à lista"
            aoRecuar={() => {
              setBancoParaConfirmar(null)
              setAAbrirBanco(false)
            }}
            aoDispensar={aoSair}
          >
            {() =>
              aAbrirBanco ? (
                <div className={`${estilos.formulario} ${estilos.ecraCentral}`}>
                  <div className={estilos.heroi}>
                    <span className={estilos.heroiIcone}>
                      <IconeBanco tamanho={28} />
                    </span>
                    <span className={estilos.roda} role="status" aria-label="A abrir" />
                    <h2 className={estilos.heroiTitulo}>A abrir {bancoParaConfirmar}…</h2>
                    <p className={estilos.heroiTexto}>
                      Entra com os dados do teu banco e confirma. Depois voltas aqui
                      automaticamente.
                    </p>
                  </div>
                </div>
              ) : (
                <div className={`${estilos.formulario} ${estilos.consentimento}`}>
                  <div className={estilos.heroi}>
                    <span className={estilos.heroiIcone}>
                      <IconeBanco tamanho={28} />
                    </span>
                    <h2 className={estilos.heroiTitulo}>{bancoParaConfirmar}</h2>
                    <p className={estilos.heroiTexto}>
                      A Gestão Financeira fica com acesso só de leitura a esta conta.
                    </p>
                  </div>

                  <section className={estilos.seccao}>
                    <h3 className={estilos.seccaoTitulo}>Permite</h3>
                    <ul className={estilos.cartaoLista}>
                      {['Ver saldos', 'Ver movimentos', 'Ver titular e IBAN'].map((texto) => (
                        <li key={texto} className={estilos.linhaPermissao}>
                          <span className={`${estilos.estado} ${estilos.estadoOk}`} aria-hidden="true">
                            <IconeCheck tamanho={12} />
                          </span>
                          {texto}
                        </li>
                      ))}
                    </ul>
                  </section>

                  <section className={estilos.seccao}>
                    <h3 className={estilos.seccaoTitulo}>Não permite</h3>
                    <ul className={estilos.cartaoLista}>
                      {['Fazer pagamentos ou transferências', 'Ver as credenciais do banco'].map(
                        (texto) => (
                          <li key={texto} className={estilos.linhaPermissao}>
                            <span className={`${estilos.estado} ${estilos.estadoErro}`} aria-hidden="true">
                              <IconeFechar tamanho={11} />
                            </span>
                            {texto}
                          </li>
                        ),
                      )}
                    </ul>
                    <p className={estilos.rodape}>
                      Válido por 90 dias. Podes desligar quando quiseres, no detalhe da conta.
                      Ligação regulada (PSD2), através da Enable Banking.
                    </p>
                  </section>

                  <div className={estilos.accoes}>
                    <Botao onClick={() => continuarParaBanco(bancoParaConfirmar)}>
                      Continuar para {bancoParaConfirmar}
                    </Botao>
                    <p className={estilos.rodapeCentrado}>
                      Vais autenticar-te no site do {bancoParaConfirmar}.
                    </p>
                  </div>
                </div>
              )
            }
          </Folha>
        )}
      </>
    )
  }

  return (
    <>
      <Folha
        titulo={tituloBase}
        direcao="baixo"
        varianteFechar="circulo"
        iconeFechar={<IconeFechar tamanho={22} />}
        rotuloFechar="Fechar"
        deslocamentoExterno={espelhoBase}
        aSeguirExterno={aEspelharBase}
        aExternamenteASair={aAbandonarBase}
        aoDispensar={aoSair}
        acao={acaoBase}
      >
        {(fechar) => (
          // Um seletor aberto no conteúdo da base (ex.: o "Tipo", ao
          // configurar uma conta só) espelha o seu arrasto na base.
          <ContextoFolha.Provider value={contextoParaAninhada}>
            {passo.tipo === 'confirmar' ? (
              conteudoConfirmar(fechar)
            ) : passo.tipo === 'erro' ? (
              <div className={`${estilos.formulario} ${estilos.ecraCentral}`}>
                <div className={estilos.heroi}>
                  <span className={`${estilos.heroiIcone} ${estilos.heroiIconeErro}`} aria-hidden="true">
                    !
                  </span>
                  <h2 className={estilos.heroiTitulo}>Não foi possível ligar ao banco</h2>
                  <p className={estilos.heroiTexto}>
                    A autorização foi cancelada ou expirou antes de terminar. Nada foi guardado.
                  </p>
                  <p className={estilos.detalheErro}>{passo.mensagem}</p>
                </div>
                <div className={estilos.accoes}>
                  <Botao onClick={abrirPassoBanco}>Tentar outra vez</Botao>
                  <Botao variante="secundario" onClick={() => irPara({ tipo: 'manual' })}>
                    Adicionar manualmente
                  </Botao>
                </div>
              </div>
            ) : (
              // "escolha" — e o que fica por trás da folha aninhada.
              <div className={estilos.escolha}>
                <button type="button" className={estilos.cartaoEscolha} onClick={abrirPassoBanco}>
                  <span className={estilos.cartaoEscolhaIcone}>
                    <IconeBanco tamanho={20} />
                  </span>
                  <span className={estilos.cartaoEscolhaTitulo}>Ligar um banco</span>
                  <span className={estilos.selo}>Recomendado</span>
                </button>
                <button
                  type="button"
                  className={estilos.cartaoEscolha}
                  onClick={() => irPara({ tipo: 'manual' })}
                >
                  <span className={estilos.cartaoEscolhaIcone}>
                    <IconeLapis tamanho={20} />
                  </span>
                  <span className={estilos.cartaoEscolhaTitulo}>Adicionar manualmente</span>
                </button>
              </div>
            )}
          </ContextoFolha.Provider>
        )}
      </Folha>

      {aninhadaAberta && (
        <ContextoFolha.Provider value={contextoParaAninhada}>
          <Folha
            titulo={tituloAninhada}
            direcao="direita"
            varianteFechar="circulo"
            aoRecuar={() => (configNaAninhada ? setFase('contas') : irPara({ tipo: 'escolha' }))}
            aoDispensar={aoSair}
            deslocamentoExterno={espelhoAninhada}
            aSeguirExterno={aEspelharAninhada}
            aExternamenteASair={aAbandonarAninhada}
            acao={
              passo.tipo === 'manual' ? (
                <button
                  type="submit"
                  form={ID_FORM_MANUAL}
                  className={estilos.botaoConfirmar}
                  disabled={aSubmeter || !valido}
                  aria-label="Criar conta"
                >
                  <IconeCheck tamanho={22} />
                </button>
              ) : configNaAninhada ? (
                <button
                  type="submit"
                  form={ID_FORM_LIGADA}
                  className={estilos.botaoConfirmar}
                  disabled={!configValida}
                  aria-label="Adicionar contas"
                >
                  <IconeCheck tamanho={22} />
                </button>
              ) : undefined
            }
          >
            {() => (
              <ContextoFolha.Provider value={contextoParaSeletor}>
                {passo.tipo === 'manual' ? (
                  <div className={estilos.formulario}>
                    <ContaFormulario
                      aoGuardar={guardarManual}
                      idFormulario={ID_FORM_MANUAL}
                      botaoNoRodape={false}
                      aoMudarSubmissao={setASubmeter}
                      aoMudarValidez={setValido}
                    />
                  </div>
                ) : passo.tipo === 'banco' ? (
                  conteudoBanco()
                ) : (
                  <div className={estilos.formulario}>
                    <ContaLigadaFormulario
                      contas={aConfigurar}
                      idFormulario={ID_FORM_LIGADA}
                      aoConfirmar={importar}
                      aoMudarValidez={setConfigValida}
                    />
                  </div>
                )}
              </ContextoFolha.Provider>
            )}
          </Folha>
        </ContextoFolha.Provider>
      )}
    </>
  )
}
