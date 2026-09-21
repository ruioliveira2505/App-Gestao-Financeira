/*
 * PÁGINA DE DETALHE DE UM GRUPO — SUBCATEGORIAS (/resumo/categorias/:grupoId)
 * =============================================================================
 *
 * Um nível abaixo de CategoriasResumo.tsx: a repartição por SUBCATEGORIA
 * de um único grupo (GET /resumo/categorias/{grupo_id}, via
 * obterDetalheGrupo em src/lib/resumo.ts — a função e o endpoint já
 * existiam, construídos e testados numa fatia anterior de Inicio.tsx, só
 * desligados dessa página; ligam-se aqui de novo).
 *
 * NAVEGAÇÃO: uma PÁGINA nova (não um acordeão a abrir dentro da linha da
 * lista anterior) — mais previsível: o mesmo gesto sempre, em vez de
 * linhas a crescer/encolher consoante quantos grupos estão abertos. O
 * mockup que levou a esta decisão comparou as duas abordagens (ver
 * caderno/decisoes.md).
 *
 * SEM ALTERNADOR "+/−": ao contrário de CategoriasResumo.tsx, aqui já não
 * faz sentido — está-se dentro de UM grupo de UMA direcção; trocar de
 * direcção obrigaria a saltar para um grupo completamente diferente. O
 * cabeçalho mostra, em vez disso, só o PERÍODO como subtítulo — "Setembro
 * 2026" (ver a nota "SUBTÍTULO", mais abaixo; NÃO o valor do grupo, que
 * já se viu na lista anterior).
 *
 * COR DAS SUBCATEGORIAS: A MESMA cor do grupo-pai, só com TONS
 * diferentes — não uma cor nova por subcategoria. Uma primeira versão
 * desta página dava a cada subcategoria uma cor hasheada a partir do seu
 * PRÓPRIO nome (`indiceDeCor(sub.nome)`), independente da cor do grupo;
 * na prática, isso produzia dois problemas: subcategorias do mesmo grupo
 * podiam sair em cores sem nada a ver umas com as outras (nem com o
 * ponto da categoria, na lista anterior), e, com só 6 cores possíveis,
 * duas ou três delas colidiam com frequência incómoda (chegou a
 * acontecer as três subcategorias de "Alimentação" saírem exactamente
 * iguais). Corrigido: a cor vem sempre de `indiceDeCor(detalhe.nome)` —
 * o nome do GRUPO, a mesma cor que já se via no ponto desta categoria em
 * CategoriasResumo.tsx — e cada subcategoria usa um TOM diferente dessa
 * MESMA cor (ver a função `tom`, mais abaixo: "solido" para a maior,
 * "fg" para a seguinte, repetindo se houver mais do que duas — ver a
 * nota junto de `tom` para o porquê de só dois tons, não três).
 * Continuidade visual com o ecrã anterior, e as subcategorias continuam
 * distinguíveis entre si — sem inventar cores novas nem correr o risco
 * de escolher uma sem relação nenhuma com o grupo a que pertencem.
 *
 * DOIS CASOS DE "UMA SÓ LINHA", TRATADOS DE FORMA DIFERENTE — um
 * movimento categorizado directamente no grupo, sem escolher
 * subcategoria, entra como a sua própria linha, com "nome" igual ao do
 * PRÓPRIO grupo (ver a nota em SubcategoriaResumo, em src/lib/resumo.ts)
 * — é como se distingue dos dois casos abaixo, ambos com uma só linha na
 * resposta:
 *   - Essa única linha É o próprio grupo (nenhum movimento foi alguma
 *     vez posto numa subcategoria real): mostra-se na mesma (a mesma
 *     razão da nota abaixo), com o nome trocado para "Sem subcategoria"
 *     (em vez de repetir o nome do grupo, que já está no título) — e uma
 *     nota, "Esta categoria não tem subcategorias." — mais precisa do
 *     que dizer que "não se divide mais" (que sugeria um limite
 *     estrutural, quando é só ausência de classificação).
 *   - Essa única linha é uma subcategoria REAL, com nome diferente do
 *     grupo (ex.: "Farmácia", dentro de "Saúde e Autocuidado"): SEM
 *     nota nenhuma — chegar aqui já ensinou algo (qual É essa única
 *     subcategoria), ao contrário do caso anterior.
 * A seta que leva a esta página, em CategoriasResumo.tsx, continua
 * SEMPRE presente nos dois casos — esconder-se só nalguns deles foi
 * tentado e revertido, por ficar inconsistente entre linhas, sem sinal
 * claro do porquê (ver caderno/decisoes.md).
 *
 * "de"/"ate"/"contas" vêm do URL (ver a mesma nota em
 * CategoriasResumo.tsx) — chegam aqui através do <Link> de cada linha
 * dessa página, para esta continuar a respeitar o mesmo período/contas.
 * "de"/"ate" servem também para o subtítulo (ver "SUBTÍTULO", abaixo) —
 * sem eles no URL (uma ligação directa sem vir da lista), o subtítulo
 * fica vazio, em vez de inventar um período que pode não corresponder ao
 * que o backend escolheu por omissão.
 *
 * "voltar" ("querystringAtual"/"voltarPara", mais abaixo) LEVA CONSIGO O
 * MESMO QUERYSTRING desta página, não um "/resumo/categorias" às cegas —
 * corrige um bug encontrado em uso real: o "‹ Categorias" (LinkVoltar,
 * só visível em ecrã largo) navegava para "/resumo/categorias" sem
 * parâmetro nenhum; a categoria seguinte aberta a partir dessa lista já
 * herdava um link sem período, e o subtítulo desaparecia — só a partir
 * da SEGUNDA visita, o que tornava o bug confuso de apanhar (o "‹" da
 * barra de topo mobile nunca tinha este problema: usa "navigate(-1)",
 * que preserva o URL anterior tal como ele estava).
 *
 * SUBTÍTULO: só o período — "Setembro 2026". Chegou a mostrar também o
 * valor do grupo ("698,82 £ · Setembro 2026"), revertido: esse valor já
 * tinha sido visto, um ecrã antes, na própria linha da lista que levou
 * aqui ("Habitação · 698,82 £ · 58%", em CategoriasResumo.tsx) —
 * repeti-lo não respondia a nenhuma pergunta nova, só repetia o que já
 * se sabia. A mesma lição aplicada, também, ao subtítulo dessa outra
 * página (ver a nota lá, "SUBTÍTULO": o total da direcção activa já se
 * vê, de forma mais rica, na barra empilhada e na lista — mostrá-lo
 * também no cabeçalho era a mesma informação duas vezes).
 *
 * <PaginaDeslizante>: a mesma transição lateral das outras páginas de
 * detalhe da app.
 */

import { useEffect, useState } from 'react'

import { useParams, useSearchParams } from 'react-router-dom'

import { useAuth } from '../auth/useAuth'
import { CabecalhoPagina } from '../componentes/CabecalhoPagina'
import { LinkVoltar } from '../componentes/LinkVoltar'
import { PaginaDeslizante } from '../componentes/PaginaDeslizante'
import { indiceDeCor } from '../lib/corDeterministica'
import { formatarIntervalo, rotuloMes } from '../lib/datas'
import { mesDeIntervalo } from '../lib/filtrosMovimentos'
import { ErroApi } from '../lib/http'
import { formatarDinheiro, formatarSemSinal } from '../lib/moedas'
import { obterDetalheGrupo, type GrupoDetalhe, type SubcategoriaResumo } from '../lib/resumo'
import estilos from './CategoriaResumoDetalhe.module.css'

/** Esqueleto mostrado enquanto o grupo carrega. */
function Esqueleto() {
  return (
    <div role="status" aria-label="A carregar a categoria">
      <span className={`${estilos.esq} ${estilos.esqBarra}`} />
      {[0, 1, 2].map((indice) => (
        <span key={indice} className={`${estilos.esq} ${estilos.esqLinha}`} />
      ))}
    </div>
  )
}

/** Formata um valor de grupo/subcategoria, retirando o sinal quando
 *  negativo (uma saída) — o mesmo padrão de formatarSemSinal (ver
 *  src/lib/moedas.ts), aqui decidido pelo PRÓPRIO sinal do valor (esta
 *  página não recebe a direcção em separado — GrupoDetalhe/
 *  SubcategoriaResumo não a repetem, o sinal do valor já a diz). */
function formatarValor(valor: string, moeda: string): string {
  return Number(valor) < 0 ? formatarSemSinal(valor, moeda) : formatarDinheiro(valor, moeda)
}

/** "tom(indice)" — DOIS tons por hue (não três), um por posição na lista
 *  (já vem ordenada por valor decrescente do backend): "solido" para a
 *  maior subcategoria (a mesma intensidade já usada para o grupo, na
 *  barra de CategoriasResumo.tsx — continuidade visual com o ecrã
 *  anterior), "fg" para a seguinte (mais escuro, ainda bem visível). Com
 *  mais de duas subcategorias o padrão repete-se (a terceira volta a
 *  "solido"). CHEGOU A TER um terceiro tom, "bg" — revertido numa
 *  revisão de fatia: "bg" é a versão mais clara da paleta, pensada para
 *  ter TEXTO por cima (ver a nota em src/index.css) — usada aqui sozinha,
 *  como preenchimento sólido sem nada por baixo a dar-lhe contraste,
 *  ficava com um contraste medido de ~1.0-1.2:1 contra o fundo — quase
 *  invisível, precisamente para a subcategoria mais pequena, que já era
 *  a mais fácil de perder de vista. */
function tom(indice: number): 'solido' | 'fg' {
  return (['solido', 'fg'] as const)[indice % 2]
}

function BarraEmpilhada({ corGrupo, subcategorias }: { corGrupo: number; subcategorias: SubcategoriaResumo[] }) {
  return (
    // "aria-hidden": puramente decorativa — a mesma proporção já se lê
    // em texto em cada linha da lista, logo abaixo.
    <div className={estilos.barraEmpilhada} aria-hidden="true">
      {subcategorias.map((sub, indice) => (
        <span
          key={sub.subcategoria_id}
          className={estilos.segmento}
          data-cor={corGrupo}
          data-tom={tom(indice)}
          style={{ width: `${sub.percentagem}%` }}
        />
      ))}
    </div>
  )
}

/** "semSubcategoria" (`sub.nome === nomeDoGrupo`) é o movimento
 *  categorizado directamente no grupo, sem escolher subcategoria — ver a
 *  nota "DOIS CASOS DE 'UMA SÓ LINHA'" no topo do ficheiro. Mostra-se
 *  como "Sem subcategoria" em vez de repetir o nome do grupo (que já
 *  está no título da página).
 *
 *  A COR de cada subcategoria é a MESMA do grupo-pai ("corGrupo",
 *  `indiceDeCor(detalhe.nome)` — a mesma cor que já se via no ponto
 *  desta categoria, na lista anterior), só com um TOM diferente por
 *  subcategoria (ver "tom", acima) — não uma cor nova, hasheada a
 *  partir do nome da própria subcategoria (a primeira versão desta
 *  página fazia isso; "Alimentação" > "Supermercado"/"Restaurantes"/
 *  "Café" podiam sair em três cores sem nada a ver umas com as outras,
 *  ou até coincidir por acaso — ver caderno/decisoes.md). O ponto não
 *  usa o componente partilhado `<PontoCategoria>` porque este ficheiro
 *  precisa de escolher o TOM por posição, não só a cor por nome. */
function LinhaSubcategoria({
  sub,
  moeda,
  corGrupo,
  indice,
  semSubcategoria,
}: {
  sub: SubcategoriaResumo
  moeda: string
  corGrupo: number
  indice: number
  semSubcategoria: boolean
}) {
  return (
    <div className={estilos.linha}>
      <span className={estilos.ponto} data-cor={corGrupo} data-tom={tom(indice)} aria-hidden="true" />
      <span className={estilos.nome}>{semSubcategoria ? 'Sem subcategoria' : sub.nome}</span>
      <span className={estilos.valores}>
        <span className={estilos.valor}>{formatarValor(sub.valor, moeda)}</span>
        <span className={estilos.percentagem}>{Math.round(sub.percentagem)}%</span>
      </span>
    </div>
  )
}

export function CategoriaResumoDetalhe() {
  const { grupoId } = useParams<{ grupoId: string }>()
  const { utilizador } = useAuth()
  const [parametros] = useSearchParams()
  const de = parametros.get('de') ?? undefined
  const ate = parametros.get('ate') ?? undefined
  const contas = parametros.get('contas')?.split(',').filter(Boolean) ?? []

  const [detalhe, setDetalhe] = useState<GrupoDetalhe | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  // Os valores de GrupoDetalhe/SubcategoriaResumo chegam como texto, já
  // convertidos para a moeda principal (a mesma convenção de
  // GrupoResumo, em obterResumo) — falta só o CÓDIGO da moeda para os
  // formatar (formatarDinheiro precisa dele para saber o símbolo). "??
  // 'EUR'" só entra em jogo enquanto "utilizador" ainda é null — o mesmo
  // alçapão de Inicio.tsx, para um teste que monte esta página sozinha.
  const moeda = utilizador?.moeda_principal ?? 'EUR'

  useEffect(() => {
    if (!grupoId) return
    let activo = true
    obterDetalheGrupo(grupoId, { contas, de, ate })
      .then((d) => {
        if (activo) setDetalhe(d)
      })
      .catch((e) => {
        if (activo) {
          setErro(e instanceof ErroApi ? e.message : 'Não foi possível carregar esta categoria.')
        }
      })
    return () => {
      activo = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- "contas" é recriado a cada renderização; "grupoId"/"de"/"ate" (texto) já bastam para detectar uma mudança real.
  }, [grupoId, de, ate, parametros.get('contas')])

  // Subtítulo: só o período ("Setembro 2026") — chegou a mostrar também
  // o valor do grupo ("698,82 £ · Setembro 2026"), revertido a pedido
  // explícito: esse valor já tinha sido visto, um ecrã antes, na própria
  // linha da lista que levou aqui ("Habitação · 698,82 £ · 58%") —
  // repeti-lo já não era responder a uma pergunta nova, só repetir o que
  // já se sabia (ver caderno/decisoes.md). Sem "de"/"ate" no URL (uma
  // ligação directa, sem vir de CategoriasResumo.tsx), o período fica de
  // fora do subtítulo, em vez de inventado.
  const mes = de && ate ? mesDeIntervalo(de, ate) : null
  const subtitulo = de && ate ? (mes ? rotuloMes(mes) : formatarIntervalo(de, ate)) : undefined

  // Ver a nota "DOIS CASOS DE 'UMA SÓ LINHA'" no topo do ficheiro: só há
  // nota (e só há "Sem subcategoria" em vez do nome) quando a ÚNICA
  // linha é o próprio grupo — uma subcategoria real a sós fica sem nota
  // nenhuma.
  const semSubcategoriaAlguma =
    detalhe !== null &&
    detalhe.subcategorias.length === 1 &&
    detalhe.subcategorias[0].nome === detalhe.nome

  // A cor do GRUPO (ver a nota "A COR de cada subcategoria", em
  // LinhaSubcategoria, acima) — a mesma que o ponto desta categoria já
  // mostrava na lista anterior (CategoriasResumo.tsx). "0" enquanto
  // "detalhe" ainda não chegou nunca é usado a sério (nada se desenha
  // antes de "detalhe" existir — ver o "!detalhe ? <Esqueleto /> " mais
  // abaixo).
  const corGrupo = detalhe ? indiceDeCor(detalhe.nome) : 0

  // "voltar" tem de levar consigo o MESMO "de"/"ate"/"contas" com que
  // esta página foi aberta — não só "/resumo/categorias", às cegas.
  // Bug encontrado em uso real: o "‹ Categorias" (LinkVoltar, só visível
  // em ecrã largo — o "‹" da barra de topo mobile usa antes
  // "navigate(-1)", que já preserva o URL anterior tal como estava, sem
  // este problema) levava para "/resumo/categorias" SEM parâmetros; a
  // partir daí, qualquer categoria aberta de novo herdava um link já
  // sem período — o subtítulo desaparecia, silenciosamente, a partir da
  // SEGUNDA visita. Reconstruir o querystring aqui, a partir do que esta
  // própria página já recebeu, corta o ciclo.
  const querystringAtual = parametros.toString()
  const voltarPara = querystringAtual ? `/resumo/categorias?${querystringAtual}` : '/resumo/categorias'

  return (
    <PaginaDeslizante>
      {(aoRecuar) => (
        <div>
          <LinkVoltar para={voltarPara}>Categorias</LinkVoltar>

          <CabecalhoPagina
            titulo={detalhe?.nome ?? ''}
            subtitulo={subtitulo}
            voltar={voltarPara}
            aoRecuar={aoRecuar}
          />

          {erro ? (
            <p role="alert" className={estilos.nota}>
              {erro}
            </p>
          ) : !detalhe ? (
            <Esqueleto />
          ) : detalhe.subcategorias.length === 0 ? (
            // Chegar aqui é raro (só através de um link/marcador antigo
            // para um período em que este grupo, entretanto, deixou de
            // ter movimentos) — mas é uma resposta válida da API (ver
            // GrupoDetalheOut, em resumo.py), não um erro. Sem esta
            // mensagem, a página mostrava uma barra e uma lista vazias,
            // sem explicação — ao contrário de CategoriasResumo.tsx, que
            // já tem o estado equivalente ("Sem saídas neste período.").
            <p className={estilos.nota}>Sem movimentos desta categoria neste período.</p>
          ) : (
            <>
              <BarraEmpilhada corGrupo={corGrupo} subcategorias={detalhe.subcategorias} />
              <div className={estilos.lista}>
                {detalhe.subcategorias.map((sub, indice) => (
                  <LinhaSubcategoria
                    key={sub.subcategoria_id}
                    sub={sub}
                    moeda={moeda}
                    corGrupo={corGrupo}
                    indice={indice}
                    semSubcategoria={sub.nome === detalhe.nome}
                  />
                ))}
              </div>
              {semSubcategoriaAlguma && (
                <p className={estilos.notaUnica}>Esta categoria não tem subcategorias.</p>
              )}
            </>
          )}
        </div>
      )}
    </PaginaDeslizante>
  )
}
