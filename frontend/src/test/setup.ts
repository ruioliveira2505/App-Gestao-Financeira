/*
 * PREPARAÇÃO COMUM A TODOS OS TESTES
 * ==================================
 *
 * Este ficheiro corre uma única vez, antes de qualquer teste (está
 * indicado em "setupFiles", no bloco "test" de vite.config.ts). Serve para
 * ligar extensões que devem valer para toda a suite de testes, sem as
 * repetir em cada ficheiro:
 *
 *   1. Os "matchers" do jest-dom, que acrescentam ao expect(...) formas de
 *      verificação próprias do DOM (por exemplo, toBeInTheDocument() ou
 *      toHaveTextContent(...)), mais legíveis do que verificar as mesmas
 *      condições à mão.
 *
 *   2. O ciclo de vida do servidor de simulação de rede (MSW): arrancá-lo
 *      antes dos testes, repor as regras entre testes, e encerrá-lo no
 *      fim.
 */

// A importação com o sufixo "/vitest" regista os matchers do jest-dom
// directamente no expect do Vitest. Não é preciso atribuir o resultado a
// nada — o efeito é o próprio acto de importar.
import '@testing-library/jest-dom/vitest'

import { afterAll, afterEach, beforeAll } from 'vitest'

import { servidorMsw } from './servidor-msw'

// beforeAll: corre uma vez, antes do primeiro teste.
// onUnhandledRequest: 'error' faz falhar qualquer teste que provoque um
// pedido HTTP para o qual não exista uma regra declarada — assim, um
// pedido inesperado é um erro visível, não algo que passa despercebido.
beforeAll(() => servidorMsw.listen({ onUnhandledRequest: 'error' }))

// afterEach: corre depois de cada teste. Remove as regras que esse teste
// tenha adicionado com servidorMsw.use(...), para que não "vazem" para o
// teste seguinte e cada teste comece de um estado limpo.
afterEach(() => servidorMsw.resetHandlers())

// afterAll: corre uma vez, depois do último teste. Encerra o servidor de
// interceptação e liberta os recursos que ocupava.
afterAll(() => servidorMsw.close())
