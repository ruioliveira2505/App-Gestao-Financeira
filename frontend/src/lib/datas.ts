/*
 * FORMATAÇÃO DE DATAS
 * ===================
 *
 * As datas vêm da API como texto ISO ("2026-01-01"). Aqui converte-se
 * para apresentação em português, e calcula-se a data de hoje.
 */

/**
 * A data de HOJE em ISO ("AAAA-MM-DD"), no fuso horário do dispositivo.
 *
 * Não serve "new Date().toISOString()": daria a data em UTC (o tempo
 * universal coordenado), e entre a meia-noite e a uma da manhã em Lisboa,
 * no verão, o UTC ainda está no dia anterior. É usada como data sugerida
 * e como data máxima nos calendários: nem um movimento nem a data inicial
 * de uma conta podem estar no futuro (o backend também o recusa).
 */
export function hojeIso(): string {
  const agora = new Date()
  const mes = String(agora.getMonth() + 1).padStart(2, '0')
  const dia = String(agora.getDate()).padStart(2, '0')
  return `${agora.getFullYear()}-${mes}-${dia}`
}

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

const MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

/**
 * "2026-07-03" -> "3 jul 2026": o dia sem zero à frente, o mês abreviado
 * (sempre em minúsculas e sem ponto) e o ano. É o formato curto da app
 * (o mesmo do calendário), que não depende do idioma nem da versão do
 * browser — ao contrário de formatarData (acima), cujo resultado ("01/01/2026"
 * ou "1 de jan. de 2026") muda com o browser. Só trabalha com a data (os
 * primeiros 10 caracteres), por isso também aceita um instante ISO.
 */
export function formatarDataCurta(iso: string): string {
  const [ano, mes, dia] = iso.slice(0, 10).split('-').map(Number)
  return `${dia} ${MESES_CURTOS[mes - 1]} ${ano}`
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

/**
 * Um instante (data e hora ISO) como data curta: "2 set", ou "30 dez 2025"
 * se não for do ano atual. Sem ponto no mês abreviado (o Intl escreveria
 * "set." em algumas versões) — fica mais limpo numa linha de estado como
 * «Suspensa · desde 2 set». "agora" é um parâmetro para os testes.
 */
export function diaCurto(isoInstante: string, agora: Date = new Date()): string {
  const data = new Date(isoInstante)
  const mes = data.toLocaleDateString('pt-PT', { month: 'short' }).replace('.', '')
  const ano = data.getFullYear() === agora.getFullYear() ? '' : ` ${data.getFullYear()}`
  return `${data.getDate()} ${mes}${ano}`
}

/**
 * Há quanto tempo foi um instante, em português curto, para o detalhe de
 * uma linha de estado («Sincronizada · há 2 horas»): "agora" (menos de um
 * minuto), "há 5 min", "há 1 hora" / "há 3 horas", "há 1 dia" / "há 3
 * dias"; a partir de uma semana, a data ("a 2 set"), que se lê melhor do
 * que "há 41 dias". "agora" é um parâmetro para os testes poderem fixar o
 * momento.
 */
export function tempoDecorrido(isoInstante: string, agora: Date = new Date()): string {
  const instante = new Date(isoInstante).getTime()
  // Uma data inválida não diz nada: texto vazio, e quem chama não mostra o
  // detalhe (em vez de «a NaN Invalid Date»).
  if (Number.isNaN(instante)) return ''
  // Uma data no futuro (relógios desacertados) conta como «agora».
  const ms = agora.getTime() - instante
  const minutos = Math.floor(ms / 60000)
  if (minutos < 1) return 'agora'
  if (minutos < 60) return `há ${minutos} min`
  const horas = Math.floor(minutos / 60)
  if (horas < 24) return horas === 1 ? 'há 1 hora' : `há ${horas} horas`
  const dias = Math.floor(horas / 24)
  if (dias < 7) return dias === 1 ? 'há 1 dia' : `há ${dias} dias`
  return `a ${diaCurto(isoInstante, agora)}`
}

/**
 * Se um instante (data e hora ISO) foi no mesmo dia que "agora", no fuso
 * do aparelho. Serve, por exemplo, para saber se o limite de acessos do
 * banco ainda vale (volta a zero no dia seguinte).
 */
export function mesmoDia(isoInstante: string, agora: Date = new Date()): boolean {
  const data = new Date(isoInstante)
  return (
    data.getFullYear() === agora.getFullYear() &&
    data.getMonth() === agora.getMonth() &&
    data.getDate() === agora.getDate()
  )
}
