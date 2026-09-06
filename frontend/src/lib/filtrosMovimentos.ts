/*
 * FILTROS DA LISTA DE MOVIMENTOS
 * =============================
 *
 * O estado dos filtros vive no URL (query string) — sobrevive a navegar
 * para editar um movimento e voltar, e é já a forma que o backend vai
 * consumir quando a filtragem passar para o servidor. Aqui ficam as
 * funções puras: ler os filtros de uma query string, escrevê-los de
 * volta, contar quantos estão ativos, e aplicá-los a uma lista de
 * movimentos (por agora, tudo no cliente).
 *
 * Parâmetros no URL:
 *   - tipo=entrada | saida                 (ausente = todos)
 *   - contas=<id>,<id>,…                   (ausente = todas)
 *   - de=<AAAA-MM-DD> & ate=<AAAA-MM-DD>   (ausentes = todo o período)
 *
 * Os atalhos de datas (últimos 7/30/90 dias, e "mês específico") são só
 * isso — atalhos: ao escolher um, os campos "de" e "ate" ficam
 * preenchidos com as datas concretas. Não há parâmetro "preset" nem "mes";
 * a folha de filtros descobre o que está ativo comparando "de"/"ate" com o
 * intervalo que cada atalho daria hoje (ou reconhecendo um mês de
 * calendário completo — ver mesDeIntervalo).
 *
 * NÃO há filtro por VALOR: as contas podem estar em moedas diferentes, e
 * um intervalo único (10–500) sobre montantes de moedas diferentes estaria
 * a comparar grandezas que não são comparáveis. Volta quando a aplicação
 * tiver uma moeda base para converter (a página Resumo vai precisar dela).
 */

import type { Movimento } from './movimentos'

export type Filtros = {
  tipo: 'entrada' | 'saida' | null
  contas: string[]
  de: string | null
  ate: string | null
}

export const FILTROS_VAZIOS: Filtros = { tipo: null, contas: [], de: null, ate: null }

/** Lê os filtros de uma query string. */
export function lerFiltros(params: URLSearchParams): Filtros {
  const tipo = params.get('tipo')
  const contas = params.get('contas')
  return {
    tipo: tipo === 'entrada' || tipo === 'saida' ? tipo : null,
    contas: contas ? contas.split(',').filter(Boolean) : [],
    de: params.get('de') || null,
    ate: params.get('ate') || null,
  }
}

/** Converte os filtros de volta numa query string, omitindo o que está no
 *  estado por omissão — para o URL ficar limpo quando não há filtros. */
export function escreverFiltros(filtros: Filtros): URLSearchParams {
  const params = new URLSearchParams()
  if (filtros.tipo) params.set('tipo', filtros.tipo)
  if (filtros.contas.length > 0) params.set('contas', filtros.contas.join(','))
  if (filtros.de) params.set('de', filtros.de)
  if (filtros.ate) params.set('ate', filtros.ate)
  return params
}

/** Quantos filtros estão ativos — para saber se se assinala o funil e para
 *  o subtítulo "N de N". */
export function contarFiltrosAtivos(filtros: Filtros): number {
  let n = 0
  if (filtros.tipo) n += 1
  if (filtros.contas.length > 0) n += 1
  if (filtros.de || filtros.ate) n += 1
  return n
}

/** Aplica os filtros a uma lista de movimentos. A pesquisa por texto é
 *  tratada à parte (é sempre visível, não vive na folha de filtros). */
export function aplicarFiltros(movimentos: Movimento[], filtros: Filtros): Movimento[] {
  const contas = new Set(filtros.contas)
  return movimentos.filter((movimento) => {
    const valor = Number(movimento.valor)
    if (filtros.tipo === 'entrada' && valor < 0) return false
    if (filtros.tipo === 'saida' && valor >= 0) return false
    if (contas.size > 0 && !contas.has(movimento.conta_id)) return false
    if (filtros.de && movimento.data < filtros.de) return false
    if (filtros.ate && movimento.data > filtros.ate) return false
    return true
  })
}

// --- Atalhos de datas ---
//
// Duas JANELAS MÓVEIS curtas (7 / 30 / 90 dias, sempre a acabar hoje) para
// o caso comum — "o que se passou ultimamente" — e, à parte, um seletor de
// MÊS ESPECÍFICO que dobra qualquer mês de calendário numa só opção (este
// mês, o mês passado, "março", "dezembro do ano passado"). O resto é o
// "Personalizado". Sem "este ano" nem "este trimestre": raros, e o
// personalizado cobre-os.

export type Preset = '7d' | '30d' | '90d'

export const PRESETS: Preset[] = ['7d', '30d', '90d']

export const ROTULO_PRESET: Record<Preset, string> = {
  '7d': 'Últimos 7 dias',
  '30d': 'Últimos 30 dias',
  '90d': 'Últimos 90 dias',
}

// Quantos dias abrange cada janela móvel (inclusive: "7 dias" = hoje e os
// 6 anteriores).
const DIAS_DO_PRESET: Record<Preset, number> = { '7d': 7, '30d': 30, '90d': 90 }

function iso(data: Date): string {
  const ano = data.getFullYear()
  const mes = String(data.getMonth() + 1).padStart(2, '0')
  const dia = String(data.getDate()).padStart(2, '0')
  return `${ano}-${mes}-${dia}`
}

/** O intervalo {de, ate} de uma janela móvel — de hoje para trás. */
export function intervaloDoPreset(preset: Preset): { de: string; ate: string } {
  const hoje = new Date()
  hoje.setHours(0, 0, 0, 0)
  const de = new Date(hoje)
  de.setDate(de.getDate() - (DIAS_DO_PRESET[preset] - 1))
  return { de: iso(de), ate: iso(hoje) }
}

/** O intervalo {de, ate} de um mês de calendário. "mesIso" é "AAAA-MM"
 *  (o formato de um <input type="month">). */
export function intervaloDoMes(mesIso: string): { de: string; ate: string } {
  const [ano, mes] = mesIso.split('-').map(Number)
  const de = new Date(ano, mes - 1, 1)
  // Dia 0 do mês seguinte = último dia deste.
  const ate = new Date(ano, mes, 0)
  return { de: iso(de), ate: iso(ate) }
}

/** Se o intervalo nos filtros é exatamente um mês de calendário (dia 1 →
 *  último dia do mesmo mês), devolve-o como "AAAA-MM"; senão, null. Serve
 *  para reconhecer a escolha "Mês específico" e mostrá-la como "Março
 *  2026". */
export function mesDeIntervalo(filtros: Filtros): string | null {
  if (!filtros.de || !filtros.ate) return null
  const de = new Date(`${filtros.de}T00:00:00`)
  const ate = new Date(`${filtros.ate}T00:00:00`)
  if (de.getDate() !== 1) return null
  if (de.getFullYear() !== ate.getFullYear() || de.getMonth() !== ate.getMonth()) return null
  const ultimoDia = new Date(de.getFullYear(), de.getMonth() + 1, 0).getDate()
  if (ate.getDate() !== ultimoDia) return null
  return `${de.getFullYear()}-${String(de.getMonth() + 1).padStart(2, '0')}`
}

/** Qual atalho (se algum) corresponde ao intervalo atualmente nos filtros. */
export function presetAtivo(filtros: Filtros): Preset | null {
  if (!filtros.de || !filtros.ate) return null
  return (
    PRESETS.find((preset) => {
      const intervalo = intervaloDoPreset(preset)
      return intervalo.de === filtros.de && intervalo.ate === filtros.ate
    }) ?? null
  )
}
