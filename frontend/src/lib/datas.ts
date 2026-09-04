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
