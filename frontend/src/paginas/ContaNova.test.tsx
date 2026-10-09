/*
 * TESTES DO MODAL "NOVA CONTA"
 * ===========================
 *
 * Exercita também o ContaFormulario em modo de criação.
 */

import { fireEvent, render as renderBase, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'

import { AuthProvider } from '../auth/AuthProvider'
import { useAuth } from '../auth/useAuth'
import { servidorMsw } from '../test/servidor-msw'
import { definirEcraMobile } from '../test/setup'
import { ContaNova } from './ContaNova'
import { ComConsultas } from '../test/consultas'
import type { ContaBancaria } from '../lib/openBanking'

// Todas as montagens deste ficheiro levam a cache dos dados do servidor à
// volta (a app recebe-a em main.tsx; aqui, cada montagem tem uma nova —
// ver test/consultas.tsx). "wrapper" é a opção do Testing Library para
// envolver o que se monta num componente.
function render(ui: Parameters<typeof renderBase>[0]) {
  return renderBase(ui, { wrapper: ComConsultas })
}

// Mostra o URL actual (caminho + query string), para os testes confirmarem
// que o passo fica guardado nele.
function MostrarUrl() {
  const { pathname, search } = useLocation()
  return <output aria-label="url">{pathname + search}</output>
}

// O utilizador autenticado (o formulário lê dele a moeda principal, para
// a moeda de uma conta nova). "EUR" por omissão; um teste usa outra.
function montar(entrada = '/contas/nova', moedaPrincipal = 'EUR') {
  servidorMsw.use(
    http.get('/api/auth/me', () =>
      HttpResponse.json({ id: 'u1', email: 'ana@exemplo.pt', moeda_principal: moedaPrincipal }),
    ),
  )
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[entrada]}>
        <MostrarUrl />
        <Routes>
          <Route path="/contas" element={<p>lista de contas</p>} />
          <Route path="/contas/nova" element={<ContaNova />} />
          <Route path="/contas/:id" element={<p>detalhe da conta</p>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  )
}

// Uma conta já existente — para as sugestões de banco e tipo (que saem
// das contas do utilizador).
const CONTA_EXISTENTE = {
  id: 'c-existente',
  nome: 'Existente',
  banco: null,
  tipo: null,
  moeda: 'EUR',
  data_ancora: '2026-01-01',
  saldo_ancora: '0.00',
  saldo: '0.00',
  saldo_convertido: '0.00',
  vinculo: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

describe('Página Nova conta', () => {
  it('cria a conta e navega para o seu detalhe', async () => {
    let corpoRecebido: Record<string, unknown> | null = null
    servidorMsw.use(
      // O formulário pede a lista de contas para as sugestões.
      http.get('/api/contas', () => HttpResponse.json([])),
      http.post('/api/contas', async ({ request }) => {
        corpoRecebido = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({ id: 'nova-1' }, { status: 201 })
      }),
    )

    montar()
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar manualmente' }))

    await userEvent.type(screen.getByLabelText('Nome'), 'Revolut')
    await userEvent.type(screen.getByLabelText('Saldo inicial'), '250,50')
    await userEvent.click(screen.getByRole('button', { name: 'Criar conta' }))

    expect(await screen.findByText('detalhe da conta')).toBeInTheDocument()
    // A vírgula decimal portuguesa foi convertida em ponto para a API.
    expect(corpoRecebido).toMatchObject({ nome: 'Revolut', saldo_ancora: '250.50' })
  })

  it('depois de criar, recuar do detalhe leva à lista — não reabre o formulário', async () => {
    servidorMsw.use(
      http.get('/api/contas', () => HttpResponse.json([])),
      http.get('/api/auth/me', () =>
        HttpResponse.json({ id: 'u1', email: 'ana@exemplo.pt', moeda_principal: 'EUR' }),
      ),
      http.post('/api/contas', () => HttpResponse.json({ id: 'nova-9' }, { status: 201 })),
    )
    // O detalhe com um "‹" que recua uma página — o que o da app faz.
    function DetalheComVoltar() {
      const navegar = useNavigate()
      return (
        <button type="button" onClick={() => navegar(-1)}>
          recuar do detalhe
        </button>
      )
    }
    // Chegou-se à Nova conta a partir da lista (há uma entrada antes).
    render(
      <AuthProvider>
        <MemoryRouter initialEntries={['/contas', '/contas/nova']} initialIndex={1}>
          <Routes>
            <Route path="/contas" element={<p>lista de contas</p>} />
            <Route path="/contas/nova" element={<ContaNova />} />
            <Route path="/contas/:id" element={<DetalheComVoltar />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar manualmente' }))
    await userEvent.type(screen.getByLabelText('Nome'), 'Nova')
    await userEvent.type(screen.getByLabelText('Saldo inicial'), '10')
    await userEvent.click(screen.getByRole('button', { name: 'Criar conta' }))

    await userEvent.click(await screen.findByRole('button', { name: 'recuar do detalhe' }))
    expect(await screen.findByText('lista de contas')).toBeInTheDocument()
  })

  it('se a criação falhar, mostra o erro do servidor e o modal continua aberto', async () => {
    servidorMsw.use(
      http.get('/api/contas', () => HttpResponse.json([])),
      http.post('/api/contas', () =>
        HttpResponse.json({ detail: 'Já existe uma conta com este nome.' }, { status: 409 }),
      ),
    )

    montar()
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar manualmente' }))
    await userEvent.type(screen.getByLabelText('Nome'), 'Revolut')
    await userEvent.type(screen.getByLabelText('Saldo inicial'), '100')
    await userEvent.click(screen.getByRole('button', { name: 'Criar conta' }))

    const erro = await screen.findByText('Já existe uma conta com este nome.')
    expect(screen.getByRole('dialog', { name: 'Nova conta' })).toBeInTheDocument()
    // O erro aparece no TOPO do formulário, antes do campo Nome — no fundo
    // ficava fora do ecrã, num telemóvel.
    expect(
      erro.compareDocumentPosition(screen.getByLabelText('Nome')) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(screen.queryByText('lista de contas')).not.toBeInTheDocument()
  })

  it('o passo escolhido fica no URL (um refresh não volta à escolha)', async () => {
    servidorMsw.use(http.get('/api/contas', () => HttpResponse.json([])))
    montar()
    expect(screen.getByRole('status', { name: 'url' })).toHaveTextContent(/^\/contas\/nova$/)

    await userEvent.click(screen.getByRole('button', { name: 'Adicionar manualmente' }))
    expect(screen.getByRole('status', { name: 'url' })).toHaveTextContent('/contas/nova?via=manual')

    // Recuar à escolha tira-o outra vez.
    await userEvent.click(screen.getByRole('button', { name: 'Voltar' }))
    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'url' })).toHaveTextContent(/^\/contas\/nova$/),
    )
  })

  it('a moeda tem um campo só de procurar (por nome ou código, sem "Adicionar")', async () => {
    definirEcraMobile(true)
    servidorMsw.use(http.get('/api/contas', () => HttpResponse.json([])))
    montar()
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar manualmente' }))

    await userEvent.click(screen.getByText('Euro (€)'))
    const painel = await screen.findByRole('dialog', { name: 'Moeda' })
    const procura = within(painel).getByRole('textbox', { name: 'Procurar moeda' })

    // Pelo código: "usd" encontra o dólar, e o euro sai da lista.
    await userEvent.type(procura, 'usd')
    expect(within(painel).getByRole('button', { name: /Dólar/ })).toBeInTheDocument()
    expect(within(painel).queryByRole('button', { name: /Euro/ })).not.toBeInTheDocument()

    // Sem correspondência: diz-se que não há resultados, sem "Adicionar".
    await userEvent.clear(procura)
    await userEvent.type(procura, 'xyz')
    expect(within(painel).getByText('Sem resultados para «xyz».')).toBeInTheDocument()
    expect(within(painel).queryByRole('button', { name: /Adicionar/ })).not.toBeInTheDocument()
  })

  it('"‹" no passo "manual" volta à escolha', async () => {
    servidorMsw.use(http.get('/api/contas', () => HttpResponse.json([])))
    montar()

    await userEvent.click(screen.getByRole('button', { name: 'Adicionar manualmente' }))
    expect(screen.getByLabelText('Nome')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Voltar' }))

    await waitFor(() => expect(screen.queryByLabelText('Nome')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Adicionar manualmente' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Ligar um banco/ })).toBeInTheDocument()
  })

  it('o "✓" só fica ativo com os campos obrigatórios preenchidos', async () => {
    servidorMsw.use(http.get('/api/contas', () => HttpResponse.json([])))
    montar()
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar manualmente' }))

    // Sem nome nem saldo, o "✓" está desativado.
    const confirmar = screen.getByRole('button', { name: 'Criar conta' })
    expect(confirmar).toBeDisabled()

    // Só com o nome ainda falta o saldo.
    await userEvent.type(screen.getByLabelText('Nome'), 'Revolut')
    expect(confirmar).toBeDisabled()

    // Com nome + saldo (a data já vem preenchida com hoje), ativa.
    await userEvent.type(screen.getByLabelText('Saldo inicial'), '100')
    expect(confirmar).toBeEnabled()
  })

  it('o campo de saldo não deixa escrever letras', async () => {
    servidorMsw.use(http.get('/api/contas', () => HttpResponse.json([])))
    montar()
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar manualmente' }))

    const saldo = screen.getByLabelText('Saldo inicial')
    await userEvent.type(saldo, '12a3b,4c5')

    expect(saldo).toHaveValue('123,45')
  })

  it('em mobile, a moeda escolhe-se num painel que entra da direita', async () => {
    definirEcraMobile(true)
    servidorMsw.use(http.get('/api/contas', () => HttpResponse.json([])))
    montar()
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar manualmente' }))

    // O campo "Moeda" é um botão (mostra o valor atual, "Euro") que abre
    // o painel.
    await userEvent.click(screen.getByText(/Euro/))

    const painel = await screen.findByRole('dialog', { name: 'Moeda' })
    await userEvent.click(within(painel).getByText(/Dólar americano/))

    // O painel anima a saída e desmonta; o campo passa a mostrar a moeda
    // escolhida.
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Moeda' })).not.toBeInTheDocument(),
    )
    expect(screen.getByText(/Dólar americano/)).toBeInTheDocument()
  })

  it('em mobile, acrescenta um banco novo escrevendo-o no campo "procurar ou adicionar"', async () => {
    definirEcraMobile(true)
    let corpoRecebido: Record<string, unknown> | null = null
    servidorMsw.use(
      http.get('/api/contas', () => HttpResponse.json([])),
      http.post('/api/contas', async ({ request }) => {
        corpoRecebido = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({ id: 'nova-2' }, { status: 201 })
      }),
    )
    montar()
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar manualmente' }))

    // O campo "Banco" mostra "Sem banco" por omissão; abre o seletor.
    await userEvent.click(screen.getByText('Sem banco'))
    const painel = await screen.findByRole('dialog', { name: 'Banco' })

    // Ainda sem bancos usados: a ajuda explica como adicionar.
    expect(within(painel).getByText(/Escreve o nome do banco/)).toBeInTheDocument()

    // Escreve-se no campo do topo; um nome novo vira "Adicionar «…»".
    await userEvent.type(
      within(painel).getByRole('textbox', { name: 'Procurar ou adicionar banco' }),
      'Banco XPTO',
    )
    await userEvent.click(within(painel).getByRole('button', { name: 'Adicionar «Banco XPTO»' }))

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Banco' })).not.toBeInTheDocument(),
    )
    expect(screen.getByText('Banco XPTO')).toBeInTheDocument()

    // O banco escrito à mão vai na criação da conta.
    await userEvent.type(screen.getByLabelText('Nome'), 'X')
    await userEvent.type(screen.getByLabelText('Saldo inicial'), '0')
    await userEvent.click(screen.getByRole('button', { name: 'Criar conta' }))
    await screen.findByText('detalhe da conta')
    expect(corpoRecebido).toMatchObject({ banco: 'Banco XPTO' })
  })

  it('um banco novo só fica na lista enquanto está escolhido', async () => {
    definirEcraMobile(true)
    servidorMsw.use(
      http.get('/api/contas', () =>
        HttpResponse.json([{ ...CONTA_EXISTENTE, banco: 'CGD' }]),
      ),
    )
    montar()
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar manualmente' }))

    // Escolhe um banco novo, escrevendo-o.
    await userEvent.click(screen.getByText('Sem banco'))
    let painel = await screen.findByRole('dialog', { name: 'Banco' })
    await userEvent.type(
      within(painel).getByRole('textbox', { name: 'Procurar ou adicionar banco' }),
      'Banco Novo',
    )
    await userEvent.click(within(painel).getByRole('button', { name: 'Adicionar «Banco Novo»' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Banco' })).not.toBeInTheDocument())

    // Volta a abrir: o banco novo está lá (é o escolhido) — tira-se a escolha.
    await userEvent.click(screen.getByText('Banco Novo'))
    painel = await screen.findByRole('dialog', { name: 'Banco' })
    await userEvent.click(within(painel).getByRole('button', { name: 'Sem banco' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Banco' })).not.toBeInTheDocument())

    // Abre de novo: só os bancos de contas que existem — o novo desapareceu.
    await userEvent.click(screen.getByText('Sem banco'))
    painel = await screen.findByRole('dialog', { name: 'Banco' })
    expect(within(painel).getByRole('button', { name: 'CGD' })).toBeInTheDocument()
    expect(within(painel).queryByText('Banco Novo')).not.toBeInTheDocument()
  })

  it('"Saldo negativo" envia o saldo com sinal menos', async () => {
    let corpoRecebido: Record<string, unknown> | null = null
    servidorMsw.use(
      http.get('/api/contas', () => HttpResponse.json([])),
      http.post('/api/contas', async ({ request }) => {
        corpoRecebido = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({ id: 'nova-5' }, { status: 201 })
      }),
    )
    montar()
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar manualmente' }))

    await userEvent.type(screen.getByLabelText('Nome'), 'Cartão')
    await userEvent.type(screen.getByLabelText('Saldo inicial'), '412,90')
    const interruptor = screen.getByRole('switch', { name: 'Saldo negativo' })
    expect(interruptor).toHaveAttribute('aria-checked', 'false')
    await userEvent.click(interruptor)
    expect(interruptor).toHaveAttribute('aria-checked', 'true')
    await userEvent.click(screen.getByRole('button', { name: 'Criar conta' }))

    await screen.findByText('detalhe da conta')
    expect(corpoRecebido).toMatchObject({ saldo_ancora: '-412.90' })
  })

  it('a moeda de uma conta nova começa na moeda principal do utilizador', async () => {
    servidorMsw.use(
      http.get('/api/contas', () => HttpResponse.json([])),
      http.get('/api/auth/me', () =>
        HttpResponse.json({ id: 'u1', email: 'ana@exemplo.pt', moeda_principal: 'USD' }),
      ),
    )
    // Como na app (a RotaProtegida), a página só aparece depois de o
    // utilizador estar carregado — por isso espera-se por ela com findBy.
    function SoAutenticado({ children }: { children: ReactNode }) {
      const { utilizador } = useAuth()
      return utilizador ? children : null
    }
    render(
      <AuthProvider>
        <MemoryRouter initialEntries={['/contas/nova']}>
          <SoAutenticado>
            <ContaNova />
          </SoAutenticado>
        </MemoryRouter>
      </AuthProvider>,
    )
    await userEvent.click(await screen.findByRole('button', { name: 'Adicionar manualmente' }))

    expect(screen.getByText('Dólar americano ($)')).toBeInTheDocument()
  })

  it('o saldo mostra o símbolo da moeda e, com "Saldo negativo", o sinal menos', async () => {
    servidorMsw.use(http.get('/api/contas', () => HttpResponse.json([])))
    montar()
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar manualmente' }))

    const saldo = screen.getByLabelText('Saldo inicial')
    // A linha do valor: [−] valor símbolo.
    const linha = saldo.closest('div') as HTMLElement
    expect(linha).toHaveTextContent('€')
    expect(linha).not.toHaveTextContent('−')

    await userEvent.type(saldo, '412,90')
    await userEvent.click(screen.getByRole('switch', { name: 'Saldo negativo' }))
    expect(linha).toHaveTextContent('−')
    // O valor escrito continua sem sinal — o sinal só se junta ao enviar.
    expect(saldo).toHaveValue('412,90')
  })

  it('a data de início escolhe-se no calendário, sem dias futuros', async () => {
    let corpoRecebido: Record<string, unknown> | null = null
    servidorMsw.use(
      http.get('/api/contas', () => HttpResponse.json([])),
      http.post('/api/contas', async ({ request }) => {
        corpoRecebido = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({ id: 'nova-6' }, { status: 201 })
      }),
    )
    montar()
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar manualmente' }))

    // O campo mostra hoje; abre o calendário (em ecrã largo, por baixo dele).
    await userEvent.click(screen.getByRole('button', { name: /Data inicial/ }))
    // Recua um mês e escolhe o dia 1.
    await userEvent.click(screen.getByRole('button', { name: 'Mês anterior' }))
    const hoje = new Date()
    const anterior = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1)
    const nomeMes = anterior.toLocaleDateString('pt-PT', { month: 'long' })
    await userEvent.click(
      screen.getByRole('button', { name: `1 de ${nomeMes} de ${anterior.getFullYear()}` }),
    )

    // Um dia futuro (no mês seguinte ao atual) não se pode escolher.
    await userEvent.click(screen.getByRole('button', { name: 'Mês seguinte' }))
    await userEvent.click(screen.getByRole('button', { name: 'Mês seguinte' }))
    const seguinte = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 1)
    const nomeSeguinte = seguinte.toLocaleDateString('pt-PT', { month: 'long' })
    expect(
      screen.getByRole('button', { name: `1 de ${nomeSeguinte} de ${seguinte.getFullYear()}` }),
    ).toBeDisabled()

    await userEvent.type(screen.getByLabelText('Nome'), 'Antiga')
    await userEvent.type(screen.getByLabelText('Saldo inicial'), '10')
    await userEvent.click(screen.getByRole('button', { name: 'Criar conta' }))

    await screen.findByText('detalhe da conta')
    const mes = String(anterior.getMonth() + 1).padStart(2, '0')
    expect(corpoRecebido).toMatchObject({ data_ancora: `${anterior.getFullYear()}-${mes}-01` })
  })

  it('arrastar o painel da moeda para o LADO recua ao formulário', async () => {
    definirEcraMobile(true)
    servidorMsw.use(http.get('/api/contas', () => HttpResponse.json([])))
    montar()
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar manualmente' }))

    await userEvent.click(screen.getByText(/Euro/))
    const painel = await screen.findByRole('dialog', { name: 'Moeda' })
    // ".cabecalho" é o primeiro filho de ".painelInterior", não
    // directamente do "dialog" — ver a nota em Folha.module.css.
    const cabecalho = painel.firstElementChild?.firstElementChild as HTMLElement

    // Arrasto claramente horizontal (dx >> dy) para lá do limiar.
    fireEvent.pointerDown(cabecalho, { clientX: 40, clientY: 80, pointerId: 1 })
    fireEvent.pointerMove(cabecalho, { clientX: 300, clientY: 84, pointerId: 1 })
    fireEvent.pointerUp(cabecalho, { clientX: 300, clientY: 84, pointerId: 1 })

    // O painel da moeda fecha, mas o modal "Nova conta" continua — não se
    // saiu do fluxo.
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Moeda' })).not.toBeInTheDocument(),
    )
    expect(screen.getByRole('dialog', { name: 'Nova conta' })).toBeInTheDocument()
    expect(screen.queryByText('lista de contas')).not.toBeInTheDocument()
  })

  it('arrastar o painel da moeda para BAIXO abandona o fluxo (vai à lista)', async () => {
    definirEcraMobile(true)
    servidorMsw.use(http.get('/api/contas', () => HttpResponse.json([])))
    montar()
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar manualmente' }))

    await userEvent.click(screen.getByText(/Euro/))
    const painel = await screen.findByRole('dialog', { name: 'Moeda' })
    // ".cabecalho" é o primeiro filho de ".painelInterior", não
    // directamente do "dialog" — ver a nota em Folha.module.css.
    const cabecalho = painel.firstElementChild?.firstElementChild as HTMLElement

    // Arrasto claramente vertical (dy >> dx) para lá do limiar.
    fireEvent.pointerDown(cabecalho, { clientX: 40, clientY: 80, pointerId: 1 })
    fireEvent.pointerMove(cabecalho, { clientX: 44, clientY: 330, pointerId: 1 })

    // A meio do gesto, as TRÊS camadas descem juntas — o formulário e
    // também a folha de base (a "escolha"), que de outro modo ficaria
    // parada e apareceria por trás, como se o gesto recuasse um passo.
    const [base, formulario] = screen.getAllByRole('dialog')
    expect(base.style.transform).toBe('translateY(250px)')
    expect(formulario.style.transform).toBe('translateY(250px)')

    fireEvent.pointerUp(cabecalho, { clientX: 44, clientY: 330, pointerId: 1 })

    // As três folhas saem e vai-se parar à página Contas.
    expect(await screen.findByText('lista de contas')).toBeInTheDocument()
  })

  it('é um modal e o "X" fecha-o (volta à lista)', async () => {
    servidorMsw.use(http.get('/api/contas', () => HttpResponse.json([])))
    montar()

    expect(screen.getByRole('dialog', { name: 'Nova conta' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Fechar' }))

    // Aberto direto pelo URL (sem histórico) → o "X" vai para /contas.
    expect(await screen.findByText('lista de contas')).toBeInTheDocument()
  })

  it('descarta-se ao arrastar o cabeçalho para baixo além do limiar', async () => {
    definirEcraMobile(true) // o arrasto é um gesto de toque — só em mobile.
    servidorMsw.use(http.get('/api/contas', () => HttpResponse.json([])))
    montar()

    const dialogo = await screen.findByRole('dialog', { name: 'Nova conta' })
    // O cabeçalho (a "pega" + a linha do título) é a zona de arrasto.
    // ".cabecalho" é o primeiro filho de ".painelInterior", não
    // directamente do "dialog" — ver a nota em Folha.module.css.
    const cabecalho = dialogo.firstElementChild?.firstElementChild as HTMLElement

    fireEvent.pointerDown(cabecalho, { clientY: 80, pointerId: 1 })
    fireEvent.pointerMove(cabecalho, { clientY: 320, pointerId: 1 })
    fireEvent.pointerUp(cabecalho, { clientY: 320, pointerId: 1 })

    expect(await screen.findByText('lista de contas')).toBeInTheDocument()
  })

  it('volta ao sítio se o arrasto para baixo for curto', async () => {
    definirEcraMobile(true) // o arrasto é um gesto de toque — só em mobile.
    servidorMsw.use(http.get('/api/contas', () => HttpResponse.json([])))
    montar()

    const dialogo = await screen.findByRole('dialog', { name: 'Nova conta' })
    // ".cabecalho" é o primeiro filho de ".painelInterior", não
    // directamente do "dialog" — ver a nota em Folha.module.css.
    const cabecalho = dialogo.firstElementChild?.firstElementChild as HTMLElement

    fireEvent.pointerDown(cabecalho, { clientY: 80, pointerId: 1 })
    fireEvent.pointerMove(cabecalho, { clientY: 130, pointerId: 1 })
    fireEvent.pointerUp(cabecalho, { clientY: 130, pointerId: 1 })

    // Arrasto curto: não descarta — o modal continua lá.
    expect(screen.getByRole('dialog', { name: 'Nova conta' })).toBeInTheDocument()
    expect(screen.queryByText('lista de contas')).not.toBeInTheDocument()
  })
})

describe('Página Nova conta — Open Banking', () => {
  it('o primeiro ecrã pergunta manual ou banco, sem mostrar já o formulário', () => {
    montar()

    expect(screen.getByRole('button', { name: 'Adicionar manualmente' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Ligar um banco/ })).toBeInTheDocument()
    expect(screen.queryByLabelText('Nome')).not.toBeInTheDocument()
  })

  it('com "?via=banco" abre já na lista de bancos, e "‹" volta à escolha', async () => {
    // A entrada usada pelo botão "Ligar um banco" do estado "sem contas",
    // na página Contas.
    servidorMsw.use(
      http.get('/api/open-banking/bancos', () =>
        HttpResponse.json([{ name: 'Caixa Geral de Depósitos', country: 'PT' }]),
      ),
    )
    montar('/contas/nova?via=banco')

    expect(await screen.findByRole('button', { name: 'Caixa Geral de Depósitos' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Voltar' }))
    expect(await screen.findByRole('button', { name: 'Adicionar manualmente' })).toBeInTheDocument()
  })

  it('com "?via=manual" abre já no formulário manual', async () => {
    servidorMsw.use(http.get('/api/contas', () => HttpResponse.json([])))
    montar('/contas/nova?via=manual')

    expect(await screen.findByLabelText('Nome')).toBeInTheDocument()
  })

  it('"Ligar um banco" lista os bancos por ordem alfabética', async () => {
    servidorMsw.use(
      http.get('/api/open-banking/bancos', () =>
        HttpResponse.json([
          { name: 'Revolut', country: 'PT' },
          { name: 'Caixa Geral de Depósitos', country: 'PT' },
        ]),
      ),
    )
    montar()

    await userEvent.click(screen.getByRole('button', { name: /Ligar um banco/ }))

    const linhas = await screen.findAllByRole('button', { name: /Caixa|Revolut/ })
    expect(linhas.map((linha) => linha.textContent)).toEqual([
      'Caixa Geral de Depósitos',
      'Revolut',
    ])
  })

  it('tocar num banco mostra as permissões (numa folha própria), e "Voltar à lista" só fecha essa folha', async () => {
    servidorMsw.use(
      http.get('/api/open-banking/bancos', () =>
        HttpResponse.json([{ name: 'Revolut', country: 'PT', validade_dias: 180 }]),
      ),
    )
    montar()

    await userEvent.click(screen.getByRole('button', { name: /Ligar um banco/ }))
    await userEvent.click(await screen.findByRole('button', { name: /Revolut/ }))

    // Ecrã de permissões: o banco, o que vai ver e o que nunca pode, a
    // duração (a que o backend calculou para este banco), como cancelar e
    // quem é o responsável (link para o registo oficial da EBA).
    const permissoes = screen.getByRole('dialog', { name: 'Permissões' })
    expect(within(permissoes).getByRole('heading', { name: 'Revolut' })).toBeInTheDocument()
    expect(within(permissoes).getByText('Vai poder ver')).toBeInTheDocument()
    expect(within(permissoes).getByText('Nunca vai poder')).toBeInTheDocument()
    expect(within(permissoes).getByText('180 dias')).toBeInTheDocument()
    expect(within(permissoes).getByText('Quando quiseres')).toBeInTheDocument()
    expect(within(permissoes).getByRole('link', { name: /Responsável/ })).toHaveAttribute(
      'href',
      expect.stringContaining('euclid.eba.europa.eu'),
    )
    expect(within(permissoes).getByRole('button', { name: 'Continuar' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Voltar à lista' }))

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Permissões' })).not.toBeInTheDocument(),
    )
    expect(screen.getByRole('button', { name: /Revolut/ })).toBeInTheDocument()
  })

  it('procurar filtra os bancos, sem acentos nem maiúsculas', async () => {
    servidorMsw.use(
      http.get('/api/open-banking/bancos', () =>
        HttpResponse.json([
          { name: 'Revolut', country: 'PT' },
          { name: 'Caixa Geral de Depósitos', country: 'PT' },
          { name: 'Crédito Agrícola', country: 'PT' },
        ]),
      ),
    )
    montar()
    await userEvent.click(screen.getByRole('button', { name: /Ligar um banco/ }))
    await screen.findByRole('button', { name: /Revolut/ })

    await userEvent.type(screen.getByRole('textbox', { name: 'Procurar banco' }), 'agricola')
    expect(screen.getByRole('button', { name: /Crédito Agrícola/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Revolut/ })).not.toBeInTheDocument()

    await userEvent.clear(screen.getByRole('textbox', { name: 'Procurar banco' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Procurar banco' }), 'xyz')
    expect(screen.getByText('Sem resultados para «xyz».')).toBeInTheDocument()
  })

  it('a lista de bancos tem uma secção por letra', async () => {
    servidorMsw.use(
      http.get('/api/open-banking/bancos', () =>
        HttpResponse.json([
          { name: 'Revolut', country: 'PT' },
          { name: 'Caixa Geral de Depósitos', country: 'PT' },
          { name: 'Crédito Agrícola', country: 'PT' },
        ]),
      ),
    )
    montar()

    await userEvent.click(screen.getByRole('button', { name: /Ligar um banco/ }))
    await screen.findByRole('button', { name: /Revolut/ })

    // "C" aparece uma vez só, para as duas; "R" para a Revolut.
    expect(screen.getAllByText('C')).toHaveLength(1)
    expect(screen.getAllByText('R')).toHaveLength(1)
  })

  it('trocar de país refaz o pedido de bancos', async () => {
    servidorMsw.use(
      http.get('/api/open-banking/bancos', ({ request }) => {
        const pais = new URL(request.url).searchParams.get('pais')
        return HttpResponse.json(
          pais === 'ES'
            ? [{ name: 'BBVA', country: 'ES' }]
            : [{ name: 'Caixa Geral de Depósitos', country: 'PT' }],
        )
      }),
    )
    montar()

    await userEvent.click(screen.getByRole('button', { name: /Ligar um banco/ }))
    expect(
      await screen.findByRole('button', { name: /Caixa Geral de Depósitos/ }),
    ).toBeInTheDocument()

    await userEvent.click(screen.getByText('Portugal'))
    await userEvent.click(screen.getByText('Espanha'))

    expect(await screen.findByRole('button', { name: /BBVA/ })).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Caixa Geral de Depósitos/ }),
    ).not.toBeInTheDocument()
  })

  it('"‹" no passo "banco" volta à escolha', async () => {
    servidorMsw.use(http.get('/api/open-banking/bancos', () => HttpResponse.json([])))
    montar()

    await userEvent.click(screen.getByRole('button', { name: /Ligar um banco/ }))
    expect(screen.getByLabelText('País')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Voltar' }))

    await waitFor(() => expect(screen.queryByLabelText('País')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Adicionar manualmente' })).toBeInTheDocument()
  })

  describe('ao voltar do banco (?autorizacao=)', () => {
    const CGD = {
      id: 'cl-1',
      banco: 'Caixa Geral de Depósitos',
      iban: 'PT50001800031497057802084',
      moeda: 'EUR',
      nome_titular: 'Rui',
      conta_id: null,
      conta_nome: null,
      valido_ate: '2027-04-01T10:00:00+00:00',
      tipo_sugerido: 'Conta à ordem',
      nome_sugerido: 'Conta à ordem CGD',
      conta_antiga: null,
      // "satisfies" pede ao TypeScript que confirme que o exemplo tem a
      // forma da resposta da API, para uma mudança de nomes não passar
      // despercebida.
    } satisfies ContaBancaria

    function respostaCriada(contaId: string, movimentos: number) {
      return HttpResponse.json({
        conta_id: contaId,
        nome: 'CGD',
        banco: 'Caixa Geral de Depósitos',
        moeda: 'EUR',
        data_ancora: '2026-01-01',
        saldo_ancora: '0.00',
        movimentos_importados: movimentos,
      })
    }

    it('com uma conta só: não pergunta quais, configura-se como no manual, e termina no detalhe', async () => {
      let nomeRecebido: string | null = null
      let tipoRecebido: string | null = null
      // Valor-sentinela: distingue "pedido não feito" de "feito sem data_de".
      let dataDeRecebida: string | null = 'pedido-por-fazer'
      servidorMsw.use(
        http.get('/api/contas', () => HttpResponse.json([])),
        http.get('/api/open-banking/autorizacoes/lig-1/contas-bancarias', () => HttpResponse.json([CGD])),
        http.post('/api/open-banking/contas-bancarias/cl-1/criar-conta', ({ request }) => {
          const parametros = new URL(request.url).searchParams
          nomeRecebido = parametros.get('nome')
          tipoRecebido = parametros.get('tipo')
          dataDeRecebida = parametros.get('data_de')
          return respostaCriada('nova-3', 5)
        }),
      )
      montar('/contas/nova?autorizacao=lig-1')

      // O nome começa vazio, com a sugestão como exemplo; o tipo vem
      // preenchido; o que vem do banco está à vista, bloqueado (o IBAN
      // abreviado) — sem nenhum ecrã de "contas encontradas" pelo meio.
      const nome = await screen.findByLabelText('Nome')
      expect(nome).toHaveValue('')
      expect(nome).toHaveAttribute('placeholder', 'Ex.: Conta à ordem CGD')
      expect(screen.getByText('PT50 •••• 2084')).toBeInTheDocument()
      expect(screen.queryByText(/contas encontradas/)).not.toBeInTheDocument()

      // Sem nome, o ✓ não fica ativo — como no manual.
      const adicionar = screen.getByRole('button', { name: 'Adicionar conta' })
      expect(adicionar).toBeDisabled()
      await userEvent.type(nome, 'Ordenado')
      await userEvent.click(adicionar)

      expect(await screen.findByText('Conta adicionada')).toBeInTheDocument()
      // Quantos movimentos vieram e desde quando — a data mais antiga que o
      // banco disponibilizou (a data_ancora devolvida pelo backend).
      expect(screen.getByText('5 movimentos desde 01/01/2026')).toBeInTheDocument()
      expect(nomeRecebido).toBe('Ordenado')
      expect(tipoRecebido).toBe('Conta à ordem')
      expect(dataDeRecebida).toBeNull()

      await userEvent.click(screen.getByRole('button', { name: 'Ver conta' }))
      expect(await screen.findByText('detalhe da conta')).toBeInTheDocument()
    })

    it('sem movimentos importados, não mostra nenhum "desde"', async () => {
      // Sem movimentos, a data devolvida seria só a de hoje — mostrá-la
      // como "desde" sugeriria um histórico que não existe.
      servidorMsw.use(
        http.get('/api/contas', () => HttpResponse.json([])),
        http.get('/api/open-banking/autorizacoes/lig-1/contas-bancarias', () => HttpResponse.json([CGD])),
        http.post('/api/open-banking/contas-bancarias/cl-1/criar-conta', () =>
          respostaCriada('nova-4', 0),
        ),
      )
      montar('/contas/nova?autorizacao=lig-1')

      await userEvent.type(await screen.findByLabelText('Nome'), 'Ordenado')
      await userEvent.click(screen.getByRole('button', { name: 'Adicionar conta' }))

      expect(await screen.findByText('Conta adicionada')).toBeInTheDocument()
      expect(screen.getByText('0 movimentos')).toBeInTheDocument()
      expect(screen.queryByText(/desde/)).not.toBeInTheDocument()
    })

    it('desligar "Todo o histórico" mostra "Desde", que se escolhe no calendário', async () => {
      let dataDeRecebida: string | null = null
      servidorMsw.use(
        http.get('/api/contas', () => HttpResponse.json([])),
        http.get('/api/open-banking/autorizacoes/lig-1/contas-bancarias', () => HttpResponse.json([CGD])),
        http.post('/api/open-banking/contas-bancarias/cl-1/criar-conta', ({ request }) => {
          dataDeRecebida = new URL(request.url).searchParams.get('data_de')
          return respostaCriada('nova-3', 2)
        }),
      )
      montar('/contas/nova?autorizacao=lig-1')
      await userEvent.type(await screen.findByLabelText('Nome'), 'Ordenado')

      expect(screen.queryByRole('button', { name: /Desde/ })).not.toBeInTheDocument()
      await userEvent.click(screen.getByRole('switch', { name: 'Todo o histórico' }))

      // Começa no início do ano; em ecrã largo, o calendário abre por baixo
      // do campo e tocar num dia muda logo a data. Escolhe-se o dia 1 de
      // janeiro: nunca está no futuro (os dias futuros estão desativados),
      // por isso o teste passa em qualquer dia do ano, incluindo de 1 a 14
      // de janeiro, quando o dia 15 ainda não chegou.
      const ano = new Date().getFullYear()
      await userEvent.click(screen.getByRole('button', { name: /Desde/ }))
      await userEvent.click(screen.getByRole('button', { name: `1 de janeiro de ${ano}` }))
      await userEvent.click(screen.getByRole('button', { name: 'Adicionar conta' }))

      await screen.findByText('Conta adicionada')
      expect(dataDeRecebida).toBe(`${ano}-01-01`)
    })

    it('com várias contas: escolhe-se quais, e só essas são criadas', async () => {
      const criadas: string[] = []
      servidorMsw.use(
        http.get('/api/contas', () => HttpResponse.json([])),
        http.get('/api/open-banking/autorizacoes/lig-1/contas-bancarias', () =>
          HttpResponse.json([
            { ...CGD, id: 'cl-1', iban: 'PT50000000000000000004021', moeda: 'EUR', tipo_sugerido: null },
            { ...CGD, id: 'cl-2', iban: 'PT50000000000000000007780', moeda: 'USD', tipo_sugerido: null },
            // Já nas tuas contas (a ligação renovou-se): aparece à parte,
            // sem se poder escolher.
            { ...CGD, id: 'cl-3', conta_id: 'antiga', conta_nome: 'Ordenado' },
          ]),
        ),
        http.post('/api/open-banking/contas-bancarias/:id/criar-conta', ({ params }) => {
          criadas.push(String(params.id))
          return respostaCriada(`nova-${params.id}`, 7)
        }),
      )
      montar('/contas/nova?autorizacao=lig-1')

      expect(await screen.findByText('3 contas encontradas')).toBeInTheDocument()
      expect(screen.getByText('Já nas tuas contas')).toBeInTheDocument()
      expect(screen.getByText('Ordenado')).toBeInTheDocument()
      expect(screen.getByText('Ligação renovada até 1 abr 2027')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Continuar com 2 contas' })).toBeInTheDocument()

      await userEvent.click(screen.getByRole('checkbox', { name: /Conta USD/ }))
      await userEvent.click(screen.getByRole('button', { name: 'Continuar com 1 conta' }))

      const configurar = await screen.findByRole('dialog', { name: 'Configurar contas' })
      await userEvent.type(within(configurar).getByLabelText('Nome'), 'Principal')
      await userEvent.click(screen.getByRole('button', { name: 'Adicionar contas' }))

      expect(await screen.findByText('Conta adicionada')).toBeInTheDocument()
      expect(criadas).toEqual(['cl-1'])
    })

    it('se a criação falhar, diz o que falhou e deixa tentar outra vez', async () => {
      servidorMsw.use(
        http.get('/api/contas', () => HttpResponse.json([])),
        http.get('/api/open-banking/autorizacoes/lig-1/contas-bancarias', () => HttpResponse.json([CGD])),
        http.post('/api/open-banking/contas-bancarias/cl-1/criar-conta', () =>
          HttpResponse.json(
            { detail: 'O banco não aceitou o pedido. Tenta outra vez mais tarde.' },
            { status: 502 },
          ),
        ),
      )
      montar('/contas/nova?autorizacao=lig-1')
      await userEvent.type(await screen.findByLabelText('Nome'), 'Ordenado')

      await userEvent.click(screen.getByRole('button', { name: 'Adicionar conta' }))

      expect(await screen.findByText('Não foi possível adicionar')).toBeInTheDocument()
      expect(screen.getByText('O banco não aceitou o pedido. Tenta outra vez mais tarde.')).toBeInTheDocument()

      await userEvent.click(screen.getByRole('button', { name: 'Tentar outra vez' }))
      expect(await screen.findByLabelText('Nome')).toBeInTheDocument()
    })

    it('uma conta que já foi tua (desvinculada) diz qual era', async () => {
      servidorMsw.use(
        http.get('/api/contas', () => HttpResponse.json([])),
        http.get('/api/open-banking/autorizacoes/lig-1/contas-bancarias', () =>
          HttpResponse.json([
            { ...CGD, id: 'cl-1' },
            { ...CGD, id: 'cl-2', conta_antiga: { id: 'c-velha', nome: 'Cartão Caixa' } },
          ]),
        ),
      )
      montar('/contas/nova?autorizacao=lig-1')

      expect(await screen.findByText('Já foi a «Cartão Caixa»')).toBeInTheDocument()
    })

    it('se todas as contas já estão na app, diz isso e que a ligação se renovou', async () => {
      servidorMsw.use(
        http.get('/api/contas', () => HttpResponse.json([])),
        http.get('/api/open-banking/autorizacoes/lig-1/contas-bancarias', () =>
          HttpResponse.json([{ ...CGD, conta_id: 'c-1', conta_nome: 'Ordenado' }]),
        ),
      )
      montar('/contas/nova?autorizacao=lig-1')

      expect(await screen.findByText('Já está tudo nas tuas contas')).toBeInTheDocument()
      expect(screen.getByText('Ligação renovada até 1 abr 2027.')).toBeInTheDocument()
      expect(screen.getByText('Ordenado')).toBeInTheDocument()
    })
  })

  it('chegando com "?erro=" explica, e deixa tentar outra vez ou fazer à mão', async () => {
    servidorMsw.use(http.get('/api/open-banking/bancos', () => HttpResponse.json([])))
    montar('/contas/nova?erro=Autoriza%C3%A7%C3%A3o%20recusada.')

    expect(await screen.findByText('Não foi possível ligar ao banco')).toBeInTheDocument()
    // A mensagem técnica só aparece quando se pede.
    expect(screen.queryByText('Autorização recusada.')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Detalhes técnicos' }))
    expect(screen.getByText('Autorização recusada.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Adicionar manualmente' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Tentar outra vez' }))

    expect(await screen.findByLabelText('País')).toBeInTheDocument()
  })
})
