/*
 * COR DETERMINÍSTICA A PARTIR DE UM NOME
 * =======================================
 *
 * Um "hash" simples e estável: transforma qualquer texto sempre no mesmo
 * número inteiro, dentro de um intervalo dado. Usa-se para escolher uma
 * cor a partir de um nome (o mesmo nome dá sempre a mesma cor, sem guardar
 * nada em lado nenhum) — o Avatar (círculo com a inicial, para contas) e o
 * PontoCategoria (ponto colorido, para categorias) partilham esta mesma
 * lógica, em vez de cada um a duplicar.
 *
 * O algoritmo em si (multiplicar por 31 e somar o código de cada
 * caractere) não tem nada de especial — é só uma forma comum de espalhar
 * texto por um conjunto de valores de forma estável; não precisa de ser
 * criptograficamente seguro, só de dar sempre o mesmo resultado para a
 * mesma entrada.
 */

export const N_CORES = 6

/** Índice de cor (0 a nCores-1) determinístico a partir de "chave" — o
 *  mesmo texto dá sempre o mesmo índice. */
export function indiceDeCor(chave: string, nCores: number = N_CORES): number {
  let acumulador = 0
  for (let i = 0; i < chave.length; i++) {
    acumulador = (acumulador * 31 + chave.charCodeAt(i)) >>> 0
  }
  return acumulador % nCores
}
