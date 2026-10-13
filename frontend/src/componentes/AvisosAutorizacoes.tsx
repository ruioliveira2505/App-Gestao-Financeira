/*
 * AVISOS DAS AUTORIZAÇÕES — A PÍLULA E O CARROSSEL (página Contas)
 * ================================================================
 *
 * Uma AUTORIZAÇÃO é o consentimento que o utilizador dá ao banco para a
 * aplicação ler as suas contas, durante um prazo. Quando termina, as contas
 * que dela dependem ficam SUSPENSAS (deixam de receber movimentos); por
 * isso a lista de contas avisa das autorizações que já terminaram e das que
 * terminam em 7 dias ou menos, para o utilizador as renovar a tempo. Os
 * avisos calculam-se em src/lib/contas.ts (avisosDasAutorizacoes): um por
 * autorização, as terminadas primeiro.
 *
 * Este ficheiro desenha os avisos em duas peças, que a página Contas põe
 * em sítios diferentes e liga pelo mesmo estado (aberto ou recolhido):
 *
 *   - PilulaAvisos: um botão pequeno, na linha do título "Contas", com um
 *     ícone de alerta e o número de autorizações a verificar. A cor é a do
 *     caso mais grave (vermelho se alguma terminou, âmbar se só há a
 *     terminar). Tocar abre ou recolhe o carrossel. Recolhido, a pílula é o
 *     único sinal que fica: não ocupa uma linha da página, e nada se apaga.
 *
 *   - CarrosselAvisos: por baixo do título, uma fila de cartões, um por
 *     autorização, que desliza na horizontal com "encaixe" (scroll-snap: o
 *     movimento pára sempre com um cartão alinhado à esquerda). O cartão
 *     seguinte espreita na margem, e um indicador de pontos diz em qual se
 *     está. Cada cartão tem o banco, o titular por baixo, uma etiqueta com
 *     o caso ("Terminada" ou "A expirar") e, em baixo, a linha "Renovar →",
 *     que é toda ela o botão.
 *
 * RENOVAR: ainda não existe a página "Renovar autorização" do Perfil (está
 * desenhada). Até lá, "Renovar →" pede uma confirmação curta (porque a
 * aplicação vai SAIR para o site do banco) e segue para o banco; no
 * regresso, a página "Nova conta" mostra a autorização renovada.
 *
 * ANIMAÇÃO: o carrossel está sempre na página (para poder animar a entrada
 * e a saída); recolhido, dobra a altura até zero e fica fora do alcance do
 * teclado e dos leitores de ecrã ("inert"). Com "reduzir movimento" nas
 * definições do sistema, a regra global de index.css desliga as transições.
 *
 * Desenho decidido no canvas de design de Contas («1 · Contas», D7 e D10).
 */

import { useEffect, useRef, useState } from 'react'

import { Confirmacao } from './Confirmacao'
import { IconeAlerta } from './icones'
import type { AvisoAutorizacao } from '../lib/contas'
import { diaCurto } from '../lib/datas'
import { renovarAutorizacao } from '../lib/openBanking'
import estilos from './AvisosAutorizacoes.module.css'

// O espaço entre cartões (em px): tem de bater com ".fila" no .module.css.
// Com a largura de um cartão, dá o passo do carrossel, para saber em que
// cartão se está a partir da posição do scroll.
const ESPACO_ENTRE_CARTOES = 12

/** O texto que um leitor de ecrã ouve na pílula, e o que ela faz. */
function rotuloPilula(numero: number, aberto: boolean): string {
  const quantos = numero === 1 ? '1 autorização a verificar' : `${numero} autorizações a verificar`
  return `${quantos}. ${aberto ? 'Recolher' : 'Mostrar'}`
}

/**
 * A pílula dos avisos, para a linha do título. "idCarrossel" liga-a ao
 * carrossel que controla (aria-controls), para um leitor de ecrã saber o
 * que se abre.
 */
export function PilulaAvisos({
  avisos,
  aberto,
  aoAlternar,
  idCarrossel,
}: {
  avisos: AvisoAutorizacao[]
  aberto: boolean
  aoAlternar: () => void
  idCarrossel: string
}) {
  const urgente = avisos.some((aviso) => aviso.caso === 'terminada')
  // A partir de dez, "9+": um número maior não cabe na pílula e não diz
  // mais nada de útil (há muito a renovar, de qualquer forma).
  const numero = avisos.length > 9 ? '9+' : String(avisos.length)
  return (
    <button
      type="button"
      className={[
        estilos.pilula,
        urgente ? estilos.pilulaUrgente : estilos.pilulaAviso,
        aberto && estilos.pilulaAberta,
      ]
        .filter(Boolean)
        .join(' ')}
      aria-expanded={aberto}
      aria-controls={idCarrossel}
      aria-label={rotuloPilula(avisos.length, aberto)}
      onClick={aoAlternar}
    >
      <IconeAlerta tamanho={18} traco={2.2} />
      <span>{numero}</span>
    </button>
  )
}

/** O carrossel dos avisos: um cartão por autorização. */
export function CarrosselAvisos({
  avisos,
  aberto,
  id,
}: {
  avisos: AvisoAutorizacao[]
  aberto: boolean
  id: string
}) {
  // O cartão em que se está (o mais à esquerda), para o indicador.
  const [ativo, setAtivo] = useState(0)
  // A autorização cuja renovação se está a confirmar (null: nenhuma).
  const [aRenovar, setARenovar] = useState<AvisoAutorizacao | null>(null)
  // Verdadeiro depois de confirmar: a aplicação está a sair para o banco, e
  // o botão não deve aceitar um segundo toque (um segundo pedido).
  const [aSair, setASair] = useState(false)
  // Se os cartões não cabem todos à vista (há para onde deslizar). Num ecrã
  // largo, com poucos cartões, cabem todos: aí não se mostram os pontos,
  // que dariam a entender que há mais. Por omissão, sim.
  const [transborda, setTransborda] = useState(true)
  const filaRef = useRef<HTMLDivElement>(null)

  // Mede se a fila transborda, e volta a medir quando muda de tamanho
  // (rodar o telemóvel, redimensionar a janela). O ResizeObserver chama a
  // função logo ao começar a observar, e depois a cada mudança. Os
  // ambientes sem ele (os testes) ficam com o valor por omissão.
  useEffect(() => {
    const fila = filaRef.current
    if (!fila || typeof ResizeObserver === 'undefined') return
    const observador = new ResizeObserver(() => setTransborda(fila.scrollWidth > fila.clientWidth + 1))
    observador.observe(fila)
    return () => observador.disconnect()
  }, [avisos.length])

  function aoDeslizar() {
    const fila = filaRef.current
    if (!fila) return
    // O passo mede-se no próprio cartão: num ecrã estreito, o cartão encolhe.
    const cartao = fila.firstElementChild as HTMLElement | null
    const passo = (cartao?.offsetWidth ?? 300) + ESPACO_ENTRE_CARTOES
    const indice = Math.round(fila.scrollLeft / passo)
    if (indice !== ativo) setAtivo(indice)
  }

  // Se a lista encolher (por exemplo, depois de renovar uma), o cartão
  // ativo nunca passa do último.
  const ativoVisivel = Math.min(ativo, avisos.length - 1)

  return (
    <>
      <div
        id={id}
        className={aberto ? `${estilos.envolvente} ${estilos.envolventeAberto}` : estilos.envolvente}
        // Recolhido: fora do teclado e dos leitores de ecrã, de uma vez.
        inert={!aberto}
      >
        <div className={estilos.interior}>
          <div
            ref={filaRef}
            className={estilos.fila}
            role="list"
            aria-label="Autorizações a verificar"
            onScroll={aoDeslizar}
          >
            {avisos.map((aviso, indice) => (
              <div
                key={aviso.autorizacao_id}
                role="listitem"
                className={[
                  estilos.cartao,
                  aviso.caso === 'terminada' ? estilos.cartaoUrgente : estilos.cartaoAviso,
                ].join(' ')}
                // Ao abrir, cada cartão entra um pouco depois do anterior.
                style={{ transitionDelay: aberto ? `${120 + indice * 70}ms` : '0ms' }}
              >
                <div className={estilos.cartaoTopo}>
                  <span className={estilos.cartaoTextos}>
                    <span className={estilos.cartaoBanco}>{aviso.banco}</span>
                    {aviso.titular && <span className={estilos.cartaoTitular}>{aviso.titular}</span>}
                  </span>
                  <span
                    className={
                      aviso.caso === 'terminada'
                        ? `${estilos.etiqueta} ${estilos.etiquetaUrgente}`
                        : `${estilos.etiqueta} ${estilos.etiquetaAviso}`
                    }
                  >
                    {aviso.caso === 'terminada' ? 'Terminada' : 'A expirar'}
                  </span>
                </div>
                <button
                  type="button"
                  className={estilos.renovar}
                  // O nome completo, com a data que o cartão não escreve:
                  // «Revolut, Rui Oliveira, terminou a 2 set. Renovar».
                  aria-label={`${aviso.banco}${aviso.titular ? `, ${aviso.titular}` : ''}, ${
                    aviso.caso === 'terminada' ? 'terminou' : 'expira'
                  } a ${diaCurto(aviso.data)}. Renovar`}
                  onClick={() => setARenovar(aviso)}
                >
                  <span>Renovar</span>
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M5 12h14M13 6l6 6-6 6" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
          {/* Indicador de página: só com mais do que um cartão (com um só,
              não há para onde deslizar). Decorativo: a lista já diz quantos
              são a quem usa um leitor de ecrã. */}
          {avisos.length > 1 && transborda && (
            <div className={estilos.pontos} aria-hidden="true">
              {avisos.map((aviso, indice) => (
                <span
                  key={aviso.autorizacao_id}
                  className={indice === ativoVisivel ? `${estilos.ponto} ${estilos.pontoAtivo}` : estilos.ponto}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {aRenovar && (
        <Confirmacao
          titulo="Renovar autorização"
          textoConfirmar={`Continuar para ${aRenovar.banco}`}
          // Não é destrutivo: o botão não fica a vermelho.
          neutra
          aConfirmar={aSair}
          aoConfirmar={() => {
            setASair(true)
            renovarAutorizacao(aRenovar.autorizacao_id)
          }}
          aoCancelar={() => setARenovar(null)}
        >
          Vais sair da aplicação para te autenticares em {aRenovar.banco}. No fim, voltas aqui e as
          contas voltam a sincronizar.
        </Confirmacao>
      )}
    </>
  )
}
