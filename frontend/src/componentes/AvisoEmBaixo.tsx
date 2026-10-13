/*
 * AvisoEmBaixo — O AVISO QUE APARECE NO FUNDO DO ECRÃ
 * ===================================================
 *
 * Uma mensagem curta, ao centro, no fundo do ecrã, sobre o resultado de
 * uma ação (em inglês chama-se "toast"): por exemplo, o resultado de
 * "Sincronizar agora". É a mesma peça em Contas e em Ver conta, para o
 * resultado soar e parecer igual em todo o lado.
 *
 * O texto segue sempre a forma «Estado · detalhe» («Atualizado · 3
 * movimentos novos», «Não atualizado · limite do banco»): quem lê
 * reconhece o estado logo no início da frase. Tem um de três TIPOS, com um
 * ícone e uma duração próprios:
 *   - "ok" (✓): correu bem; desaparece ao fim de 4 segundos;
 *   - "alerta" (!): algo falhou; fica 6 segundos, porque se lê com mais
 *     calma;
 *   - "andamento" (uma roda a girar): a ação ainda decorre; fica até quem
 *     o mostrou o substituir pelo resultado, no mesmo sítio.
 *
 * Só há um de cada vez: quem o mostra guarda um só aviso, e um novo
 * substitui o anterior NO MESMO SÍTIO, sem voltar a animar a entrada (o
 * resultado toma o lugar de «A sincronizar…» sem piscar). Para isso, quem
 * o mostra não lhe muda a "key": passa um número ("chave") diferente a
 * cada aviso novo, que só recomeça a contagem do tempo.
 *
 * Tocar nele fecha-o. Não tem botões: o estado fica sempre visível noutro
 * sítio (na conta, na página dela), por isso o aviso pode desaparecer sem
 * se perder nada.
 *
 * Para leitores de ecrã é role="status": é lido sem lhes tirar o foco. A
 * região com role="status" está SEMPRE na página (vazia quando não há
 * aviso): os leitores de ecrã costumam ignorar uma região que aparece já
 * com texto dentro, e só anunciam o que muda numa região que já lá estava.
 * Com "reduzir movimento", a regra global de index.css desliga a animação
 * de entrada.
 */

import { useEffect } from 'react'

import { IconeAlerta, IconeCheck } from './icones'
import estilos from './AvisoEmBaixo.module.css'

export type TipoAviso = 'ok' | 'alerta' | 'andamento'

// Quanto tempo fica cada tipo, em milissegundos (null: até ser substituído).
const DURACAO: Record<TipoAviso, number | null> = {
  ok: 4000,
  alerta: 6000,
  andamento: null,
}

/** Um aviso: o texto, o tipo e uma "chave" diferente a cada aviso novo
 *  (recomeça a contagem do tempo, mesmo que o texto seja igual ao
 *  anterior — ex.: sincronizar duas vezes seguidas). */
export type Aviso = { texto: string; tipo: TipoAviso; chave: number }

export function AvisoEmBaixo({
  aviso,
  aoFechar,
}: {
  // O aviso a mostrar, ou null (a região fica na página, vazia).
  aviso: Aviso | null
  // Chamado quando o aviso deve sair (fim do tempo, ou um toque): quem o
  // mostra põe-no a null.
  aoFechar: () => void
}) {
  const tipo = aviso?.tipo
  const chave = aviso?.chave
  // O temporizador recomeça a cada aviso novo (outro tipo ou chave), e é
  // cancelado se o aviso sair antes.
  useEffect(() => {
    if (!tipo) return
    const duracao = DURACAO[tipo]
    if (duracao === null) return
    const temporizador = window.setTimeout(aoFechar, duracao)
    return () => window.clearTimeout(temporizador)
  }, [tipo, chave, aoFechar])

  return (
    <div role="status">
      {aviso && (
        <div className={estilos.aviso} onClick={aoFechar}>
          {aviso.tipo === 'ok' && <IconeCheck tamanho={16} traco={2.6} />}
          {aviso.tipo === 'alerta' && <IconeAlerta tamanho={16} traco={2.4} />}
          {aviso.tipo === 'andamento' && <span className={estilos.roda} aria-hidden="true" />}
          <span>{aviso.texto}</span>
        </div>
      )}
    </div>
  )
}
