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
 *            banco) → volta aqui → contas encontradas (quando há algo a
 *            decidir ou a contar) → configurar → a importar → concluído.
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
 *         /open-banking/callback reencaminha para "/contas/nova?autorizacao=
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
 *     lido, o que nunca é possível, quanto tempo dura o consentimento,
 *     como cancelar, quem é o responsável, e um botão largo "Continuar".
 *     Ao tocar, o mesmo ecrã passa a "A preparar a ligação…" e só então a
 *     app sai da SPA (iniciarAutorizacao, em src/lib/openBanking.ts) — primeiro
 *     para a página da Enable Banking, depois para o site do banco.
 *
 *   Cada "‹" recua só um nível. Os "‹" só podem ter alcances diferentes
 *   por serem folhas a sério: o "aoRecuar" do Folha pressupõe que recuar
 *   DESMONTA a folha, revelando o que já estava por trás — usado numa folha
 *   que não desmonta, a folha animava a sair e nunca voltava a entrar.
 *
 * FASES DO PASSO "confirmar" (estado "fase"):
 *   - "contas": mostra as contas NOVAS para escolher (uma que já foi uma
 *     conta tua, entretanto desvinculada, diz «Já foi a «X»») e, à parte,
 *     as que já estão nas tuas contas, cuja ligação se renovou sozinha
 *     («Ligação renovada até…»). Aparece quando há várias contas novas, ou
 *     uma nova e outras renovadas; com uma só conta nova e mais nada,
 *     salta-se directamente para configurar. Sem nenhuma conta nova, o ecrã
 *     é "Já está tudo nas tuas contas". O banco já
 *     delimita, na sua própria autenticação, que contas ficam autorizadas;
 *     este passo pergunta outra coisa: das autorizadas, quais trazer.
 *   - "configurar": ContaLigadaFormulario (nome, tipo, e desde quando
 *     importar). Com uma conta, é o conteúdo da própria folha de base;
 *     com várias, abre na folha aninhada, por cima da lista — o "‹" volta
 *     à escolha de contas.
 *   - "importar": cria as contas uma a uma (criarContaDoBanco — cada uma
 *     já importa os seus movimentos no backend), mostrando o progresso.
 *   - "concluido": resumo (quantos movimentos entraram em cada conta), ou
 *     o que falhou.
 *
 * COORDENAÇÃO DE ARRASTO (ContextoFolha): uma folha arrastada para baixo
 * arrasta consigo a que está por trás. "contextoParaAninhada" liga
 * qualquer coisa aberta por cima da folha de BASE (a folha aninhada, ou um
 * seletor aberto no conteúdo da base) à base; "contextoParaSeletor" liga o
 * que abre por cima da folha ANINHADA (seletores de moeda/tipo/país, a
 * folha de permissões) à aninhada — e, em cascata, também à base: são
 * três camadas, e arrastar a de cima tem de levar as DUAS de baixo. Sem a
 * cascata, a aninhada descia com o seletor mas a base ficava parada, e o
 * que aparecia por trás era a "escolha" (manual/banco), como se o gesto
 * tivesse recuado um passo em vez de fechar tudo. A folha de base em si
 * nunca fica dentro de um Provider — não tem nada por trás.
 *
 * O passo inicial lê-se da query string, uma vez, ao montar: "autorizacao" e
 * "erro" (o regresso do banco, acima) ou "via=banco" / "via=manual" — a
 * entrada directa num dos dois caminhos, usada pelos botões do estado
 * "sem contas" da página Contas (a "escolha" fica por trás, e o "‹" recua
 * até ela, como se se tivesse tocado no cartão).
 *
 * O PASSO VIVE TAMBÉM NO URL. Escolher um dos cartões escreve "via=manual"
 * ou "via=banco" na query string, e recuar à escolha apaga-o — sem isso,
 * um refresh voltava sempre à escolha, porque o passo só existia na
 * memória da página. Escreve-se com "replace" (substitui a entrada actual
 * do histórico em vez de acrescentar outra): o botão "voltar" do browser
 * continua a fechar a janela inteira, como antes, e o "‹" continua a ser
 * a única forma de recuar um passo. O que já se tinha escrito no
 * formulário perde-se num refresh — é o normal num formulário por gravar.
 *
 * SAIR DO FORMULÁRIO MANUAL COM DADOS ESCRITOS. Fechar a folha (o "‹",
 * Escape, o toque no fundo, arrastá-la) perderia o que se escreveu, por
 * isso, com algum campo já preenchido, a folha não sai: aparece primeiro
 * uma confirmação («Descartar» ou «Continuar a editar»). O mesmo vale para
 * arrastar para baixo um painel aberto por cima do formulário (a moeda, o
 * banco): fecha-se esse painel e pergunta-se. Se o utilizador confirmar,
 * faz-se o que ele queria — recuar à escolha, ou sair do fluxo todo. Um
 * formulário por tocar sai sem perguntar.
 *
 * Ao SAIR sem criar, recua no histórico (ou vai para "/contas" se a rota
 * foi aberta directamente); ao CRIAR, vai para o detalhe da conta (ou para
 * a lista, se foram várias), levando no "state" da navegação o aviso a
 * mostrar lá ("Conta criada") — sempre NO LUGAR desta página no
 * histórico, nunca por cima (ver "aoSair").
 */

import { useQueryClient } from '@tanstack/react-query'
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
import { Confirmacao } from '../componentes/Confirmacao'
import { Folha, type Intencao } from '../componentes/Folha'
import {
  IconeBanco,
  IconeCheck,
  IconeChevronDireita,
  IconeExterno,
  IconeFechar,
  IconeLapis,
} from '../componentes/icones'
// As mesmas fichas dos formulários de conta (cartão com contorno, linhas
// com o nome à esquerda e o valor à direita) — para o país, no passo de
// escolher o banco.
import ficha from '../componentes/ContaFormulario.module.css'
import { ListaDeOpcoes, type OpcaoLista } from '../componentes/ListaDeOpcoes'
import { criarConta } from '../lib/contas'
import { formatarData } from '../lib/datas'
import { CHAVES } from '../lib/consultas'
import { ErroApi } from '../lib/http'
import {
  criarContaDoBanco,
  iniciarAutorizacao,
  listarBancos,
  listarContasBancarias,
  type Banco,
  type ContaBancaria,
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
  | { tipo: 'confirmar'; autorizacaoId: string }
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

// O registo oficial da Autoridade Bancária Europeia (EBA) onde a Enable
// Banking — a empresa que faz a ligação aos bancos — está inscrita como
// prestadora autorizada de serviços de informação sobre contas (pelo
// regulador financeiro da Finlândia, a FIN-FSA). É a prova independente
// de que está autorizada; a linha «Responsável» das permissões abre-o.
const REGISTO_EBA_ENABLE_BANKING =
  'https://euclid.eba.europa.eu/register/pir/view/PSD_AISP/FI_FIN_FSA!29884997'

// "2027-04-01T10:00:00+00:00" → "1 abr 2027" — o formato curto de datas
// da app (o mesmo do calendário).
const MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
function dataCurta(iso: string): string {
  const [ano, mes, dia] = iso.slice(0, 10).split('-').map(Number)
  return `${dia} ${MESES_CURTOS[mes - 1]} ${ano}`
}

export function ContaNova() {
  const navegar = useNavigate()
  const localizacao = useLocation()
  const [parametros, setParametros] = useSearchParams()
  // A cache dos dados do servidor, para invalidar a lista de contas depois
  // de criar. A TanStack Query (uma biblioteca de gestão de
  // dados vindos do servidor) guarda numa cache (uma cópia em memória)
  // os dados já pedidos, identificados por uma "chave" (ex.: ['contas']).
  // "Invalidar" uma chave marca esses dados como desatualizados: todas as
  // páginas que os mostram voltam a pedi-los e redesenham-se sozinhas.
  const clienteConsultas = useQueryClient()

  const [passo, setPasso] = useState<Passo>(() => {
    const autorizacao = parametros.get('autorizacao')
    const erro = parametros.get('erro')
    if (autorizacao) return { tipo: 'confirmar', autorizacaoId: autorizacao }
    if (erro) return { tipo: 'erro', mensagem: erro }
    const via = parametros.get('via')
    if (via === 'banco') return { tipo: 'banco' }
    if (via === 'manual') return { tipo: 'manual' }
    return { tipo: 'escolha' }
  })
  // O erro do banco mostra a mensagem técnica só quando se pede.
  const [verDetalhesErro, setVerDetalhesErro] = useState(false)
  // Lido uma vez, para o efeito que carrega a lista de bancos ao entrar
  // directamente no passo "banco" (ver mais abaixo).
  const [entrouPeloBanco] = useState(() => parametros.get('via') === 'banco')

  function irPara(novoPasso: Passo) {
    setPasso(novoPasso)
    // Guarda o passo no URL (ver "O PASSO VIVE TAMBÉM NO URL", no topo).
    // Só os três passos a que se chega por um toque: "confirmar" e "erro"
    // já chegam com o seu próprio parâmetro, vindos do banco. Voltar à
    // escolha limpa tudo — incluindo um "erro" antigo, para um refresh
    // não o voltar a mostrar.
    if (novoPasso.tipo === 'manual' || novoPasso.tipo === 'banco') {
      setParametros({ via: novoPasso.tipo }, { replace: true })
    } else if (novoPasso.tipo === 'escolha') {
      setParametros({}, { replace: true })
    }
  }

  // --- Passo "manual" ---
  const [aSubmeter, setASubmeter] = useState(false)
  const [valido, setValido] = useState(false)
  // Há dados escritos no formulário (ver SAIR DO FORMULÁRIO MANUAL COM
  // DADOS ESCRITOS), e o que o utilizador queria quando tentou sair — a
  // confirmação está aberta enquanto isto não for null.
  const [alterado, setAlterado] = useState(false)
  const [saidaPendente, setSaidaPendente] = useState<Intencao | null>(null)

  // --- Passo "banco": país, lista, banco escolhido (por confirmar nas
  // permissões) e se já se tocou em "Continuar para <banco>" ---
  const [bancos, setBancos] = useState<Banco[] | null>(null)
  const [erroBancos, setErroBancos] = useState<string | null>(null)
  const [paisBanco, setPaisBanco] = useState('PT')
  const [bancoParaConfirmar, setBancoParaConfirmar] = useState<string | null>(null)
  const [aAbrirBanco, setAAbrirBanco] = useState(false)

  // --- Passo "confirmar" (ver FASES, no topo do ficheiro) ---
  const [contasLigadas, setContasLigadas] = useState<ContaBancaria[] | null>(null)
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
  // Com dados escritos no formulário manual, a saída pede confirmação.
  const proteger = passo.tipo === 'manual' && alterado && !aSubmeter
  const contextoParaSeletor = useMemo(
    () => ({
      // Em cascata (ver COORDENAÇÃO DE ARRASTO): o mesmo deslocamento vai
      // para a aninhada E para a base, e largar para lá do limiar faz as
      // duas saírem — o gesto fecha o fluxo todo.
      espelharDeslocamento: (y: number) => {
        setAEspelharAninhada(true)
        setEspelhoAninhada(y > 0 ? y : 0)
        contextoParaAninhada.espelharDeslocamento(y)
      },
      concluirArrasto: (descartar: boolean) => {
        // Com dados por guardar, o gesto fecha só o painel de cima (a
        // moeda, o banco) e pergunta; as folhas de baixo voltam ao sítio.
        const sair = descartar && !proteger
        if (descartar && proteger) setSaidaPendente('dispensar')
        setAEspelharAninhada(false)
        if (sair) setAAbandonarAninhada(true)
        else setEspelhoAninhada(0)
        contextoParaAninhada.concluirArrasto(sair)
      },
    }),
    [contextoParaAninhada, proteger],
  )

  // Para onde navegar quando a folha acabar de sair, e o que levar no
  // "state" da navegação (o aviso a mostrar no destino).
  const destino = useRef<string | number>(localizacao.key === 'default' ? '/contas' : -1)
  const estadoDestino = useRef<{ aviso: string } | undefined>(undefined)

  // Com a cascata de arrasto, a base e a aninhada saem ao mesmo tempo, e
  // as duas chamam "aoSair" no fim da animação. Só a primeira navega — a
  // segunda faria um segundo "navegar(-1)" e recuaria duas páginas.
  const jaSaiu = useRef(false)
  // Chegou-se aqui por dentro da app (há uma página da app logo atrás no
  // histórico — a lista de Contas)? Ou a página carregou de raiz (o
  // regresso do site do banco, um link directo)? Lido uma vez, ao montar.
  const veioDeDentro = useRef(localizacao.key !== 'default')

  /*
   * SAIR SEM DEIXAR A "NOVA CONTA" NO HISTÓRICO. Depois de criar, vai-se
   * para o detalhe da conta — e o "‹" de lá tem de levar à lista de
   * Contas, não reabrir este formulário (nem, depois do Open Banking,
   * voltar ao site do banco). Por isso o fluxo nunca acrescenta o detalhe
   * POR CIMA desta página; põe-no NO LUGAR dela ("replace"):
   *   - veio de dentro: [Contas, Nova conta] → [Contas, Conta];
   *   - carregou de raiz: [site do banco, Nova conta] → primeiro troca-se
   *     a Nova conta pela lista ([…, Contas]) e só depois se abre a conta
   *     por cima ([…, Contas, Conta]) — o "‹" do detalhe volta à lista.
   * Voltar à lista sem criar nada é só recuar, quando se veio de lá.
   */
  function aoSair() {
    if (jaSaiu.current) return
    jaSaiu.current = true
    const alvo = destino.current
    const estado = estadoDestino.current
    if (typeof alvo === 'number' || (alvo === '/contas' && veioDeDentro.current)) {
      navegar(-1)
    } else if (alvo !== '/contas' && !veioDeDentro.current) {
      navegar('/contas', { replace: true })
      navegar(alvo, { state: estado })
    } else {
      navegar(alvo, { state: estado, replace: true })
    }
  }

  // Entrada directa no passo "banco" (via=banco): a lista de bancos tem de
  // ser pedida aqui, porque não houve o toque em "Ligar um banco" que
  // normalmente a pede (ver abrirPassoBanco).
  useEffect(() => {
    if (!entrouPeloBanco) return
    listarBancos('PT')
      .then(setBancos)
      .catch((erroApanhado) => {
        setErroBancos(
          erroApanhado instanceof ErroApi
            ? erroApanhado.message
            : 'Não foi possível obter a lista de bancos.',
        )
      })
  }, [entrouPeloBanco])

  // Voltar do site do banco com o botão "atrás" do browser pode restaurar
  // esta página tal como ficou (a "bfcache"), presa em "A preparar a ligação…" — ao
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
    // Há uma conta nova: invalida a lista (a página Contas, por baixo,
    // actualiza-se sozinha).
    void clienteConsultas.invalidateQueries({ queryKey: CHAVES.contas })
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
    // Um instante para o ecrã "A preparar a ligação…" chegar a ser pintado antes de o
    // browser começar a sair da app.
    window.setTimeout(() => iniciarAutorizacao(banco, paisBanco), 60)
  }

  // Carrega as contas descobertas assim que se entra no passo "confirmar".
  // Num efeito (useEffect: código que corre DEPOIS de o componente se
  // desenhar), e não no corpo do componente: o corpo pode correr várias
  // vezes antes de a resposta chegar (cada mudança de estado volta a
  // desenhá-lo, e o modo de desenvolvimento do React desenha-o duas
  // vezes de propósito), e cada vez dispararia outro pedido ao servidor.
  // O efeito só volta a correr se mudar a ligação a confirmar.
  const ligacaoAConfirmar = passo.tipo === 'confirmar' ? passo.autorizacaoId : null
  useEffect(() => {
    if (ligacaoAConfirmar === null) return
    // "activo" evita gravar a resposta de um pedido que já não interessa
    // (o utilizador saiu deste passo antes de ela chegar).
    let activo = true
    listarContasBancarias(ligacaoAConfirmar)
      .then((contas) => {
        if (activo) setContasLigadas(contas)
      })
      .catch((erroApanhado) => {
        if (!activo) return
        setErroContasLigadas(
          erroApanhado instanceof ErroApi
            ? erroApanhado.message
            : 'Não foi possível obter as contas descobertas.',
        )
      })
    return () => {
      activo = false
    }
  }, [ligacaoAConfirmar])

  // Ao voltar do banco: as contas ainda por associar (novas, ou que já
  // foram uma conta tua entretanto desvinculada) e as que já estão nas
  // tuas contas (a ligação renovou-se sozinha — ver ContaBancaria, em
  // src/lib/openBanking.ts).
  const pendentes = (contasLigadas ?? []).filter((c) => c.conta_id === null)
  const renovadas = (contasLigadas ?? []).filter((c) => c.conta_id !== null)
  // O ecrã "Contas encontradas" aparece quando há algo a decidir (várias
  // contas novas) ou a contar (uma nova e outras renovadas). Com uma só
  // conta nova e mais nada, configura-se logo.
  const escolhaVisivel = pendentes.length > 1 || (pendentes.length === 1 && renovadas.length > 0)
  const aConfigurar = escolhaVisivel
    ? pendentes.filter((c) => !desmarcadas.includes(c.id))
    : pendentes
  const nomeBancoLigado = contasLigadas?.[0]?.banco ?? ''

  function alternarConta(id: string) {
    setDesmarcadas((atual) =>
      atual.includes(id) ? atual.filter((x) => x !== id) : [...atual, id],
    )
  }

  // Cria as contas uma a uma — cada criarContaDoBanco já importa os
  // movimentos no backend. Uma que falhe não impede as seguintes.
  async function importar(dados: DadosContasLigadas) {
    setFase('importar')
    setResultados(dados.contas.map((c) => ({ id: c.id, nome: c.nome, estado: 'a-importar' })))
    for (const c of dados.contas) {
      try {
        const criada = await criarContaDoBanco(c.id, c.nome, dados.dataDe ?? undefined, c.tipo)
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
    // Contas novas (as que correram bem): invalida a lista.
    void clienteConsultas.invalidateQueries({ queryKey: CHAVES.contas })
    setFase('concluido')
  }

  // A duração da autorização no banco escolhido (o máximo que ele aceita,
  // até 180 dias — calculado pelo backend). 90 se, por alguma razão, o
  // banco não estiver na lista.
  const validadeDias =
    bancos?.find((banco) => banco.name === bancoParaConfirmar)?.validade_dias ?? 90

  // A lista do passo "banco": alfabética (a Enable Banking não promete
  // ordem), com uma secção por letra — o padrão das listas longas
  // alfabéticas (os contactos do telemóvel).
  const opcoesBanco: OpcaoLista[] = (bancos ?? [])
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, 'pt'))
    .map((banco) => ({ valor: banco.name, etiqueta: banco.name, grupo: letraDe(banco.name) }))

  const configNaAninhada = passo.tipo === 'confirmar' && fase === 'configurar' && escolhaVisivel
  const aninhadaAberta = passo.tipo === 'manual' || passo.tipo === 'banco' || configNaAninhada
  // Uma conta só: o formulário de configurar está na própria base, logo
  // desde o início (a escolha de contas nem chega a existir) — por isso
  // não depende de "fase" ser "configurar", só de não ter começado a
  // importação.
  const configNaBase =
    passo.tipo === 'confirmar' &&
    pendentes.length === 1 &&
    !escolhaVisivel &&
    (fase === 'contas' || fase === 'configurar')

  // Título da folha de BASE. Com a aninhada aberta por cima, as duas
  // diriam «Nova conta» — duas "role=dialog" com o mesmo nome seriam
  // ambíguas para quem usa leitor de ecrã. A de base ganha então um NOME
  // ACESSÍVEL próprio («Nova conta, escolha»), mas o título VISÍVEL fica
  // «Nova conta»: ao recuar, quando a aninhada sai pelo lado, a base vê-se
  // por instantes, e um título diferente aparecia a piscar.
  let tituloBase = 'Nova conta'
  let nomeAcessivelBase: string | undefined
  if (passo.tipo === 'confirmar') {
    if (fase === 'importar') tituloBase = 'A importar'
    else if (fase === 'concluido') tituloBase = 'Concluído'
    else if (configNaBase) tituloBase = 'Nova conta'
    else tituloBase = 'Contas encontradas'
  } else if (aninhadaAberta) {
    nomeAcessivelBase = 'Nova conta, escolha'
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
                ? 'A importar movimentos'
                : falhouTudo
                  ? 'Não foi possível adicionar'
                  : feitos.length === 1
                    ? 'Conta adicionada'
                    : `${feitos.length} contas adicionadas`}
            </h2>
            <p className={estilos.heroiTexto}>
              {!concluido
                ? 'Demora alguns segundos.'
                : falhouTudo
                  ? 'Nada foi guardado. Podes tentar outra vez.'
                  : 'Os movimentos importados ficam por categorizar.'}
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
            <span className={`${estilos.heroiIcone} ${estilos.heroiIconeOk}`}>
              <IconeCheck tamanho={30} />
            </span>
            <h2 className={estilos.heroiTitulo}>Já está tudo nas tuas contas</h2>
            {renovadas.length > 0 && (
              <p className={estilos.heroiTexto}>
                Ligação renovada até {dataCurta(renovadas[0].valido_ate)}.
              </p>
            )}
          </div>
          {listaRenovadas('iban')}
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

    // Uma conta nova e mais nada: configura-se aqui mesmo, sem escolha.
    if (!escolhaVisivel) {
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

    // Contas encontradas: as novas, para escolher (e, por cima, a folha
    // aninhada de configurar), e as que já estão nas tuas contas.
    const n = aConfigurar.length
    const total = (contasLigadas ?? []).length
    return (
      <div className={`${estilos.formulario} ${estilos.consentimento}`}>
        <div className={estilos.heroi}>
          <h2 className={estilos.heroiTitulo}>
            {total === 1 ? '1 conta encontrada' : `${total} contas encontradas`}
          </h2>
          <p className={estilos.heroiTexto}>{nomeBancoLigado}</p>
        </div>

        <section className={estilos.seccao}>
          <h3 className={estilos.seccaoTitulo}>Novas</h3>
          <ul className={estilos.cartaoLista}>
            {pendentes.map((c) => {
              const marcada = !desmarcadas.includes(c.id)
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    className={estilos.linhaConta}
                    role="checkbox"
                    aria-checked={marcada}
                    onClick={() => alternarConta(c.id)}
                  >
                    <span className={`${estilos.marca} ${marcada ? estilos.marcaOn : ''}`} aria-hidden="true">
                      <IconeCheck tamanho={13} />
                    </span>
                    <span className={estilos.linhaContaTexto}>
                      <span>{c.tipo_sugerido ?? `Conta ${c.moeda}`}</span>
                      <span className={estilos.linhaContaDetalhe}>
                        {/* Já foi uma conta tua, entretanto desvinculada:
                            por agora entra como conta nova (religar à
                            antiga precisa de reconciliações), mas diz-se
                            qual era, para não haver surpresas. */}
                        {c.conta_antiga
                          ? `Já foi a «${c.conta_antiga.nome}»`
                          : [ibanCurto(c.iban), c.moeda].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </section>

        {renovadas.length > 0 && (
          <section className={estilos.seccao}>
            <h3 className={estilos.seccaoTitulo}>Já nas tuas contas</h3>
            {listaRenovadas('renovada')}
          </section>
        )}

        <div className={estilos.accoes}>
          <Botao disabled={n === 0} onClick={() => setFase('configurar')}>
            {n === 0 ? 'Escolhe pelo menos uma' : n === 1 ? 'Continuar com 1 conta' : `Continuar com ${n} contas`}
          </Botao>
        </div>
      </div>
    )
  }

  // As contas que já estavam nas tuas contas: a ligação renovou-se. Por
  // baixo do nome, a data de renovação — ou, no ecrã "Já está tudo nas
  // tuas contas" (onde essa data já está no título), o IBAN abreviado.
  function listaRenovadas(detalhe: 'renovada' | 'iban') {
    return (
      <ul className={estilos.cartaoLista}>
        {renovadas.map((c) => (
          <li key={c.id} className={estilos.linhaConta}>
            <span className={`${estilos.estado} ${estilos.estadoOk}`} aria-hidden="true">
              <IconeCheck tamanho={12} />
            </span>
            <span className={estilos.linhaContaTexto}>
              <span>{c.conta_nome ?? c.banco}</span>
              <span className={estilos.linhaContaDetalhe}>
                {detalhe === 'renovada'
                  ? `Ligação renovada até ${dataCurta(c.valido_ate)}`
                  : [ibanCurto(c.iban), c.moeda].filter(Boolean).join(' · ')}
              </span>
            </span>
          </li>
        ))}
      </ul>
    )
  }

  function conteudoBanco() {
    // O país numa ficha, como os campos dos formulários (com o seletor de
    // procura dos outros seletores).
    const fichaPais = (
      <div className={ficha.grupo}>
        <CampoSelecao
          disposicao="lado"
          etiqueta="País"
          valor={paisBanco}
          aoMudar={mudarPais}
          opcoes={OPCOES_PAIS}
          direcaoPainel="direita"
          pesquisavel
        />
      </div>
    )
    return (
      <>
        <div className={`${estilos.formulario} ${estilos.consentimento}`}>
          {erroBancos !== null ? (
            <>
              {fichaPais}
              <CaixaErro>{erroBancos}</CaixaErro>
            </>
          ) : bancos === null ? (
            <>
              {fichaPais}
              <p className={estilos.nota}>A carregar bancos…</p>
            </>
          ) : opcoesBanco.length === 0 ? (
            <>
              {fichaPais}
              <p className={estilos.nota}>Este país ainda não tem bancos suportados.</p>
            </>
          ) : (
            // A procura no topo do ecrã; o país logo a seguir (filtra a
            // lista, por isso fica por cima dela); depois os bancos, um
            // cartão por letra.
            <ListaDeOpcoes
              opcoes={opcoesBanco}
              valor=""
              aoEscolher={setBancoParaConfirmar}
              procura="Procurar banco"
              depoisDaProcura={fichaPais}
            />
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
                    {/* Não «A abrir <banco>»: o primeiro ecrã a seguir é o da
                        Enable Banking, e só depois o do banco. */}
                    <span className={estilos.roda} role="status" aria-label="A preparar a ligação" />
                    <h2 className={estilos.heroiTitulo}>A preparar a ligação…</h2>
                  </div>
                </div>
              ) : (
                // O que torna o consentimento informado (PSD2, artigo 67.º;
                // RGPD): o que se vai ver e o que nunca se pode fazer, por
                // quanto tempo, como se cancela, e quem acede. As contas a
                // partilhar escolhem-se no próprio banco, a seguir.
                <div className={`${estilos.formulario} ${estilos.consentimento}`}>
                  <h2 className={`${estilos.heroiTitulo} ${estilos.tituloPermissoes}`}>
                    {bancoParaConfirmar}
                  </h2>

                  <section className={estilos.seccao}>
                    <h3 className={estilos.seccaoTitulo}>Vai poder ver</h3>
                    <ul className={estilos.cartaoLista}>
                      {['Saldos', 'Movimentos', 'Titular e IBAN'].map((texto) => (
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
                    <h3 className={estilos.seccaoTitulo}>Nunca vai poder</h3>
                    <ul className={estilos.cartaoLista}>
                      {['Fazer pagamentos ou transferências', 'Ver as tuas credenciais do banco'].map(
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
                  </section>

                  <section className={estilos.seccao}>
                    <ul className={estilos.cartaoLista}>
                      <li className={estilos.linhaInfo}>
                        <span>Duração</span>
                        <span className={estilos.linhaInfoValor}>{validadeDias} dias</span>
                      </li>
                      <li className={estilos.linhaInfo}>
                        <span>Cancelar</span>
                        <span className={estilos.linhaInfoValor}>Quando quiseres</span>
                      </li>
                      <li>
                        <a
                          className={estilos.linhaInfo}
                          href={REGISTO_EBA_ENABLE_BANKING}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <span>Responsável</span>
                          <span className={estilos.linhaInfoValor}>
                            Enable Banking
                            <IconeExterno />
                          </span>
                        </a>
                      </li>
                    </ul>
                    <p className={estilos.rodape}>
                      Para cancelar, toca em «Desvincular» no detalhe da conta, ou cancela no teu
                      banco. No fim do prazo, o banco volta a pedir autorização.
                    </p>
                  </section>

                  <div className={estilos.accoes}>
                    <Botao onClick={() => continuarParaBanco(bancoParaConfirmar)}>Continuar</Botao>
                    <p className={estilos.rodapeCentrado}>Inicias sessão no site do banco.</p>
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
        nomeAcessivel={nomeAcessivelBase}
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
                    A autorização foi cancelada ou expirou. Nada foi guardado.
                  </p>
                </div>
                {/* A mensagem técnica do banco, só para quem a pedir (ex.:
                    para a enviar a quem dá suporte). */}
                <ul className={estilos.cartaoLista}>
                  <li>
                    <button
                      type="button"
                      className={estilos.linhaInfo}
                      aria-expanded={verDetalhesErro}
                      onClick={() => setVerDetalhesErro((v) => !v)}
                    >
                      <span>Detalhes técnicos</span>
                      <span
                        className={`${estilos.setaDetalhes} ${verDetalhesErro ? estilos.setaDetalhesAberta : ''}`}
                        aria-hidden="true"
                      >
                        <IconeChevronDireita tamanho={16} />
                      </span>
                    </button>
                  </li>
                  {verDetalhesErro && (
                    <li className={estilos.linhaPermissao}>
                      <code className={estilos.detalheErro}>{passo.mensagem}</code>
                    </li>
                  )}
                </ul>
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

      {saidaPendente !== null && (
        <Confirmacao
          titulo="Tens dados por guardar"
          textoConfirmar="Descartar"
          textoCancelar="Continuar a editar"
          aoConfirmar={() => {
            // Faz o que o utilizador queria quando tentou sair (a folha,
            // já sem a proteção, desaparece).
            const intencao = saidaPendente
            setSaidaPendente(null)
            setAlterado(false)
            if (intencao === 'recuar') irPara({ tipo: 'escolha' })
            else aoSair()
          }}
          aoCancelar={() => setSaidaPendente(null)}
        >
          Se saíres agora, perdes o que escreveste.
        </Confirmacao>
      )}

      {aninhadaAberta && (
        <ContextoFolha.Provider value={contextoParaAninhada}>
          <Folha
            titulo={tituloAninhada}
            direcao="direita"
            varianteFechar="circulo"
            aoRecuar={() => (configNaAninhada ? setFase('contas') : irPara({ tipo: 'escolha' }))}
            aoDispensar={aoSair}
            protegida={proteger}
            aoTentarSair={setSaidaPendente}
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
                      aoMudarAlterado={setAlterado}
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
