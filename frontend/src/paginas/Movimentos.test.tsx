/*
 * TESTES DA PÁGINA MOVIMENTOS (a lista)
 * =====================================
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { delay, http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'

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
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...sobrepor,
  }
}

function movimento(sobrepor: Record<string, unknown> = {}) {
  return {
    id: 'm1',
    conta_id: 'c1',
    data: isoData(),
    descricao: 'Compras',
    valor: '-50.00',
    created_at: '2026-01-01T10:00:00Z',
    updated_at: '2026-01-01T10:00:00Z',
    ...sobrepor,
  }
}

function usar(contas: unknown[], movimentos: unknown[]) {
  servidorMsw.use(
    http.get('/api/contas', () => HttpResponse.json(contas)),
    http.get('/api/movimentos', () => HttpResponse.json(movimentos)),
  )
}

function montar(entrada = '/movimentos') {
  return render(
    <MemoryRouter initialEntries={[entrada]}>
      <Movimentos />
    </MemoryRouter>,
  )
}

/** Abre a folha de filtros (esperando primeiro que a lista carregue, já
 *  que o botão só aparece com movimentos) e devolve o "dialog". O rótulo
 *  do funil é "Filtros" ou "Filtros (ativos)" consoante haja filtros — daí
 *  a expressão regular. */
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
async function abrirSeletor(titulo: 'Contas' | 'Tipo' | 'Datas') {
  await userEvent.click(screen.getByRole('button', { name: new RegExp(`^${titulo}:`) }))
  return screen.findByRole('dialog', { name: titulo })
}

/** Fecha um seletor de filtro (o "‹ Voltar" do cabeçalho) e espera que
 *  desmonte, deixando a folha de filtros à vista outra vez. */
async function fecharSeletor(titulo: 'Contas' | 'Tipo' | 'Datas') {
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
    // saldo_ancora 1000; +1500 (Salário) - 750 (Renda) = 1750 no fim.
    usar(
      [conta({ saldo_ancora: '1000.00' })],
      [
        movimento({
          id: 'a',
          descricao: 'Salário',
          valor: '1500.00',
          data: isoData(-1),
          created_at: '2026-01-01T09:00:00Z',
        }),
        movimento({
          id: 'b',
          descricao: 'Renda',
          valor: '-750.00',
          data: isoData(),
          created_at: '2026-01-02T09:00:00Z',
        }),
      ],
    )

    montar()

    const linhaRenda = await screen.findByRole('link', { name: /Renda/ })
    // O último movimento cronologicamente: 1000 + 1500 - 750 = 1750.
    expect(linhaRenda).toHaveTextContent(/1.?750,00/)

    const linhaSalario = await screen.findByRole('link', { name: /Salário/ })
    // Logo a seguir ao salário (o primeiro): 1000 + 1500 = 2500.
    expect(linhaSalario).toHaveTextContent(/2.?500,00/)
  })

  it('filtra a lista pela pesquisa (descrição ou nome da conta)', async () => {
    usar(
      [conta({ id: 'c1', nome: 'À ordem' }), conta({ id: 'c2', nome: 'Poupança' })],
      [
        movimento({ id: 'a', conta_id: 'c1', descricao: 'Supermercado' }),
        movimento({ id: 'b', conta_id: 'c2', descricao: 'Transferência' }),
      ],
    )

    montar()
    const campo = await screen.findByRole('searchbox', { name: 'Procurar movimento' })

    await userEvent.type(campo, 'supermercado')
    expect(screen.getByRole('link', { name: /Supermercado/ })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Transferência/ })).not.toBeInTheDocument()

    await userEvent.clear(campo)
    await userEvent.type(campo, 'poupança')
    expect(screen.getByRole('link', { name: /Transferência/ })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Supermercado/ })).not.toBeInTheDocument()
  })

  it('mostra uma mensagem quando a pesquisa não encontra nada', async () => {
    usar([conta()], [movimento({ descricao: 'Compras' })])

    montar()
    const campo = await screen.findByRole('searchbox', { name: 'Procurar movimento' })
    await userEvent.type(campo, 'zzz')

    expect(screen.getByText(/Nenhum movimento corresponde/)).toBeInTheDocument()
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
    // faria a barra de procura "saltar"); o único aviso é o rótulo do
    // funil a mudar.
    expect(screen.getByRole('button', { name: 'Filtros (ativos)' })).toBeInTheDocument()
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

    // As duas voltam, e o funil deixa de assinalar filtros.
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

    // O funil já assinala filtros, e o seletor de "Tipo" abre com
    // "Entradas" marcado.
    expect(screen.getByRole('button', { name: 'Filtros (ativos)' })).toBeInTheDocument()
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
})
