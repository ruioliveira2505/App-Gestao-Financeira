/*
 * TESTES DA PÁGINA "EDITAR CONTA"
 * ==============================
 *
 * Cobre o carregamento do formulário preenchido e — o que é próprio desta
 * página — as acções no fim: "Desvincular" (numa conta com vínculo ao
 * banco) e "Eliminar conta", cada uma com diálogo de confirmação.
 */

import { fireEvent, render as renderBase, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

import { AuthProvider } from '../auth/AuthProvider'
import { servidorMsw } from '../test/servidor-msw'
import { definirEcraMobile } from '../test/setup'
import { ContaEditar } from './ContaEditar'
import { ComConsultas } from '../test/consultas'
import { escutarAvisos } from '../lib/avisoPendente'

// Todas as montagens deste ficheiro levam a cache dos dados do servidor à
// volta (a app recebe-a em main.tsx; aqui, cada montagem tem uma nova —
// ver test/consultas.tsx). "wrapper" é a opção do Testing Library para
// envolver o que se monta num componente.
function render(ui: Parameters<typeof renderBase>[0]) {
  return renderBase(ui, { wrapper: ComConsultas })
}

const CONTA = {
  id: 'c1',
  nome: 'Conta à ordem',
  banco: 'BPI',
  tipo: 'Conta corrente',
  moeda: 'EUR',
  data_ancora: '2026-01-01',
  saldo_ancora: '1000.00',
  saldo: '1000.00',
  saldo_convertido: null,
  vinculo: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

function montar() {
  // O formulário lê do utilizador autenticado a moeda principal.
  servidorMsw.use(
    http.get('/api/auth/me', () =>
      HttpResponse.json({ id: 'u1', email: 'ana@exemplo.pt', moeda_principal: 'EUR' }),
    ),
  )
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={['/contas/c1/editar']}>
        <Routes>
          <Route path="/contas/:id/editar" element={<ContaEditar />} />
          <Route path="/contas/:id" element={<p>detalhe da conta</p>} />
          <Route path="/contas" element={<p>lista de contas</p>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  )
}

describe('Página Editar conta', () => {
  it('em mobile, é uma folha e o "✓" guarda as alterações', async () => {
    definirEcraMobile(true)
    let corpoRecebido: Record<string, unknown> | null = null
    servidorMsw.use(
      http.get('/api/contas/c1', () => HttpResponse.json(CONTA)),
      http.get('/api/contas', () => HttpResponse.json([CONTA])),
      http.patch('/api/contas/c1', async ({ request }) => {
        corpoRecebido = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({ ...CONTA, nome: 'Conta renomeada' })
      }),
    )

    montar()

    await screen.findByRole('dialog', { name: 'Editar conta' })
    const nome = screen.getByLabelText('Nome')
    await userEvent.clear(nome)
    await userEvent.type(nome, 'Conta renomeada')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar alterações' }))

    expect(await screen.findByText('detalhe da conta')).toBeInTheDocument()
    expect(corpoRecebido).toMatchObject({ nome: 'Conta renomeada' })
    // E deixou à página da conta o aviso «Alterações guardadas».
    const recebidos: string[] = []
    escutarAvisos('c1', (texto) => recebidos.push(texto))()
    expect(recebidos).toEqual(['Alterações guardadas'])
  })

  it('em mobile, arrastar o seletor de moeda para baixo abandona a edição', async () => {
    definirEcraMobile(true)
    servidorMsw.use(
      http.get('/api/contas/c1', () => HttpResponse.json(CONTA)),
      http.get('/api/contas', () => HttpResponse.json([CONTA])),
    )

    montar()

    await screen.findByRole('dialog', { name: 'Editar conta' })
    await userEvent.click(screen.getByText(/Euro/))
    const painelMoeda = await screen.findByRole('dialog', { name: 'Moeda' })
    // ".cabecalho" é o primeiro filho de ".painelInterior", não
    // directamente do "dialog" — ver a nota em Folha.module.css.
    const cabecalho = painelMoeda.firstElementChild?.firstElementChild as HTMLElement

    fireEvent.pointerDown(cabecalho, { clientX: 40, clientY: 80, pointerId: 1 })
    fireEvent.pointerMove(cabecalho, { clientX: 44, clientY: 330, pointerId: 1 })
    fireEvent.pointerUp(cabecalho, { clientX: 44, clientY: 330, pointerId: 1 })

    // Como no "Nova conta": as duas folhas saem juntas e vai-se parar ao
    // detalhe da conta (o destino de sair da edição).
    expect(await screen.findByText('detalhe da conta')).toBeInTheDocument()
  })

  it('em desktop, o seletor de banco abre a lista por baixo do campo', async () => {
    servidorMsw.use(
      http.get('/api/contas/c1', () => HttpResponse.json(CONTA)),
      http.get('/api/contas', () => HttpResponse.json([CONTA])),
    )

    montar()

    await screen.findByLabelText('Nome')
    // O campo "Banco" mostra "BPI"; clicar abre a lista NO SÍTIO.
    await userEvent.click(screen.getByText('BPI'))

    // Não abre um diálogo/modal — a lista fica em linha, com o campo de
    // procurar ou adicionar no topo.
    expect(screen.queryByRole('dialog', { name: 'Banco' })).not.toBeInTheDocument()
    expect(
      screen.getByRole('textbox', { name: 'Procurar ou adicionar banco' }),
    ).toBeInTheDocument()

    // Escolher "Sem banco" fecha a lista e muda o valor.
    await userEvent.click(screen.getByRole('button', { name: 'Sem banco' }))
    expect(
      screen.queryByRole('textbox', { name: 'Procurar ou adicionar banco' }),
    ).not.toBeInTheDocument()
    expect(screen.getByText('Sem banco')).toBeInTheDocument()
  })

  it('mostra o formulário preenchido com os dados da conta', async () => {
    servidorMsw.use(
      http.get('/api/contas/c1', () => HttpResponse.json(CONTA)),
      // O formulário pede a lista de contas para as sugestões.
      http.get('/api/contas', () => HttpResponse.json([CONTA])),
    )

    montar()

    expect(await screen.findByLabelText('Nome')).toHaveValue('Conta à ordem')
    // O campo "Banco" é agora um seletor: mostra o valor atual como texto.
    expect(screen.getByText('BPI')).toBeInTheDocument()
  })

  it('elimina a conta após confirmação e volta à lista', async () => {
    let eliminou = false
    servidorMsw.use(
      http.get('/api/contas/c1', () => HttpResponse.json(CONTA)),
      http.get('/api/contas', () => HttpResponse.json([CONTA])),
      http.delete('/api/contas/c1', () => {
        eliminou = true
        return new HttpResponse(null, { status: 204 })
      }),
    )

    montar()
    await userEvent.click(await screen.findByRole('button', { name: 'Eliminar conta' }))

    // Aparece o diálogo de confirmação; o botão de confirmar diz "Eliminar".
    const dialogo = await screen.findByRole('dialog', { name: 'Eliminar conta' })
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Eliminar' }))

    expect(await screen.findByText('lista de contas')).toBeInTheDocument()
    expect(eliminou).toBe(true)
  })

  it('eliminar recua por cima do detalhe (que já não existe) até à lista', async () => {
    servidorMsw.use(
      http.get('/api/auth/me', () =>
        HttpResponse.json({ id: 'u1', email: 'ana@exemplo.pt', moeda_principal: 'EUR' }),
      ),
      http.get('/api/contas/c1', () => HttpResponse.json(CONTA)),
      http.get('/api/contas', () => HttpResponse.json([CONTA])),
      http.delete('/api/contas/c1', () => new HttpResponse(null, { status: 204 })),
    )
    // Histórico: lista → detalhe → editar (aberto a partir do detalhe, que
    // por sua vez foi aberto dentro da app — o "state" que o detalhe passa).
    render(
      <AuthProvider>
        <MemoryRouter
          initialEntries={[
            '/contas',
            '/contas/c1',
            { pathname: '/contas/c1/editar', state: { detalheVeioDeDentro: true } },
          ]}
          initialIndex={2}
        >
          <Routes>
            <Route path="/contas/:id/editar" element={<ContaEditar />} />
            <Route path="/contas/:id" element={<p>detalhe da conta</p>} />
            <Route path="/contas" element={<p>lista de contas</p>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>,
    )
    await userEvent.click(await screen.findByRole('button', { name: 'Eliminar conta' }))
    const dialogo = await screen.findByRole('dialog', { name: 'Eliminar conta' })
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Eliminar' }))

    // Recuou DUAS páginas: não para no detalhe da conta eliminada.
    expect(await screen.findByText('lista de contas')).toBeInTheDocument()
    expect(screen.queryByText('detalhe da conta')).not.toBeInTheDocument()
  })

  it('cancela a eliminação sem apagar nada', async () => {
    let eliminou = false
    servidorMsw.use(
      http.get('/api/contas/c1', () => HttpResponse.json(CONTA)),
      http.get('/api/contas', () => HttpResponse.json([CONTA])),
      http.delete('/api/contas/c1', () => {
        eliminou = true
        return new HttpResponse(null, { status: 204 })
      }),
    )

    montar()
    await userEvent.click(await screen.findByRole('button', { name: 'Eliminar conta' }))
    const dialogo = await screen.findByRole('dialog', { name: 'Eliminar conta' })
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Cancelar' }))

    // Fecha o action sheet de confirmação (o modal "Editar conta" fica).
    // (Fecha a descer — espera-se pelo fim da animação de saída.)
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Eliminar conta' })).not.toBeInTheDocument(),
    )
    expect(eliminou).toBe(false)
  })

  it('se o pedido da conta falhar, mostra o erro em vez do formulário', async () => {
    servidorMsw.use(
      http.get('/api/contas/c1', () =>
        HttpResponse.json({ detail: 'Falha de rede.' }, { status: 500 }),
      ),
    )

    montar()

    expect(await screen.findByRole('alert')).toHaveTextContent('Falha de rede.')
    expect(screen.queryByLabelText('Nome')).not.toBeInTheDocument()
  })

  it('se guardar falhar, mostra o erro dentro do formulário (que continua aberto)', async () => {
    servidorMsw.use(
      http.get('/api/contas/c1', () => HttpResponse.json(CONTA)),
      http.get('/api/contas', () => HttpResponse.json([CONTA])),
      http.patch('/api/contas/c1', () =>
        HttpResponse.json({ detail: 'Nome já usado noutra conta.' }, { status: 409 }),
      ),
    )

    montar()
    await screen.findByRole('dialog', { name: 'Editar conta' })
    await userEvent.click(screen.getByRole('button', { name: 'Guardar alterações' }))

    expect(await screen.findByText('Nome já usado noutra conta.')).toBeInTheDocument()
    // O modal continua aberto — não houve navegação para o detalhe.
    expect(screen.getByRole('dialog', { name: 'Editar conta' })).toBeInTheDocument()
  })

  it('se eliminar falhar, mostra o erro junto ao botão — sem perder o formulário', async () => {
    // Regressão: o erro de eliminar reutilizava o mesmo estado do erro de
    // CARREGAR a conta, e esse estado faz a página inteira dar lugar a uma
    // mensagem — perdendo o formulário só porque a eliminação falhou.
    servidorMsw.use(
      http.get('/api/contas/c1', () => HttpResponse.json(CONTA)),
      http.get('/api/contas', () => HttpResponse.json([CONTA])),
      http.delete('/api/contas/c1', () =>
        HttpResponse.json({ detail: 'A conta tem movimentos associados.' }, { status: 409 }),
      ),
    )

    montar()
    await userEvent.click(await screen.findByRole('button', { name: 'Eliminar conta' }))
    const dialogo = await screen.findByRole('dialog', { name: 'Eliminar conta' })
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Eliminar' }))

    expect(await screen.findByText('A conta tem movimentos associados.')).toBeInTheDocument()
    // O diálogo de confirmação fecha, mas o formulário de edição fica.
    expect(screen.queryByRole('dialog', { name: 'Eliminar conta' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Editar conta' })).toBeInTheDocument()
    expect(screen.getByLabelText('Nome')).toBeInTheDocument()
  })

  describe('desvincular', () => {
    const VINCULO = {
      conta_bancaria_id: 'cb-1',
      banco: 'Caixa Geral de Depósitos',
      titular: 'Rui Oliveira',
      valido_ate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
      autorizacao_id: 'a-1',
      iban: null,
      sincronizado_em: null,
      suspensa_desde: null,
      autorizacao_terminada_em: null,
      falha_em: null,
      falha_motivo: null,
      estado: 'vinculada',
      motivo: null,
    }

    it('numa conta manual não há «Desvincular»', async () => {
      servidorMsw.use(http.get('/api/contas/c1', () => HttpResponse.json(CONTA)))

      montar()

      await screen.findByRole('button', { name: 'Eliminar conta' })
      expect(screen.queryByRole('button', { name: 'Desvincular' })).not.toBeInTheDocument()
    })

    it('numa conta vinculada, «Desvincular» pede confirmação e só depois desvincula', async () => {
      let vinculada = true
      servidorMsw.use(
        http.get('/api/contas/c1', () => HttpResponse.json({ ...CONTA, vinculo: vinculada ? VINCULO : null })),
        http.delete('/api/open-banking/contas-bancarias/cb-1/vinculo', () => {
          vinculada = false
          return new HttpResponse(null, { status: 204 })
        }),
      )

      montar()
      await userEvent.click(await screen.findByRole('button', { name: 'Desvincular' }))
      expect(vinculada).toBe(true)

      const dialogo = await screen.findByRole('dialog', { name: 'Desvincular conta' })
      expect(dialogo).toHaveTextContent('Caixa Geral de Depósitos')
      await userEvent.click(within(dialogo).getByRole('button', { name: 'Desvincular' }))

      // A conta passou a manual: o botão desaparece da folha.
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Desvincular' })).not.toBeInTheDocument())
      expect(vinculada).toBe(false)
    })

    it('se desvincular falhar, mostra o erro junto ao botão, que continua lá', async () => {
      servidorMsw.use(
        http.get('/api/contas/c1', () => HttpResponse.json({ ...CONTA, vinculo: VINCULO })),
        http.delete('/api/open-banking/contas-bancarias/cb-1/vinculo', () =>
          HttpResponse.json({ detail: 'Outra operação a decorrer nesta conta.' }, { status: 409 }),
        ),
      )

      montar()
      await userEvent.click(await screen.findByRole('button', { name: 'Desvincular' }))
      const dialogo = await screen.findByRole('dialog', { name: 'Desvincular conta' })
      await userEvent.click(within(dialogo).getByRole('button', { name: 'Desvincular' }))

      expect(await screen.findByText('Outra operação a decorrer nesta conta.')).toBeInTheDocument()
      expect(screen.queryByRole('dialog', { name: 'Desvincular conta' })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Desvincular' })).toBeInTheDocument()
    })
  })
})
