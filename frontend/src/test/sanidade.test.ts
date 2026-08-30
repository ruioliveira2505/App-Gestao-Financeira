/*
 * TESTE DE SANIDADE
 * =================
 *
 * Um único teste, sem qualquer relação com a lógica da aplicação. Existe
 * só para confirmar que a máquina de testes está montada e a correr: se
 * `npm run test` executar este ficheiro e o der como aprovado, então o
 * Vitest, o ambiente jsdom e o ficheiro de preparação (src/test/setup.ts)
 * estão todos a funcionar.
 *
 * Pode ser removido assim que existirem testes reais suficientes — a sua
 * função é apenas servir de primeiro sinal de vida da configuração.
 */

import { describe, expect, it } from 'vitest'

describe('máquina de testes', () => {
  it('está operacional', () => {
    expect(1 + 1).toBe(2)
  })
})
