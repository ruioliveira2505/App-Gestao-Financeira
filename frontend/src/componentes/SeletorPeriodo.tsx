/*
 * SeletorPeriodo — O FILTRO DE PERÍODO DA PÁGINA INÍCIO
 * =========================================================
 *
 * A MESMA lógica de ListaDatas (dentro de FiltroMovimentos.tsx): um
 * mostrador com o intervalo actual, e uma lista de duas linhas — "Mês
 * específico" e "Data personalizada" — cada uma a revelar o seu próprio
 * campo (ou par de campos) ao ser tocada; escolher aplica AO VIVO (chama
 * "aoMudar" a cada alteração), sem fechar o seletor sozinho — fecha-se
 * pelo cabeçalho, tal como qualquer outra folha desta app.
 *
 * A ÚNICA DIFERENÇA: aqui não há "Todo o período" nem atalhos de janela
 * móvel (7/30/90 dias) — esta página é sempre um RESUMO de algum
 * período concreto (nunca "sem limite"), por isso essas opções não
 * fariam sentido. E começa sempre em "Mês específico", com o mês em
 * vista já preenchido (nunca em branco) — ver "mesEmVista", abaixo.
 *
 * Ao contrário de FiltroContas (um botão-ícone na barra de topo — é
 * GLOBAL, afecta o Saldo Total, ver a nota "GATILHO NA BARRA DE TOPO" em
 * FiltroContas.tsx), este filtro nunca afecta o Saldo Total (ver a nota
 * "FILTRO DE PERÍODO" em app/routers/resumo.py) — só o fluxo do mês
 * (Entradas/Saídas/Líquido, a repartição por categoria). Por isso vive
 * numa linha própria, CENTRADA, entre o Saldo Total e o resumo de
 * Entradas/Saídas/Líquido em Inicio.tsx — a posição já diz o âmbito
 * (afecta tudo o que vem a seguir a ele, não o que vem antes).
 *
 * Duas versões anteriores desta posição: primeiro embutido no rótulo do
 * mês, dentro do que era o "cabecalhoFluxo" (ao lado do "Líquido X", que
 * entretanto se mudou para o resumo — ver a nota "OITAVA FATIA" em
 * Inicio.tsx); depois, uma tentativa de lhe dar destaque numa linha
 * própria foi revertida por não ser ainda o que tinha sido pedido (ver
 * caderno/decisoes.md) — só mais tarde é que a posição actual, centrada,
 * foi pedida a sério.
 *
 * ALVO DE TOQUE (revisão de design/UX): o gatilho é maiúsculas,
 * `--texto-sm` — visualmente pequeno de propósito, por ser um título de
 * secção antes de mais nada. `.gatilho` ganha padding em todos os lados
 * (ver CSS) para alargar a área tocável para perto dos ~2.5rem (40px)
 * usados em todos os outros botões-ícone da app. Chegou a ganhar também
 * um fundo e um contorno próprios ("chip") — revertido logo a seguir, a
 * pedido explícito (ver caderno/decisoes.md): o alvo de toque manteve-
 * se, só o aspecto voltou a ser só texto.
 *
 * A lista de opções ("Mês específico"/"Data personalizada") usa
 * `LinhaOpcaoFiltro`, partilhada com FiltroMovimentos/FiltroContas/
 * FiltroCategoriasResumo.
 */

import { useState } from 'react'

import { CampoTexto } from './CampoTexto'
import { Folha } from './Folha'
import { IconeChevronDireita, IconeFechar } from './icones'
import { LinhaOpcaoFiltro as LinhaOpcao } from './LinhaOpcaoFiltro'
import { formatarIntervalo, rotuloMes } from '../lib/datas'
import { intervaloDoMes } from '../lib/filtrosMovimentos'
import estilos from './SeletorPeriodo.module.css'

type Escolha = 'mes' | 'personalizado'

type Props = {
  de: string
  ate: string
  // "AAAA-MM-DD" de hoje — limite superior dos campos, para não se
  // poder escolher um período no futuro.
  hojeIso: string
  aoMudar: (de: string, ate: string) => void
}

/**
 * Se [de, ate] é um mês em vista — começa no dia 1 e "ate" cai dentro do
 * MESMO mês — devolve esse mês ("AAAA-MM"); senão, null. Mais permissiva
 * do que mesDeIntervalo (src/lib/filtrosMovimentos.ts, que exige "ate"
 * no ÚLTIMO dia do mês): aqui isso excluiria sempre o mês EM CURSO (que
 * só vai até hoje, nunca até ao seu último dia — ver a nota PERÍODO em
 * app/routers/resumo.py), e é exactamente esse o caso mais comum de
 * abrir este seletor.
 */
function mesEmVista(de: string, ate: string): string | null {
  if (!de.endsWith('-01')) return null
  return de.slice(0, 7) === ate.slice(0, 7) ? de.slice(0, 7) : null
}

export function SeletorPeriodo({ de, ate, hojeIso, aoMudar }: Props) {
  const [aberto, setAberto] = useState(false)
  const mes = mesEmVista(de, ate)
  const rotulo = mes ? rotuloMes(mes) : formatarIntervalo(de, ate)

  return (
    <>
      <button
        type="button"
        className={estilos.gatilho}
        aria-haspopup="dialog"
        onClick={() => setAberto(true)}
      >
        {rotulo}
        <IconeChevronDireita tamanho={14} />
      </button>

      {aberto && (
        <Folha
          titulo="Período"
          direcao="baixo"
          varianteFechar="circulo"
          iconeFechar={<IconeFechar tamanho={22} />}
          rotuloFechar="Fechar"
          aoDispensar={() => setAberto(false)}
        >
          {() => <ConteudoPeriodo de={de} ate={ate} mesInicial={mes} hojeIso={hojeIso} aoMudar={aoMudar} />}
        </Folha>
      )}
    </>
  )
}

/**
 * O conteúdo da folha em si — componente à parte para o seu estado
 * "escolha" (qual das duas linhas está activa) só arrancar quando a
 * folha abre, sempre em "mes" (ver a nota "A ÚNICA DIFERENÇA" no topo do
 * ficheiro).
 */
function ConteudoPeriodo({
  de,
  ate,
  mesInicial,
  hojeIso,
  aoMudar,
}: {
  de: string
  ate: string
  mesInicial: string | null
  hojeIso: string
  aoMudar: (de: string, ate: string) => void
}) {
  const [escolha, setEscolha] = useState<Escolha>('mes')

  function escolherMes(mesIso: string) {
    const intervalo = intervaloDoMes(mesIso)
    aoMudar(intervalo.de, intervalo.ate)
  }

  return (
    <div className={estilos.conteudo}>
      <p className={estilos.intervalo}>{formatarIntervalo(de, ate)}</p>

      <div className={estilos.lista}>
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
            max={hojeIso.slice(0, 7)}
            valor={mesInicial ?? ''}
            aoMudar={(valor) => {
              if (valor) escolherMes(valor)
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
            max={ate || hojeIso}
            valor={de}
            aoMudar={(valor) => {
              if (valor) aoMudar(valor, ate)
            }}
          />
          <CampoTexto
            disposicao="linha"
            etiqueta="Até"
            tipo="date"
            max={hojeIso}
            valor={ate}
            aoMudar={(valor) => {
              if (valor) aoMudar(de, valor)
            }}
          />
        </div>
      )}
    </div>
  )
}
