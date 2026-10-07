/*
 * SeletorData — ESCOLHER UMA DATA NUM CALENDÁRIO
 * ==============================================
 *
 * Substitui o campo de data nativo do browser (<input type="date">), que
 * em cada sistema aparece de maneira diferente e que, nesta app, chegou a
 * mostrar DOIS ícones de calendário lado a lado (o do browser e o nosso).
 *
 * O CAMPO é uma linha de ficha como as outras (CampoSelecao, CampoTexto):
 * o nome em cima, ténue, e a data por baixo ("2 out 2026"), com uma seta
 * para baixo que roda enquanto o calendário está aberto. Sem preenchimento
 * nem "pílula" — é um campo como os outros. Com disposicao="lado", o nome
 * fica à esquerda e a data à direita (como nos outros campos com essa
 * disposição).
 *
 * O CALENDÁRIO:
 *   - TELEMÓVEL: um cartão que FLUTUA na parte de baixo do ecrã (com
 *     margem dos lados e em baixo, cantos todos arredondados), sobre um
 *     véu que escurece ligeiramente o formulário — o desenho dos
 *     calendários do iOS. Por cima, a mesma barra das folhas da app: "✕"
 *     à esquerda, o nome do campo ao centro, "✓" à direita. Por isso a
 *     escolha é um RASCUNHO: tocar num dia só o marca; a data no campo só
 *     muda com o "✓". O "✕", tocar fora do cartão ou Escape CANCELAM e
 *     deixam a data como estava. O formulário fica PARADO por trás — não
 *     rola para mostrar o campo: o cartão é modal (o véu escurece tudo o
 *     resto) e o seu título já diz que data se está a escolher. Desenha-se
 *     num "portal" (createPortal, do React: o componente desenha-se noutro
 *     ponto da página, aqui diretamente no <body>, embora continue a
 *     pertencer a este componente), como a Confirmacao, para ficar por cima
 *     da folha onde o formulário vive.
 *   - ECRÃ LARGO: abre-se por baixo do campo, DENTRO da ficha (como a
 *     lista em linha do CampoSelecao). Aqui não há barra nem rascunho:
 *     tocar num dia muda logo a data; fecha-se tocando fora ou com Escape.
 *
 * Dentro do calendário: o mês e o ano no título ("Outubro 2026 ›"), as
 * setas ‹ › para mudar de mês, a semana a começar à SEGUNDA (como se usa
 * em Portugal), o dia escolhido num círculo preenchido e o dia de hoje
 * com o número a vermelho. A grelha tem sempre seis linhas, mesmo nos
 * meses que só ocupam cinco, para o cartão não mudar de altura ao trocar
 * de mês. Tocar no título troca a grelha por duas RODAS, de meses e de
 * anos (ver "Roda", abaixo), para saltar para longe sem tocar nas setas
 * mês a mês.
 *
 * "maximo" (uma data ISO, "AAAA-MM-DD"): os dias depois dela ficam
 * esbatidos e não se podem escolher — ex.: a data de início de uma conta,
 * que o backend não aceita no futuro.
 *
 * As datas entram e saem como texto ISO ("2026-10-02"), o formato da API;
 * por dentro trabalha-se com {ano, mes (0–11), dia}, para nunca passar
 * pelo objecto Date com fusos horários pelo meio.
 */

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { useMediaQuery } from '../hooks/useMediaQuery'
import { DURACAO_DESLOCAR_MS } from '../lib/movimento'
import { IconeCheck, IconeChevronDireita, IconeChevronEsquerda, IconeFechar } from './icones'
import estilos from './SeletorData.module.css'

const MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]
const MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const DIAS_SEMANA = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB', 'DOM']

// Altura de cada linha das rodas de mês e ano, em px (= 2.75rem, o valor
// do CSS ".item"). A roda calcula a linha ao centro a partir dela.
const ALTURA_ITEM = 44

type Dia = { ano: number; mes: number; dia: number }

function deIso(iso: string): Dia {
  const [ano, mes, dia] = iso.split('-').map(Number)
  return { ano, mes: mes - 1, dia }
}

function paraIso({ ano, mes, dia }: Dia): string {
  return `${ano}-${String(mes + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
}

/** "2026-10-02" → "2 out 2026". */
function formatarDataCurta(iso: string): string {
  const { ano, mes, dia } = deIso(iso)
  return `${dia} ${MESES_CURTOS[mes]} ${ano}`
}

function hojeIso(): string {
  const agora = new Date()
  return paraIso({ ano: agora.getFullYear(), mes: agora.getMonth(), dia: agora.getDate() })
}

/*
 * Roda — UMA COLUNA DE ESCOLHA AO ESTILO DO iOS
 *
 * Uma lista que rola na vertical, em que o valor escolhido é o que fica
 * AO CENTRO, dentro da faixa cinzenta (desenhada por fora, por quem usa,
 * para atravessar as duas rodas de uma vez). Escolhe-se de duas formas:
 *   - rolando: o CSS "scroll-snap" encaixa sempre uma linha no centro, e,
 *     quando o scroll pára, a linha que lá ficou passa a ser a escolhida;
 *   - tocando numa linha: rola até ela e escolhe-a logo.
 * Por cima e por baixo, as linhas desvanecem (uma máscara em gradiente, no
 * CSS), como num cilindro a fugir para trás.
 *
 * A conta "linha ao centro = scrollTop / ALTURA_ITEM" funciona porque o
 * CSS põe, antes da primeira linha e depois da última, um espaço de meia
 * roda menos meia linha — assim, com scrollTop = i × ALTURA_ITEM, a linha
 * i fica exactamente ao centro.
 */
function Roda({
  rotulo,
  itens,
  indice,
  aoEscolher,
}: {
  rotulo: string
  itens: string[]
  indice: number
  aoEscolher: (indice: number) => void
}) {
  const rodaRef = useRef<HTMLDivElement>(null)
  const temporizador = useRef<number | undefined>(undefined)

  // Ao aparecer, a linha escolhida já está ao centro (sem animação). Um
  // efeito "de layout" corre antes da pintura — nunca se vê a roda no
  // sítio errado, a saltar.
  useLayoutEffect(() => {
    if (rodaRef.current) rodaRef.current.scrollTop = indice * ALTURA_ITEM
    // Só ao aparecer: depois, é o próprio scroll que manda.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => () => window.clearTimeout(temporizador.current), [])

  // O scroll dispara muitas vezes por segundo; só se escolhe quando pára
  // (120 ms sem mexer). O evento "scrollend" faria isto sozinho, mas ainda
  // não existe em todos os browsers que a app suporta.
  function aoRolar() {
    window.clearTimeout(temporizador.current)
    temporizador.current = window.setTimeout(() => {
      const roda = rodaRef.current
      if (!roda) return
      const novo = Math.min(itens.length - 1, Math.max(0, Math.round(roda.scrollTop / ALTURA_ITEM)))
      if (novo !== indice) aoEscolher(novo)
    }, 120)
  }

  function tocar(i: number) {
    rodaRef.current?.scrollTo?.({ top: i * ALTURA_ITEM, behavior: 'smooth' })
    aoEscolher(i)
  }

  return (
    <div ref={rodaRef} className={estilos.roda} role="listbox" aria-label={rotulo} onScroll={aoRolar}>
      {itens.map((texto, i) => (
        <button
          key={texto}
          type="button"
          role="option"
          aria-selected={i === indice}
          className={i === indice ? `${estilos.item} ${estilos.itemEscolhido}` : estilos.item}
          onClick={() => tocar(i)}
        >
          {texto}
        </button>
      ))}
    </div>
  )
}

type Props = {
  etiqueta: string
  // A data escolhida, em ISO ("AAAA-MM-DD").
  valor: string
  aoMudar: (iso: string) => void
  // Último dia que se pode escolher, em ISO (os seguintes ficam esbatidos).
  maximo?: string
  // "linha" (nome em cima, data por baixo) ou "lado" (nome à esquerda,
  // data à direita).
  disposicao?: 'linha' | 'lado'
}

export function SeletorData({ etiqueta, valor, aoMudar, maximo, disposicao = 'linha' }: Props) {
  const id = useId()
  const eMobile = useMediaQuery('(max-width: 768px)')
  const [aberto, setAberto] = useState(false)
  // A descer (telemóvel), antes de sair da página.
  const [aFechar, setAFechar] = useState(false)
  // Telemóvel: o dia marcado mas ainda não confirmado com o "✓" (ver
  // O CALENDÁRIO, no topo). Em ecrã largo não se usa — muda logo "valor".
  const [rascunho, setRascunho] = useState(valor)
  // "dias" (a grelha) ou "meses" (as colunas de mês e ano).
  const [modo, setModo] = useState<'dias' | 'meses'>('dias')
  // O dia que o calendário mostra como escolhido: o rascunho, em
  // telemóvel; a própria data do campo, em ecrã largo.
  const marcado = eMobile ? rascunho : valor
  const escolhido = deIso(valor)
  // O mês que se está a VER (pode ser outro que não o da data escolhida).
  const [vista, setVista] = useState({ ano: escolhido.ano, mes: escolhido.mes })
  const raizRef = useRef<HTMLDivElement>(null)

  function abrir() {
    setVista({ ano: escolhido.ano, mes: escolhido.mes })
    setModo('dias')
    setRascunho(valor)
    setAFechar(false)
    setAberto(true)
  }

  // Fecha sem mexer na data (o "✕", tocar fora, Escape) — o rascunho
  // perde-se.
  function fechar() {
    if (!aberto) return
    if (eMobile) setAFechar(true)
    else setAberto(false)
  }

  // O "✓": passa o rascunho para o campo, e fecha.
  function confirmar() {
    if (rascunho !== valor) aoMudar(rascunho)
    fechar()
  }

  function escolherDia(iso: string) {
    if (eMobile) setRascunho(iso)
    else aoMudar(iso)
  }

  // Telemóvel: no fim da descida, sai mesmo da página.
  useEffect(() => {
    if (!aFechar) return
    const temporizador = window.setTimeout(() => {
      setAberto(false)
      setAFechar(false)
    }, DURACAO_DESLOCAR_MS)
    return () => window.clearTimeout(temporizador)
  }, [aFechar])

  // Escape fecha; em ecrã largo, tocar fora também (em telemóvel, quem
  // apanha esse toque é o véu escurecido por trás do painel).
  useEffect(() => {
    if (!aberto) return
    function aoTeclar(evento: KeyboardEvent) {
      if (evento.key === 'Escape') {
        evento.stopPropagation()
        fechar()
      }
    }
    function aoClicarFora(evento: MouseEvent) {
      if (!eMobile && raizRef.current && !raizRef.current.contains(evento.target as Node)) {
        setAberto(false)
      }
    }
    document.addEventListener('keydown', aoTeclar, true)
    document.addEventListener('mousedown', aoClicarFora)
    return () => {
      document.removeEventListener('keydown', aoTeclar, true)
      document.removeEventListener('mousedown', aoClicarFora)
    }
    // "fechar" muda a cada render mas faz sempre o mesmo; não entra aqui.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto, eMobile])

  // --- A grelha do mês que se está a ver ---
  const hoje = hojeIso()
  const primeiroDiaSemana = new Date(vista.ano, vista.mes, 1).getDay() // 0 = domingo
  const vaziosAntes = (primeiroDiaSemana + 6) % 7 // semana a começar à segunda
  const diasNoMes = new Date(vista.ano, vista.mes + 1, 0).getDate()

  function mudarMes(delta: number) {
    const total = vista.ano * 12 + vista.mes + delta
    setVista({ ano: Math.floor(total / 12), mes: total % 12 })
  }

  // Anos na roda: de 30 anos atrás até ao ano do "maximo" (ou o atual
  // + 5, sem máximo).
  const anoFinal = maximo ? deIso(maximo).ano : new Date().getFullYear() + 5
  const anos: number[] = []
  for (let ano = anoFinal - 30; ano <= anoFinal; ano++) anos.push(ano)
  // Um ano fora da roda (ex.: uma data antiga) fica no extremo mais perto.
  const posicaoAno = anos.indexOf(vista.ano)
  const indiceAno = posicaoAno !== -1 ? posicaoAno : vista.ano < anos[0] ? 0 : anos.length - 1

  const calendario = (
    <div className={estilos.calendario}>
      <div className={estilos.cabecalho}>
        <button
          type="button"
          className={estilos.titulo}
          aria-expanded={modo === 'meses'}
          onClick={() => setModo((m) => (m === 'dias' ? 'meses' : 'dias'))}
        >
          {MESES[vista.mes]} {vista.ano}
          <span className={modo === 'meses' ? `${estilos.tituloSeta} ${estilos.tituloSetaAberta}` : estilos.tituloSeta}>
            <IconeChevronDireita tamanho={16} traco={2.4} />
          </span>
        </button>
        {modo === 'dias' && (
          <span className={estilos.setas}>
            <button type="button" className={estilos.seta} aria-label="Mês anterior" onClick={() => mudarMes(-1)}>
              <IconeChevronEsquerda tamanho={18} traco={2.4} />
            </button>
            <button type="button" className={estilos.seta} aria-label="Mês seguinte" onClick={() => mudarMes(1)}>
              <IconeChevronDireita tamanho={18} traco={2.4} />
            </button>
          </span>
        )}
      </div>

      {modo === 'dias' ? (
        <>
          <div className={estilos.semana} aria-hidden="true">
            {DIAS_SEMANA.map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>
          <div className={estilos.grelha}>
            {Array.from({ length: vaziosAntes }, (_, i) => (
              <span key={`v${i}`} />
            ))}
            {Array.from({ length: diasNoMes }, (_, i) => {
              const dia = { ano: vista.ano, mes: vista.mes, dia: i + 1 }
              const iso = paraIso(dia)
              const eEscolhido = iso === marcado
              const eHoje = iso === hoje
              // Comparar ISO como texto funciona: "AAAA-MM-DD" ordena-se
              // alfabeticamente pela mesma ordem que cronologicamente.
              const desativado = maximo !== undefined && iso > maximo
              return (
                <button
                  key={iso}
                  type="button"
                  className={[
                    estilos.dia,
                    eEscolhido && estilos.diaEscolhido,
                    eHoje && !eEscolhido && estilos.diaHoje,
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  disabled={desativado}
                  aria-pressed={eEscolhido}
                  aria-label={`${i + 1} de ${MESES[vista.mes].toLocaleLowerCase('pt')} de ${vista.ano}${eHoje ? ', hoje' : ''}`}
                  onClick={() => escolherDia(iso)}
                >
                  <span>{i + 1}</span>
                </button>
              )
            })}
          </div>
        </>
      ) : (
        <div className={estilos.rodas}>
          {/* A faixa cinzenta ao centro, comum às duas rodas — o valor
              escolhido de cada uma é o que fica dentro dela. */}
          <span className={estilos.faixa} aria-hidden="true" />
          <Roda
            rotulo="Mês"
            itens={MESES}
            indice={vista.mes}
            aoEscolher={(mes) => setVista((v) => ({ ...v, mes }))}
          />
          <Roda
            rotulo="Ano"
            itens={anos.map(String)}
            indice={indiceAno}
            aoEscolher={(i) => setVista((v) => ({ ...v, ano: anos[i] }))}
          />
        </div>
      )}
    </div>
  )

  return (
    <div ref={raizRef} className={disposicao === 'lado' ? `${estilos.campo} ${estilos.lado}` : estilos.campo}>
      <button
        type="button"
        id={id}
        className={estilos.gatilho}
        aria-expanded={aberto && !aFechar}
        aria-haspopup="dialog"
        onClick={() => (aberto && !aFechar ? fechar() : abrir())}
      >
        <span className={estilos.textos}>
          <span className={estilos.etiqueta}>{etiqueta}</span>
          <span className={estilos.valor}>{formatarDataCurta(valor)}</span>
        </span>
        <span
          className={aberto && !aFechar ? `${estilos.seta2} ${estilos.seta2Aberta}` : estilos.seta2}
          aria-hidden="true"
        >
          <IconeChevronDireita tamanho={16} />
        </span>
      </button>

      {aberto && !eMobile && <div className={estilos.emLinha}>{calendario}</div>}

      {aberto &&
        eMobile &&
        createPortal(
          <>
            {/* Véu que escurece um pouco o formulário: tocar fora do
                cartão cancela, como o "✕". */}
            <div className={aFechar ? `${estilos.veu} ${estilos.veuAFechar}` : estilos.veu} onClick={fechar} />
            <div
              className={aFechar ? `${estilos.painel} ${estilos.painelAFechar}` : estilos.painel}
              role="dialog"
              aria-label={etiqueta}
            >
              <div className={estilos.barra}>
                <button type="button" className={estilos.botaoCancelar} aria-label="Cancelar" onClick={fechar}>
                  <IconeFechar tamanho={20} />
                </button>
                <span className={estilos.barraTitulo}>{etiqueta}</span>
                <button type="button" className={estilos.botaoConfirmar} aria-label="Confirmar" onClick={confirmar}>
                  <IconeCheck tamanho={22} />
                </button>
              </div>
              <div className={estilos.cartao}>{calendario}</div>
            </div>
          </>,
          document.body,
        )}
    </div>
  )
}
