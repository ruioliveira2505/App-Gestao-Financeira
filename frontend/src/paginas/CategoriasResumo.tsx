/*
 * PÁGINA DE DETALHE DE CATEGORIAS (/resumo/categorias)
 * =====================================================
 *
 * A página que o título "Categorias" (no cartão de categorias de
 * Início.tsx) e a sua seta já prometiam, desde a "NONA FATIA" desse
 * ficheiro — a lista COMPLETA de categorias do período (não só as 4
 * maiores, como no cartão), com uma barra empilhada a mostrar a
 * repartição inteira, e cada linha a abrir uma segunda página com as
 * subcategorias desse grupo (CategoriaResumoDetalhe.tsx).
 *
 * PERÍODO E CONTAS vêm do URL ("de"/"ate"/"contas", como query params),
 * não de estado local nem de contexto — esta página é alcançada por um
 * <Link> a partir de Início.tsx, que já resolveu o período (mês actual
 * por omissão, ou o escolhido em SeletorPeriodo) e a selecção de contas
 * activa nessa altura, e os escreve no URL. Isto tem duas vantagens
 * sobre passar esse estado por "state" de navegação: a página funciona
 * também se aberta directamente por um URL (sem vir de Início), e um
 * "recarregar" (F5) não perde o período. Sem "de"/"ate" no URL (ex.: um
 * marcador guardado sem eles), o backend decide o período por omissão —
 * a mesma regra já usada em obterResumo, aqui e em Início.tsx.
 *
 * O ALTERNADOR "+/−" é uma cópia (não uma importação) do de Início.tsx —
 * mesmo símbolo, mesmo tamanho, mesma cor por direcção; vive aqui na
 * "acao" do cabeçalho (ver CabecalhoPagina.tsx) em vez de dentro do
 * conteúdo, porque esta já É a página "de Categorias", não um cartão
 * dentro de outra página — o alternador faz parte do SEU cabeçalho, tal
 * como "Editar" faz parte do cabeçalho de ContaDetalhe.tsx.
 *
 * SEM "LIMITE_CATEGORIAS": ao contrário do cartão de Início, aqui
 * mostram-se TODAS as categorias da direcção activa — é precisamente a
 * página para quem quer ver mais do que as 4 maiores. Por isso a barra
 * empilhada nunca tem um segmento "outras": a lista já as tem todas.
 *
 * CADA LINHA ABRE `/resumo/categorias/:grupoId` (CategoriaResumoDetalhe.
 * tsx), levando consigo o MESMO "de"/"ate"/"contas" — para a página de
 * subcategorias continuar a respeitar o período e a selecção de contas
 * desta lista.
 *
 * SUBTÍTULO: só o período — "Setembro 2026". Chegou a mostrar também o
 * total da direcção activa ("1202,22 £ · Setembro 2026" — já vinha em
 * "resumo", sem somar a lista de novo), numa correcção anterior que
 * tentou resolver uma inconsistência com CategoriaResumoDetalhe.tsx (um
 * nível abaixo, que só mostrava o valor do grupo). Revertido: esse total
 * já se vê, de forma mais rica, na barra empilhada e na lista logo a
 * seguir — mostrá-lo também aqui em cima era a mesma informação duas
 * vezes, não duas perguntas diferentes (ver caderno/decisoes.md).
 *
 * <PaginaDeslizante>: a mesma transição lateral de ContaDetalhe.tsx —
 * entra a deslizar da direita, sai a deslizar de volta para lá.
 */

import { useEffect, useState } from 'react'

import { Link, useSearchParams } from 'react-router-dom'

import { useAuth } from '../auth/useAuth'
import { CabecalhoPagina } from '../componentes/CabecalhoPagina'
import { IconeChevronDireita, IconeMais, IconeMenos } from '../componentes/icones'
import { LinkVoltar } from '../componentes/LinkVoltar'
import { PaginaDeslizante } from '../componentes/PaginaDeslizante'
import { PontoCategoria } from '../componentes/PontoCategoria'
import { indiceDeCor } from '../lib/corDeterministica'
import { mesDeIntervalo } from '../lib/filtrosMovimentos'
import { formatarIntervalo, rotuloMes } from '../lib/datas'
import { ErroApi } from '../lib/http'
import { formatarDinheiro, formatarSemSinal } from '../lib/moedas'
import { obterResumo, type GrupoResumo, type Resumo } from '../lib/resumo'
import estilos from './CategoriasResumo.module.css'

type Direcao = 'entrada' | 'saida'

/** Esqueleto mostrado enquanto o resumo carrega: a barra empilhada e
 *  várias linhas, a pulsar devagar — o mesmo padrão já usado em
 *  Inicio.tsx e ContaDetalhe.tsx. */
function Esqueleto() {
  return (
    <div role="status" aria-label="A carregar as categorias">
      <span className={`${estilos.esq} ${estilos.esqBarra}`} />
      {[0, 1, 2, 3, 4].map((indice) => (
        <span key={indice} className={`${estilos.esq} ${estilos.esqLinha}`} />
      ))}
    </div>
  )
}

/** A barra empilhada no topo — um segmento por categoria, na MESMA cor
 *  determinística do ponto de PontoCategoria (ver a nota "DÉCIMA
 *  TERCEIRA FATIA" em Inicio.tsx: a mesma ideia da barra do cartão de
 *  categorias, aqui sem segmento "outras" — a lista já mostra todas). */
function BarraEmpilhada({ categorias }: { categorias: GrupoResumo[] }) {
  return (
    // "aria-hidden": puramente decorativa — a mesma proporção já se lê
    // em texto em cada linha da lista, logo abaixo.
    <div className={estilos.barraEmpilhada} aria-hidden="true">
      {categorias.map((grupo) => (
        <span
          key={grupo.grupo_id}
          className={estilos.segmento}
          data-cor={indiceDeCor(grupo.nome)}
          style={{ width: `${grupo.percentagem}%` }}
        />
      ))}
    </div>
  )
}

/** Uma linha da lista: ponto + nome + valor/percentagem + seta — leva a
 *  `/resumo/categorias/:grupoId`, com o mesmo período/contas desta
 *  página. A seta aparece SEMPRE, mesmo para uma categoria com uma só
 *  subcategoria (ver a nota "categorias com uma só subcategoria" em
 *  CategoriaResumoDetalhe.tsx) — mais previsível do que escondê-la só
 *  nalgumas linhas. */
function LinhaCategoria({
  grupo,
  moeda,
  cor,
  parametros,
}: {
  grupo: GrupoResumo
  moeda: string
  cor: Direcao
  parametros: string
}) {
  return (
    <Link to={`/resumo/categorias/${grupo.grupo_id}?${parametros}`} className={estilos.linha}>
      <PontoCategoria nomeGrupo={grupo.nome} tamanho="sm" />
      <span className={estilos.nome}>{grupo.nome}</span>
      <span className={estilos.valores}>
        <span className={estilos.valor}>
          {cor === 'entrada' ? formatarDinheiro(grupo.valor, moeda) : formatarSemSinal(grupo.valor, moeda)}
        </span>
        <span className={estilos.percentagem}>{Math.round(grupo.percentagem)}%</span>
      </span>
      <span className={estilos.seta} aria-hidden="true">
        <IconeChevronDireita tamanho={16} />
      </span>
    </Link>
  )
}

export function CategoriasResumo() {
  const { utilizador } = useAuth()
  const [parametros] = useSearchParams()
  const de = parametros.get('de') ?? undefined
  const ate = parametros.get('ate') ?? undefined
  const contas = parametros.get('contas')?.split(',').filter(Boolean) ?? []

  const [resumo, setResumo] = useState<Resumo | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [direcaoActiva, setDirecaoActiva] = useState<Direcao>('saida')

  useEffect(() => {
    let activo = true
    obterResumo({ contas, de, ate })
      .then((r) => {
        if (activo) setResumo(r)
      })
      .catch((e) => {
        if (activo) {
          setErro(e instanceof ErroApi ? e.message : 'Não foi possível carregar as categorias.')
        }
      })
    return () => {
      activo = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- "contas" é recriado a cada renderização (novo array); "de"/"ate" (texto) já chegam do URL e bastam para detectar uma mudança real.
  }, [de, ate, parametros.get('contas')])

  const moeda = utilizador?.moeda_principal ?? 'EUR'
  const categorias = resumo ? (direcaoActiva === 'entrada' ? resumo.categorias_entradas : resumo.categorias_saidas) : []

  // Subtítulo: só o período ("Setembro 2026") — chegou a mostrar também
  // o total da direcção activa ("1202,22 £ · Setembro 2026"), revertido
  // a pedido explícito: esse total já se vê, de forma mais rica, na
  // barra empilhada e na lista logo a seguir — repeti-lo aqui em cima
  // era a mesma informação duas vezes, não duas perguntas diferentes
  // (ver caderno/decisoes.md).
  const mes = resumo ? mesDeIntervalo(resumo.periodo_inicio, resumo.periodo_fim) : null
  const subtitulo = resumo
    ? (mes ? rotuloMes(mes) : formatarIntervalo(resumo.periodo_inicio, resumo.periodo_fim))
    : undefined

  return (
    <PaginaDeslizante>
      {(aoRecuar) => (
        <div>
          <LinkVoltar para="/">Início</LinkVoltar>

          <CabecalhoPagina
            titulo="Categorias"
            subtitulo={subtitulo}
            voltar="/"
            aoRecuar={aoRecuar}
            acao={
              <div className={estilos.miniToggle} role="group" aria-label="Direcção">
                <button
                  type="button"
                  className={
                    direcaoActiva === 'entrada'
                      ? `${estilos.miniToggleBotao} ${estilos.miniToggleActivo} ${estilos.miniToggleEntrada}`
                      : estilos.miniToggleBotao
                  }
                  aria-pressed={direcaoActiva === 'entrada'}
                  aria-label="Entradas"
                  onClick={() => setDirecaoActiva('entrada')}
                >
                  <IconeMais tamanho={14} traco={2.6} />
                </button>
                <button
                  type="button"
                  className={
                    direcaoActiva === 'saida'
                      ? `${estilos.miniToggleBotao} ${estilos.miniToggleActivo}`
                      : estilos.miniToggleBotao
                  }
                  aria-pressed={direcaoActiva === 'saida'}
                  aria-label="Saídas"
                  onClick={() => setDirecaoActiva('saida')}
                >
                  <IconeMenos tamanho={14} traco={2.6} />
                </button>
              </div>
            }
          />

          {erro ? (
            <p role="alert" className={estilos.nota}>
              {erro}
            </p>
          ) : !resumo ? (
            <Esqueleto />
          ) : categorias.length === 0 ? (
            <p className={estilos.nota}>
              Sem {direcaoActiva === 'entrada' ? 'entradas' : 'saídas'} neste período.
            </p>
          ) : (
            <>
              <BarraEmpilhada categorias={categorias} />
              <div className={estilos.lista}>
                {categorias.map((grupo) => (
                  <LinhaCategoria
                    key={grupo.grupo_id}
                    grupo={grupo}
                    moeda={moeda}
                    cor={direcaoActiva}
                    parametros={parametros.toString()}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </PaginaDeslizante>
  )
}
