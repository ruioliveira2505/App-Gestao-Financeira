/*
 * TESTES DA PÁGINA DE DETALHE DE UMA CONTA
 * =======================================
 */

import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { delay, http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

import { servidorMsw } from '../test/servidor-msw'
import { AuthProvider } from '../auth/AuthProvider'
import { ContaDetalhe } from './ContaDetalhe'

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
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

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
