/*
 * TESTES DO MODAL "NOVO MOVIMENTO"
 * ================================
 *
 * Exercita também o MovimentoFormulario em modo de criação. A concha do
 * modal (arrasto, animações, Escape…) é a mesma Folha já testada a fundo
 * em ContaNova.test.tsx — aqui cobre-se só o que é próprio desta rota, e
 * uma vez a coordenação com a folha aninhada (o seletor de conta), para
 * confirmar que está ligada.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

import { servidorMsw } from '../test/servidor-msw'
import { definirEcraMobile } from '../test/setup'
import { MovimentoNovo } from './MovimentoNovo'

const CONTA = {
  id: 'c1',
  nome: 'Conta à ordem',
  banco: 'BPI',
  tipo: 'Conta corrente',
  moeda: 'EUR',
  data_ancora: '2026-01-01',
  saldo_ancora: '1000.00',
  saldo: '1000.00',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

// Árvore mínima, mas com o "Outros" protegido dos dois lados — é para lá
// que o formulário pré-preenche a categoria por omissão (ver
// categoriaRefugio, src/lib/categorias.ts); sem ele, o "✓" nunca ficaria
// ativo nestes testes, que não escolhem categoria explicitamente.
const ARVORE = [
  { id: 'g1', nome: 'Trabalho', direcao: 'entrada', subcategorias: [{ id: 'sub1', nome: 'Salário', protegida: false }] },
  { id: 'g2', nome: 'Outras Entradas', direcao: 'entrada', subcategorias: [{ id: 'sub2', nome: 'Outros', protegida: true }] },
  { id: 'g3', nome: 'Alimentação', direcao: 'saida', subcategorias: [{ id: 'sub3', nome: 'Supermercado', protegida: false }] },
  { id: 'g4', nome: 'Outras Saídas', direcao: 'saida', subcategorias: [{ id: 'sub4', nome: 'Outros', protegida: true }] },
]

function montar(entrada = '/movimentos/novo') {
  // Registado aqui, não em cada teste: todo o carregamento do formulário
  // precisa da árvore de categorias, tal como precisa das contas — mas só
  // alguns testes têm razão para se preocupar com o SEU conteúdo.
  servidorMsw.use(http.get('/api/categorias/arvore', () => HttpResponse.json(ARVORE)))
  return render(
    <MemoryRouter initialEntries={[entrada]}>
      <Routes>
        <Route path="/movimentos" element={<p>lista de movimentos</p>} />
        <Route path="/movimentos/novo" element={<MovimentoNovo />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('Página Novo movimento', () => {
  it('cria uma saída (valor negativo) e volta à lista', async () => {
    let corpoRecebido: Record<string, unknown> | null = null
    servidorMsw.use(
      http.get('/api/contas', () => HttpResponse.json([CONTA])),
      http.post('/api/movimentos', async ({ request }) => {
        corpoRecebido = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({ id: 'm1' }, { status: 201 })
      }),
    )

    montar()

    // Em desktop, escolher a conta revela a lista em linha, por baixo do
    // campo (sem camada flutuante) — tal como em ContaFormulario.
    await userEvent.click(await screen.findByText('Escolher conta'))
    await userEvent.click(screen.getByText('Conta à ordem'))

    await userEvent.type(screen.getByLabelText('Descrição'), 'Supermercado')
    await userEvent.type(screen.getByLabelText(/Valor/), '49,90')
    // "Saída" já é a escolha por omissão do seletor de tipo.
    await userEvent.click(screen.getByRole('button', { name: 'Criar movimento' }))

    expect(await screen.findByText('lista de movimentos')).toBeInTheDocument()
    expect(corpoRecebido).toMatchObject({
      conta_id: 'c1',
      descricao: 'Supermercado',
      valor: '-49.90',
    })
  })

  it('escolher "Entrada" dá um valor positivo', async () => {
    let corpoRecebido: Record<string, unknown> | null = null
    servidorMsw.use(
      http.get('/api/contas', () => HttpResponse.json([CONTA])),
      http.post('/api/movimentos', async ({ request }) => {
        corpoRecebido = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({ id: 'm1' }, { status: 201 })
      }),
    )

    montar()
    await userEvent.click(await screen.findByText('Escolher conta'))
    await userEvent.click(screen.getByText('Conta à ordem'))

    // Tipo é um seletor (como a Conta): abre-se pelo valor atual ("Saída")
    // e escolhe-se "Entrada".
    await userEvent.click(screen.getByText('Saída'))
    await userEvent.click(screen.getByText('Entrada'))
    await userEvent.type(screen.getByLabelText('Descrição'), 'Salário')
    await userEvent.type(screen.getByLabelText(/Valor/), '1500')
    await userEvent.click(screen.getByRole('button', { name: 'Criar movimento' }))

    await screen.findByText('lista de movimentos')
    expect(corpoRecebido).toMatchObject({ valor: '1500.00' })
  })

  it('se a criação falhar, mostra o erro do servidor e o modal continua aberto', async () => {
    servidorMsw.use(
      http.get('/api/contas', () => HttpResponse.json([CONTA])),
      http.post('/api/movimentos', () =>
        HttpResponse.json({ detail: 'Conta não encontrada.' }, { status: 404 }),
      ),
    )

    montar()
    await userEvent.click(await screen.findByText('Escolher conta'))
    await userEvent.click(screen.getByText('Conta à ordem'))
    await userEvent.type(screen.getByLabelText('Descrição'), 'Supermercado')
    await userEvent.type(screen.getByLabelText(/Valor/), '10')
    await userEvent.click(screen.getByRole('button', { name: 'Criar movimento' }))

    expect(await screen.findByText('Conta não encontrada.')).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Novo movimento' })).toBeInTheDocument()
    expect(screen.queryByText('lista de movimentos')).not.toBeInTheDocument()
  })

  it('o "✓" só fica ativo com os campos obrigatórios preenchidos', async () => {
    servidorMsw.use(http.get('/api/contas', () => HttpResponse.json([CONTA])))
    montar()
    await screen.findByText('Escolher conta')

    // Sem conta escolhida, mesmo com o resto preenchido, o "✓" está
    // desativado — uma conta é sempre obrigatória.
    const confirmar = screen.getByRole('button', { name: 'Criar movimento' })
    await userEvent.type(screen.getByLabelText('Descrição'), 'Compras')
    await userEvent.type(screen.getByLabelText(/Valor/), '10')
    expect(confirmar).toBeDisabled()

    await userEvent.click(screen.getByText('Escolher conta'))
    await userEvent.click(screen.getByText('Conta à ordem'))
    expect(confirmar).toBeEnabled()
  })

  it('um valor de "0" não ativa o "✓"', async () => {
    servidorMsw.use(http.get('/api/contas', () => HttpResponse.json([CONTA])))
    montar()

    await userEvent.click(await screen.findByText('Escolher conta'))
    await userEvent.click(screen.getByText('Conta à ordem'))
    await userEvent.type(screen.getByLabelText('Descrição'), 'Nada')
    await userEvent.type(screen.getByLabelText(/Valor/), '0')

    expect(screen.getByRole('button', { name: 'Criar movimento' })).toBeDisabled()
  })

  it('sem contas nenhumas, pede para criar uma conta em vez do formulário', async () => {
    servidorMsw.use(http.get('/api/contas', () => HttpResponse.json([])))
    montar()

    expect(await screen.findByText('Precisas de uma conta primeiro.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Criar conta' })).toHaveAttribute(
      'href',
      '/contas/nova',
    )
    expect(screen.queryByLabelText('Descrição')).not.toBeInTheDocument()
  })

  it('se o pedido das contas falhar, mostra o erro — NUNCA "Precisas de uma conta primeiro"', async () => {
    // Regressão: um pedido falhado (rede, servidor) era tratado
    // exactamente como "chegou e é uma lista vazia" — um utilizador com
    // contas de sobra via a mensagem de conta VAZIA, e era convidado a
    // criar mais uma que já tem.
    servidorMsw.use(
      http.get('/api/contas', () =>
        HttpResponse.json({ detail: 'Falha de rede.' }, { status: 500 }),
      ),
    )
    montar()

    expect(await screen.findByText('Falha de rede.')).toBeInTheDocument()
    expect(screen.queryByText('Precisas de uma conta primeiro.')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Descrição')).not.toBeInTheDocument()
  })

  it('se o pedido da árvore de categorias falhar, mostra o erro dentro do formulário (que continua utilizável)', async () => {
    servidorMsw.use(
      http.get('/api/contas', () => HttpResponse.json([CONTA])),
      http.get('/api/categorias/arvore', () =>
        HttpResponse.json({ detail: 'Falha de rede.' }, { status: 500 }),
      ),
    )
    // Não usa montar(): esse auxiliar regista sempre, por baixo, o seu
    // próprio handler de SUCESSO para "/api/categorias/arvore" — como é
    // chamado depois de qualquer "servidorMsw.use()" do próprio teste,
    // ganharia sempre ao handler de falha registado aqui.
    render(
      <MemoryRouter initialEntries={['/movimentos/novo']}>
        <Routes>
          <Route path="/movimentos" element={<p>lista de movimentos</p>} />
          <Route path="/movimentos/novo" element={<MovimentoNovo />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText('Falha de rede.')).toBeInTheDocument()
    // Ao contrário do erro das contas: o resto do formulário continua lá
    // (a conta já carregou, só a categoria é que falhou).
    expect(screen.getByLabelText('Descrição')).toBeInTheDocument()
  })

  it('em mobile, a conta escolhe-se num painel que entra da direita', async () => {
    definirEcraMobile(true)
    servidorMsw.use(
      http.get('/api/contas', () =>
        HttpResponse.json([CONTA, { ...CONTA, id: 'c2', nome: 'Poupança' }]),
      ),
    )
    montar()

    await userEvent.click(await screen.findByText('Escolher conta'))
    const painel = await screen.findByRole('dialog', { name: 'Conta' })
    await userEvent.click(within(painel).getByText('Poupança'))

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Conta' })).not.toBeInTheDocument(),
    )
    expect(screen.getByText('Poupança')).toBeInTheDocument()
  })

  it('arrastar o painel da conta para BAIXO abandona o fluxo (vai à lista)', async () => {
    definirEcraMobile(true)
    servidorMsw.use(
      http.get('/api/contas', () =>
        HttpResponse.json([CONTA, { ...CONTA, id: 'c2', nome: 'Poupança' }]),
      ),
    )
    montar()

    await userEvent.click(await screen.findByText('Escolher conta'))
    const painel = await screen.findByRole('dialog', { name: 'Conta' })
    // ".cabecalho" é o primeiro filho de ".painelInterior" (o invólucro
    // que recorta aos cantos arredondados — ver a nota em
    // Folha.module.css), não directamente de ".painel" (o próprio
    // "dialog", que só tem esse invólucro como filho único).
    const cabecalho = painel.firstElementChild?.firstElementChild as HTMLElement

    fireEvent.pointerDown(cabecalho, { clientX: 40, clientY: 80, pointerId: 1 })
    fireEvent.pointerMove(cabecalho, { clientX: 44, clientY: 330, pointerId: 1 })
    fireEvent.pointerUp(cabecalho, { clientX: 44, clientY: 330, pointerId: 1 })

    expect(await screen.findByText('lista de movimentos')).toBeInTheDocument()
  })

  it('é um modal e o "X" fecha-o (volta à lista)', async () => {
    servidorMsw.use(http.get('/api/contas', () => HttpResponse.json([CONTA])))
    montar()

    expect(await screen.findByRole('dialog', { name: 'Novo movimento' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Fechar' }))

    expect(await screen.findByText('lista de movimentos')).toBeInTheDocument()
  })
})
