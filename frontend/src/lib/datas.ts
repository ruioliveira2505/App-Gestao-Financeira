/*
 * FORMATAÇÃO DE DATAS
 * ===================
 *
 * As datas vêm da API como texto ISO ("2026-01-01"). Aqui converte-se
 * para apresentação em português.
 */

/**
 * "2026-01-01" -> "1 de jan. de 2026".
 *
 * O "T00:00:00" força a interpretação como meia-noite local, evitando um
 * salto de dia por causa do fuso horário (que aconteceria se a string
 * fosse interpretada como meia-noite UTC).
 */
export function formatarData(iso: string): string {
  const data = new Date(`${iso}T00:00:00`)
  return new Intl.DateTimeFormat('pt-PT', { dateStyle: 'medium' }).format(data)
}

/** "2026-03" -> "Março 2026" (mês por extenso, capitalizado, + ano). Para
 *  o resumo do filtro "Mês específico". */
export function rotuloMes(mesIso: string): string {
  const data = new Date(`${mesIso}-01T00:00:00`)
  const nome = data.toLocaleDateString('pt-PT', { month: 'long' })
  return `${nome.charAt(0).toLocaleUpperCase('pt')}${nome.slice(1)} ${data.getFullYear()}`
}

/** "4 set" — dia e mês abreviado, sem o ponto que o pt-PT põe na
 *  abreviatura do mês ("set." → "set"). */
function diaEMesCurto(data: Date): string {
  const mes = data.toLocaleDateString('pt-PT', { month: 'short' }).replace(/\.$/, '')
  return `${data.getDate()} ${mes}`
}

/**
 * Um intervalo de datas em formato compacto, para o mostrador do filtro de
 * datas:
 *
 *   "8 set – 7 out 2026"        (mesmo ano — ano só no fim)
 *   "30 dez 2025 – 5 jan 2026"  (anos diferentes — ano em cada ponta)
 *   "Desde 1 mar 2026"          (só a ponta de início)
 *   "Até 31 mar 2026"           (só a ponta de fim)
 *
 * Devolve "" se ambas as pontas forem null — quem chama trata desse caso
 * ("Sem limite de datas").
 */
export function formatarIntervalo(de: string | null, ate: string | null): string {
  const dDe = de ? new Date(`${de}T00:00:00`) : null
  const dAte = ate ? new Date(`${ate}T00:00:00`) : null

  if (dDe && dAte) {
    const inicio =
      dDe.getFullYear() === dAte.getFullYear()
        ? diaEMesCurto(dDe)
        : `${diaEMesCurto(dDe)} ${dDe.getFullYear()}`
    return `${inicio} – ${diaEMesCurto(dAte)} ${dAte.getFullYear()}`
  }
  if (dDe) return `Desde ${diaEMesCurto(dDe)} ${dDe.getFullYear()}`
  if (dAte) return `Até ${diaEMesCurto(dAte)} ${dAte.getFullYear()}`
  return ''
}

/**
 * Rótulo do cabeçalho de um grupo de dia numa lista tipo extrato (ex.:
 * Movimentos). Sempre "<prefixo> · <dia mês>", com o ano ao fim quando não
 * é o ano corrente:
 *
 *   Hoje · 6 set          Ontem · 5 set
 *   Sex · 4 set           Ter · 12 ago 2025
 *
 * O prefixo é "Hoje"/"Ontem" para os dois dias mais recentes e, para os
 * restantes, o dia da semana abreviado e capitalizado ("sex." → "Sex").
 *
 * "hoje" é sempre recalculado (não passado como argumento) e comparado à
 * meia-noite LOCAL — tal como formatarData(), para não saltar de dia por
 * causa do fuso horário.
 */
export function rotuloDiaRelativo(iso: string): string {
  const hoje = new Date()
  hoje.setHours(0, 0, 0, 0)
  const data = new Date(`${iso}T00:00:00`)
  const diasDeDiferenca = Math.round((hoje.getTime() - data.getTime()) / 86_400_000)

  let prefixo: string
  if (diasDeDiferenca === 0) {
    prefixo = 'Hoje'
  } else if (diasDeDiferenca === 1) {
    prefixo = 'Ontem'
  } else {
    const diaSemana = data
      .toLocaleDateString('pt-PT', { weekday: 'short' })
      .replace(/\.$/, '')
    prefixo = diaSemana.charAt(0).toLocaleUpperCase('pt') + diaSemana.slice(1)
  }

  const sufixoAno =
    data.getFullYear() !== hoje.getFullYear() ? ` ${data.getFullYear()}` : ''
  return `${prefixo} · ${diaEMesCurto(data)}${sufixoAno}`
}
