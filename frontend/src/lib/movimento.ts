/*
 * DURAÇÕES DE MOVIMENTO (em código)
 * =================================
 *
 * As mesmas durações das variáveis "--movimento-*" de src/index.css, em
 * milissegundos, para o código que precisa de ESPERAR pelo fim de uma
 * animação — por exemplo, uma folha que só pode ser retirada da página
 * depois de acabar de deslizar para fora (antes disso, desaparecia a meio
 * do movimento). O CSS anima; o código só espera.
 *
 * Têm de ser iguais às do CSS. Se um dia mudarem, mudam nos dois sítios
 * (ler as variáveis do CSS em tempo de execução seria possível, mas
 * acrescentava complexidade a cada uso para um valor que quase nunca
 * muda).
 */

/** Resposta ao toque (realce de uma linha ou botão). */
export const DURACAO_TOQUE_MS = 120

/** Aparecer/desaparecer sem deslocação (fades, menus, avisos). */
export const DURACAO_APARECER_MS = 200

/** Deslocações no ecrã (folhas, páginas, menu ☰, pesquisa). */
export const DURACAO_DESLOCAR_MS = 320
