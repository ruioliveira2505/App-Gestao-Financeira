/*
 * TESTES DA PÁGINA INÍCIO
 * =======================
 *
 * Monta a página dentro de um AuthProvider real (autenticado por
 * GET /auth/me, tal como ContaDetalhe.test.tsx) e mocka GET /resumo.
 * Cobre: a ausência de qualquer título de página (por agora — ver a nota
 * "DESENHO DELIBERADAMENTE DIFERENTE" em Inicio.tsx); o saldo total e o
 * líquido, formatados na moeda principal; o mês mostrado no cabeçalho da
 * secção; o cartão de categorias com o alternador "+/−" (aria-label
 * "Entradas"/"Saídas" — o texto visível é só "+"/"−", ver a nota "NONA
 * FATIA" em Inicio.tsx; "Saídas" activo por omissão, a troca ao clicar,
 * cada um com a sua lista de categorias); o estado vazio de uma direcção
 * sem categorias; o esqueleto enquanto o pedido está em curso; e a falha
 * do pedido. Sem "Ver mais"/"Ver menos" nem acordeão de subcategoria —
 * saíram nesta fatia (ver a mesma nota) — por isso não há testes deles
 * aqui; `GrupoDetalhe`/`obterDetalheGrupo` (em src/lib/resumo.ts)
 * continuam a existir e a ser testados no backend, só não são chamados
 * por esta página.
 *
 * E o filtro global de contas (FiltroContas, em componentes/
 * FiltroContas.tsx): invisível com 0 ou 1 conta; com várias, escolher
 * uma seleção pede de novo GET /resumo com "contas" no URL, mostra o
 * esqueleto entretanto (a própria lista de categorias muda por baixo).
 *
 * E o filtro de período (SeletorPeriodo, em componentes/
 * SeletorPeriodo.tsx), numa linha própria logo a seguir ao Saldo Total —
 * a mesma lógica de ListaDatas em FiltroMovimentos.tsx (mostrador, "Mês
 * específico"/"Data personalizada"), começando sempre em "Mês
 * específico" já preenchido com o mês em vista: escolher um mês, ou
 * preencher "De"/"Até", pede de novo GET /resumo com "de"/"ate" no URL e
 * troca o título.
 *
 * O filtro de categoria/subcategoria (FiltroCategoriasResumo) existe
 * como componente e como parâmetros de GET /resumo, mas não está
 * montado nesta página por agora (ver a nota "SÉTIMA FATIA" em
 * Inicio.tsx) — por isso não há testes de integração dele aqui (tem os
 * seus próprios, em FiltroCategoriasResumo.test.tsx).
 *
 * Cobre também: com mais categorias do que LIMITE_CATEGORIAS, só as 4
 * maiores aparecem na lista e a barra empilhada ganha um 5.º segmento
 * ("outras", com a largura do que ficou de fora); com 4 ou menos, esse
 * segmento não aparece; e que o título "Categorias" é um link que leva
 * sempre "de"/"ate" (e "contas", quando há uma selecção) — a mesma
 * classe de bug que já aconteceu uma vez nesta fatia (o "‹ Categorias"
 * de CategoriaResumoDetalhe.tsx, que perdia o querystring ao voltar).
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { delay, http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

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

function conta(overrides: Partial<{ id: string; nome: string; banco: string | null }> = {}) {
  return {
    id: 'c1',
    nome: 'Conta',
    banco: null,
    tipo: null,
    moeda: 'USD',
    data_ancora: '2020-01-01',
    saldo_ancora: '0.00',
    saldo: '0.00',
    saldo_convertido: '0.00',
    created_at: '2020-01-01T00:00:00Z',
    updated_at: '2020-01-01T00:00:00Z',
    ...overrides,
  }
}

// "contas" é um parâmetro de montar() (não um servidorMsw.use() à parte,
// chamado pelo próprio teste) porque o MSW resolve pedidos pelo handler
// registado MAIS RECENTEMENTE — um servidorMsw.use() do teste, chamado
// ANTES de montar(), perderia sempre para o handler por omissão que
// montar() registaria a seguir. Por omissão, [] — o FiltroContas fica
// invisível (menos de 2 contas) e não interfere com os testes que não
// são sobre ele.
function montar({ contas = [] as ReturnType<typeof conta>[] } = {}) {
  servidorMsw.use(http.get('/api/auth/me', () => HttpResponse.json(UTILIZADOR)))
  servidorMsw.use(http.get('/api/contas', () => HttpResponse.json(contas)))
  // <MemoryRouter>: o título "Categorias" é agora um <Link> para
  // "/resumo/categorias" (ver a nota "DÉCIMA TERCEIRA FATIA" em
  // Inicio.tsx) — precisa de um contexto de router para renderizar, tal
  // como em ContaDetalhe.test.tsx. O destino é só um marcador (esta
  // página não testa a navegação em si, só que o link existe e aponta
  // para o sítio certo).
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<Inicio />} />
          <Route path="/resumo/categorias" element={<p>página de categorias</p>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  )
}

/** O valor ao lado de um rótulo da linha Entradas/Saídas/Líquido (ver
 *  ".resumoFluxo" em Inicio.tsx) — rótulo e valor são dois <span>
 *  irmãos, por isso já chega encontrar o rótulo, por texto, para
 *  navegar até ao valor, sem depender de nenhuma classe CSS. Filtra-se
 *  por "<span>" por segurança — "Entradas"/"Saídas" são também o NOME
 *  ACESSÍVEL (aria-label) dos botões "+"/"−" do cartão de categorias,
 *  ver a nota "NONA FATIA" em Inicio.tsx, mas esses não têm esse TEXTO
 *  visível, por isso "getAllByText" nunca os encontra de qualquer forma. */
function valorAoLadoDoRotulo(rotulo: string): HTMLElement {
  const rotulos = screen.getAllByText(rotulo).filter((elemento) => elemento.tagName === 'SPAN')
  if (rotulos.length !== 1) {
    throw new Error(
      `Esperava um único rótulo "${rotulo}" (span); encontrei ${rotulos.length}.`,
    )
  }
  const elemento = rotulos[0].nextElementSibling
  if (!(elemento instanceof HTMLElement)) {
    throw new Error(`Não encontrei nenhum valor ao lado do rótulo "${rotulo}".`)
  }
  return elemento
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
    expect(valorAoLadoDoRotulo('Líquido')).toHaveTextContent(/1.?200,00 ?US\$/)
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
    await screen.findByText('Saldo total')

    // A coluna "Saídas" (mesma linha do Líquido — ver ".resumoFluxo" em
    // Inicio.tsx) usa a mesma classe semântica ".negativo" (cada
    // elemento traz também a sua própria classe estrutural —
    // ".resumoValor" — por isso comparam-se as classes por conteúdo, não
    // por igualdade exacta). SEM "-": o sinal é redundante com a cor
    // (ver formatarSemSinal, em Inicio.tsx) — só "Líquido" pode ser
    // positivo ou negativo consoante o mês, por isso mantém sempre o
    // sinal.
    const liquido = valorAoLadoDoRotulo('Líquido')
    const totalSaidas = valorAoLadoDoRotulo('Saídas')
    expect(liquido).toHaveTextContent(/-300,00 ?US\$/)
    expect(liquido.className).toMatch(/negativo/)
    expect(totalSaidas.className).toMatch(/negativo/)
  })

  describe('cartão de categorias — alternador "+/−"', () => {
    it('"Saídas" está activo por omissão, com a sua lista de categorias', async () => {
      servidorMsw.use(
        http.get('/api/resumo', () =>
          HttpResponse.json({
            ...RESUMO,
            categorias_saidas: [grupo({ grupo_id: 's1', nome: 'Alimentação', valor: '-300.00', percentagem: 60 })],
          }),
        ),
      )

      montar()

      // O nome acessível dos botões é "Entradas"/"Saídas" (aria-label) —
      // o texto visível é só "+"/"−", ver a nota "NONA FATIA" em
      // Inicio.tsx.
      expect(await screen.findByRole('button', { name: 'Saídas' })).toHaveAttribute(
        'aria-pressed',
        'true',
      )
      expect(screen.getByRole('button', { name: 'Entradas' })).toHaveAttribute(
        'aria-pressed',
        'false',
      )
      // Sem "-": dentro de "Saídas" já activo, o sinal é redundante (ver
      // formatarSemSinal, em Inicio.tsx).
      expect(screen.getByText(/300,00 ?US\$/)).toBeInTheDocument()
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

      // Nem a coluna "Saídas" da linha de resumo, nem o valor da
      // categoria — nenhum "-" em lado nenhum desta página (as duas
      // mostram o mesmo valor: a categoria única vale o total inteiro).
      expect(screen.queryByText(/-500,00/)).not.toBeInTheDocument()
      expect(screen.getAllByText(/500,00 ?US\$/)).toHaveLength(2)
    })

    it('clicar em "Entradas" troca a lista de categorias mostrada', async () => {
      servidorMsw.use(
        http.get('/api/resumo', () =>
          HttpResponse.json({
            ...RESUMO,
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

    it('com mais categorias do que LIMITE_CATEGORIAS, só as 4 maiores aparecem na lista, e a barra ganha um segmento "outras"', async () => {
      servidorMsw.use(
        http.get('/api/resumo', () =>
          HttpResponse.json({
            ...RESUMO,
            categorias_saidas: [
              grupo({ grupo_id: 's1', nome: 'Habitação', valor: '-300.00', percentagem: 30 }),
              grupo({ grupo_id: 's2', nome: 'Alimentação', valor: '-250.00', percentagem: 25 }),
              grupo({ grupo_id: 's3', nome: 'Transportes', valor: '-200.00', percentagem: 20 }),
              grupo({ grupo_id: 's4', nome: 'Lazer', valor: '-150.00', percentagem: 15 }),
              grupo({ grupo_id: 's5', nome: 'Saúde', valor: '-100.00', percentagem: 10 }),
            ],
          }),
        ),
      )

      const { container } = montar()
      await screen.findByText('Habitação')

      // Só as 4 maiores (LIMITE_CATEGORIAS) — a 5.ª fica de fora da lista.
      expect(screen.getByText('Alimentação')).toBeInTheDocument()
      expect(screen.getByText('Transportes')).toBeInTheDocument()
      expect(screen.getByText('Lazer')).toBeInTheDocument()
      expect(screen.queryByText('Saúde')).not.toBeInTheDocument()

      // A barra empilhada (única "div[aria-hidden]" desta página — ver a
      // nota "aria-hidden" em BarraEmpilhada, Inicio.tsx) ganha um 5.º
      // segmento, "outras", com a largura do que ficou de fora: 100 -
      // (30+25+20+15) = 10%.
      const barra = container.querySelector('div[aria-hidden="true"]')
      expect(barra?.children).toHaveLength(5)
      const segmentoOutras = barra?.children[4] as HTMLElement
      expect(segmentoOutras.style.width).toBe('10%')
    })

    it('com 4 categorias ou menos (nada escondido), a barra NÃO ganha um segmento "outras"', async () => {
      servidorMsw.use(
        http.get('/api/resumo', () =>
          HttpResponse.json({
            ...RESUMO,
            categorias_saidas: [
              grupo({ grupo_id: 's1', nome: 'Habitação', valor: '-500.00', percentagem: 50 }),
              grupo({ grupo_id: 's2', nome: 'Alimentação', valor: '-300.00', percentagem: 30 }),
              grupo({ grupo_id: 's3', nome: 'Transportes', valor: '-200.00', percentagem: 20 }),
            ],
          }),
        ),
      )

      const { container } = montar()
      await screen.findByText('Habitação')

      const barra = container.querySelector('div[aria-hidden="true"]')
      expect(barra?.children).toHaveLength(3)
    })
  })

  it('o título "Categorias" é um link que leva o período e as contas seleccionadas', async () => {
    servidorMsw.use(http.get('/api/resumo', () => HttpResponse.json(RESUMO)))

    montar()
    await screen.findByText('Saldo total')

    // "RESUMO.periodo_inicio"/"periodo_fim" resolvidos por esta própria
    // página — o mesmo padrão de bug do "‹ Categorias" em
    // CategoriaResumoDetalhe.tsx (querystring perdido ao navegar):
    // este link é a ORIGEM de "de"/"ate" para toda a navegação seguinte,
    // por isso tem de os levar sempre, mesmo sem nenhuma conta
    // seleccionada (0/1 contas — "contas" fica de fora do querystring,
    // ver a nota "linkCategorias" em Inicio.tsx).
    expect(screen.getByRole('link', { name: /Categorias/ })).toHaveAttribute(
      'href',
      '/resumo/categorias?de=2026-09-01&ate=2026-09-18',
    )
  })

  describe('filtro global de contas', () => {
    it('não aparece com menos de duas contas', async () => {
      servidorMsw.use(http.get('/api/resumo', () => HttpResponse.json(RESUMO)))

      montar({ contas: [conta()] })

      await screen.findByText('Saldo total')
      expect(screen.queryByRole('button', { name: /Contas/ })).not.toBeInTheDocument()
    })

    it('aparece com duas ou mais contas, "Todas" por omissão', async () => {
      servidorMsw.use(http.get('/api/resumo', () => HttpResponse.json(RESUMO)))

      montar({ contas: [conta({ id: 'c1', nome: 'Conta A' }), conta({ id: 'c2', nome: 'Conta B' })] })

      expect(await screen.findByRole('button', { name: 'Contas: Todas' })).toBeInTheDocument()
    })

    it('escolher uma conta pede de novo o resumo com "contas" no URL, e mostra o esqueleto entretanto', async () => {
      let ultimoPedidoContas: string | null = null
      servidorMsw.use(
        http.get('/api/resumo', async ({ request }) => {
          const url = new URL(request.url)
          ultimoPedidoContas = url.searchParams.get('contas')
          // Um pequeno atraso na segunda chamada dá tempo de observar o
          // esqueleto a reaparecer antes dos novos números.
          if (ultimoPedidoContas) await delay(20)
          return HttpResponse.json(RESUMO)
        }),
      )
      montar({ contas: [conta({ id: 'c1', nome: 'Conta A' }), conta({ id: 'c2', nome: 'Conta B' })] })
      await screen.findByRole('button', { name: 'Contas: Todas' })

      await userEvent.click(screen.getByRole('button', { name: 'Contas: Todas' }))
      await userEvent.click(await screen.findByRole('button', { name: 'Conta A' }))

      expect(await screen.findByRole('status', { name: 'A carregar o resumo' })).toBeInTheDocument()
      await screen.findByRole('button', { name: 'Contas: Conta A' })
      expect(ultimoPedidoContas).toBe('c1')
    })

    it('escolher uma conta muda a lista de categorias mostrada', async () => {
      let ultimoPedidoContas: string | null = null
      servidorMsw.use(
        http.get('/api/resumo', ({ request }) => {
          const url = new URL(request.url)
          ultimoPedidoContas = url.searchParams.get('contas')
          return HttpResponse.json({
            ...RESUMO,
            categorias_saidas: ultimoPedidoContas
              ? [grupo({ grupo_id: 's2', nome: 'Transporte', valor: '-80.00', percentagem: 100 })]
              : [grupo({ grupo_id: 's1', nome: 'Alimentação', valor: '-320.00', percentagem: 100 })],
          })
        }),
      )
      montar({ contas: [conta({ id: 'c1', nome: 'Conta A' }), conta({ id: 'c2', nome: 'Conta B' })] })
      await screen.findByText('Alimentação')

      await userEvent.click(screen.getByRole('button', { name: 'Contas: Todas' }))
      await userEvent.click(await screen.findByRole('button', { name: 'Conta A' }))

      expect(await screen.findByText('Transporte')).toBeInTheDocument()
      expect(screen.queryByText('Alimentação')).not.toBeInTheDocument()
    })
  })

  describe('filtro de período', () => {
    it('o campo de mês abre já preenchido com o mês em curso', async () => {
      servidorMsw.use(http.get('/api/resumo', () => HttpResponse.json(RESUMO)))
      montar()
      await screen.findByRole('button', { name: 'Setembro 2026' })

      await userEvent.click(screen.getByRole('button', { name: 'Setembro 2026' }))

      // RESUMO.periodo_inicio é "2026-09-01" (dia 1) e periodo_fim
      // ("2026-09-18") cai no MESMO mês — mesEmVista (SeletorPeriodo.tsx)
      // reconhece isto como "o mês em vista", mesmo sem chegar ao último
      // dia. O campo de mês já mostra "2026-09", não vazio.
      expect(await screen.findByLabelText('Mês')).toHaveValue('2026-09')
    })

    it('escolher outro mês pede de novo o resumo com "de"/"ate" no URL, e mostra esse mês', async () => {
      let ultimoDe: string | null = null
      let ultimoAte: string | null = null
      servidorMsw.use(
        http.get('/api/resumo', ({ request }) => {
          const url = new URL(request.url)
          ultimoDe = url.searchParams.get('de')
          ultimoAte = url.searchParams.get('ate')
          if (ultimoDe) {
            return HttpResponse.json({
              ...RESUMO,
              periodo_inicio: '2026-08-01',
              periodo_fim: '2026-08-31',
            })
          }
          return HttpResponse.json(RESUMO)
        }),
      )
      montar()
      await screen.findByRole('button', { name: 'Setembro 2026' })

      await userEvent.click(screen.getByRole('button', { name: 'Setembro 2026' }))
      fireEvent.change(await screen.findByLabelText('Mês'), { target: { value: '2026-08' } })

      expect(await screen.findByRole('button', { name: 'Agosto 2026' })).toBeInTheDocument()
      // intervaloDoMes (src/lib/filtrosMovimentos.ts) resolve sempre até
      // ao ÚLTIMO DIA do mês escolhido.
      expect(ultimoDe).toBe('2026-08-01')
      expect(ultimoAte).toBe('2026-08-31')
    })

    it('preencher "De" e "Até" pede de novo o resumo com esse intervalo, mesmo não sendo um mês inteiro', async () => {
      // Ecoa "de"/"ate" tal como recebidos — para "resumo.periodo_inicio"/
      // "periodo_fim" (as props de/ate de SeletorPeriodo) reflectirem
      // sempre o ÚLTIMO pedido, tal como o backend real faria.
      let ultimoDe: string | null = null
      let ultimoAte: string | null = null
      servidorMsw.use(
        http.get('/api/resumo', ({ request }) => {
          const url = new URL(request.url)
          ultimoDe = url.searchParams.get('de')
          ultimoAte = url.searchParams.get('ate')
          return HttpResponse.json({
            ...RESUMO,
            periodo_inicio: ultimoDe ?? RESUMO.periodo_inicio,
            periodo_fim: ultimoAte ?? RESUMO.periodo_fim,
          })
        }),
      )
      montar()
      await screen.findByRole('button', { name: 'Setembro 2026' })

      await userEvent.click(screen.getByRole('button', { name: 'Setembro 2026' }))
      await userEvent.click(await screen.findByRole('button', { name: 'Data personalizada' }))
      fireEvent.change(await screen.findByLabelText('De'), { target: { value: '2026-08-10' } })
      // Espera que este primeiro pedido (ainda com o "Até" antigo)
      // resolva antes de editar "Até" — tal como um utilizador real, que
      // não preenche os dois campos no mesmo instante; sem esperar, o
      // segundo campo aplicaria com um "de" ainda desactualizado (o
      // pedido "aplica ao vivo", tal como em Movimentos — ver a nota no
      // topo de SeletorPeriodo.tsx).
      await waitFor(() => expect(ultimoDe).toBe('2026-08-10'))
      fireEvent.change(screen.getByLabelText('Até'), { target: { value: '2026-08-20' } })

      // "10 ago – 20 ago 2026" — não é um mês inteiro, por isso o título
      // usa o formato de intervalo, não um nome de mês.
      expect(await screen.findByRole('button', { name: '10 ago – 20 ago 2026' })).toBeInTheDocument()
      expect(ultimoDe).toBe('2026-08-10')
      expect(ultimoAte).toBe('2026-08-20')
    })

    it('mudar o mês muda a lista de categorias mostrada', async () => {
      let ultimoDe: string | null = null
      servidorMsw.use(
        http.get('/api/resumo', ({ request }) => {
          ultimoDe = new URL(request.url).searchParams.get('de')
          return HttpResponse.json({
            ...RESUMO,
            categorias_saidas: ultimoDe
              ? [grupo({ grupo_id: 's2', nome: 'Transporte', valor: '-80.00', percentagem: 100 })]
              : [grupo({ grupo_id: 's1', nome: 'Alimentação', valor: '-320.00', percentagem: 100 })],
          })
        }),
      )
      montar()
      await screen.findByText('Alimentação')

      await userEvent.click(screen.getByRole('button', { name: 'Setembro 2026' }))
      fireEvent.change(await screen.findByLabelText('Mês'), { target: { value: '2026-08' } })

      expect(await screen.findByText('Transporte')).toBeInTheDocument()
      expect(screen.queryByText('Alimentação')).not.toBeInTheDocument()
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
