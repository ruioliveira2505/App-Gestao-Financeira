/*
 * TESTES DA PÁGINA MOVIMENTOS (a lista)
 * =====================================
 *
 * O endpoint /api/movimentos é agora paginado e filtrado NO SERVIDOR (ver
 * a nota PAGINAÇÃO POR CURSOR em Movimentos.tsx e em
 * app/routers/movimentos.py, no backend) — por isso o handler de MSW
 * usado pela maioria destes testes (handlerMovimentos, mais abaixo) faz
 * ele próprio essa filtragem/paginação sobre a lista completa recebida,
 * em vez de a devolver tal e qual: sem isso, os testes que verificam um
 * filtro (tipo, contas, categorias, datas, pesquisa) veriam sempre a
 * lista inteira, porque o filtro real acontece no lado do pedido, não no
 * componente.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { delay, http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'

import { simularEntradaNoEcra } from '../test/setup'
import { servidorMsw } from '../test/servidor-msw'
import { Movimentos } from './Movimentos'

// "Hoje"/"Ontem" (os rótulos de grupo) dependem da data real do
// teste — por isso calculados aqui, não escritos à mão, para o teste
// nunca desactualizar por si só.
function isoData(deslocamentoDias = 0): string {
  const data = new Date()
  data.setDate(data.getDate() + deslocamentoDias)
  const ano = data.getFullYear()
  const mes = String(data.getMonth() + 1).padStart(2, '0')
  const dia = String(data.getDate()).padStart(2, '0')
  return `${ano}-${mes}-${dia}`
}

function conta(sobrepor: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    nome: 'Conta X',
    banco: 'BPI',
    tipo: 'Conta corrente',
    moeda: 'EUR',
    data_ancora: '2026-01-01',
    saldo_ancora: '1000.00',
    saldo: '1000.00',
    saldo_convertido: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...sobrepor,
  }
}

function movimento(sobrepor: Record<string, unknown> = {}) {
  return {
    id: 'm1',
    conta_id: 'c1',
    categoria_id: 'cat1',
    data: isoData(),
    descricao: 'Compras',
    valor: '-50.00',
    created_at: '2026-01-01T10:00:00Z',
    updated_at: '2026-01-01T10:00:00Z',
    // null por omissão — só os testes sobre o saldo remanescente o
    // definem; o resto não quer essa linha extra na descrição da linha.
    saldo_apos: null,
    ...sobrepor,
  }
}

// --- Filtragem/paginação do handler de /api/movimentos, ao estilo do
// backend (ver a nota no topo do ficheiro) ---

// Os campos de um Movimento/Conta que a filtragem olha — o resto de cada
// objeto (Record<string, unknown>, tal como os fixtures acima) passa por
// aqui sem tipo próprio, tal como já acontecia antes desta fatia.
type CampoTexto = string

function campo(objeto: Record<string, unknown>, nome: string): CampoTexto {
  return objeto[nome] as CampoTexto
}

/** A mesma chave de ordenação/desempate do backend (data, created_at, id,
 *  todos descendentes) — ver a nota PAGINAÇÃO POR CURSOR em
 *  app/routers/movimentos.py. */
function compararDesc(a: Record<string, unknown>, b: Record<string, unknown>): number {
  return (
    campo(b, 'data').localeCompare(campo(a, 'data')) ||
    campo(b, 'created_at').localeCompare(campo(a, 'created_at')) ||
    campo(b, 'id').localeCompare(campo(a, 'id'))
  )
}

/** Aplica a um pedido GET /movimentos os mesmos filtros, ordem e
 *  paginação por cursor que o backend real aplica (ver
 *  app/routers/movimentos.py) — para os testes que dependem de um filtro
 *  ou da paginação continuarem a exercer o comportamento real, e não uma
 *  lista sempre completa e sempre igual. */
function filtrarEPaginar(
  url: string,
  contas: Record<string, unknown>[],
  movimentos: Record<string, unknown>[],
): Record<string, unknown>[] {
  const parametros = new URL(url, 'http://localhost').searchParams
  let lista = [...movimentos]

  const contaId = parametros.get('conta_id')
  if (contaId) lista = lista.filter((m) => campo(m, 'conta_id') === contaId)

  const contasCsv = parametros.get('contas')
  if (contasCsv) {
    const ids = new Set(contasCsv.split(','))
    lista = lista.filter((m) => ids.has(campo(m, 'conta_id')))
  }

  const categoriasCsv = parametros.get('categorias')
  if (categoriasCsv) {
    const ids = new Set(categoriasCsv.split(','))
    lista = lista.filter((m) => ids.has(campo(m, 'categoria_id')))
  }

  const tipo = parametros.get('tipo')
  if (tipo === 'entrada') lista = lista.filter((m) => Number(campo(m, 'valor')) > 0)
  if (tipo === 'saida') lista = lista.filter((m) => Number(campo(m, 'valor')) < 0)

  const de = parametros.get('de')
  if (de) lista = lista.filter((m) => campo(m, 'data') >= de)
  const ate = parametros.get('ate')
  if (ate) lista = lista.filter((m) => campo(m, 'data') <= ate)

  const pesquisa = parametros.get('pesquisa')
  if (pesquisa) {
    const alvo = pesquisa.toLowerCase()
    const contaPorId = new Map(contas.map((c) => [campo(c, 'id'), c]))
    lista = lista.filter((m) => {
      const conta = contaPorId.get(campo(m, 'conta_id'))
      const nomeConta = conta ? campo(conta, 'nome') : ''
      return (
        campo(m, 'descricao').toLowerCase().includes(alvo) ||
        nomeConta.toLowerCase().includes(alvo)
      )
    })
  }

  lista.sort(compararDesc)

  const antesData = parametros.get('antes_data')
  const antesCriadoEm = parametros.get('antes_criado_em')
  const antesId = parametros.get('antes_id')
  if (antesData && antesCriadoEm && antesId) {
    lista = lista.filter((m) => {
      const data = campo(m, 'data')
      const criadoEm = campo(m, 'created_at')
      const id = campo(m, 'id')
      if (data !== antesData) return data < antesData
      if (criadoEm !== antesCriadoEm) return criadoEm < antesCriadoEm
      return id < antesId
    })
  }

  const limite = Number(parametros.get('limite') ?? '30')
  return lista.slice(0, limite)
}

/** O handler de GET /movimentos usado por usar(...) — filtra e pagina a
 *  lista completa a cada pedido, tal como o backend real. */
function handlerMovimentos(contas: Record<string, unknown>[], movimentos: Record<string, unknown>[]) {
  return http.get('/api/movimentos', ({ request }) =>
    HttpResponse.json(filtrarEPaginar(request.url, contas, movimentos)),
  )
}

// Árvore com dois grupos de saída (o segundo com duas subcategorias, para
// testar o toque no cabeçalho do grupo) e um de entrada — dá para testar o
// agrupamento, a multi-escolha e a restrição por Tipo do filtro de
// Categorias, além de dar à página de onde tirar a cor do ponto de cada
// linha (a cor vem do nome do GRUPO — ver PontoCategoria.tsx).
const ARVORE = [
  {
    id: 'g1',
    nome: 'Alimentação',
    direcao: 'saida',
    subcategorias: [{ id: 'cat1', nome: 'Supermercado', protegida: false }],
  },
  {
    id: 'g2',
    nome: 'Transportes',
    direcao: 'saida',
    subcategorias: [
      { id: 'cat2', nome: 'Combustível', protegida: false },
      { id: 'cat3', nome: 'Portagens', protegida: false },
    ],
  },
  {
    id: 'g3',
    nome: 'Trabalho',
    direcao: 'entrada',
    subcategorias: [{ id: 'cat4', nome: 'Salário', protegida: false }],
  },
]

function usar(contas: Record<string, unknown>[], movimentos: Record<string, unknown>[]) {
  servidorMsw.use(
    http.get('/api/contas', () => HttpResponse.json(contas)),
    handlerMovimentos(contas, movimentos),
  )
}

function montar(entrada = '/movimentos') {
  // Registado aqui, não em "usar": toda a montagem da página precisa da
  // árvore de categorias, tal como precisa de contas e movimentos.
  servidorMsw.use(http.get('/api/categorias/arvore', () => HttpResponse.json(ARVORE)))
  return render(
    <MemoryRouter initialEntries={[entrada]}>
      <Movimentos />
    </MemoryRouter>,
  )
}

/** Abre a folha de filtros (esperando primeiro que a lista carregue, já
 *  que o botão só aparece com movimentos) e devolve o "dialog". "Filtros"
 *  e "Selecionar" são dois botões directos, unidos numa pílula (ver a
 *  nota ESTRUTURA, no topo de Movimentos.tsx) — o rótulo de "Filtros" é
 *  "Filtros" ou "Filtros (ativos)" consoante haja filtros, daí a
 *  expressão regular. */
async function abrirFiltros() {
  await userEvent.click(await screen.findByRole('button', { name: /^Filtros/ }))
  return screen.getByRole('dialog', { name: 'Filtros' })
}

/** Fecha a folha de filtros e espera que desmonte (tem animação de saída),
 *  para as queries seguintes só verem a lista por trás. */
async function fecharFiltros() {
  await userEvent.click(screen.getByRole('button', { name: 'Fechar' }))
  await waitFor(() =>
    expect(screen.queryByRole('dialog', { name: 'Filtros' })).not.toBeInTheDocument(),
  )
}

/** A partir da folha de filtros, abre o seletor de um filtro (uma folha
 *  que entra da direita) e devolve o "dialog" dele. O nome acessível da
 *  linha é "Contas: Todas", "Tipo: Saídas", etc. */
async function abrirSeletor(titulo: 'Contas' | 'Tipo' | 'Categorias' | 'Datas') {
  await userEvent.click(screen.getByRole('button', { name: new RegExp(`^${titulo}:`) }))
  return screen.findByRole('dialog', { name: titulo })
}

/** Fecha um seletor de filtro (o "‹ Voltar" do cabeçalho) e espera que
 *  desmonte, deixando a folha de filtros à vista outra vez. */
async function fecharSeletor(titulo: 'Contas' | 'Tipo' | 'Categorias' | 'Datas') {
  await userEvent.click(screen.getByRole('button', { name: 'Voltar' }))
  await waitFor(() =>
    expect(screen.queryByRole('dialog', { name: titulo })).not.toBeInTheDocument(),
  )
}

/** Simula o "fechar" da folha "Novo movimento": um botão que recua no
 *  histórico (navigate(-1)) — exatamente o que MovimentoNovo faz ao sair,
 *  com ou sem sucesso. Usado só para testar que voltar a /movimentos
 *  actualiza a lista, sem montar a folha toda. */
function BotaoRecuar() {
  const navegar = useNavigate()
  return (
    <button type="button" onClick={() => navegar(-1)}>
      Recuar
    </button>
  )
}

describe('Página Movimentos', () => {
  it('mostra os movimentos, a conta de cada um, e o botão de novo movimento', async () => {
    usar(
      [conta()],
      [
        movimento({ id: 'a', descricao: 'Salário', valor: '1500.00' }),
        movimento({ id: 'b', descricao: 'Renda', valor: '-750.00' }),
      ],
    )

    montar()

    const linhaSalario = await screen.findByRole('link', { name: /Salário/ })
    expect(linhaSalario).toHaveAttribute('href', '/movimentos/a/editar')
    expect(linhaSalario).toHaveTextContent('Conta X')
    expect(linhaSalario).toHaveTextContent(/1.?500,00/)

    const linhaRenda = await screen.findByRole('link', { name: /Renda/ })
    expect(linhaRenda).toHaveAttribute('href', '/movimentos/b/editar')
    expect(linhaRenda).toHaveTextContent(/-.?750,00/)

    // Sem filtro nem pesquisa, o cabeçalho não tem subtítulo (a lista é
    // potencialmente infinita — uma contagem não diria nada de útil).
    const cabecalho = screen.getByRole('heading', { name: 'Movimentos' }).closest('header')
    expect(cabecalho?.querySelector('p')).toBeNull()

    expect(screen.getByRole('link', { name: 'Novo movimento' })).toHaveAttribute(
      'href',
      '/movimentos/novo',
    )
  })

  it('mostra o saldo remanescente da conta por baixo do valor', async () => {
    // "saldo_apos" já vem pronto do backend (ver a nota SALDO REMANESCENTE
    // em app/routers/movimentos.py) — a página só o mostra, não o calcula.
    usar(
      [conta({ saldo_ancora: '1000.00' })],
      [
        movimento({
          id: 'a',
          descricao: 'Salário',
          valor: '1500.00',
          data: isoData(-1),
          created_at: '2026-01-01T09:00:00Z',
          saldo_apos: '2500.00',
        }),
        movimento({
          id: 'b',
          descricao: 'Renda',
          valor: '-750.00',
          data: isoData(),
          created_at: '2026-01-02T09:00:00Z',
          saldo_apos: '1750.00',
        }),
      ],
    )

    montar()

    const linhaRenda = await screen.findByRole('link', { name: /Renda/ })
    expect(linhaRenda).toHaveTextContent(/1.?750,00/)

    const linhaSalario = await screen.findByRole('link', { name: /Salário/ })
    expect(linhaSalario).toHaveTextContent(/2.?500,00/)
  })

  it('filtra a lista pela pesquisa (descrição ou nome da conta), com debounce', async () => {
    // A pesquisa só dispara o pedido 300ms depois de parar de escrever
    // (ver a nota PAGINAÇÃO POR CURSOR/FILTROS em Movimentos.tsx) — daí os
    // "findBy" (que esperam) em vez de "getBy" (que não esperam) a seguir
    // a cada userEvent.type.
    usar(
      [conta({ id: 'c1', nome: 'À ordem' }), conta({ id: 'c2', nome: 'Poupança' })],
      [
        movimento({ id: 'a', conta_id: 'c1', descricao: 'Supermercado' }),
        movimento({ id: 'b', conta_id: 'c2', descricao: 'Transferência' }),
      ],
    )

    montar()
    // "campoPesquisa", não "campo" — esse nome já pertence à função
    // module-level "campo(objeto, nome)" usada pelo mock de filtragem
    // (mais acima), que ficaria encoberta ("shadowed") dentro deste bloco.
    const campoPesquisa = await screen.findByRole('searchbox', { name: 'Procurar movimento' })

    await userEvent.type(campoPesquisa, 'supermercado')
    expect(await screen.findByRole('link', { name: /Supermercado/ })).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: /Transferência/ })).not.toBeInTheDocument(),
    )

    await userEvent.clear(campoPesquisa)
    await userEvent.type(campoPesquisa, 'poupança')
    expect(await screen.findByRole('link', { name: /Transferência/ })).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: /Supermercado/ })).not.toBeInTheDocument(),
    )
  })

  it('mostra uma mensagem quando a pesquisa não encontra nada', async () => {
    usar([conta()], [movimento({ descricao: 'Compras' })])

    montar()
    const campoPesquisa = await screen.findByRole('searchbox', { name: 'Procurar movimento' })
    await userEvent.type(campoPesquisa, 'zzz')

    expect(await screen.findByText(/Nenhum movimento corresponde/)).toBeInTheDocument()
  })

  it('ao limpar a pesquisa, não mostra por instantes a mensagem de "sem movimentos" da conta', async () => {
    // Regressão: o estado "sem resultados" usava a pesquisa TAL COMO
    // ESTÁ ESCRITA, não a já debounced — ao limpar rapidamente o campo,
    // "pesquisa" ficava vazia antes de a resposta a essa mudança chegar,
    // e "itens" continuava vazio (ainda da pesquisa anterior), o que por
    // instantes mostrava "Ainda não tens movimentos" (o estado de conta
    // sem NENHUM movimento) mesmo havendo movimentos de sobra.
    usar([conta()], [movimento({ descricao: 'Compras' })])
    montar()
    const campoPesquisa = await screen.findByRole('searchbox', { name: 'Procurar movimento' })

    await userEvent.type(campoPesquisa, 'zzz')
    expect(await screen.findByText(/Nenhum movimento corresponde/)).toBeInTheDocument()

    await userEvent.clear(campoPesquisa)
    // Ainda dentro dos 300ms de debounce: a mensagem tem de continuar a
    // ser a de "sem resultados de pesquisa" — nunca a de "conta vazia".
    expect(screen.queryByText('Ainda não tens movimentos.')).not.toBeInTheDocument()

    await waitFor(() => expect(screen.getByRole('link', { name: /Compras/ })).toBeInTheDocument())
  })

  it('mostra sempre os movimentos por data descendente, agrupados por dia', async () => {
    // Sem "⋯" nenhum — esta página não tem ordenar/agrupar configurável
    // (ver a explicação no topo de Movimentos.tsx): é sempre esta ordem.
    usar(
      [conta()],
      [
        movimento({ id: 'a', descricao: 'Mais antigo', data: isoData(-1), valor: '-50.00' }),
        movimento({ id: 'b', descricao: 'Mais recente', data: isoData(0), valor: '900.00' }),
      ],
    )

    montar()
    await screen.findByRole('link', { name: /Mais recente/ })

    expect(screen.queryByRole('button', { name: 'Ordenar e agrupar' })).not.toBeInTheDocument()

    const nomes = screen
      .getAllByRole('link', { name: /Mais/ })
      .map((no) => no.textContent ?? '')
    expect(nomes[0]).toMatch(/Mais recente/)
    expect(nomes[1]).toMatch(/Mais antigo/)
  })

  it('agrupa por dia, com "Hoje ·"/"Ontem ·" e a data ao lado', async () => {
    usar(
      [conta()],
      [
        movimento({ id: 'a', descricao: 'De hoje', data: isoData(0) }),
        movimento({ id: 'b', descricao: 'De ontem', data: isoData(-1) }),
      ],
    )

    montar()
    await screen.findByRole('link', { name: /De hoje/ })

    const grupoHoje = screen.getByText(/^Hoje ·/).closest('section') as HTMLElement
    expect(within(grupoHoje).getByRole('link', { name: /De hoje/ })).toBeInTheDocument()

    const grupoOntem = screen.getByText(/^Ontem ·/).closest('section') as HTMLElement
    expect(within(grupoOntem).getByRole('link', { name: /De ontem/ })).toBeInTheDocument()
  })

  it('mostra o esqueleto enquanto os movimentos carregam', async () => {
    servidorMsw.use(
      http.get('/api/contas', () => HttpResponse.json([conta()])),
      http.get('/api/movimentos', async () => {
        await delay()
        return HttpResponse.json([movimento()])
      }),
    )

    montar()

    expect(screen.getByRole('status', { name: 'A carregar movimentos' })).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: /Compras/ })).toBeInTheDocument()
    expect(
      screen.queryByRole('status', { name: 'A carregar movimentos' }),
    ).not.toBeInTheDocument()
  })

  it('sem contas nenhumas, pede para criar uma conta primeiro', async () => {
    usar([], [])

    montar()

    expect(await screen.findByText('Precisas de uma conta primeiro.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Criar conta' })).toHaveAttribute(
      'href',
      '/contas/nova',
    )
  })

  it('com contas mas sem movimentos, mostra o estado vazio de movimentos', async () => {
    usar([conta()], [])

    montar()

    expect(await screen.findByText('Ainda não tens movimentos.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Criar o primeiro' })).toHaveAttribute(
      'href',
      '/movimentos/novo',
    )
  })

  it('actualiza a lista ao voltar a esta rota, sem ser preciso dar refresh', async () => {
    // Simula criar um movimento noutra rota ("/movimentos/novo") e voltar:
    // a segunda vez que a API é chamada já traz o movimento novo.
    let chamada = 0
    servidorMsw.use(
      http.get('/api/contas', () => HttpResponse.json([conta()])),
      http.get('/api/categorias/arvore', () => HttpResponse.json(ARVORE)),
      http.get('/api/movimentos', () => {
        chamada += 1
        return HttpResponse.json(chamada === 1 ? [] : [movimento({ descricao: 'Recém-criado' })])
      }),
    )

    render(
      <MemoryRouter initialEntries={['/movimentos', '/movimentos/novo']} initialIndex={1}>
        <Routes>
          <Route path="/movimentos" element={<Movimentos />} />
          <Route
            path="/movimentos/novo"
            element={
              <>
                <Movimentos />
                <BotaoRecuar />
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
    )

    // Montagem inicial, em "/movimentos/novo": a lista ainda está vazia.
    await screen.findByText('Ainda não tens movimentos.')

    await userEvent.click(screen.getByRole('button', { name: 'Recuar' }))

    // De volta a "/movimentos": a lista foi buscar de novo, sem ação
    // nenhuma do utilizador além de lá chegar.
    expect(await screen.findByRole('link', { name: /Recém-criado/ })).toBeInTheDocument()
  })

  it('filtra por tipo (só saídas), e assinala que há filtros ativos', async () => {
    usar(
      [conta()],
      [
        movimento({ id: 'a', descricao: 'Salário', valor: '1500.00' }),
        movimento({ id: 'b', descricao: 'Renda', valor: '-750.00' }),
      ],
    )
    montar()
    await screen.findByRole('link', { name: /Salário/ })

    // A linha "Tipo" abre o seu seletor (folha que entra da direita).
    await abrirFiltros()
    const seletor = await abrirSeletor('Tipo')
    await userEvent.click(within(seletor).getByRole('button', { name: 'Saídas' }))
    await fecharSeletor('Tipo')
    await fecharFiltros()

    // Só a saída fica; a entrada some.
    expect(await screen.findByRole('link', { name: /Renda/ })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Salário/ })).not.toBeInTheDocument()

    // Não há chips na página nem contagem de resultados no cabeçalho (isso
    // faria a barra de procura "saltar"); o único aviso é o rótulo do "⋯"
    // a mudar.
    expect(
      screen.getByRole('button', { name: 'Filtros (ativos)' }),
    ).toBeInTheDocument()
    const cabecalho = screen.getByRole('heading', { name: 'Movimentos' }).closest('header')
    expect(cabecalho?.querySelector('p')).toBeNull()
  })

  it('filtra por conta (multi-escolha); "Todas" limpa a escolha', async () => {
    usar(
      [conta({ id: 'c1', nome: 'À ordem' }), conta({ id: 'c2', nome: 'Poupança' })],
      [
        movimento({ id: 'a', conta_id: 'c1', descricao: 'Da à ordem' }),
        movimento({ id: 'b', conta_id: 'c2', descricao: 'Da poupança' }),
      ],
    )
    montar()
    await screen.findByRole('link', { name: /Da à ordem/ })

    await abrirFiltros()
    const seletor = await abrirSeletor('Contas')
    await userEvent.click(within(seletor).getByRole('button', { name: 'Poupança' }))
    await fecharSeletor('Contas')
    await fecharFiltros()

    expect(await screen.findByRole('link', { name: /Da poupança/ })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Da à ordem/ })).not.toBeInTheDocument()

    // Reabrindo o seletor: a conta escolhida fica marcada (aria-pressed);
    // "Todas" não.
    await abrirFiltros()
    const seletor2 = await abrirSeletor('Contas')
    expect(within(seletor2).getByRole('button', { name: 'Poupança' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(within(seletor2).getByRole('button', { name: 'Todas' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )

    // "Todas" repõe todas as contas.
    await userEvent.click(within(seletor2).getByRole('button', { name: 'Todas' }))
    await fecharSeletor('Contas')
    await fecharFiltros()
    expect(await screen.findByRole('link', { name: /Da à ordem/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Da poupança/ })).toBeInTheDocument()
  })

  it('marcar todas as contas uma a uma colapsa de volta para "Todas"', async () => {
    usar(
      [conta({ id: 'c1', nome: 'À ordem' }), conta({ id: 'c2', nome: 'Poupança' })],
      [movimento({ id: 'a', conta_id: 'c1', descricao: 'Um' })],
    )
    montar()
    await screen.findByRole('link', { name: /Um/ })

    await abrirFiltros()
    const seletor = await abrirSeletor('Contas')
    await userEvent.click(within(seletor).getByRole('button', { name: 'À ordem' }))
    await userEvent.click(within(seletor).getByRole('button', { name: 'Poupança' }))

    // Todas marcadas = sem filtro: "Todas" acende, as individuais apagam.
    expect(within(seletor).getByRole('button', { name: 'Todas' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(within(seletor).getByRole('button', { name: 'À ordem' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    await fecharSeletor('Contas')
    await fecharFiltros()
    expect(screen.getByRole('button', { name: 'Filtros' })).toBeInTheDocument()
  })

  it('com uma só conta, a linha "Contas" não aparece na folha', async () => {
    usar([conta()], [movimento({ descricao: 'Único' })])
    montar()
    await screen.findByRole('link', { name: /Único/ })

    const folha = await abrirFiltros()
    // Não há linha "Contas"; "Tipo" e "Datas" continuam.
    expect(within(folha).queryByRole('button', { name: /^Contas:/ })).not.toBeInTheDocument()
    expect(within(folha).getByRole('button', { name: /^Tipo:/ })).toBeInTheDocument()
    expect(within(folha).getByRole('button', { name: /^Datas:/ })).toBeInTheDocument()
  })

  it('o seletor de Categorias mostra as subcategorias agrupadas, e filtra por elas', async () => {
    usar(
      [conta()],
      [
        movimento({ id: 'a', categoria_id: 'cat1', descricao: 'Do supermercado' }),
        movimento({ id: 'b', categoria_id: 'cat2', descricao: 'Da bomba de gasolina' }),
      ],
    )
    montar()
    await screen.findByRole('link', { name: /Do supermercado/ })

    await abrirFiltros()
    const seletor = await abrirSeletor('Categorias')
    // Os cabeçalhos de grupo aparecem, e cada subcategoria por baixo do seu.
    expect(within(seletor).getByText('Alimentação')).toBeInTheDocument()
    expect(within(seletor).getByText('Transportes')).toBeInTheDocument()
    await userEvent.click(within(seletor).getByRole('button', { name: 'Supermercado' }))
    await fecharSeletor('Categorias')
    await fecharFiltros()

    expect(await screen.findByRole('link', { name: /Do supermercado/ })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Da bomba de gasolina/ })).not.toBeInTheDocument()
  })

  it('marcar todos os grupos (tocando nos cabeçalhos) colapsa de volta para "Todas"', async () => {
    usar(
      [conta()],
      [movimento({ id: 'a', categoria_id: 'cat1', descricao: 'Do supermercado' })],
    )
    montar()
    await screen.findByRole('link', { name: /Do supermercado/ })

    await abrirFiltros()
    const seletor = await abrirSeletor('Categorias')
    await userEvent.click(within(seletor).getByRole('button', { name: 'Alimentação' }))
    await userEvent.click(within(seletor).getByRole('button', { name: 'Transportes' }))
    await userEvent.click(within(seletor).getByRole('button', { name: 'Trabalho' }))

    expect(within(seletor).getByRole('button', { name: 'Todas' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await fecharSeletor('Categorias')
    await fecharFiltros()
    expect(screen.getByRole('button', { name: 'Filtros' })).toBeInTheDocument()
  })

  it('tocar no cabeçalho de um grupo marca todas as suas subcategorias de uma vez', async () => {
    usar(
      [conta()],
      [
        movimento({ id: 'a', categoria_id: 'cat2', descricao: 'Combustível' }),
        movimento({ id: 'b', categoria_id: 'cat3', descricao: 'Portagens' }),
        movimento({ id: 'c', categoria_id: 'cat1', descricao: 'Supermercado' }),
      ],
    )
    montar()
    await screen.findByRole('link', { name: /Combustível/ })

    await abrirFiltros()
    const seletor = await abrirSeletor('Categorias')
    await userEvent.click(within(seletor).getByRole('button', { name: 'Transportes' }))
    // As duas subcategorias de Transportes ficam marcadas, sem lhes tocar.
    expect(within(seletor).getByRole('button', { name: 'Combustível' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(within(seletor).getByRole('button', { name: 'Portagens' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await fecharSeletor('Categorias')

    // O resumo da linha mostra o nome do grupo, não "2 categorias".
    expect(screen.getByRole('button', { name: /^Categorias: Transportes$/ })).toBeInTheDocument()
    await fecharFiltros()

    expect(await screen.findByRole('link', { name: /Combustível/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Portagens/ })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Supermercado/ })).not.toBeInTheDocument()
  })

  it('definir o Tipo restringe as opções de Categorias, e tira da escolha as que já não batem certo', async () => {
    usar(
      [conta()],
      [
        movimento({ id: 'a', categoria_id: 'cat4', valor: '1500.00', descricao: 'Salário' }),
        movimento({ id: 'b', categoria_id: 'cat1', valor: '-30.00', descricao: 'Supermercado' }),
      ],
    )
    montar()
    await screen.findByRole('link', { name: /Salário/ })

    // Escolhe "Salário" (entrada) em Categorias, com Tipo ainda em "Todos".
    await abrirFiltros()
    const seletorCategorias = await abrirSeletor('Categorias')
    await userEvent.click(within(seletorCategorias).getByRole('button', { name: 'Salário' }))
    await fecharSeletor('Categorias')

    // Muda o Tipo para "Saídas" — só grupos de saída ficam visíveis em
    // Categorias, e "Salário" (que já não bate certo) sai da escolha.
    const seletorTipo = await abrirSeletor('Tipo')
    await userEvent.click(within(seletorTipo).getByRole('button', { name: 'Saídas' }))
    await fecharSeletor('Tipo')

    const seletorCategorias2 = await abrirSeletor('Categorias')
    expect(within(seletorCategorias2).queryByText('Trabalho')).not.toBeInTheDocument()
    expect(within(seletorCategorias2).getByText('Alimentação')).toBeInTheDocument()
    await fecharSeletor('Categorias')
    await fecharFiltros()

    // A lista já só mostra a saída — "Salário" saiu de Categorias, e o
    // Tipo="Saídas" também a excluiria de qualquer forma.
    expect(await screen.findByRole('link', { name: /Supermercado/ })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Salário/ })).not.toBeInTheDocument()
  })

  it('filtra por uma janela de data ("Últimos 90 dias")', async () => {
    usar(
      [conta()],
      [
        movimento({ id: 'a', descricao: 'Recente', data: isoData(-10) }),
        movimento({ id: 'b', descricao: 'Antigo', data: isoData(-200) }),
      ],
    )
    montar()
    await screen.findByRole('link', { name: /Recente/ })

    await abrirFiltros()
    const seletor = await abrirSeletor('Datas')
    await userEvent.click(within(seletor).getByRole('button', { name: 'Últimos 90 dias' }))
    await fecharSeletor('Datas')
    await fecharFiltros()

    expect(await screen.findByRole('link', { name: /Recente/ })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Antigo/ })).not.toBeInTheDocument()

    // Reabrindo o seletor, "Últimos 90 dias" está marcado.
    await abrirFiltros()
    const seletor2 = await abrirSeletor('Datas')
    expect(within(seletor2).getByRole('button', { name: 'Últimos 90 dias' })).toHaveAttribute(
      'aria-current',
      'true',
    )
  })

  it('o seletor de Datas mostra no topo o intervalo a que a escolha dá', async () => {
    usar([conta()], [movimento({ descricao: 'Qualquer', data: isoData(0) })])
    montar()
    await screen.findByRole('link', { name: /Qualquer/ })

    await abrirFiltros()
    const seletor = await abrirSeletor('Datas')

    // Sem filtro, o mostrador diz "Sem limite de datas".
    expect(within(seletor).getByText('Sem limite de datas')).toBeInTheDocument()

    // Escolher um atalho → passa a mostrar um intervalo concreto.
    await userEvent.click(within(seletor).getByRole('button', { name: 'Últimos 7 dias' }))
    expect(within(seletor).queryByText('Sem limite de datas')).not.toBeInTheDocument()
  })

  it('"Data personalizada" revela De / Até; editá-los mantém a linha marcada', async () => {
    usar([conta()], [movimento({ descricao: 'Qualquer', data: isoData(0) })])
    montar()
    await screen.findByRole('link', { name: /Qualquer/ })

    await abrirFiltros()
    const seletor = await abrirSeletor('Datas')
    // Escondidos até se escolher "Data personalizada".
    expect(within(seletor).queryByLabelText('De')).not.toBeInTheDocument()

    await userEvent.click(within(seletor).getByRole('button', { name: 'Data personalizada' }))
    expect(within(seletor).getByLabelText('De')).toBeInTheDocument()
    expect(within(seletor).getByLabelText('Até')).toBeInTheDocument()
    expect(
      within(seletor).getByRole('button', { name: 'Data personalizada' }),
    ).toHaveAttribute('aria-current', 'true')

    // Editar mantém o "✓" nesta linha (não se "perde").
    fireEvent.change(within(seletor).getByLabelText('De'), { target: { value: '2020-01-01' } })
    expect(
      within(seletor).getByRole('button', { name: 'Data personalizada' }),
    ).toHaveAttribute('aria-current', 'true')
  })

  it('"Mês específico" revela o campo de mês', async () => {
    usar([conta()], [movimento({ descricao: 'Qualquer', data: isoData(0) })])
    montar()
    await screen.findByRole('link', { name: /Qualquer/ })

    await abrirFiltros()
    const seletor = await abrirSeletor('Datas')
    expect(within(seletor).queryByLabelText('Mês')).not.toBeInTheDocument()

    await userEvent.click(within(seletor).getByRole('button', { name: 'Mês específico' }))
    expect(within(seletor).getByLabelText('Mês')).toBeInTheDocument()
    expect(within(seletor).getByRole('button', { name: 'Mês específico' })).toHaveAttribute(
      'aria-current',
      'true',
    )
  })

  it('mostra todas as contas no seletor, sem "Ver tudo"', async () => {
    const contas = Array.from({ length: 7 }, (_, indice) =>
      conta({ id: `c${indice}`, nome: `Conta ${String.fromCharCode(65 + indice)}` }),
    )
    usar(contas, [movimento({ conta_id: 'c6', descricao: 'Só um' })])
    montar()
    await screen.findByRole('link', { name: /Só um/ })

    await abrirFiltros()
    const seletor = await abrirSeletor('Contas')
    // Todas as 7 aparecem de imediato — a última ("Conta G") inclusive.
    expect(within(seletor).getByRole('button', { name: /Conta G/ })).toBeInTheDocument()
    expect(within(seletor).queryByRole('button', { name: /Ver tudo/ })).not.toBeInTheDocument()
  })

  it('"Limpar filtros" na folha repõe todos os filtros', async () => {
    usar(
      [conta()],
      [
        movimento({ id: 'a', descricao: 'Salário', valor: '1500.00' }),
        movimento({ id: 'b', descricao: 'Renda', valor: '-750.00' }),
      ],
    )
    montar()
    await screen.findByRole('link', { name: /Salário/ })

    const folha = await abrirFiltros()
    const seletor = await abrirSeletor('Tipo')
    await userEvent.click(within(seletor).getByRole('button', { name: 'Saídas' }))
    await fecharSeletor('Tipo')
    // Com um filtro ativo, o "Limpar filtros" está no fundo da folha principal.
    await userEvent.click(within(folha).getByRole('button', { name: 'Limpar filtros' }))
    await fecharFiltros()

    // As duas voltam, e o "⋯" deixa de assinalar filtros.
    expect(await screen.findByRole('link', { name: /Salário/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Renda/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Filtros' })).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Filtros (ativos)' }),
    ).not.toBeInTheDocument()
  })

  it('mensagem própria quando os filtros não deixam nada', async () => {
    usar(
      [conta({ id: 'c1', nome: 'À ordem' }), conta({ id: 'c2', nome: 'Poupança' })],
      [movimento({ id: 'a', conta_id: 'c1', descricao: 'Único' })],
    )
    montar()
    await screen.findByRole('link', { name: /Único/ })

    await abrirFiltros()
    const seletor = await abrirSeletor('Contas')
    await userEvent.click(within(seletor).getByRole('button', { name: /Poupança/ }))
    await fecharSeletor('Contas')
    await fecharFiltros()

    expect(await screen.findByText('Nenhum movimento com estes filtros.')).toBeInTheDocument()
    // Com as folhas fechadas, o único "Limpar filtros" é o do estado vazio.
    await userEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }))
    expect(await screen.findByRole('link', { name: /Único/ })).toBeInTheDocument()
  })

  it('lê os filtros do URL ao carregar (?tipo=entrada)', async () => {
    usar(
      [conta()],
      [
        movimento({ id: 'a', descricao: 'Salário', valor: '1500.00' }),
        movimento({ id: 'b', descricao: 'Renda', valor: '-750.00' }),
      ],
    )
    montar('/movimentos?tipo=entrada')

    expect(await screen.findByRole('link', { name: /Salário/ })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Renda/ })).not.toBeInTheDocument()

    // O "⋯" já assinala filtros, e o seletor de "Tipo" abre com
    // "Entradas" marcado.
    expect(
      screen.getByRole('button', { name: 'Filtros (ativos)' }),
    ).toBeInTheDocument()
    await abrirFiltros()
    const seletor = await abrirSeletor('Tipo')
    expect(within(seletor).getByRole('button', { name: 'Entradas' })).toHaveAttribute(
      'aria-current',
      'true',
    )
  })

  it('mostra uma mensagem de erro se a API falhar', async () => {
    servidorMsw.use(
      http.get('/api/contas', () => HttpResponse.json([conta()])),
      http.get('/api/movimentos', () =>
        HttpResponse.json({ detail: 'Sessão inválida ou expirada.' }, { status: 401 }),
      ),
    )

    montar()

    expect(await screen.findByRole('alert')).toHaveTextContent('Sessão inválida ou expirada.')
  })

  describe('scroll infinito', () => {
    // 35 movimentos, um por dia (o mais recente é "m0") — mais do que o
    // limite de uma página (30), para "temMais" ficar true na primeira
    // página e a sentinela aparecer.
    function movimentosParaPaginar(quantos = 35) {
      return Array.from({ length: quantos }, (_, indice) =>
        movimento({
          id: `m${indice}`,
          descricao: `Movimento ${indice}`,
          data: isoData(-indice),
          created_at: `2026-01-01T00:00:${String(indice % 60).padStart(2, '0')}Z`,
        }),
      )
    }

    it('a sentinela só aparece quando há mais do que uma página', async () => {
      usar([conta()], [movimento({ descricao: 'Único' })])
      montar()

      await screen.findByRole('link', { name: /Único/ })
      expect(
        screen.queryByRole('status', { name: 'A carregar mais movimentos' }),
      ).not.toBeInTheDocument()
    })

    it('carrega a página seguinte ao a sentinela entrar no ecrã', async () => {
      usar([conta()], movimentosParaPaginar())
      montar()

      // Primeira página: os 30 mais recentes (m0..m29) — o mais antigo
      // (m34) ainda não chegou. O filtro por nome exclui o "Novo
      // movimento" do cabeçalho (que também é um link, mas com "N"
      // maiúsculo e "movimento" minúsculo — não bate com este regex).
      await screen.findByRole('link', { name: /Movimento 0/ })
      expect(screen.getAllByRole('link', { name: /^Movimento \d/ })).toHaveLength(30)
      expect(screen.queryByRole('link', { name: /Movimento 34/ })).not.toBeInTheDocument()

      const sentinela = screen.getByRole('status', { name: 'A carregar mais movimentos' })
      simularEntradaNoEcra(sentinela)

      // Segunda página: os 5 que faltavam — a sentinela desaparece (já
      // não há mais para carregar).
      expect(await screen.findByRole('link', { name: /Movimento 34/ })).toBeInTheDocument()
      expect(screen.getAllByRole('link', { name: /^Movimento \d/ })).toHaveLength(35)
      await waitFor(() =>
        expect(
          screen.queryByRole('status', { name: 'A carregar mais movimentos' }),
        ).not.toBeInTheDocument(),
      )
    })

    it('mudar de filtro reinicia a paginação, em vez de continuar a partir do cursor antigo', async () => {
      const todos = [
        ...movimentosParaPaginar(31),
        movimento({ id: 'especial', descricao: 'Especial', categoria_id: 'cat2', data: isoData(-1) }),
      ]
      usar([conta()], todos)
      montar()

      await screen.findByRole('link', { name: /Movimento 0/ })
      const sentinela = screen.getByRole('status', { name: 'A carregar mais movimentos' })
      simularEntradaNoEcra(sentinela)
      await screen.findByRole('link', { name: /Movimento 30/ })

      // Filtra para a categoria "Especial" — uma primeira página nova,
      // não uma continuação da paginação de "cat1".
      await abrirFiltros()
      const seletor = await abrirSeletor('Categorias')
      await userEvent.click(within(seletor).getByRole('button', { name: 'Combustível' }))
      await fecharSeletor('Categorias')
      await fecharFiltros()

      expect(await screen.findByRole('link', { name: /Especial/ })).toBeInTheDocument()
      expect(screen.queryByRole('link', { name: /Movimento/ })).not.toBeInTheDocument()
    })

    it('mudar de filtro ENQUANTO "carregar mais" ainda está em curso não mistura as duas listas', async () => {
      // Regressão: "carregarMais" não tinha nenhuma proteção contra
      // respostas fora de ordem — se a página seguinte de um filtro
      // antigo demorasse mais do que a mudança de filtro seguinte, a sua
      // resposta (tardia) era anexada à lista NOVA, já de outro critério,
      // em silêncio. Este teste atrasa deliberadamente essa resposta,
      // muda de filtro antes de ela chegar, e confirma que é ignorada.
      const todos = [
        ...movimentosParaPaginar(31),
        movimento({ id: 'especial', descricao: 'Especial', categoria_id: 'cat2', data: isoData(-1) }),
      ]
      let atrasarProximaComCursor = false
      servidorMsw.use(
        http.get('/api/contas', () => HttpResponse.json([conta()])),
        http.get('/api/categorias/arvore', () => HttpResponse.json(ARVORE)),
        http.get('/api/movimentos', async ({ request }) => {
          const url = new URL(request.url)
          if (url.searchParams.get('antes_data') && atrasarProximaComCursor) {
            atrasarProximaComCursor = false
            await delay(300)
          }
          return HttpResponse.json(filtrarEPaginar(request.url, [conta()], todos))
        }),
      )
      montar()

      await screen.findByRole('link', { name: /Movimento 0/ })
      atrasarProximaComCursor = true
      const sentinela = screen.getByRole('status', { name: 'A carregar mais movimentos' })
      simularEntradaNoEcra(sentinela)

      // Sem esperar pela resposta (atrasada) de "carregar mais": muda já
      // de filtro para a categoria "Especial".
      await abrirFiltros()
      const seletor = await abrirSeletor('Categorias')
      await userEvent.click(within(seletor).getByRole('button', { name: 'Combustível' }))
      await fecharSeletor('Categorias')
      await fecharFiltros()

      expect(await screen.findByRole('link', { name: /Especial/ })).toBeInTheDocument()
      expect(screen.queryByRole('link', { name: /^Movimento \d/ })).not.toBeInTheDocument()

      // Espera o suficiente para a resposta atrasada (do filtro ANTERIOR)
      // chegar — e confirma que não se anexou à lista já substituída.
      await new Promise((resolve) => setTimeout(resolve, 400))
      expect(screen.queryByRole('link', { name: /^Movimento \d/ })).not.toBeInTheDocument()
      expect(screen.getByRole('link', { name: /Especial/ })).toBeInTheDocument()
    })

    it('eliminar em lote enquanto "carregar mais" está em curso ignora a resposta atrasada', async () => {
      // A mesma regressão do teste anterior, mas do lado de "recarregar()"
      // (chamado depois de eliminar/recategorizar em lote): também tem de
      // invalidar um "carregar mais" ainda pendente, para a sua resposta
      // (tardia, da lista ANTIGA) não reaparecer depois de a lista já ter
      // sido recarregada.
      let movimentosAtuais = movimentosParaPaginar(31)
      let atrasarProximaComCursor = false
      servidorMsw.use(
        http.get('/api/contas', () => HttpResponse.json([conta()])),
        http.get('/api/categorias/arvore', () => HttpResponse.json(ARVORE)),
        http.get('/api/movimentos', async ({ request }) => {
          const url = new URL(request.url)
          if (url.searchParams.get('antes_data') && atrasarProximaComCursor) {
            atrasarProximaComCursor = false
            await delay(300)
          }
          return HttpResponse.json(filtrarEPaginar(request.url, [conta()], movimentosAtuais))
        }),
        http.post('/api/movimentos/eliminar-em-lote', async ({ request }) => {
          const corpo = (await request.json()) as { ids: string[] }
          movimentosAtuais = movimentosAtuais.filter(
            (m) => !corpo.ids.includes(campo(m, 'id')),
          )
          return new HttpResponse(null, { status: 204 })
        }),
      )
      montar()

      await screen.findByRole('link', { name: /Movimento 0/ })
      atrasarProximaComCursor = true
      const sentinela = screen.getByRole('status', { name: 'A carregar mais movimentos' })
      simularEntradaNoEcra(sentinela)

      // Sem esperar pela resposta atrasada: entra em seleção, elimina
      // "Movimento 0" — dispara recarregar(), substituindo a lista pela
      // primeira página já sem esse movimento (30 dos 30 restantes).
      await userEvent.click(screen.getByRole('button', { name: 'Selecionar' }))
      await userEvent.click(screen.getByRole('link', { name: /Movimento 0/ }))
      await userEvent.click(screen.getByRole('button', { name: /Eliminar/ }))
      const dialogo = await screen.findByRole('dialog', { name: 'Eliminar movimentos' })
      await userEvent.click(within(dialogo).getByRole('button', { name: 'Eliminar' }))

      await waitFor(() => expect(screen.queryByText(/selecionado/)).not.toBeInTheDocument())
      expect(screen.queryByRole('link', { name: /Movimento 0/ })).not.toBeInTheDocument()

      // Espera o suficiente para a resposta atrasada de "carregar mais"
      // (ainda da lista de 31) chegar — não deve acrescentar nada à lista
      // já recarregada.
      await new Promise((resolve) => setTimeout(resolve, 400))
      expect(screen.getAllByRole('link', { name: /^Movimento \d/ })).toHaveLength(30)
    })

    it('se carregar mais falhar, mostra "tentar novamente" e não perde o que já estava carregado', async () => {
      const todos = movimentosParaPaginar()
      // A primeira página (sem cursor) passa sempre; a PRIMEIRA tentativa
      // de "carregar mais" (com "antes_data") falha — a segunda (o
      // "tentar novamente" do utilizador) já passa.
      let tentativasComCursor = 0
      servidorMsw.use(
        http.get('/api/contas', () => HttpResponse.json([conta()])),
        http.get('/api/categorias/arvore', () => HttpResponse.json(ARVORE)),
        http.get('/api/movimentos', ({ request }) => {
          const url = new URL(request.url)
          if (url.searchParams.get('antes_data')) {
            tentativasComCursor += 1
            if (tentativasComCursor === 1) {
              return HttpResponse.json({ detail: 'Falha de rede.' }, { status: 500 })
            }
          }
          return HttpResponse.json(filtrarEPaginar(request.url, [conta()], todos))
        }),
      )
      montar()

      await screen.findByRole('link', { name: /Movimento 0/ })
      const sentinela = screen.getByRole('status', { name: 'A carregar mais movimentos' })
      simularEntradaNoEcra(sentinela)

      const tentarNovamente = await screen.findByRole('button', {
        name: /Não foi possível carregar mais/,
      })
      // O que já estava na lista continua lá — o erro não a limpou.
      expect(screen.getByRole('link', { name: /Movimento 0/ })).toBeInTheDocument()

      await userEvent.click(tentarNovamente)
      expect(await screen.findByRole('link', { name: /Movimento 34/ })).toBeInTheDocument()
    })
  })
})

describe('Modo de seleção múltipla', () => {
  it('"Selecionar", na pílula do cabeçalho, entra em modo seleção', async () => {
    usar([conta()], [movimento({ id: 'a', descricao: 'Salário', categoria_id: 'cat1' })])
    montar()
    await screen.findByRole('link', { name: /Salário/ })

    await userEvent.click(screen.getByRole('button', { name: 'Selecionar' }))

    // Ninguém fica pré-selecionado — a ação só entra no modo.
    expect(screen.getByText('0 selecionados')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeInTheDocument()
    // A pílula ("Selecionar"/"Filtros") esconde-se; a pesquisa fica — só
    // esbatida e sem aceitar escrita (ver a nota MODO DE SELEÇÃO MÚLTIPLA).
    expect(screen.queryByRole('button', { name: 'Selecionar' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Filtros/ })).not.toBeInTheDocument()
    expect(screen.getByPlaceholderText('Procurar movimento…')).toBeDisabled()
  })

  it('tocar numa linha, em modo seleção, alterna a seleção — não abre a edição', async () => {
    usar(
      [conta()],
      [
        movimento({ id: 'a', descricao: 'Salário', categoria_id: 'cat1' }),
        movimento({ id: 'b', descricao: 'Renda', categoria_id: 'cat1' }),
      ],
    )
    montar()
    await screen.findByRole('link', { name: /Salário/ })

    await userEvent.click(screen.getByRole('button', { name: 'Selecionar' }))
    expect(screen.getByText('0 selecionados')).toBeInTheDocument()

    const linhaRenda = screen.getByRole('link', { name: /Renda/ })
    await userEvent.click(linhaRenda)
    expect(screen.getByText('1 selecionado')).toBeInTheDocument()
    expect(linhaRenda).toHaveAttribute('aria-pressed', 'true')

    // Tocar de novo desmarca — não navega (ainda na mesma lista).
    await userEvent.click(linhaRenda)
    expect(screen.getByText('0 selecionados')).toBeInTheDocument()
    expect(linhaRenda).toHaveAttribute('aria-pressed', 'false')
  })

  it('"Cancelar" sai do modo de seleção', async () => {
    usar([conta()], [movimento({ id: 'a', descricao: 'Salário', categoria_id: 'cat1' })])
    montar()
    await screen.findByRole('link', { name: /Salário/ })

    await userEvent.click(screen.getByRole('button', { name: 'Selecionar' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(screen.queryByText(/selecionado/)).not.toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Selecionar' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Filtros/ })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Procurar movimento…')).not.toBeDisabled()
  })

  it('"Categorizar" fica desativado quando a seleção mistura entradas e saídas', async () => {
    usar(
      [conta()],
      [
        movimento({ id: 'a', descricao: 'Salário', categoria_id: 'cat4', valor: '1500.00' }),
        movimento({ id: 'b', descricao: 'Renda', categoria_id: 'cat1', valor: '-750.00' }),
      ],
    )
    montar()
    await screen.findByRole('link', { name: /Salário/ })

    await userEvent.click(screen.getByRole('button', { name: 'Selecionar' }))
    await userEvent.click(screen.getByRole('link', { name: /Salário/ }))
    await userEvent.click(screen.getByRole('link', { name: /Renda/ }))

    expect(screen.getByRole('button', { name: /Categorizar/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Eliminar/ })).not.toBeDisabled()
  })

  it('elimina os movimentos selecionados', async () => {
    let movimentosAtuais = [
      movimento({ id: 'a', descricao: 'Salário', categoria_id: 'cat4', valor: '1500.00' }),
      movimento({ id: 'b', descricao: 'Renda', categoria_id: 'cat1', valor: '-750.00' }),
    ]
    let corpoRecebido: unknown = null
    servidorMsw.use(
      http.get('/api/contas', () => HttpResponse.json([conta()])),
      http.get('/api/movimentos', () => HttpResponse.json(movimentosAtuais)),
      http.get('/api/categorias/arvore', () => HttpResponse.json(ARVORE)),
      http.post('/api/movimentos/eliminar-em-lote', async ({ request }) => {
        corpoRecebido = await request.json()
        movimentosAtuais = movimentosAtuais.filter((m) => !(corpoRecebido as { ids: string[] }).ids.includes(m.id))
        return new HttpResponse(null, { status: 204 })
      }),
    )
    montar()
    await screen.findByRole('link', { name: /Salário/ })

    await userEvent.click(screen.getByRole('button', { name: 'Selecionar' }))
    await userEvent.click(screen.getByRole('link', { name: /Salário/ }))
    await userEvent.click(screen.getByRole('link', { name: /Renda/ }))

    await userEvent.click(screen.getByRole('button', { name: /Eliminar/ }))
    const dialogo = await screen.findByRole('dialog', { name: 'Eliminar movimentos' })
    expect(dialogo).toHaveTextContent('2 movimentos serão eliminados.')
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Eliminar' }))

    expect(corpoRecebido).toEqual({ ids: ['a', 'b'] })
    // Volta ao modo normal, com a lista já sem os movimentos eliminados.
    await waitFor(() => expect(screen.queryByText(/selecionado/)).not.toBeInTheDocument())
    expect(screen.queryByRole('link', { name: /Salário/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Renda/ })).not.toBeInTheDocument()
  })

  it('recategoriza os movimentos selecionados', async () => {
    const movimentosAtuais = [
      movimento({ id: 'a', descricao: 'Combustível de carro', categoria_id: 'cat1', valor: '-40.00' }),
    ]
    let corpoRecebido: unknown = null
    servidorMsw.use(
      http.get('/api/contas', () => HttpResponse.json([conta()])),
      http.get('/api/movimentos', () => HttpResponse.json(movimentosAtuais)),
      http.get('/api/categorias/arvore', () => HttpResponse.json(ARVORE)),
      http.post('/api/movimentos/recategorizar-em-lote', async ({ request }) => {
        corpoRecebido = await request.json()
        return new HttpResponse(null, { status: 204 })
      }),
    )
    montar()
    await screen.findByRole('link', { name: /Combustível/ })

    await userEvent.click(screen.getByRole('button', { name: 'Selecionar' }))
    await userEvent.click(screen.getByRole('link', { name: /Combustível/ }))
    await userEvent.click(screen.getByRole('button', { name: /Categorizar/ }))

    const folha = await screen.findByRole('dialog', { name: 'Categorizar' })
    // Só categorias de SAÍDA (a direção do único movimento selecionado) —
    // "Trabalho" (entrada) não aparece.
    expect(within(folha).getByText('Portagens')).toBeInTheDocument()
    expect(within(folha).queryByText('Salário')).not.toBeInTheDocument()

    await userEvent.click(within(folha).getByText('Portagens'))

    expect(corpoRecebido).toEqual({ ids: ['a'], categoria_id: 'cat3' })
    await waitFor(() => expect(screen.queryByText(/selecionado/)).not.toBeInTheDocument())
  })
})
