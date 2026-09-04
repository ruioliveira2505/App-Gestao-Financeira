/*
 * Folha — A CONCHA PARTILHADA DOS MODAIS EM "SHEET"
 * ================================================
 *
 * Um modal que, em telemóvel, é uma "folha" (sheet) à maneira do iOS, com
 * UMA ÚNICA FORMA: cobre o ecrã deixando uma folga no topo (o que está por
 * trás espreita por aí), cantos de cima arredondados, uma "pega", ancorada
 * em baixo a toda a largura. Em ecrã largo é um diálogo centrado com
 * sombra à volta.
 *
 * A prop "direcao" só troca a ANIMAÇÃO DE ENTRADA:
 *   - "baixo"   — entra a subir de baixo (tarefa nova; ex.: "Nova conta").
 *   - "direita" — entra a deslizar da direita (avançar um nível; ex.:
 *                 escolher a moeda, a partir do modal "Nova conta").
 *
 * DOIS GESTOS DE SAÍDA, com destinos diferentes:
 *
 *   - RECUAR um nível — o "‹"/"X" do cabeçalho, a tecla Escape, um toque no
 *     fundo, ou (só quando "direcao='direita'") arrastar para o LADO. Sai
 *     pelo lado e chama "aoRecuar". Se "aoRecuar" não for dado (ex.: a
 *     "Nova conta", que não tem para onde recuar), cai no "aoDispensar".
 *
 *   - DISPENSAR o fluxo todo — arrastar para BAIXO. Sai por baixo e chama
 *     "aoDispensar". Quando esta folha está aninhada noutra (a moeda por
 *     cima da "Nova conta"), o arrasto para baixo é ESPELHADO na folha de
 *     fundo (via contextoFolha) para as duas descerem como uma só; ao
 *     largar, ou saem as duas (passou o limiar) ou voltam as duas.
 *
 * A folha de FUNDO de um fluxo recebe do contextoFolha, por props, o
 * espelho do arrasto da folha de cima: "deslocamentoExterno" (px a descer)
 * + "aSeguirExterno" (a seguir o dedo, sem suavização) e, no fim,
 * "aExternamenteASair" (largou-se para lá do limiar — sai também).
 *
 * Em qualquer saída o painel ANIMA para fora (uma classe CSS põe o
 * "transform" final; a transição do ".painel" trata do resto) e só no fim
 * da animação se chama o callback. Quem monta a folha é responsável por
 * SÓ A MONTAR enquanto está aberta.
 *
 * ACESSO A "fechar" A PARTIR DO CONTEÚDO. As props "children" e "acao"
 * aceitam um nó React ou uma função "(fechar) => nó"; "fechar" faz um
 * recuo animado (ex.: escolher uma opção e voltar).
 *
 * "aria-modal" + armadilha de foco (o Tab não sai da folha) + o botão de
 * fechar recebe o foco ao abrir. O "onKeyDown" faz "stopPropagation" do
 * Escape/Tab: uma folha por cima de outra trata ela própria dessas teclas.
 */

import {
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'

import { ContextoFolha } from './contextoFolha'
import { IconeChevronEsquerda } from './icones'
import estilos from './Folha.module.css'

// Distância de arrasto (px) a partir da qual largar descarta a folha.
const LIMIAR_DESCARTE = 120
// Movimento (px) a partir do qual se decide o eixo de um arrasto ambíguo.
const LIMIAR_EIXO = 6
// Deve acompanhar a duração da transição de "transform" no CSS.
const DURACAO_SAIDA_MS = 280
// A partir daqui é "desktop": a folha é um diálogo centrado, sem arrasto.
const CONSULTA_DESKTOP = '(min-width: 769px)'

type Direcao = 'baixo' | 'direita'
type Intencao = 'recuar' | 'dispensar'
type Eixo = 'x' | 'y'

// "children" e "acao" podem ser um nó fixo ou uma função que recebe o
// "fechar" da folha (para um botão do conteúdo poder despoletar o recuo
// animado).
type NoOuComFechar = ReactNode | ((fechar: () => void) => ReactNode)

type Props = {
  // Vai para o cabeçalho e para o "aria-label" da folha.
  titulo: string
  // Lado por onde a folha entra.
  direcao?: Direcao
  // Abandonar o fluxo (arrasto para baixo). Corre DEPOIS da animação.
  aoDispensar: () => void
  // Recuar um nível ("‹" / Escape / fundo / arrasto para o lado). Corre
  // DEPOIS da animação. Se ausente, estes gestos caem no "aoDispensar".
  aoRecuar?: () => void
  // Ícone do botão de fechar (por omissão, um "‹").
  iconeFechar?: ReactNode
  // Rótulo acessível do botão de fechar (por omissão, "Voltar").
  rotuloFechar?: string
  // Aspeto do botão de fechar: "simples" (só o ícone) ou "circulo"
  // (círculo branco com sombra, como o "X" do modal "Nova conta").
  varianteFechar?: 'simples' | 'circulo'
  // --- Só para a folha de FUNDO de um fluxo (preenchidas pelo contexto): ---
  // Espelho do arrasto vertical da folha de cima (px a descer, >= 0).
  deslocamentoExterno?: number
  // A folha de cima está a seguir o dedo agora — mover sem suavização.
  aSeguirExterno?: boolean
  // A folha de cima largou para lá do limiar — sair também (para baixo).
  aExternamenteASair?: boolean
  // Conteúdo do canto superior direito (ex.: um "✓"). Opcional.
  acao?: NoOuComFechar
  // Corpo da folha.
  children: NoOuComFechar
}

export function Folha({
  titulo,
  direcao = 'baixo',
  aoDispensar,
  aoRecuar,
  iconeFechar,
  rotuloFechar = 'Voltar',
  varianteFechar = 'simples',
  deslocamentoExterno = 0,
  aSeguirExterno = false,
  aExternamenteASair = false,
  acao,
  children,
}: Props) {
  const painelRef = useRef<HTMLDivElement>(null)
  // Recebe o foco ao abrir, para a navegação por teclado / leitor de ecrã
  // começar dentro da folha.
  const fecharRef = useRef<HTMLButtonElement>(null)

  // Coordenação com a folha de fundo, quando esta está aninhada num fluxo.
  const contexto = useContext(ContextoFolha)

  // Deslocamento próprio (px) no eixo ativo — o arrasto desta folha.
  const [deslocamento, setDeslocamento] = useState(0)
  const [eixo, setEixo] = useState<Eixo>('y')
  const [aArrastar, setAArrastar] = useState(false)
  // Saída desencadeada por dentro (gesto / botão desta folha).
  const [aSair, setASair] = useState(false)
  // Que callback correr no fim da animação de saída.
  const [intencaoSaida, setIntencaoSaida] = useState<Intencao>('dispensar')

  // Ponto onde o arrasto começou e eixo já "travado" (null = ainda a
  // decidir, só acontece em "direcao='direita'").
  const arrastoInicio = useRef<{ x: number; y: number } | null>(null)
  const arrastoEixo = useRef<Eixo | null>(null)

  const entradaHorizontal = direcao === 'direita'
  // A saída pode vir de dentro (aSair) ou de fora (a folha de fundo, quando
  // a de cima foi largada para lá do limiar). Derivado — sem "efeito" — para
  // as duas folhas começarem a sair no MESMO fotograma.
  const aSairAgora = aSair || aExternamenteASair

  // Ao abrir, o foco vai para o botão de fechar.
  useEffect(() => {
    fecharRef.current?.focus()
  }, [])

  // Inicia a animação de saída própria. "recuar" só sai pelo lado se houver
  // para onde recuar (aoRecuar); caso contrário sai por baixo. Fica em
  // "useCallback" para poder ser passado ao conteúdo.
  const sair = useCallback(
    (intencao: Intencao) => {
      if (aSair) return
      const recuaPeloLado = intencao === 'recuar' && aoRecuar !== undefined
      setIntencaoSaida(recuaPeloLado ? 'recuar' : 'dispensar')
      setEixo(recuaPeloLado ? 'x' : 'y')
      setAArrastar(false)
      setASair(true)
    },
    [aSair, aoRecuar],
  )

  const fechar = useCallback(() => sair('recuar'), [sair])

  // Terminada a animação de saída, corre-se o callback certo (que desmonta
  // a folha / navega). O temporizador limpa-se se a folha sair antes.
  useEffect(() => {
    if (!aSairAgora) return
    const id = window.setTimeout(() => {
      if (intencaoSaida === 'recuar' && aoRecuar !== undefined) aoRecuar()
      else aoDispensar()
    }, DURACAO_SAIDA_MS)
    return () => window.clearTimeout(id)
  }, [aSairAgora, intencaoSaida, aoRecuar, aoDispensar])

  function aoClicarFundo(evento: MouseEvent<HTMLDivElement>) {
    // Só quando o alvo é o próprio fundo — um clique dentro do painel
    // borbulha até aqui, mas aí "alvo" é um elemento do painel.
    if (evento.target === evento.currentTarget) sair('recuar')
  }

  // --- Arrasto para descartar ---

  function aoDescerPonteiro(evento: PointerEvent<HTMLDivElement>) {
    if (aSairAgora) return
    // No desktop a folha é um diálogo centrado, sem gesto de arrasto.
    if (window.matchMedia(CONSULTA_DESKTOP).matches) return
    // Não iniciar o arrasto quando se toca num controlo do cabeçalho.
    if ((evento.target as HTMLElement).closest('button, a')) return

    arrastoInicio.current = { x: evento.clientX, y: evento.clientY }
    // "baixo": só há arrasto vertical. "direita": decide-se ao mover.
    arrastoEixo.current = entradaHorizontal ? null : 'y'
    if (arrastoEixo.current) setEixo(arrastoEixo.current)
    setAArrastar(true)
    try {
      evento.currentTarget.setPointerCapture(evento.pointerId)
    } catch {
      // Navegadores / jsdom sem captura de ponteiro — ignora-se.
    }
  }

  function aoMoverPonteiro(evento: PointerEvent<HTMLDivElement>) {
    if (arrastoInicio.current === null) return
    const dx = evento.clientX - arrastoInicio.current.x
    const dy = evento.clientY - arrastoInicio.current.y

    // Ainda a decidir o eixo (só em "direcao='direita'").
    if (arrastoEixo.current === null) {
      if (Math.abs(dx) < LIMIAR_EIXO && Math.abs(dy) < LIMIAR_EIXO) return
      arrastoEixo.current = Math.abs(dy) > Math.abs(dx) ? 'y' : 'x'
      setEixo(arrastoEixo.current)
    }

    const bruto = arrastoEixo.current === 'y' ? dy : dx
    // No sentido da folga segue o dedo; no sentido oposto há resistência.
    const valor = bruto > 0 ? bruto : bruto / 4
    setDeslocamento(valor)
    // Arrasto vertical de uma folha aninhada: a de fundo desce igual.
    if (arrastoEixo.current === 'y') contexto?.espelharDeslocamento(valor)
  }

  function aoLargarPonteiro(evento: PointerEvent<HTMLDivElement>) {
    if (arrastoInicio.current === null) return
    const dx = evento.clientX - arrastoInicio.current.x
    const dy = evento.clientY - arrastoInicio.current.y
    const eixoArrasto = arrastoEixo.current ?? 'y'
    const bruto = eixoArrasto === 'y' ? dy : dx
    arrastoInicio.current = null
    arrastoEixo.current = null
    setAArrastar(false)

    const passouLimiar = bruto > LIMIAR_DESCARTE
    if (eixoArrasto === 'y') {
      // Para baixo: abandona o fluxo. A folha de fundo sai / repõe junto.
      contexto?.concluirArrasto(passouLimiar)
      if (passouLimiar) sair('dispensar')
      else setDeslocamento(0)
    } else if (passouLimiar) {
      // Para o lado: recua um nível.
      sair('recuar')
    } else {
      setDeslocamento(0)
    }
  }

  function aoTeclar(evento: KeyboardEvent<HTMLDivElement>) {
    if (evento.key === 'Escape' || evento.key === 'Tab') {
      evento.stopPropagation()
    }

    if (evento.key === 'Escape') {
      sair('recuar')
      return
    }
    if (evento.key !== 'Tab' || !painelRef.current) return

    // Foco preso: ao passar do último elemento focável volta ao primeiro, e
    // vice-versa.
    const focaveis = painelRef.current.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])',
    )
    if (focaveis.length === 0) return
    const primeiro = focaveis[0]
    const ultimo = focaveis[focaveis.length - 1]

    if (evento.shiftKey && document.activeElement === primeiro) {
      evento.preventDefault()
      ultimo.focus()
    } else if (!evento.shiftKey && document.activeElement === ultimo) {
      evento.preventDefault()
      primeiro.focus()
    }
  }

  // --- Estilo do painel ---
  //
  // Enquanto a folha SAI, o "transform" final vem de uma classe CSS
  // (.saiParaBaixo / .saiParaLado) e a transição do ".painel" anima até lá.
  // Fora da saída, o "transform" é inline: segue o arrasto (próprio ou o
  // espelho da folha de cima) ou está em repouso (0).
  const seguirDedo = aArrastar || aSeguirExterno
  const emSaida = aSairAgora && !aArrastar

  let transformInline: string | undefined
  if (aArrastar) {
    transformInline =
      eixo === 'x' ? `translateX(${deslocamento}px)` : `translateY(${deslocamento}px)`
  } else if (!aSairAgora && (aSeguirExterno || deslocamentoExterno > 0)) {
    // Folha de fundo a espelhar (ou a repor) o arrasto da de cima.
    transformInline = `translateY(${deslocamentoExterno}px)`
  } else if (!aSairAgora) {
    transformInline =
      eixo === 'x' ? `translateX(${deslocamento}px)` : `translateY(${deslocamento}px)`
  }

  const classePainel = [
    estilos.painel,
    entradaHorizontal ? estilos.entraDaDireita : estilos.entraDeBaixo,
    seguirDedo ? estilos.painelAArrastar : '',
    emSaida ? (eixo === 'x' ? estilos.saiParaLado : estilos.saiParaBaixo) : '',
  ]
    .filter(Boolean)
    .join(' ')

  const classeFechar = `${estilos.botaoFechar} ${
    varianteFechar === 'circulo' ? estilos.fecharCirculo : estilos.fecharSimples
  }`

  const conteudo = typeof children === 'function' ? children(fechar) : children
  const acaoConteudo = typeof acao === 'function' ? acao(fechar) : acao

  return createPortal(
    <div
      className={aSairAgora ? `${estilos.fundo} ${estilos.fundoASair}` : estilos.fundo}
      onClick={aoClicarFundo}
    >
      <div
        ref={painelRef}
        className={classePainel}
        style={transformInline ? { transform: transformInline } : undefined}
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        onKeyDown={aoTeclar}
      >
        <div
          className={estilos.cabecalho}
          onPointerDown={aoDescerPonteiro}
          onPointerMove={aoMoverPonteiro}
          onPointerUp={aoLargarPonteiro}
          onPointerCancel={aoLargarPonteiro}
        >
          <span className={estilos.pega} aria-hidden="true" />
          <div className={estilos.barraTitulo}>
            <div className={estilos.zonaLateral}>
              <button
                type="button"
                ref={fecharRef}
                className={classeFechar}
                onClick={() => sair('recuar')}
                aria-label={rotuloFechar}
              >
                {iconeFechar ?? <IconeChevronEsquerda tamanho={24} />}
              </button>
            </div>
            <span className={estilos.titulo}>{titulo}</span>
            <div className={estilos.zonaLateral}>{acaoConteudo}</div>
          </div>
        </div>

        <div className={estilos.corpo}>{conteudo}</div>
      </div>
    </div>,
    document.body,
  )
}
