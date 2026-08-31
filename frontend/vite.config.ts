/*
 * CONFIGURAÇÃO DO VITE
 * =====================
 *
 * O Vite é a ferramenta que, em desenvolvimento, arranca o servidor local
 * que serve a aplicação React (por omissão em http://localhost:5173) e,
 * para produção, empacota o código num conjunto de ficheiros estáticos.
 * Este ficheiro define o comportamento dessa ferramenta.
 *
 * Duas responsabilidades, neste momento:
 *
 *   1. Activar o plugin de React, que ensina o Vite a compreender a
 *      sintaxe JSX (o HTML escrito dentro do código dos componentes) e a
 *      recarregar automaticamente os componentes alterados sem perder o
 *      estado da página ("Fast Refresh").
 *
 *   2. Configurar um "proxy" de desenvolvimento (ver abaixo, em detalhe),
 *      para que o browser fale sempre com uma única origem durante o
 *      desenvolvimento e o cookie de sessão da autenticação funcione sem
 *      necessidade de configuração adicional no backend.
 *
 *   3. Configurar o Vitest — a ferramenta de testes — no bloco "test" mais
 *      abaixo. O Vitest reutiliza esta mesma configuração do Vite, por
 *      isso os testes são escritos e transformados exactamente como o
 *      código da aplicação, sem uma segunda configuração em paralelo.
 */

// A função defineConfig é importada de "vitest/config" (e não de "vite"),
// versão que conhece o bloco "test" usado no fim deste ficheiro. Para tudo
// o resto — plugins, server, proxy — comporta-se de forma idêntica à de
// "vite".
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],

  // "server" abrange as opções do servidor local usado apenas em
  // desenvolvimento (o comando `npm run dev`). Nada aqui tem efeito no
  // resultado do `npm run build`.
  server: {
    // host: true faz o servidor escutar em todas as interfaces de rede da
    // máquina, não apenas em "localhost". O `npm run dev` passa a imprimir
    // também um endereço "Network:" (ex.: http://192.168.1.x:5173) que
    // outros dispositivos no mesmo Wi-Fi — um telemóvel — podem abrir para
    // ver a aplicação. O proxy de /api continua a funcionar, porque é
    // resolvido do lado do servidor (esta máquina).
    host: true,

    // PROXY DE DESENVOLVIMENTO
    // ------------------------
    //
    // Problema que resolve: a aplicação React é servida pelo Vite em
    // http://localhost:5173, mas a API (FastAPI) corre noutro sítio,
    // http://127.0.0.1:8000. Um pedido do browser de uma origem para
    // outra origem diferente é um pedido "cross-origin", sujeito às
    // restrições de CORS ("Cross-Origin Resource Sharing") impostas pelo
    // browser — e, além disso, o cookie de sessão da autenticação está
    // marcado como SameSite=Lax, pelo que o browser evita enviá-lo em
    // pedidos considerados de outra origem.
    //
    // Solução: em desenvolvimento, o próprio servidor do Vite recebe os
    // pedidos que começam por "/api" e reencaminha-os, do lado do
    // servidor, para o FastAPI. Visto do browser, existe uma única
    // origem (localhost:5173) — não há pedido cross-origin, não é
    // preciso configurar CORS, e o cookie de sessão é tratado como
    // pertencente à mesma origem, sendo enviado normalmente.
    //
    // (Em produção, frontend e API poderão estar em domínios diferentes;
    // nessa altura será preciso configurar CORS no backend. Fica
    // deliberadamente adiado para a fase de publicação — ver o caderno.)
    proxy: {
      '/api': {
        // Destino para onde os pedidos "/api/..." são reencaminhados: o
        // servidor local do FastAPI.
        target: 'http://127.0.0.1:8000',

        // changeOrigin altera o cabeçalho "Host" do pedido reencaminhado
        // para corresponder ao "target". Sem isto, o FastAPI receberia
        // um pedido a dizer que o Host é "localhost:5173", o que pode
        // confundir lógica que dependa desse cabeçalho.
        changeOrigin: true,

        // As rotas do backend não têm o prefixo "/api" (são "/auth/login",
        // "/auth/me", etc.). Este "rewrite" remove o "/api" do início do
        // caminho antes de reencaminhar: o browser pede
        // "/api/auth/login", o FastAPI recebe "/auth/login".
        //
        // O prefixo "/api" existe apenas para o Vite conseguir distinguir
        // "isto é um pedido à API, reencaminha" de "isto é um pedido a uma
        // página da aplicação React, serve o index.html".
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },

  // CONFIGURAÇÃO DOS TESTES (Vitest)
  // -------------------------------
  //
  // Este bloco só é lido pelo Vitest (comando `npm run test`); não tem
  // qualquer efeito no servidor de desenvolvimento nem no `npm run build`.
  test: {
    // environment: define o "ambiente" onde cada teste corre. Um teste de
    // componentes React precisa de um "document", de "window" e das
    // restantes APIs de um browser — que não existem no Node.js puro.
    // "jsdom" é uma implementação dessas APIs em JavaScript, suficiente
    // para montar componentes e simular interacções sem abrir um browser
    // real.
    environment: 'jsdom',

    // globals: torna as funções de teste (describe, it, expect, vi, ...)
    // disponíveis globalmente, sem as importar em cada ficheiro. Mesmo
    // assim, este projecto importa-as explicitamente em cada ficheiro de
    // teste, por clareza; esta opção existe sobretudo porque algumas
    // bibliotecas de apoio (como o matcher do jest-dom) esperam encontrar
    // esse registo global já feito.
    globals: true,

    // setupFiles: ficheiro(s) executado(s) uma vez antes da suite de
    // testes. É onde se ligam extensões transversais a todos os testes —
    // aqui, os matchers do jest-dom e o servidor de simulação de rede
    // (MSW). Ver src/test/setup.ts.
    setupFiles: ['./src/test/setup.ts'],
  },
})
