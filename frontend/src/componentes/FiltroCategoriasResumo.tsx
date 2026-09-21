/*
 * FiltroCategoriasResumo — O FILTRO DE CATEGORIA/SUBCATEGORIA DA PÁGINA
 * INÍCIO
 * ==========================================================================
 *
 * Um botão (ícone de funil) — pensado para viver junto do alternador
 * "+/−" do cartão de categorias de Inicio.tsx, embora esteja, por agora,
 * DESLIGADO dessa página (ver a nota "SÉTIMA FATIA" em Inicio.tsx) — que
 * abre uma folha com a árvore de categorias em multi-escolha — "Todas" +
 * um cabeçalho por grupo (tocável, marca/desmarca o grupo inteiro de uma
 * vez) + uma linha por subcategoria — a MESMA interacção de
 * ListaCategorias, dentro de FiltroMovimentos.tsx.
 *
 * SÓ MOSTRA A DIRECÇÃO ACTIVA (a prop "direcao", que viria do estado de
 * direcção de Inicio.tsx, hoje escolhido pelo alternador "+/−", não por
 * um controlo segmentado — esse saiu numa fatia anterior) — ao contrário
 * de Movimentos, que mostra sempre as duas. Como GET /resumo devolve as
 * duas listas (categorias_entradas/categorias_saidas) na MESMA resposta,
 * mostrar só uma implica GUARDAR as duas selecções em separado (ver a
 * nota "SÉTIMA FATIA" em Inicio.tsx) — se fosse uma selecção só, filtrar
 * dentro de Saídas deixaria Entradas com ZERO categorias (nenhum id de
 * entrada estaria na lista de inclusão). Por isso este componente só
 * conhece a selecção da SUA direcção — Inicio.tsx é que decidiria qual
 * das duas passar, consoante a direcção activa, se este filtro voltar a
 * ser ligado.
 *
 * O ID DO PRÓPRIO GRUPO entra na selecção quando o cabeçalho é tocado
 * (não só as subcategorias) — para um movimento categorizado
 * directamente no grupo (sem escolher subcategoria; ver a nota
 * "REPARTIÇÃO POR GRUPO" em app/routers/resumo.py) não ficar de fora só
 * porque o filtro só continha ids de subcategoria.
 *
 * O GATILHO segue a receita de botão-ícone já usada no resto da app
 * (Contas, ContaDetalhe, BarraTopoMobile: círculo 2.5rem, fundo
 * "--cor-fundo", "box-shadow: var(--sombra-flutuante)", activo em
 * "--cor-superficie") — revisto numa passagem de design/UX; antes era um
 * quadrado ("--raio-md") de 2.25rem com fundo "--cor-superficie", uma
 * receita só sua, sem correspondência no resto da app. A lista de
 * opções usa LinhaOpcaoFiltro, partilhada com FiltroMovimentos/
 * FiltroContas/SeletorPeriodo.
 */

import { Fragment, useState } from 'react'

import { Folha } from './Folha'
import { IconeFechar, IconeFunil } from './icones'
import { LinhaOpcaoFiltro as LinhaOpcao } from './LinhaOpcaoFiltro'
import { PontoCategoria } from './PontoCategoria'
import type { Direcao, GrupoArvore } from '../lib/categorias'
import estilos from './FiltroCategoriasResumo.module.css'

type Props = {
  arvore: GrupoArvore[]
  direcao: Direcao
  seleccionadas: string[]
  aoMudar: (ids: string[]) => void
}

function idsDoGrupo(grupo: GrupoArvore): string[] {
  return [grupo.id, ...grupo.subcategorias.map((sub) => sub.id)]
}

export function FiltroCategoriasResumo({ arvore, direcao, seleccionadas, aoMudar }: Props) {
  const [aberto, setAberto] = useState(false)
  const grupos = arvore.filter((grupo) => grupo.direcao === direcao)

  // Sem nenhum grupo desta direcção (não deveria acontecer — a árvore
  // semeada tem sempre "Outras Entradas"/"Outras Saídas" — mas evita um
  // botão sem nada para filtrar).
  if (grupos.length === 0) return null

  function aplicar(proximas: string[]) {
    const todosOsIds = grupos.flatMap(idsDoGrupo)
    const todas = todosOsIds.length > 0 && todosOsIds.every((id) => proximas.includes(id))
    aoMudar(todas ? [] : proximas)
  }

  function alternarSubcategoria(id: string) {
    aplicar(
      seleccionadas.includes(id)
        ? seleccionadas.filter((outro) => outro !== id)
        : [...seleccionadas, id],
    )
  }

  function alternarGrupo(grupo: GrupoArvore) {
    const idsGrupo = idsDoGrupo(grupo)
    const grupoTodoMarcado = idsGrupo.every((id) => seleccionadas.includes(id))
    const semEsteGrupo = seleccionadas.filter((id) => !idsGrupo.includes(id))
    aplicar(grupoTodoMarcado ? semEsteGrupo : [...semEsteGrupo, ...idsGrupo])
  }

  return (
    <>
      <button
        type="button"
        className={estilos.gatilho}
        aria-label={seleccionadas.length > 0 ? 'Categorias (filtro activo)' : 'Categorias'}
        aria-haspopup="dialog"
        onClick={() => setAberto(true)}
      >
        <IconeFunil tamanho={18} />
        {seleccionadas.length > 0 && <span className={estilos.ponto} aria-hidden="true" />}
      </button>

      {aberto && (
        <Folha
          titulo="Categorias"
          direcao="baixo"
          varianteFechar="circulo"
          iconeFechar={<IconeFechar tamanho={22} />}
          rotuloFechar="Fechar"
          aoDispensar={() => setAberto(false)}
        >
          {() => (
            <div className={estilos.lista}>
              <LinhaOpcao
                multi
                etiqueta="Todas"
                selecionada={seleccionadas.length === 0}
                aoTocar={() => aoMudar([])}
              />
              {grupos.map((grupo) => {
                const idsGrupo = idsDoGrupo(grupo)
                const grupoTodoMarcado = idsGrupo.every((id) => seleccionadas.includes(id))
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
                        selecionada={seleccionadas.includes(sub.id)}
                        aoTocar={() => alternarSubcategoria(sub.id)}
                      />
                    ))}
                  </Fragment>
                )
              })}
            </div>
          )}
        </Folha>
      )}
    </>
  )
}
