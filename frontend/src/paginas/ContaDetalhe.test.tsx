/*
 * TESTES DA PÁGINA DE DETALHE DE UMA CONTA
 * =======================================
 */

import { render as renderBase, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { delay, http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

import { servidorMsw } from '../test/servidor-msw'
import { AuthProvider } from '../auth/AuthProvider'
import { ContaDetalhe } from './ContaDetalhe'
import { ComConsultas } from '../test/consultas'
import type { Conta } from '../lib/contas'

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
  // "satisfies Conta" pede ao TypeScript que confirme que este exemplo tem
  // a forma de uma Conta da API: se a API mudar um nome de campo, o
  // exemplo deixa de compilar, em vez de o teste passar com dados errados.
} satisfies Conta

const UTILIZADOR = { id: 'u1', email: 'ana@exemplo.pt', moeda_principal: 'EUR' }

function montar() {
  // AuthProvider real: ContaDetalhe usa useAuth() para saber a moeda
  // principal do utilizador (ver a nota "mostraConversao" em
  // ContaDetalhe.tsx).
  servidorMsw.use(http.get('/api/auth/me', () => HttpResponse.json(UTILIZADOR)))
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={['/contas/c1']}>
        <Routes>
          <Route path="/contas/:id" element={<ContaDetalhe />} />
          <Route path="/contas/:id/editar" element={<p>página de edição</p>} />
          <Route path="/contas" element={<p>lista de contas</p>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  )
}

describe('Página de detalhe de uma conta — aviso de chegada', () => {
  it('mostra o aviso vindo do "state" da navegação (ex.: "Conta criada")', async () => {
    servidorMsw.use(
      http.get('/api/auth/me', () => HttpResponse.json(UTILIZADOR)),
      http.get('/api/contas/c1', () => HttpResponse.json(CONTA)),
    )
    render(
      <AuthProvider>
        <MemoryRouter initialEntries={[{ pathname: '/contas/c1', state: { aviso: 'Conta criada' } }]}>
          <Routes>
            <Route path="/contas/:id" element={<ContaDetalhe />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>,
    )

    expect(await screen.findByText('Conta criada')).toBeInTheDocument()
  })

  it('sem aviso no "state", não mostra nenhum', async () => {
    servidorMsw.use(http.get('/api/contas/c1', () => HttpResponse.json(CONTA)))
    montar()

    await screen.findByRole('heading', { name: 'Conta à ordem' })
    expect(screen.queryByText('Conta criada')).not.toBeInTheDocument()
  })
})

describe('Página de detalhe de uma conta', () => {
  it('mostra o nome, o saldo e a ficha de detalhes', async () => {
    servidorMsw.use(http.get('/api/contas/c1', () => HttpResponse.json(CONTA)))

    montar()

    // O nome da conta é o título (vai para a barra de topo em mobile).
    expect(await screen.findByRole('heading', { name: 'Conta à ordem' })).toBeInTheDocument()
    // O saldo aparece em destaque e outra vez na ficha "Detalhes".
    expect(screen.getAllByText(/1.?000,00/).length).toBeGreaterThanOrEqual(1)
    // Ficha "Detalhes": banco, tipo, moeda e o ponto de partida.
    expect(screen.getByText('Banco')).toBeInTheDocument()
    expect(screen.getByText('BPI')).toBeInTheDocument()
    expect(screen.getByText('Tipo de conta')).toBeInTheDocument()
    expect(screen.getByText('Conta corrente')).toBeInTheDocument()
    expect(screen.getByText('Início dos movimentos')).toBeInTheDocument()
    expect(screen.getByText('Saldo de início')).toBeInTheDocument()
  })

  it('a acção "Editar" leva ao formulário de edição', async () => {
    servidorMsw.use(http.get('/api/contas/c1', () => HttpResponse.json(CONTA)))

    montar()

    const editar = await screen.findByRole('link', { name: 'Editar' })
    expect(editar).toHaveAttribute('href', '/contas/c1/editar')

    await userEvent.click(editar)
    expect(await screen.findByText('página de edição')).toBeInTheDocument()
  })

  it('não tem acção de eliminar (isso vive no formulário de edição)', async () => {
    servidorMsw.use(http.get('/api/contas/c1', () => HttpResponse.json(CONTA)))

    montar()
    await screen.findByRole('heading', { name: 'Conta à ordem' })

    expect(screen.queryByRole('button', { name: /eliminar|remover|apagar/i })).not.toBeInTheDocument()
  })

  it('mostra uma mensagem e uma saída quando a conta não carrega', async () => {
    servidorMsw.use(
      http.get('/api/contas/c1', () =>
        HttpResponse.json({ detail: 'Conta não encontrada.' }, { status: 404 }),
      ),
    )

    montar()

    expect(await screen.findByRole('alert')).toHaveTextContent('Conta não encontrada.')
    expect(screen.getByRole('link', { name: 'Voltar às contas' })).toHaveAttribute(
      'href',
      '/contas',
    )
  })

  it('mostra um esqueleto enquanto a conta carrega', async () => {
    servidorMsw.use(
      http.get('/api/contas/c1', async () => {
        await delay()
        return HttpResponse.json(CONTA)
      }),
    )

    montar()

    // Enquanto a resposta não chega, há um esqueleto anunciado como "status".
    expect(screen.getByRole('status', { name: 'A carregar a conta' })).toBeInTheDocument()
    // Quando a conta chega, o esqueleto dá lugar ao conteúdo.
    expect(await screen.findByRole('heading', { name: 'Conta à ordem' })).toBeInTheDocument()
    expect(
      screen.queryByRole('status', { name: 'A carregar a conta' }),
    ).not.toBeInTheDocument()
  })

  describe('conversão de moeda', () => {
    it('conta já na moeda principal: hero mostra só o saldo, sem valor original por baixo', async () => {
      // UTILIZADOR.moeda_principal é "EUR" (ver o topo do ficheiro); a
      // conta também — nada a converter.
      servidorMsw.use(http.get('/api/contas/c1', () => HttpResponse.json(CONTA)))

      montar()

      await screen.findByText('Saldo atual')
      // Em vez de procurar um prefixo de código ("EUR ") que o hero nunca
      // chega a renderizar (formatarDinheiro usa sempre símbolo, nunca
      // código) — o que faria esta asserção passar sempre, mesmo que o
      // valor original aparecesse por engano — confirma-se directamente,
      // dentro do bloco do hero (".perfil", o pai de "Saldo atual"), que
      // o valor só aparece UMA vez: sem segunda linha ".saldoOriginal".
      const perfil = screen.getByText('Saldo atual').closest('div') as HTMLElement
      expect(perfil.textContent?.match(/1.?000,00/g)?.length).toBe(1)
    })

    it('conta noutra moeda, com taxa disponível: hero mostra o convertido, e o original por baixo', async () => {
      servidorMsw.use(
        http.get('/api/contas/c1', () =>
          HttpResponse.json({
            ...CONTA,
            moeda: 'USD',
            saldo: '1000.00',
            saldo_convertido: '925.00',
          }),
        ),
      )

      montar()

      await screen.findByText('Saldo atual')
      // Restringido ao bloco do hero (".perfil"), não ao documento
      // inteiro: com saldo == saldo_ancora nesta ficha de teste, o valor
      // original coincide também com a ficha "Saldo de início" — mas essa
      // fica FORA de ".perfil", por isso contar ocorrências aqui dentro
      // não é afectado por essa duplicação, e confirma mesmo que aparecem
      // as DUAS linhas do hero (convertido + original), nem mais nem menos.
      const perfil = screen.getByText('Saldo atual').closest('div') as HTMLElement
      // "within" (não "textContent.match") para o texto do valor
      // convertido — getByText normaliza espaços em branco, incluindo o
      // espaço insecável que o Intl.NumberFormat insere entre o número e
      // o símbolo da moeda; comparar directamente contra "textContent" (a
      // seguir, só para a CONTAGEM de ocorrências) não faria essa
      // normalização, e "925,00 ?€" nunca bateria certo com esse espaço.
      expect(within(perfil).getByText(/925,00 ?€/)).toBeInTheDocument()
      expect(perfil.textContent?.match(/1.?000,00/g)?.length).toBe(1)
    })

    it('conta noutra moeda, sem taxa disponível: hero mostra só o valor original', async () => {
      servidorMsw.use(
        http.get('/api/contas/c1', () =>
          HttpResponse.json({ ...CONTA, moeda: 'USD', saldo: '1000.00', saldo_convertido: null }),
        ),
      )

      montar()

      await screen.findByText('Saldo atual')
      // Mesma lógica: dentro do hero, só pode aparecer o valor UMA vez
      // (sem ".saldoOriginal" a duplicá-lo) — ver a nota no teste acima.
      const perfil = screen.getByText('Saldo atual').closest('div') as HTMLElement
      expect(perfil.textContent?.match(/1.?000,00/g)?.length).toBe(1)
    })
  })
})

const CONTA_LIGADA = {
  ...CONTA,
  vinculo: {
    conta_bancaria_id: 'cl-1',
    banco: 'Caixa Geral de Depósitos',
    // Daqui a 90 dias, calculado a cada execução: com uma data fixa, a
    // ligação passaria a "expirada" sozinha no dia em que a data passasse,
    // e os testes falhariam sem nada ter mudado no código.
    valido_ate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
  },
} satisfies Conta

describe('Página de detalhe de uma conta — Open Banking', () => {
  it('conta manual não mostra a secção Open Banking', async () => {
    servidorMsw.use(http.get('/api/contas/c1', () => HttpResponse.json(CONTA)))
    montar()

    await screen.findByRole('heading', { name: 'Conta à ordem' })
    expect(screen.queryByText('Open Banking')).not.toBeInTheDocument()
  })

  it('conta ligada mostra o banco e as acções Sincronizar agora e Desvincular', async () => {
    servidorMsw.use(http.get('/api/contas/c1', () => HttpResponse.json(CONTA_LIGADA)))
    montar()

    await screen.findByText('Ligada a Caixa Geral de Depósitos.')
    expect(screen.getByRole('button', { name: 'Sincronizar agora' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Desvincular' })).toBeInTheDocument()
  })

  it('"Sincronizar agora" mostra quantos movimentos novos entraram', async () => {
    servidorMsw.use(
      http.get('/api/contas/c1', () => HttpResponse.json(CONTA_LIGADA)),
      http.post('/api/open-banking/contas-bancarias/cl-1/sincronizar', () =>
        HttpResponse.json({ movimentos_importados: 3 }),
      ),
    )
    montar()

    await userEvent.click(await screen.findByRole('button', { name: 'Sincronizar agora' }))

    expect(await screen.findByText('3 movimento(s) novo(s) importado(s).')).toBeInTheDocument()
  })

  it('"Sincronizar agora" mostra um erro se o pedido falhar', async () => {
    servidorMsw.use(
      http.get('/api/contas/c1', () => HttpResponse.json(CONTA_LIGADA)),
      http.post('/api/open-banking/contas-bancarias/cl-1/sincronizar', () =>
        HttpResponse.json({ detail: 'A autorização deste banco já terminou. É preciso autorizá-lo outra vez.' }, { status: 409 }),
      ),
    )
    montar()

    await userEvent.click(await screen.findByRole('button', { name: 'Sincronizar agora' }))

    expect(await screen.findByText('A autorização deste banco já terminou. É preciso autorizá-lo outra vez.')).toBeInTheDocument()
  })

  it('"Desvincular" pede confirmação e, ao confirmar, remove a secção', async () => {
    // Depois de desvincular, a página volta a pedir a conta ao servidor
    // (invalida a cache) — que já a devolve sem ligação.
    let desvinculada = false
    servidorMsw.use(
      http.get('/api/contas/c1', () =>
        HttpResponse.json(desvinculada ? { ...CONTA_LIGADA, vinculo: null } : CONTA_LIGADA),
      ),
      http.delete('/api/open-banking/contas-bancarias/cl-1/vinculo', () => {
        desvinculada = true
        return new HttpResponse(null, { status: 204 })
      }),
    )
    montar()

    await userEvent.click(await screen.findByRole('button', { name: 'Desvincular' }))
    expect(
      await screen.findByRole('heading', { name: 'Desvincular conta' }),
    ).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Sim, desvincular' }))

    await waitFor(() => expect(screen.queryByText('Open Banking')).not.toBeInTheDocument())
  })
})
