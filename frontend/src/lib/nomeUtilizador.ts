/*
 * NOME DO UTILIZADOR A PARTIR DO EMAIL
 * ===================================
 *
 * O registo só recolhe o email. Na falta de um campo de nome verdadeiro,
 * deriva-se um "nome" da parte antes do "@" ("ana@exemplo.pt" -> "ana") e
 * a sua inicial, para o avatar. Quando existir um campo de nome, troca-se
 * estas funções pela leitura desse campo.
 *
 * Um único sítio, partilhado pela barra lateral (desktop), pelo menu ☰
 * (mobile) e pela página de Perfil.
 */

export function nomeApresentado(email: string | undefined): string {
  if (!email) return 'Utilizador'
  const arroba = email.indexOf('@')
  return arroba > 0 ? email.slice(0, arroba) : email
}

export function inicial(email: string | undefined): string {
  return nomeApresentado(email).charAt(0).toUpperCase() || '?'
}
