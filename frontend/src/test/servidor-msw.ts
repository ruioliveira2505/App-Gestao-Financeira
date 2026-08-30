/*
 * SERVIDOR DE SIMULAÇÃO DE REDE PARA OS TESTES (MSW)
 * ==================================================
 *
 * O MSW ("Mock Service Worker") intercepta os pedidos HTTP feitos pelo
 * código durante os testes e responde-lhes com respostas definidas por
 * nós, sem que nenhum pedido chegue a sair para a rede real.
 *
 * Porque é que isto interessa neste projecto: o cliente HTTP da aplicação
 * (src/lib/api.ts, criado no passo seguinte) faz pedidos "fetch" à API de
 * autenticação. Nos testes não há — nem deve haver — um backend a correr.
 * Ao interceptar ao nível da rede, o MSW permite testar esse cliente tal
 * como ele é (cabeçalhos, envio de cookies, interpretação de respostas de
 * erro), em vez de o substituir por uma versão falsa e deixar o código
 * real por exercitar.
 *
 * Este ficheiro apenas cria o servidor de interceptação, sem regras
 * ("handlers") por omissão: cada teste, ou cada ficheiro de testes,
 * declara as respostas de que precisa através de servidorMsw.use(...).
 * O arranque e o encerramento do servidor são tratados uma única vez em
 * src/test/setup.ts.
 */

// setupServer é a variante do MSW para ambientes Node.js (é o caso do
// Vitest). Existe uma variante diferente para código a correr num browser
// real, que este projecto não usa nos testes.
import { setupServer } from 'msw/node'

// Sem argumentos: nenhuma rota é simulada até um teste o pedir
// explicitamente. Combinado com onUnhandledRequest: 'error' (ver
// setup.ts), qualquer pedido inesperado feito por um teste faz esse teste
// falhar — em vez de sair silenciosamente para a rede.
export const servidorMsw = setupServer()
