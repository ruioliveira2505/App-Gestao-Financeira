/*
 * TESTES DAS FUNÇÕES AUXILIARES DE CATEGORIAS
 * ===========================================
 *
 * O grupo "Outras Saídas" tem duas subcategorias protegidas (não se
 * editam nem se eliminam): o "Outros", o destino por omissão de um
 * movimento sem categoria escolhida, e o "Acerto de saldo", RESERVADO aos
 * acertos das reconciliações (o movimento que a aplicação cria pela
 * diferença entre o saldo afirmado e o calculado). Estes testes garantem
 * que o reservado nunca se oferece para escolher num movimento, e que o
 * destino por omissão é sempre o "Outros", seja qual for a ordem.
 */

import { describe, expect, it } from 'vitest'

import { categoriaRefugio, escolhiveis, type GrupoArvore } from './categorias'

const ARVORE: GrupoArvore[] = [
  {
    id: 'g1',
    nome: 'Outras Saídas',
    direcao: 'saida',
    subcategorias: [
      // O reservado primeiro, de propósito: a ordem não pode decidir.
      { id: 'acerto', nome: 'Acerto de saldo', protegida: true, reservada: true },
      { id: 'quotas', nome: 'Quotas', protegida: false, reservada: false },
      { id: 'outros', nome: 'Outros', protegida: true, reservada: false },
    ],
  },
]

describe('categorias reservadas', () => {
  it('escolhiveis tira o "Acerto de saldo"', () => {
    expect(escolhiveis(ARVORE[0].subcategorias).map((s) => s.id)).toEqual(['quotas', 'outros'])
  })

  it('a categoria-refúgio é o "Outros", nunca o "Acerto de saldo"', () => {
    expect(categoriaRefugio(ARVORE, 'saida')).toBe('outros')
  })
})
