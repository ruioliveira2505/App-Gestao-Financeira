/*
 * LayoutAutenticacao — MOLDURA DOS ECRÃS DE AUTENTICAÇÃO
 * =====================================================
 *
 * Componente puramente visual, partilhado pelos ecrãs de registo e de
 * início de sessão. Coloca o conteúdo recebido dentro de um cartão
 * centrado no ecrã, com um título por cima.
 *
 * Não tem lógica nem estado: recebe o título e o conteúdo (o formulário e
 * a ligação para o outro ecrã) como props, e apenas os enquadra. Manter
 * esta moldura num sítio só evita repetir a mesma estrutura e os mesmos
 * estilos nos dois ecrãs, e garante que ficam iguais.
 */

import type { ReactNode } from 'react'

// "estilos" é um objecto cujas chaves são os nomes das classes definidas
// em LayoutAutenticacao.module.css (estilos.fundo, estilos.cartao). Ver o
// comentário no topo desse ficheiro para o que "module.css" implica.
import estilos from './LayoutAutenticacao.module.css'

export function LayoutAutenticacao({
  titulo,
  children,
}: {
  titulo: string
  children: ReactNode
}) {
  return (
    <div className={estilos.fundo}>
      {/* <main> marca o conteúdo principal da página para tecnologias de
          apoio (leitores de ecrã) e para o próprio browser. */}
      <main className={estilos.cartao}>
        <h1>{titulo}</h1>
        {children}
      </main>
    </div>
  )
}
