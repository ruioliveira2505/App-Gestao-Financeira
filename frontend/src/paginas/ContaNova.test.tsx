/*
 * TESTES DO MODAL "NOVA CONTA"
 * ===========================
 *
 * Exercita também o ContaFormulario em modo de criação.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

import { servidorMsw } from '../test/servidor-msw'
import { definirEcraMobile } from '../test/setup'
import { ContaNova } from './ContaNova'

function montar(entrada = '/contas/nova') {
  return render(
    <MemoryRouter initialEntries={[entrada]}>
      <Routes>
        <Route path="/contas" element={<p>lista de contas</p>} />
        <Route path="/contas/nova" element={<ContaNova />} />
        <Route path="/contas/:id" element={<p>detalhe da conta</p>} />
      </Routes>
    </MemoryRouter>,
  )
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
    await userEvent.type(screen.getByLabelText('Saldo início'), '250,50')
    await userEvent.click(screen.getByRole('button', { name: 'Criar conta' }))

    expect(await screen.findByText('detalhe da conta')).toBeInTheDocument()
    // A vírgula decimal portuguesa foi convertida em ponto para a API.
    expect(corpoRecebido).toMatchObject({ nome: 'Revolut', saldo_ancora: '250.50' })
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
    await userEvent.type(screen.getByLabelText('Saldo início'), '100')
    await userEvent.click(screen.getByRole('button', { name: 'Criar conta' }))

    expect(await screen.findByText('Já existe uma conta com este nome.')).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Nova conta' })).toBeInTheDocument()
    expect(screen.queryByText('lista de contas')).not.toBeInTheDocument()
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
    await userEvent.type(screen.getByLabelText('Saldo início'), '100')
    expect(confirmar).toBeEnabled()
  })

  it('o campo de saldo não deixa escrever letras', async () => {
    servidorMsw.use(http.get('/api/contas', () => HttpResponse.json([])))
    montar()
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar manualmente' }))

    const saldo = screen.getByLabelText('Saldo início')
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

  it('em mobile, escreve um banco à mão pela linha "Adicionar banco"', async () => {
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

    // A linha "Adicionar banco" vira campo de escrita; escreve-se e confirma-se.
    await userEvent.click(
      within(painel).getByRole('button', { name: /Adicionar banco/ }),
    )
    await userEvent.type(
      within(painel).getByLabelText('Adicionar banco'),
      'Banco XPTO',
    )
    await userEvent.click(within(painel).getByRole('button', { name: 'Confirmar' }))

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Banco' })).not.toBeInTheDocument(),
    )
    expect(screen.getByText('Banco XPTO')).toBeInTheDocument()

    // O banco escrito à mão vai na criação da conta.
    await userEvent.type(screen.getByLabelText('Nome'), 'X')
    await userEvent.type(screen.getByLabelText('Saldo início'), '0')
    await userEvent.click(screen.getByRole('button', { name: 'Criar conta' }))
    await screen.findByText('detalhe da conta')
    expect(corpoRecebido).toMatchObject({ banco: 'Banco XPTO' })
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
    fireEvent.pointerUp(cabecalho, { clientX: 44, clientY: 330, pointerId: 1 })

    // As duas folhas saem e vai-se parar à página Contas.
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
        HttpResponse.json([{ name: 'Revolut', country: 'PT' }]),
      ),
    )
    montar()

    await userEvent.click(screen.getByRole('button', { name: /Ligar um banco/ }))
    await userEvent.click(await screen.findByRole('button', { name: /Revolut/ }))

    // Ecrã de permissões: identifica o banco, o que lê, o que não
    // consegue, e um botão que diz para onde se vai — não há "Continuar"
    // nenhum antes de escolher um banco.
    const permissoes = screen.getByRole('dialog', { name: 'Permissões' })
    expect(within(permissoes).getByRole('heading', { name: 'Revolut' })).toBeInTheDocument()
    expect(within(permissoes).getByText('Permite')).toBeInTheDocument()
    expect(within(permissoes).getByText('Não permite')).toBeInTheDocument()
    expect(
      within(permissoes).getByRole('button', { name: 'Continuar para Revolut' }),
    ).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Voltar à lista' }))

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Permissões' })).not.toBeInTheDocument(),
    )
    expect(screen.getByRole('button', { name: /Revolut/ })).toBeInTheDocument()
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

  describe('ao voltar do banco (?ligacao=)', () => {
    const CGD = {
      id: 'cl-1',
      banco: 'Caixa Geral de Depósitos',
      iban: 'PT50001800031497057802084',
      moeda: 'EUR',
      nome_titular: 'Rui',
      conta_id: null,
    }

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
      // Valor-sentinela: distingue "pedido não feito" de "feito sem data_de".
      let dataDeRecebida: string | null = 'pedido-por-fazer'
      servidorMsw.use(
        http.get('/api/contas', () => HttpResponse.json([])),
        http.get('/api/open-banking/ligacoes/lig-1/contas-ligadas', () => HttpResponse.json([CGD])),
        http.post('/api/open-banking/contas-ligadas/cl-1/associar-nova-conta', ({ request }) => {
          const parametros = new URL(request.url).searchParams
          nomeRecebido = parametros.get('nome')
          dataDeRecebida = parametros.get('data_de')
          return respostaCriada('nova-3', 5)
        }),
      )
      montar('/contas/nova?ligacao=lig-1')

      // O nome vem sugerido (o banco) e o que vem do banco está à vista,
      // bloqueado — sem nenhum ecrã de "escolhe as contas" pelo meio.
      expect(await screen.findByLabelText('Nome')).toHaveValue('Caixa Geral de Depósitos')
      expect(screen.getByText('PT50 0018 0003 1497 0578 0208 4')).toBeInTheDocument()
      expect(screen.queryByText(/Escolhe as que queres/)).not.toBeInTheDocument()

      await userEvent.click(screen.getByRole('button', { name: 'Adicionar conta' }))

      expect(await screen.findByText('Conta adicionada')).toBeInTheDocument()
      // Quantos movimentos vieram e desde quando — a data mais antiga que o
      // banco disponibilizou (a data_ancora devolvida pelo backend).
      expect(screen.getByText('5 movimentos desde 01/01/2026')).toBeInTheDocument()
      expect(nomeRecebido).toBe('Caixa Geral de Depósitos')
      expect(dataDeRecebida).toBeNull()

      await userEvent.click(screen.getByRole('button', { name: 'Ver conta' }))
      expect(await screen.findByText('detalhe da conta')).toBeInTheDocument()
    })

    it('sem movimentos importados, não mostra nenhum "desde"', async () => {
      // Sem movimentos, a data devolvida seria só a de hoje — mostrá-la
      // como "desde" sugeriria um histórico que não existe.
      servidorMsw.use(
        http.get('/api/contas', () => HttpResponse.json([])),
        http.get('/api/open-banking/ligacoes/lig-1/contas-ligadas', () => HttpResponse.json([CGD])),
        http.post('/api/open-banking/contas-ligadas/cl-1/associar-nova-conta', () =>
          respostaCriada('nova-4', 0),
        ),
      )
      montar('/contas/nova?ligacao=lig-1')

      await userEvent.click(await screen.findByRole('button', { name: 'Adicionar conta' }))

      expect(await screen.findByText('Conta adicionada')).toBeInTheDocument()
      expect(screen.getByText('0 movimentos')).toBeInTheDocument()
      expect(screen.queryByText(/desde/)).not.toBeInTheDocument()
    })

    it('"A partir de uma data" exige a data e envia-a ao backend', async () => {
      let dataDeRecebida: string | null = null
      servidorMsw.use(
        http.get('/api/contas', () => HttpResponse.json([])),
        http.get('/api/open-banking/ligacoes/lig-1/contas-ligadas', () => HttpResponse.json([CGD])),
        http.post('/api/open-banking/contas-ligadas/cl-1/associar-nova-conta', ({ request }) => {
          dataDeRecebida = new URL(request.url).searchParams.get('data_de')
          return respostaCriada('nova-3', 2)
        }),
      )
      montar('/contas/nova?ligacao=lig-1')
      await screen.findByLabelText('Nome')

      await userEvent.click(screen.getByText('Todo o histórico'))
      await userEvent.click(screen.getByText('A partir de uma data'))

      const adicionar = screen.getByRole('button', { name: 'Adicionar conta' })
      const desde = screen.getByLabelText('Desde')
      await userEvent.clear(desde)
      expect(adicionar).toBeDisabled()

      await userEvent.type(desde, '2026-06-01')
      expect(adicionar).toBeEnabled()
      await userEvent.click(adicionar)

      await screen.findByText('Conta adicionada')
      expect(dataDeRecebida).toBe('2026-06-01')
    })

    it('com várias contas: escolhe-se quais, e só essas são criadas', async () => {
      const criadas: string[] = []
      servidorMsw.use(
        http.get('/api/contas', () => HttpResponse.json([])),
        http.get('/api/open-banking/ligacoes/lig-1/contas-ligadas', () =>
          HttpResponse.json([
            { ...CGD, id: 'cl-1', iban: 'PT50000000000000000004021', moeda: 'EUR' },
            { ...CGD, id: 'cl-2', iban: 'PT50000000000000000007780', moeda: 'USD' },
            // Já associada numa visita anterior — nem aparece na escolha.
            { ...CGD, id: 'cl-3', conta_id: 'antiga' },
          ]),
        ),
        http.post('/api/open-banking/contas-ligadas/:id/associar-nova-conta', ({ params }) => {
          criadas.push(String(params.id))
          return respostaCriada(`nova-${params.id}`, 7)
        }),
      )
      montar('/contas/nova?ligacao=lig-1')

      expect(await screen.findByText(/Encontrámos 2 contas/)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Continuar com 2 contas' })).toBeInTheDocument()

      await userEvent.click(screen.getByRole('button', { name: /Conta USD/ }))
      await userEvent.click(screen.getByRole('button', { name: 'Continuar com 1 conta' }))

      const configurar = await screen.findByRole('dialog', { name: 'Configurar contas' })
      expect(within(configurar).getByLabelText('Nome')).toHaveValue('Caixa Geral de Depósitos')
      await userEvent.click(screen.getByRole('button', { name: 'Adicionar contas' }))

      expect(await screen.findByText('Conta adicionada')).toBeInTheDocument()
      expect(criadas).toEqual(['cl-1'])
    })

    it('se a criação falhar, diz o que falhou e deixa tentar outra vez', async () => {
      servidorMsw.use(
        http.get('/api/contas', () => HttpResponse.json([])),
        http.get('/api/open-banking/ligacoes/lig-1/contas-ligadas', () => HttpResponse.json([CGD])),
        http.post('/api/open-banking/contas-ligadas/cl-1/associar-nova-conta', () =>
          HttpResponse.json({ detail: 'Sessão expirada.' }, { status: 502 }),
        ),
      )
      montar('/contas/nova?ligacao=lig-1')
      await screen.findByLabelText('Nome')

      await userEvent.click(screen.getByRole('button', { name: 'Adicionar conta' }))

      expect(await screen.findByText('Não foi possível adicionar')).toBeInTheDocument()
      expect(screen.getByText('Sessão expirada.')).toBeInTheDocument()

      await userEvent.click(screen.getByRole('button', { name: 'Tentar outra vez' }))
      expect(await screen.findByLabelText('Nome')).toBeInTheDocument()
    })
  })

  it('chegando com "?erro=" explica, e deixa tentar outra vez ou fazer à mão', async () => {
    servidorMsw.use(http.get('/api/open-banking/bancos', () => HttpResponse.json([])))
    montar('/contas/nova?erro=Autoriza%C3%A7%C3%A3o%20recusada.')

    expect(await screen.findByText('Não foi possível ligar ao banco')).toBeInTheDocument()
    expect(screen.getByText('Autorização recusada.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Adicionar manualmente' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Tentar outra vez' }))

    expect(await screen.findByLabelText('País')).toBeInTheDocument()
  })
})
