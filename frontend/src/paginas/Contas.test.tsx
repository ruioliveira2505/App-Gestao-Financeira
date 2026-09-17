/*
 * TESTES DA PÁGINA CONTAS (a lista)
 * ================================
 */

import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { delay, http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router-dom'

import { servidorMsw } from '../test/servidor-msw'
import { definirEcraMobile } from '../test/setup'
import { AuthProvider } from '../auth/AuthProvider'
import { Contas } from './Contas'

const UTILIZADOR = { id: 'u1', email: 'ana@exemplo.pt', moeda_principal: 'EUR' }

// As escolhas de ordenação/agrupamento ficam no localStorage; limpa-se
// entre testes para um não influenciar o seguinte.
afterEach(() => {
  localStorage.clear()
})

function conta(sobrepor: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    nome: 'Conta X',
    banco: 'BPI',
    tipo: 'Conta corrente',
    moeda: 'EUR',
    data_ancora: '2026-01-01',
    saldo_ancora: '100.00',
    saldo: '100.00',
    saldo_convertido: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...sobrepor,
  }
}

function montar() {
  // AuthProvider real: CartaoConta usa useAuth() para saber a moeda
  // principal do utilizador (ver a nota "CONVERSÃO" em Contas.tsx).
  servidorMsw.use(http.get('/api/auth/me', () => HttpResponse.json(UTILIZADOR)))
  return render(
    <AuthProvider>
      <MemoryRouter>
        <Contas />
      </MemoryRouter>
    </AuthProvider>,
  )
}

describe('Página Contas', () => {
  it('mostra as contas e o botão de nova conta', async () => {
    servidorMsw.use(
      http.get('/api/contas', () =>
        HttpResponse.json([
          conta({ id: 'a', nome: 'À ordem', banco: 'BPI', saldo: '1000.00' }),
          conta({ id: 'b', nome: 'Extra', banco: 'Revolut', saldo: '3000.00' }),
        ]),
      ),
    )

    montar()

    // Cada conta é um cartão-ligação para o seu detalhe, com o saldo à vista.
    const linhaOrdem = await screen.findByRole('link', { name: /À ordem/ })
    expect(linhaOrdem).toHaveAttribute('href', '/contas/a')
    expect(linhaOrdem).toHaveTextContent(/1.?000,00/)
    expect(screen.getByRole('link', { name: /Extra/ })).toHaveAttribute('href', '/contas/b')

    // A linha mostra só o nome (banco e tipo servem para procurar/agrupar).
    expect(linhaOrdem).not.toHaveTextContent('Conta corrente')

    // Contagem total por baixo do título.
    expect(screen.getByText('2 contas')).toBeInTheDocument()

    // Não há saldo total agregado nesta página (isso vive no Início).
    expect(screen.queryByText('Saldo total')).not.toBeInTheDocument()

    expect(screen.getByRole('link', { name: 'Nova conta' })).toHaveAttribute(
      'href',
      '/contas/nova',
    )
  })

  it('filtra a lista pela pesquisa (nome, banco ou tipo)', async () => {
    servidorMsw.use(
      http.get('/api/contas', () =>
        HttpResponse.json([
          conta({ id: 'a', nome: 'À ordem', banco: 'BPI', tipo: 'Conta corrente' }),
          conta({ id: 'b', nome: 'Poupança', banco: 'Revolut', tipo: 'Conta poupança' }),
        ]),
      ),
    )

    montar()
    const campo = await screen.findByRole('searchbox', { name: 'Procurar conta' })

    // Por nome (sem acento — a pesquisa ignora acentos e maiúsculas).
    await userEvent.type(campo, 'poupanca')
    expect(screen.getByRole('link', { name: /Poupança/ })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /À ordem/ })).not.toBeInTheDocument()

    // Por banco.
    await userEvent.clear(campo)
    await userEvent.type(campo, 'BPI')
    expect(screen.getByRole('link', { name: /À ordem/ })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Poupança/ })).not.toBeInTheDocument()
  })

  it('mostra uma mensagem quando a pesquisa não encontra nada', async () => {
    servidorMsw.use(
      http.get('/api/contas', () =>
        HttpResponse.json([conta({ id: 'a', nome: 'À ordem' })]),
      ),
    )

    montar()
    const campo = await screen.findByRole('searchbox', { name: 'Procurar conta' })

    await userEvent.type(campo, 'zzz')

    expect(screen.getByText(/Nenhuma conta corresponde/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /À ordem/ })).not.toBeInTheDocument()
  })

  it('ordena a lista por campo e direção, e guarda as escolhas', async () => {
    servidorMsw.use(
      http.get('/api/contas', () =>
        HttpResponse.json([
          conta({ id: 'a', nome: 'Média', saldo: '500.00' }),
          conta({ id: 'b', nome: 'Alta', saldo: '900.00' }),
          conta({ id: 'c', nome: 'Baixa', saldo: '100.00' }),
        ]),
      ),
    )

    const nomesPor = (regex: RegExp) =>
      screen
        .getAllByRole('link')
        .map((no) => no.textContent ?? '')
        .filter((texto) => regex.test(texto))

    montar()
    // Por omissão: nome, ascendente → Alta, Baixa, Média.
    await screen.findByRole('link', { name: /Alta/ })
    expect(nomesPor(/Alta|Baixa|Média/)[0]).toMatch(/Alta/)
    expect(nomesPor(/Alta|Baixa|Média/)[1]).toMatch(/Baixa/)

    // Campo "Saldo" + direção "Descendente" → maior saldo primeiro. O menu
    // "⋯" da barra de topo abre na vista-raiz ("Ordenar por" / "Agrupar
    // por"); toca-se em "Ordenar por" para ver as opções. O menu fecha a
    // cada escolha, por isso reabre-se (e volta à vista-raiz).
    await userEvent.click(screen.getByRole('button', { name: 'Ordenar e agrupar' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Ordenar por' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Saldo' }))
    await userEvent.click(screen.getByRole('button', { name: 'Ordenar e agrupar' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Ordenar por' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Descendente' }))

    const s = nomesPor(/Alta|Baixa|Média/)
    expect(s[0]).toMatch(/Alta/) // 900
    expect(s[1]).toMatch(/Média/) // 500
    expect(s[2]).toMatch(/Baixa/) // 100

    // As escolhas ficaram guardadas.
    expect(localStorage.getItem('contasOrdemCampo')).toBe('saldo')
    expect(localStorage.getItem('contasOrdemDirecao')).toBe('desc')
  })

  it('agrupa a lista por tipo, com a contagem de contas por grupo', async () => {
    servidorMsw.use(
      http.get('/api/contas', () =>
        HttpResponse.json([
          conta({ id: 'a', nome: 'Ordenado', tipo: 'Conta à ordem', saldo: '1000.00' }),
          conta({ id: 'b', nome: 'Reserva', tipo: 'Conta poupança', saldo: '3000.00' }),
          conta({ id: 'c', nome: 'Extra', tipo: 'Conta poupança', saldo: '500.00' }),
        ]),
      ),
    )

    montar()
    await userEvent.click(await screen.findByRole('button', { name: 'Ordenar e agrupar' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Agrupar por' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Por tipo' }))

    // Cada tipo é um cabeçalho de grupo, com a contagem à direita.
    const grupoPoupanca = screen.getByText('Conta poupança').closest('section') as HTMLElement
    expect(within(grupoPoupanca).getByText('2 contas')).toBeInTheDocument()
    expect(within(grupoPoupanca).getByRole('link', { name: /Reserva/ })).toBeInTheDocument()
    expect(within(grupoPoupanca).getByRole('link', { name: /Extra/ })).toBeInTheDocument()

    const grupoOrdem = screen.getByText('Conta à ordem').closest('section') as HTMLElement
    expect(within(grupoOrdem).getByRole('link', { name: /Ordenado/ })).toBeInTheDocument()
    expect(within(grupoOrdem).queryByRole('link', { name: /Reserva/ })).not.toBeInTheDocument()
  })

  it('o menu "⋯" funciona também em ecrã de telemóvel', async () => {
    // Em mobile o painel do menu alinha-se de forma diferente (à margem da
    // página, não ao gatilho). Este teste garante que o gatilho e o submenu
    // continuam a funcionar nesse modo.
    definirEcraMobile(true)
    servidorMsw.use(
      http.get('/api/contas', () =>
        HttpResponse.json([
          conta({ id: 'a', nome: 'Ordenado', tipo: 'Conta à ordem' }),
          conta({ id: 'b', nome: 'Reserva', tipo: 'Conta poupança' }),
        ]),
      ),
    )

    montar()
    await userEvent.click(await screen.findByRole('button', { name: 'Ordenar e agrupar' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Agrupar por' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Por tipo' }))

    expect(screen.getByText('Conta poupança')).toBeInTheDocument()
    expect(screen.getByText('Conta à ordem')).toBeInTheDocument()
  })

  it('mostra o esqueleto enquanto as contas carregam', async () => {
    servidorMsw.use(
      http.get('/api/contas', async () => {
        await delay()
        return HttpResponse.json([conta()])
      }),
    )

    montar()

    // Enquanto a resposta não chega, há um esqueleto anunciado como "status".
    expect(screen.getByRole('status', { name: 'A carregar contas' })).toBeInTheDocument()
    // Quando as contas chegam, o esqueleto dá lugar à lista.
    expect(await screen.findByRole('link', { name: /Conta X/ })).toBeInTheDocument()
    expect(screen.queryByRole('status', { name: 'A carregar contas' })).not.toBeInTheDocument()
  })

  it('mostra um estado vazio quando não há contas', async () => {
    servidorMsw.use(http.get('/api/contas', () => HttpResponse.json([])))

    montar()

    expect(await screen.findByText('Ainda não tens contas.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Criar a primeira' })).toHaveAttribute(
      'href',
      '/contas/nova',
    )
  })

  it('mostra uma mensagem de erro se a API falhar', async () => {
    servidorMsw.use(
      http.get('/api/contas', () =>
        HttpResponse.json({ detail: 'Sessão inválida ou expirada.' }, { status: 401 }),
      ),
    )

    montar()

    expect(await screen.findByRole('alert')).toHaveTextContent('Sessão inválida ou expirada.')
  })

  describe('conversão de moeda', () => {
    it('mostra sempre o código da moeda por baixo do nome, mesmo já na moeda principal', async () => {
      // UTILIZADOR.moeda_principal é "EUR" (ver o topo do ficheiro); a
      // conta também — nada a CONVERTER, mas o código aparece sempre, por
      // consistência entre todas as linhas da lista.
      servidorMsw.use(
        http.get('/api/contas', () =>
          HttpResponse.json([conta({ nome: 'À ordem', moeda: 'EUR', saldo: '100.00' })]),
        ),
      )

      montar()

      const linha = await screen.findByRole('link', { name: /À ordem/ })
      expect(linha).toHaveTextContent('EUR')
      expect(linha).toHaveTextContent(/100,00 ?€/)
      // Só UM valor de saldo — sem conversão, não há segunda linha com o
      // mesmo montante repetido.
      expect(linha.textContent?.match(/100,00/g)?.length).toBe(1)
    })

    it('conta noutra moeda, com taxa disponível: código por baixo do nome + convertido em destaque + original por baixo', async () => {
      servidorMsw.use(
        http.get('/api/contas', () =>
          HttpResponse.json([
            conta({
              nome: 'Conta em dólares',
              moeda: 'USD',
              saldo: '100.00',
              saldo_convertido: '92.50',
            }),
          ]),
        ),
      )

      montar()

      const linha = await screen.findByRole('link', { name: /Conta em dólares/ })
      // O código da moeda da conta, por baixo do nome.
      expect(linha).toHaveTextContent('USD')
      // O valor convertido (na moeda principal, EUR), em destaque.
      expect(linha).toHaveTextContent(/92,50 ?€/)
      // E o original, agora com símbolo (não código) — "US$100,00" ou
      // semelhante, consoante o Intl.NumberFormat do ambiente.
      expect(linha).toHaveTextContent(/100,00/)
    })

    it('conta noutra moeda, sem taxa disponível (saldo_convertido null): código aparece, mas o saldo fica só com um valor', async () => {
      servidorMsw.use(
        http.get('/api/contas', () =>
          HttpResponse.json([
            conta({
              nome: 'Conta em dólares',
              moeda: 'USD',
              saldo: '100.00',
              saldo_convertido: null,
            }),
          ]),
        ),
      )

      montar()

      const linha = await screen.findByRole('link', { name: /Conta em dólares/ })
      // O código aparece sempre (por baixo do nome) — isto não depende de
      // haver conversão disponível.
      expect(linha).toHaveTextContent('USD')
      expect(linha).toHaveTextContent(/100,00/)
      // Só UM valor de saldo — sem taxa disponível, não há segunda linha
      // com o mesmo montante repetido.
      expect(linha.textContent?.match(/100,00/g)?.length).toBe(1)
    })
  })
})
