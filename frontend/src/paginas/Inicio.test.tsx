/*
 * TESTES DA PÁGINA INÍCIO
 * =======================
 *
 * Monta a página dentro de um AuthProvider real (autenticado por
 * GET /auth/me, tal como ContaDetalhe.test.tsx) e mocka GET /resumo.
 * Cobre: a ausência de qualquer título de página (por agora — ver a nota
 * "DESENHO DELIBERADAMENTE DIFERENTE" em Inicio.tsx); o saldo total e o
 * líquido, formatados na moeda principal; o mês mostrado no cabeçalho da
 * secção; o controlo segmentado Entradas/Saídas (a aba "Saídas" activa
 * por omissão, a troca ao clicar, cada uma com o seu total e a sua
 * repartição por categoria); "Ver mais"/"Ver menos" quando há mais do
 * que 5 categorias; o estado vazio de uma direcção sem categorias; abrir
 * um grupo (pede GET /resumo/categorias/{id} só na primeira vez, fecha
 * ao clicar outra vez, fecha o anterior ao abrir outro, fecha ao trocar
 * de direcção, estados de carregamento/vazio/erro); o esqueleto enquanto
 * o pedido está em curso; e a falha do pedido.
 */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { delay, http, HttpResponse } from 'msw'

import { servidorMsw } from '../test/servidor-msw'
import { AuthProvider } from '../auth/AuthProvider'
import { Inicio } from './Inicio'
import type { GrupoResumo } from '../lib/resumo'

const UTILIZADOR = { id: 'u1', email: 'ana@exemplo.pt', moeda_principal: 'USD' }

function grupo(overrides: Partial<GrupoResumo>): GrupoResumo {
  return { grupo_id: 'g', nome: 'Grupo', valor: '100.00', percentagem: 100, ...overrides }
}

// Os valores são todos DIFERENTES de propósito — evita que uma asserção
// só pareça correta por coincidência de dois números iguais.
const RESUMO = {
  saldo_total: '3000.00',
  entradas: '1700.00',
  saidas: '-500.00',
  liquido: '1200.00',
  categorias_entradas: [] as GrupoResumo[],
  categorias_saidas: [] as GrupoResumo[],
  periodo_inicio: '2026-09-01',
  periodo_fim: '2026-09-18',
}

function montar() {
  servidorMsw.use(http.get('/api/auth/me', () => HttpResponse.json(UTILIZADOR)))
  return render(
    <AuthProvider>
      <Inicio />
    </AuthProvider>,
  )
}

describe('Início', () => {
  it('não mostra nenhum título de página, por agora', async () => {
    servidorMsw.use(http.get('/api/resumo', () => HttpResponse.json(RESUMO)))

    montar()

    await screen.findByText('Saldo total')
    // Sem <CabecalhoPagina> e sem substituto (ver a nota "DESENHO
    // DELIBERADAMENTE DIFERENTE" em Inicio.tsx) — nenhum título de
    // PÁGINA (nível 1); o "Setembro 2026" que aparece é um título de
    // SECÇÃO (nível 2), não afectado por esta mudança.
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument()
  })

  it('mostra o saldo total e o líquido, na moeda principal', async () => {
    servidorMsw.use(http.get('/api/resumo', () => HttpResponse.json(RESUMO)))

    montar()

    expect(await screen.findByText('Saldo total')).toBeInTheDocument()
    // moeda_principal é "USD" — confirma que a formatação usa mesmo essa
    // moeda, não um "EUR" por omissão.
    expect(screen.getByText(/3.?000,00 ?US\$/)).toBeInTheDocument()
    expect(screen.getByText(/Líquido 1.?200,00 ?US\$/)).toBeInTheDocument()
  })

  it('mostra o mês do período devolvido pelo servidor', async () => {
    servidorMsw.use(http.get('/api/resumo', () => HttpResponse.json(RESUMO)))

    montar()

    // "periodo_inicio" é "2026-09-01" -> "Setembro 2026".
    expect(await screen.findByText('Setembro 2026')).toBeInTheDocument()
  })

  it('líquido negativo aparece na mesma tinta das saídas', async () => {
    servidorMsw.use(
      http.get('/api/resumo', () => HttpResponse.json({ ...RESUMO, liquido: '-300.00' })),
    )

    montar()

    const liquido = await screen.findByText(/Líquido -300,00 ?US\$/)
    // A aba "Saídas" está activa por omissão — o seu total usa a mesma
    // classe semântica ".negativo" (cada elemento traz também a sua
    // própria classe estrutural — ".liquidoInline"/".totalDirecao" — por
    // isso comparam-se as classes por conteúdo, não por igualdade exacta).
    // SEM "-": dentro da aba "Saídas" o sinal é redundante com o
    // contexto (ver formatarSemSinal, em Inicio.tsx) — só "Líquido",
    // acima, pode ser positivo ou negativo consoante o mês, por isso
    // mantém sempre o sinal.
    const totalSaidas = screen.getByText(/500,00 ?US\$/)
    expect(liquido.className).toMatch(/negativo/)
    expect(totalSaidas.className).toMatch(/negativo/)
  })

  describe('controlo segmentado Entradas/Saídas', () => {
    it('"Saídas" está activa por omissão, com o seu total e as suas categorias', async () => {
      servidorMsw.use(
        http.get('/api/resumo', () =>
          HttpResponse.json({
            ...RESUMO,
            categorias_saidas: [grupo({ grupo_id: 's1', nome: 'Alimentação', valor: '-300.00', percentagem: 60 })],
          }),
        ),
      )

      montar()

      expect(await screen.findByRole('button', { name: 'Saídas' })).toHaveAttribute(
        'aria-pressed',
        'true',
      )
      expect(screen.getByRole('button', { name: 'Entradas' })).toHaveAttribute(
        'aria-pressed',
        'false',
      )
      // Sem "-": dentro da aba "Saídas" já activa, o sinal é redundante
      // (ver formatarSemSinal, em Inicio.tsx).
      expect(screen.getByText(/500,00 ?US\$/)).toBeInTheDocument()
      expect(screen.getByText('Alimentação')).toBeInTheDocument()
    })

    it('nenhum valor de Saídas (total ou categoria) mostra o sinal negativo', async () => {
      servidorMsw.use(
        http.get('/api/resumo', () =>
          HttpResponse.json({
            ...RESUMO,
            categorias_saidas: [
              grupo({ grupo_id: 's1', nome: 'Alimentação', valor: '-500.00', percentagem: 100 }),
            ],
          }),
        ),
      )

      montar()
      await screen.findByText('Alimentação')

      // Nem o total da aba, nem o valor da categoria — nenhum "-" em
      // lado nenhum desta secção.
      expect(screen.queryByText(/-500,00/)).not.toBeInTheDocument()
      expect(screen.getAllByText(/500,00 ?US\$/)).toHaveLength(2)
    })

    it('clicar em "Entradas" troca o total e a lista de categorias mostrados', async () => {
      servidorMsw.use(
        http.get('/api/resumo', () =>
          HttpResponse.json({
            ...RESUMO,
            // Duas categorias (não uma só) — de propósito, para o total
            // (1700.00) nunca coincidir em texto com o valor de nenhuma
            // categoria isolada, o que tornaria a asserção do total
            // ambígua (haveria dois elementos com o mesmo texto).
            categorias_entradas: [
              grupo({ grupo_id: 'e1', nome: 'Salário', valor: '1200.00', percentagem: 70.6 }),
              grupo({ grupo_id: 'e2', nome: 'Outras Entradas', valor: '500.00', percentagem: 29.4 }),
            ],
            categorias_saidas: [grupo({ grupo_id: 's1', nome: 'Alimentação', valor: '-500.00', percentagem: 100 })],
          }),
        ),
      )

      montar()
      await screen.findByText('Alimentação')

      await userEvent.click(screen.getByRole('button', { name: 'Entradas' }))

      expect(screen.getByRole('button', { name: 'Entradas' })).toHaveAttribute(
        'aria-pressed',
        'true',
      )
      expect(screen.getByText(/1.?700,00 ?US\$/)).toBeInTheDocument()
      expect(screen.getByText('Salário')).toBeInTheDocument()
      expect(screen.getByText('Outras Entradas')).toBeInTheDocument()
      expect(screen.queryByText('Alimentação')).not.toBeInTheDocument()
    })

    it('uma direcção sem nenhuma categoria mostra um estado vazio, não uma lista em branco', async () => {
      servidorMsw.use(http.get('/api/resumo', () => HttpResponse.json(RESUMO)))

      montar()

      // "Saídas" activa por omissão, "categorias_saidas" vazio.
      expect(await screen.findByText('Sem saídas este mês.')).toBeInTheDocument()
    })
  })

  describe('"Ver mais" / "Ver menos"', () => {
    const SEIS_GRUPOS: GrupoResumo[] = Array.from({ length: 6 }, (_, indice) =>
      grupo({
        grupo_id: `g${indice}`,
        nome: `Categoria ${indice + 1}`,
        valor: `${100 - indice * 10}.00`,
        percentagem: 100 - indice * 10,
      }),
    )

    it('só mostra as 5 maiores categorias por omissão, com "Ver mais N" para o resto', async () => {
      servidorMsw.use(
        http.get('/api/resumo', () =>
          HttpResponse.json({ ...RESUMO, categorias_saidas: SEIS_GRUPOS }),
        ),
      )

      montar()

      await screen.findByText('Categoria 1')
      expect(screen.getByText('Categoria 5')).toBeInTheDocument()
      expect(screen.queryByText('Categoria 6')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Ver mais 1' })).toBeInTheDocument()
    })

    it('"Ver mais" mostra as restantes, e passa a "Ver menos"', async () => {
      servidorMsw.use(
        http.get('/api/resumo', () =>
          HttpResponse.json({ ...RESUMO, categorias_saidas: SEIS_GRUPOS }),
        ),
      )
      montar()
      await screen.findByText('Categoria 1')

      await userEvent.click(screen.getByRole('button', { name: 'Ver mais 1' }))

      expect(screen.getByText('Categoria 6')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Ver menos' })).toBeInTheDocument()
    })

    it('trocar de direcção repõe a lista recolhida (não herda "expandido" da aba anterior)', async () => {
      servidorMsw.use(
        http.get('/api/resumo', () =>
          HttpResponse.json({
            ...RESUMO,
            categorias_entradas: SEIS_GRUPOS,
            categorias_saidas: SEIS_GRUPOS,
          }),
        ),
      )
      montar()
      await screen.findByText('Categoria 1')
      await userEvent.click(screen.getByRole('button', { name: 'Ver mais 1' }))
      await screen.findByText('Categoria 6')

      await userEvent.click(screen.getByRole('button', { name: 'Entradas' }))

      expect(screen.queryByText('Categoria 6')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Ver mais 1' })).toBeInTheDocument()
    })
  })

  describe('abrir um grupo revela as suas subcategorias', () => {
    const GRUPO_A = grupo({ grupo_id: 'g1', nome: 'Alimentação', valor: '-320.00', percentagem: 64 })
    const GRUPO_B = grupo({ grupo_id: 'g2', nome: 'Transportes', valor: '-100.00', percentagem: 20 })

    function mockDetalhe(subcategorias: { subcategoria_id: string; nome: string; valor: string; percentagem: number }[] = []) {
      return http.get('/api/resumo/categorias/:grupoId', ({ params }) =>
        HttpResponse.json({
          grupo_id: params.grupoId,
          nome: 'Alimentação',
          valor: '-320.00',
          subcategorias,
        }),
      )
    }

    it('está fechado por omissão, sem pedir o detalhe', async () => {
      let pedidos = 0
      servidorMsw.use(
        http.get('/api/resumo', () => HttpResponse.json({ ...RESUMO, categorias_saidas: [GRUPO_A] })),
        http.get('/api/resumo/categorias/:grupoId', () => {
          pedidos += 1
          return HttpResponse.json({ grupo_id: 'g1', nome: 'Alimentação', valor: '-320.00', subcategorias: [] })
        }),
      )

      montar()

      expect(await screen.findByRole('button', { name: /Alimentação/ })).toHaveAttribute(
        'aria-expanded',
        'false',
      )
      expect(pedidos).toBe(0)
    })

    it('clicar abre, pede o detalhe, e mostra as subcategorias; clicar outra vez fecha', async () => {
      servidorMsw.use(
        http.get('/api/resumo', () => HttpResponse.json({ ...RESUMO, categorias_saidas: [GRUPO_A] })),
        mockDetalhe([
          { subcategoria_id: 'sub1', nome: 'Supermercado', valor: '-200.00', percentagem: 62.5 },
        ]),
      )

      montar()
      await screen.findByText('Alimentação')

      await userEvent.click(screen.getByRole('button', { name: /Alimentação/ }))

      expect(await screen.findByText('Supermercado')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Alimentação/ })).toHaveAttribute(
        'aria-expanded',
        'true',
      )

      await userEvent.click(screen.getByRole('button', { name: /Alimentação/ }))

      expect(screen.queryByText('Supermercado')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Alimentação/ })).toHaveAttribute(
        'aria-expanded',
        'false',
      )
    })

    it('reabrir o mesmo grupo não volta a pedir o detalhe', async () => {
      let pedidos = 0
      servidorMsw.use(
        http.get('/api/resumo', () => HttpResponse.json({ ...RESUMO, categorias_saidas: [GRUPO_A] })),
        http.get('/api/resumo/categorias/:grupoId', () => {
          pedidos += 1
          return HttpResponse.json({ grupo_id: 'g1', nome: 'Alimentação', valor: '-320.00', subcategorias: [] })
        }),
      )
      montar()
      await screen.findByText('Alimentação')
      const botao = () => screen.getByRole('button', { name: /Alimentação/ })

      await userEvent.click(botao())
      await screen.findByText('Sem detalhe este mês.')
      await userEvent.click(botao())
      await userEvent.click(botao())

      await screen.findByText('Sem detalhe este mês.')
      expect(pedidos).toBe(1)
    })

    it('abrir outro grupo fecha o anterior', async () => {
      servidorMsw.use(
        http.get('/api/resumo', () =>
          HttpResponse.json({ ...RESUMO, categorias_saidas: [GRUPO_A, GRUPO_B] }),
        ),
        http.get('/api/resumo/categorias/:grupoId', ({ params }) =>
          HttpResponse.json({
            grupo_id: params.grupoId,
            nome: params.grupoId === 'g1' ? 'Alimentação' : 'Transportes',
            valor: '0.00',
            subcategorias: [
              {
                subcategoria_id: `${String(params.grupoId)}-sub`,
                nome: `Sub de ${String(params.grupoId)}`,
                valor: '0.00',
                percentagem: 100,
              },
            ],
          }),
        ),
      )
      montar()
      await screen.findByText('Alimentação')

      await userEvent.click(screen.getByRole('button', { name: /Alimentação/ }))
      await screen.findByText('Sub de g1')

      await userEvent.click(screen.getByRole('button', { name: /Transportes/ }))

      expect(await screen.findByText('Sub de g2')).toBeInTheDocument()
      expect(screen.queryByText('Sub de g1')).not.toBeInTheDocument()
    })

    it('trocar de direcção fecha qualquer grupo aberto', async () => {
      servidorMsw.use(
        http.get('/api/resumo', () =>
          HttpResponse.json({
            ...RESUMO,
            categorias_entradas: [
              grupo({ grupo_id: 'e1', nome: 'Salário', valor: '1700.00', percentagem: 100 }),
            ],
            categorias_saidas: [GRUPO_A],
          }),
        ),
        mockDetalhe([]),
      )
      montar()
      await screen.findByText('Alimentação')
      await userEvent.click(screen.getByRole('button', { name: /Alimentação/ }))
      await screen.findByText('Sem detalhe este mês.')

      await userEvent.click(screen.getByRole('button', { name: 'Entradas' }))

      expect(screen.queryByText('Sem detalhe este mês.')).not.toBeInTheDocument()
    })

    it('"Ver menos" fecha um grupo aberto que a lista recolhida deixa de mostrar', async () => {
      // 6 grupos: o 6º só aparece depois de "Ver mais" — se ficasse
      // "aberto" em memória ao recolher de novo, reapareceria já
      // expandido ao clicar "Ver mais" outra vez.
      const seisGrupos = Array.from({ length: 6 }, (_, indice) =>
        grupo({
          grupo_id: `s${indice}`,
          nome: `Categoria ${indice + 1}`,
          valor: `${100 - indice * 10}.00`,
          percentagem: 100 - indice * 10,
        }),
      )
      servidorMsw.use(
        http.get('/api/resumo', () => HttpResponse.json({ ...RESUMO, categorias_saidas: seisGrupos })),
        http.get('/api/resumo/categorias/:grupoId', () =>
          HttpResponse.json({ grupo_id: 's5', nome: 'Categoria 6', valor: '50.00', subcategorias: [] }),
        ),
      )
      montar()
      await screen.findByText('Categoria 1')
      await userEvent.click(screen.getByRole('button', { name: 'Ver mais 1' }))
      await userEvent.click(screen.getByRole('button', { name: /Categoria 6/ }))
      await screen.findByText('Sem detalhe este mês.')

      await userEvent.click(screen.getByRole('button', { name: 'Ver menos' }))
      expect(screen.queryByText('Categoria 6')).not.toBeInTheDocument()

      await userEvent.click(screen.getByRole('button', { name: 'Ver mais 1' }))

      expect(await screen.findByRole('button', { name: /Categoria 6/ })).toHaveAttribute(
        'aria-expanded',
        'false',
      )
      expect(screen.queryByText('Sem detalhe este mês.')).not.toBeInTheDocument()
    })

    it('sem subcategorias no mês, mostra um estado vazio', async () => {
      servidorMsw.use(
        http.get('/api/resumo', () => HttpResponse.json({ ...RESUMO, categorias_saidas: [GRUPO_A] })),
        mockDetalhe([]),
      )
      montar()
      await screen.findByText('Alimentação')

      await userEvent.click(screen.getByRole('button', { name: /Alimentação/ }))

      expect(await screen.findByText('Sem detalhe este mês.')).toBeInTheDocument()
    })

    it('mostra um aviso se o pedido do detalhe falhar', async () => {
      servidorMsw.use(
        http.get('/api/resumo', () => HttpResponse.json({ ...RESUMO, categorias_saidas: [GRUPO_A] })),
        http.get('/api/resumo/categorias/:grupoId', () =>
          HttpResponse.json({ detail: 'Falha.' }, { status: 500 }),
        ),
      )
      montar()
      await screen.findByText('Alimentação')

      await userEvent.click(screen.getByRole('button', { name: /Alimentação/ }))

      expect(await screen.findByText('Não foi possível carregar.')).toBeInTheDocument()
    })

    it('reabrir depois de o pedido falhar tenta outra vez, não fica preso em erro', async () => {
      let tentativas = 0
      servidorMsw.use(
        http.get('/api/resumo', () => HttpResponse.json({ ...RESUMO, categorias_saidas: [GRUPO_A] })),
        http.get('/api/resumo/categorias/:grupoId', () => {
          tentativas += 1
          if (tentativas === 1) {
            return HttpResponse.json({ detail: 'Falha.' }, { status: 500 })
          }
          return HttpResponse.json({ grupo_id: 'g1', nome: 'Alimentação', valor: '-320.00', subcategorias: [] })
        }),
      )
      montar()
      await screen.findByText('Alimentação')
      const botao = () => screen.getByRole('button', { name: /Alimentação/ })

      await userEvent.click(botao())
      await screen.findByText('Não foi possível carregar.')
      await userEvent.click(botao())
      await userEvent.click(botao())

      expect(await screen.findByText('Sem detalhe este mês.')).toBeInTheDocument()
      expect(tentativas).toBe(2)
    })
  })

  it('mostra o esqueleto enquanto o pedido está em curso', async () => {
    servidorMsw.use(
      http.get('/api/resumo', async () => {
        await delay(50)
        return HttpResponse.json(RESUMO)
      }),
    )

    montar()

    expect(await screen.findByRole('status', { name: 'A carregar o resumo' })).toBeInTheDocument()
    expect(await screen.findByText('Saldo total')).toBeInTheDocument()
  })

  it('se o pedido falhar, mostra uma mensagem de erro', async () => {
    servidorMsw.use(
      http.get('/api/resumo', () =>
        HttpResponse.json({ detail: 'Falha de rede.' }, { status: 500 }),
      ),
    )

    montar()

    expect(await screen.findByRole('alert')).toHaveTextContent('Falha de rede.')
  })
})
