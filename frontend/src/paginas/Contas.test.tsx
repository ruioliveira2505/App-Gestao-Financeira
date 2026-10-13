/*
 * TESTES DA PÁGINA CONTAS (a lista)
 * ================================
 */

import { render as renderBase, screen, waitFor, within } from '@testing-library/react'
import { useQueryClient } from '@tanstack/react-query'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { delay, http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'

import { servidorMsw } from '../test/servidor-msw'
import { definirEcraMobile } from '../test/setup'
import { AuthProvider } from '../auth/AuthProvider'
import { PilhaDePaginas } from '../componentes/PilhaDePaginas'
import { CHAVES } from '../lib/consultas'
import { Contas } from './Contas'
import { ComConsultas } from '../test/consultas'
import type { Vinculo } from '../lib/contas'

// Todas as montagens deste ficheiro levam a cache dos dados do servidor à
// volta (a app recebe-a em main.tsx; aqui, cada montagem tem uma nova —
// ver test/consultas.tsx). "wrapper" é a opção do Testing Library para
// envolver o que se monta num componente.
function render(ui: Parameters<typeof renderBase>[0]) {
  return renderBase(ui, { wrapper: ComConsultas })
}

const UTILIZADOR = { id: 'u1', email: 'ana@exemplo.pt', moeda_principal: 'EUR' }

// As escolhas de ordenação/agrupamento ficam no localStorage; limpa-se
// entre testes para um não influenciar o seguinte.
afterEach(() => {
  localStorage.clear()
})

// Por omissão, "saldo_convertido" é igual a "saldo" — é o que o backend
// devolve para uma conta já na moeda principal (converter de EUR para EUR
// não precisa de taxa nenhuma). Um teste que queira outra coisa (outra
// moeda, ou sem taxa — null) indica-o explicitamente.
function conta(sobrepor: Record<string, unknown> = {}) {
  const base: Record<string, unknown> = {
    id: 'c1',
    nome: 'Conta X',
    banco: 'BPI',
    tipo: 'Conta corrente',
    moeda: 'EUR',
    data_ancora: '2026-01-01',
    saldo_ancora: '100.00',
    saldo: '100.00',
    vinculo: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...sobrepor,
  }
  if (!('saldo_convertido' in sobrepor)) base.saldo_convertido = base.saldo
  return base
}

// Um vínculo ao banco cuja autorização vale até daqui a "dias" dias.
// Relativo ao momento em que o teste corre, porque o aviso «a expirar»
// depende da data de hoje. Com "dias" negativo, a autorização já terminou e
// a conta está SUSPENSA (é o backend quem o deduz; aqui imita-se o que ele
// devolveria). "autorizacao" e "titular" identificam a autorização: contas
// da mesma autorização dão um só aviso.
function ligacao(
  dias: number,
  id = 'cl1',
  {
    autorizacao = `a-${id}`,
    titular = 'Rui Oliveira',
    banco = 'BPI',
    indisponivel = false,
  }: { autorizacao?: string; titular?: string; banco?: string; indisponivel?: boolean } = {},
): Vinculo {
  const validoAte = new Date(Date.now() + dias * 24 * 60 * 60 * 1000).toISOString()
  const terminada = dias < 0
  // "indisponivel": o banco deixou de partilhar a conta (suspensa), com a
  // autorização ainda ativa.
  const suspensa = terminada || indisponivel
  return {
    conta_bancaria_id: id,
    banco,
    titular,
    valido_ate: validoAte,
    autorizacao_id: autorizacao,
    iban: null,
    sincronizado_em: null,
    suspensa_desde: suspensa ? (terminada ? validoAte : new Date().toISOString()) : null,
    autorizacao_terminada_em: terminada ? validoAte : null,
    falha_em: null,
    falha_motivo: null,
    estado: suspensa ? 'suspensa' : 'vinculada',
    motivo: indisponivel ? 'indisponivel' : terminada ? 'expirada' : null,
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

    // Nada por baixo do título: nem contagem de contas, nem saldo total
    // (esse vive no Início).
    expect(screen.queryByText('2 contas')).not.toBeInTheDocument()
    expect(screen.queryByText(/4.?000,00/)).not.toBeInTheDocument()

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

  describe('modo de pesquisa', () => {
    it('em telemóvel, tocar na procura dá um "‹" para sair, que limpa a pesquisa', async () => {
      definirEcraMobile(true)
      servidorMsw.use(
        http.get('/api/contas', () =>
          HttpResponse.json([conta({ id: 'a', nome: 'À ordem' }), conta({ id: 'b', nome: 'Poupança' })]),
        ),
      )

      montar()
      const campo = await screen.findByRole('searchbox', { name: 'Procurar conta' })
      expect(screen.queryByRole('button', { name: 'Sair da pesquisa' })).not.toBeInTheDocument()

      await userEvent.type(campo, 'poup')
      expect(screen.getByRole('button', { name: 'Sair da pesquisa' })).toBeInTheDocument()
      expect(screen.queryByRole('link', { name: /À ordem/ })).not.toBeInTheDocument()

      await userEvent.click(screen.getByRole('button', { name: 'Sair da pesquisa' }))

      // Sai limpo: campo vazio, lista inteira de volta, e o "‹" desaparece
      // no fim da animação de regresso.
      expect(campo).toHaveValue('')
      expect(screen.getByRole('link', { name: /À ordem/ })).toBeInTheDocument()
      await waitFor(() =>
        expect(screen.queryByRole('button', { name: 'Sair da pesquisa' })).not.toBeInTheDocument(),
      )
    })

    it('em telemóvel, "Ver todas as contas" (procura sem resultados) sai do modo de pesquisa', async () => {
      definirEcraMobile(true)
      servidorMsw.use(http.get('/api/contas', () => HttpResponse.json([conta({ nome: 'À ordem' })])))

      montar()
      const campo = await screen.findByRole('searchbox', { name: 'Procurar conta' })
      await userEvent.type(campo, 'zzz')
      await userEvent.click(screen.getByRole('button', { name: 'Ver todas as contas' }))

      // De volta à página normal: campo vazio, lista inteira, sem o "‹".
      expect(campo).toHaveValue('')
      expect(screen.getByRole('link', { name: /À ordem/ })).toBeInTheDocument()
      await waitFor(() =>
        expect(screen.queryByRole('button', { name: 'Sair da pesquisa' })).not.toBeInTheDocument(),
      )
    })

    it('em ecrã largo, o campo de procura fica onde está (sem modo de pesquisa)', async () => {
      servidorMsw.use(http.get('/api/contas', () => HttpResponse.json([conta()])))

      montar()
      await userEvent.click(await screen.findByRole('searchbox', { name: 'Procurar conta' }))

      expect(screen.queryByRole('button', { name: 'Sair da pesquisa' })).not.toBeInTheDocument()
    })
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

    expect(screen.getByText('Nenhuma conta com «zzz»')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /À ordem/ })).not.toBeInTheDocument()

    // "Ver todas as contas" esvazia o campo e a lista volta.
    await userEvent.click(screen.getByRole('button', { name: 'Ver todas as contas' }))
    expect(campo).toHaveValue('')
    expect(screen.getByRole('link', { name: /À ordem/ })).toBeInTheDocument()
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
    await userEvent.click(screen.getByRole('button', { name: 'Mais opções' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Ordenar por' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Saldo' }))
    await userEvent.click(screen.getByRole('button', { name: 'Mais opções' }))
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

  it('ordena por saldo convertido para a moeda principal, com as contas sem câmbio no fim', async () => {
    servidorMsw.use(
      http.get('/api/contas', () =>
        HttpResponse.json([
          // 640 dólares valem 548,61 € — menos do que os 600 € da outra
          // conta, apesar de 640 > 600.
          conta({ id: 'a', nome: 'Dólares', moeda: 'USD', saldo: '640.00', saldo_convertido: '548.61' }),
          conta({ id: 'b', nome: 'Euros', saldo: '600.00' }),
          // Sem taxa de câmbio: não se pode comparar — vai para o fim.
          conta({ id: 'c', nome: 'Francos', moeda: 'CHF', saldo: '9999.00', saldo_convertido: null }),
        ]),
      ),
    )

    montar()
    await screen.findByRole('link', { name: /Euros/ })
    await userEvent.click(screen.getByRole('button', { name: 'Mais opções' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Ordenar por' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Saldo' }))
    await userEvent.click(screen.getByRole('button', { name: 'Mais opções' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Ordenar por' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Descendente' }))

    const nomes = screen
      .getAllByRole('link')
      .map((no) => no.textContent ?? '')
      .filter((texto) => /Dólares|Euros|Francos/.test(texto))
    expect(nomes[0]).toMatch(/Euros/)
    expect(nomes[1]).toMatch(/Dólares/)
    expect(nomes[2]).toMatch(/Francos/)
  })

  it('agrupa a lista por tipo, só com o nome do grupo no cabeçalho', async () => {
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
    await userEvent.click(await screen.findByRole('button', { name: 'Mais opções' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Agrupar por' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Por tipo' }))

    // Cada tipo é um cabeçalho de grupo, só com o nome — sem contagem nem
    // subtotal (3000 + 500).
    const grupoPoupanca = screen.getByText('Conta poupança').closest('section') as HTMLElement
    expect(within(grupoPoupanca).queryByText('2 contas')).not.toBeInTheDocument()
    expect(within(grupoPoupanca).queryByText(/3.?500,00/)).not.toBeInTheDocument()
    expect(within(grupoPoupanca).getByRole('link', { name: /Reserva/ })).toBeInTheDocument()
    expect(within(grupoPoupanca).getByRole('link', { name: /Extra/ })).toBeInTheDocument()

    const grupoOrdem = screen.getByText('Conta à ordem').closest('section') as HTMLElement
    expect(within(grupoOrdem).getByRole('link', { name: /Ordenado/ })).toBeInTheDocument()
    expect(within(grupoOrdem).queryByRole('link', { name: /Reserva/ })).not.toBeInTheDocument()
  })

  it('agrupado, «Sem banco» fica no fim, mesmo antes de bancos que vêm depois do «S» (Unicaixa)', async () => {
    localStorage.setItem('contasAgrupamento', 'banco')
    servidorMsw.use(
      http.get('/api/contas', () =>
        HttpResponse.json([
          conta({ id: 'a', nome: 'Carteira', banco: null }),
          conta({ id: 'b', nome: 'Conta U', banco: 'Unicaixa' }),
          conta({ id: 'c', nome: 'Conta A', banco: 'Abanca' }),
        ]),
      ),
    )

    montar()

    await screen.findByRole('link', { name: /Carteira/ })
    const grupos = screen.getAllByText(/^(Abanca|Unicaixa|Sem banco)$/).map((e) => e.textContent)
    expect(grupos).toEqual(['Abanca', 'Unicaixa', 'Sem banco'])
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
    await userEvent.click(await screen.findByRole('button', { name: 'Mais opções' }))
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

    expect(await screen.findByText('Ainda não tens contas')).toBeInTheDocument()
    // Um só botão, para o mesmo ecrã do "+" (onde se escolhe com ou sem
    // vínculo ao banco).
    expect(screen.getByRole('link', { name: 'Adicionar conta' })).toHaveAttribute('href', '/contas/nova')
  })

  it('sem avisos, apaga a escolha «recolhido» que tivesse ficado guardada', async () => {
    localStorage.setItem('contasAvisosRecolhidos:u1', 'a-cl1:a-expirar')
    servidorMsw.use(http.get('/api/contas', () => HttpResponse.json([conta()])))

    montar()

    await screen.findByRole('link', { name: /Conta X/ })
    await waitFor(() => expect(localStorage.getItem('contasAvisosRecolhidos:u1')).toBeNull())
  })

  it('mostra uma mensagem de erro se a API falhar', async () => {
    servidorMsw.use(
      http.get('/api/contas', () =>
        HttpResponse.json({ detail: 'Sessão inválida ou expirada.' }, { status: 401 }),
      ),
    )

    montar()

    // O título e o que fazer (não a mensagem técnica do pedido).
    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent('Não foi possível carregar as contas')
    expect(alerta).toHaveTextContent('Verifica a ligação à internet e tenta outra vez.')
  })

  it('quando uma página por cima altera as contas (ex.: cria uma), a lista por baixo actualiza-se', async () => {
    // A lista fica montada por baixo do detalhe (a pilha de páginas). A
    // conta "Recém-criada" só existe a partir do segundo pedido — como se
    // tivesse sido criada lá em cima, que depois invalida a cache das
    // contas (o que ContaNova faz ao criar).
    let pedidos = 0
    servidorMsw.use(
      http.get('/api/auth/me', () => HttpResponse.json(UTILIZADOR)),
      http.get('/api/contas', () => {
        pedidos += 1
        return HttpResponse.json(
          pedidos === 1
            ? [conta({ id: 'a', nome: 'Antiga' })]
            : [conta({ id: 'a', nome: 'Antiga' }), conta({ id: 'b', nome: 'Recém-criada' })],
        )
      }),
    )
    function PaginaPorCima() {
      const navegar = useNavigate()
      const cliente = useQueryClient()
      return (
        <button
          type="button"
          onClick={() => {
            void cliente.invalidateQueries({ queryKey: CHAVES.contas })
            navegar(-1)
          }}
        >
          criar e recuar
        </button>
      )
    }
    render(
      <AuthProvider>
        <MemoryRouter initialEntries={['/contas', '/contas/b']} initialIndex={1}>
          <Routes>
            <Route path="/contas" element={<PilhaDePaginas fundo={<Contas />} />}>
              <Route index element={null} />
              <Route path=":id" element={<PaginaPorCima />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </AuthProvider>,
    )
    // Por baixo da página de cima, a lista já carregou uma vez.
    await waitFor(() => expect(pedidos).toBe(1))
    expect(screen.queryByText('Recém-criada')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'criar e recuar' }))

    expect(await screen.findByRole('link', { name: /Recém-criada/ })).toBeInTheDocument()
    expect(pedidos).toBe(2)
  })

  it('"Tentar outra vez" volta a pedir as contas depois de um erro', async () => {
    let pedidos = 0
    servidorMsw.use(
      http.get('/api/contas', () => {
        pedidos += 1
        // O primeiro pedido falha; o segundo corre bem.
        return pedidos === 1
          ? HttpResponse.json({ detail: 'Erro temporário.' }, { status: 500 })
          : HttpResponse.json([conta({ nome: 'Recuperada' })])
      }),
    )

    montar()
    await screen.findByRole('alert')
    await userEvent.click(screen.getByRole('button', { name: 'Tentar outra vez' }))

    expect(await screen.findByRole('link', { name: /Recuperada/ })).toBeInTheDocument()
    expect(pedidos).toBe(2)
  })

  describe('vínculo ao banco', () => {
    it('diz o estado de cada conta com vínculo (vinculada ou suspensa); a expirar continua vinculada', async () => {
      servidorMsw.use(
        http.get('/api/contas', () =>
          HttpResponse.json([
            conta({ id: 'a', nome: 'Ativa', vinculo: ligacao(60, 'cl1') }),
            conta({ id: 'b', nome: 'Quase', vinculo: ligacao(3, 'cl2') }),
            conta({ id: 'c', nome: 'Antiga', vinculo: ligacao(-1, 'cl3') }),
            conta({ id: 'd', nome: 'Manual' }),
          ]),
        ),
      )

      montar()

      // O ícone é só visual; o estado vai, em texto, no nome da linha.
      // «A expirar» não é um estado da conta (é um aviso da autorização).
      expect(await screen.findByRole('link', { name: /Ativa.*vinculada/ })).toBeInTheDocument()
      expect(screen.getByRole('link', { name: /Quase.*vinculada/ })).toBeInTheDocument()
      expect(screen.getByRole('link', { name: /Antiga.*suspensa/ })).toBeInTheDocument()
      expect(screen.getByRole('link', { name: /Manual/ })).not.toHaveTextContent(/vinculada|suspensa/)
    })

    it('"Sincronizar agora" fica desativado sem contas vinculadas, com a razão só para leitores de ecrã', async () => {
      servidorMsw.use(http.get('/api/contas', () => HttpResponse.json([conta()])))

      montar()
      await userEvent.click(await screen.findByRole('button', { name: 'Mais opções' }))

      const item = screen.getByRole('menuitem', { name: /Sincronizar agora/ })
      expect(item).toHaveAttribute('aria-disabled', 'true')
      expect(item).toHaveTextContent('Nenhuma conta vinculada')
    })

    it('"Sincronizar agora" sincroniza as contas vinculadas (não as suspensas) e diz o resultado', async () => {
      const sincronizadas: string[] = []
      servidorMsw.use(
        http.get('/api/contas', () =>
          HttpResponse.json([
            conta({ id: 'a', nome: 'Uma', vinculo: ligacao(60, 'cl1') }),
            conta({ id: 'b', nome: 'Outra', vinculo: ligacao(3, 'cl2') }),
            // Suspensa: o banco já não responde — não é pedida.
            conta({ id: 'c', nome: 'Velha', vinculo: ligacao(-1, 'cl3') }),
          ]),
        ),
        http.post('/api/open-banking/contas-bancarias/:id/sincronizar', ({ params }) => {
          sincronizadas.push(String(params.id))
          return HttpResponse.json({ movimentos_importados: params.id === 'cl1' ? 2 : 1 })
        }),
      )

      montar()
      await userEvent.click(await screen.findByRole('button', { name: 'Mais opções' }))
      await userEvent.click(screen.getByRole('menuitem', { name: /Sincronizar agora/ }))

      expect(await screen.findByText('Atualizado · 3 movimentos novos')).toBeInTheDocument()
      expect(sincronizadas).toEqual(['cl1', 'cl2'])
    })

    it('"Sincronizar agora" com uma conta a falhar diz quantas falharam, e o resto fica atualizado', async () => {
      servidorMsw.use(
        http.get('/api/contas', () =>
          HttpResponse.json([
            conta({ id: 'a', nome: 'Uma', vinculo: ligacao(60, 'cl1') }),
            conta({ id: 'b', nome: 'Outra', vinculo: ligacao(60, 'cl2') }),
          ]),
        ),
        http.post('/api/open-banking/contas-bancarias/:id/sincronizar', ({ params }) =>
          params.id === 'cl1'
            ? HttpResponse.json({ movimentos_importados: 1 })
            : HttpResponse.json({ detail: 'O banco não respondeu.' }, { status: 502 }),
        ),
      )

      montar()
      await userEvent.click(await screen.findByRole('button', { name: 'Mais opções' }))
      await userEvent.click(screen.getByRole('menuitem', { name: /Sincronizar agora/ }))

      expect(await screen.findByText('Atualizado · 1 conta falhou')).toBeInTheDocument()
    })

    it('fechar o aviso «A sincronizar» não deixa arrancar uma segunda sincronização por cima', async () => {
      let pedidos = 0
      let terminar: () => void = () => {}
      servidorMsw.use(
        http.get('/api/contas', () => HttpResponse.json([conta({ vinculo: ligacao(60, 'cl1') })])),
        http.post('/api/open-banking/contas-bancarias/:id/sincronizar', async () => {
          pedidos += 1
          await new Promise<void>((resolver) => (terminar = resolver))
          return HttpResponse.json({ movimentos_importados: 0 })
        }),
      )

      montar()
      await userEvent.click(await screen.findByRole('button', { name: 'Mais opções' }))
      await userEvent.click(screen.getByRole('menuitem', { name: /Sincronizar agora/ }))
      // Fecha o aviso «A sincronizar» com um toque, e tenta outra vez.
      await userEvent.click(await screen.findByText('A sincronizar · 1 conta'))
      await userEvent.click(screen.getByRole('button', { name: 'Mais opções' }))
      await userEvent.click(screen.getByRole('menuitem', { name: /Sincronizar agora/ }))

      expect(pedidos).toBe(1)
      terminar()
      expect(await screen.findByText('Atualizado · sem movimentos novos')).toBeInTheDocument()
    })

    it('com todas a falhar por conflito (409), diz «tenta mais tarde», e não «sem ligação»', async () => {
      servidorMsw.use(
        http.get('/api/contas', () => HttpResponse.json([conta({ vinculo: ligacao(60, 'cl1') })])),
        http.post('/api/open-banking/contas-bancarias/:id/sincronizar', () =>
          HttpResponse.json({ detail: 'Outra operação a decorrer.' }, { status: 409 }),
        ),
      )

      montar()
      await userEvent.click(await screen.findByRole('button', { name: 'Mais opções' }))
      await userEvent.click(screen.getByRole('menuitem', { name: /Sincronizar agora/ }))

      expect(await screen.findByText('Não atualizado · tenta mais tarde')).toBeInTheDocument()
    })

    it('"Sincronizar agora" sem nenhuma conta atualizada distingue o limite do banco da falta de ligação', async () => {
      let resposta = 429
      servidorMsw.use(
        http.get('/api/contas', () => HttpResponse.json([conta({ vinculo: ligacao(60, 'cl1') })])),
        http.post('/api/open-banking/contas-bancarias/:id/sincronizar', () =>
          HttpResponse.json({ detail: 'Limite.' }, { status: resposta }),
        ),
      )

      montar()
      await userEvent.click(await screen.findByRole('button', { name: 'Mais opções' }))
      await userEvent.click(screen.getByRole('menuitem', { name: /Sincronizar agora/ }))
      const aviso = await screen.findByText('Não atualizado · limite do banco')

      // Tocar no aviso fecha-o.
      await userEvent.click(aviso)
      expect(screen.queryByText('Não atualizado · limite do banco')).not.toBeInTheDocument()

      resposta = 502
      await userEvent.click(screen.getByRole('button', { name: 'Mais opções' }))
      await userEvent.click(screen.getByRole('menuitem', { name: /Sincronizar agora/ }))
      expect(await screen.findByText('Não atualizado · sem ligação')).toBeInTheDocument()
    })
  })

  describe('avisos das autorizações', () => {
    it('sem autorizações a terminar nem terminadas, não há pílula nem cartões', async () => {
      servidorMsw.use(
        http.get('/api/contas', () => HttpResponse.json([conta({ vinculo: ligacao(60) })])),
      )

      montar()

      await screen.findByRole('link', { name: /Conta X/ })
      expect(screen.queryByRole('button', { name: /a verificar/ })).not.toBeInTheDocument()
      expect(screen.queryByRole('list', { name: 'Autorizações a verificar' })).not.toBeInTheDocument()
    })

    it('mostra a pílula com o número e um cartão por autorização, a terminada primeiro', async () => {
      servidorMsw.use(
        http.get('/api/contas', () =>
          HttpResponse.json([
            conta({ id: 'a', nome: 'Quase', vinculo: ligacao(3, 'cl1', { banco: 'Santander' }) }),
            conta({ id: 'b', nome: 'Velha', vinculo: ligacao(-1, 'cl2', { banco: 'Revolut' }) }),
            // Outra conta da MESMA autorização terminada: não conta outra vez.
            conta({ id: 'c', nome: 'Velha 2', vinculo: ligacao(-1, 'cl3', { banco: 'Revolut', autorizacao: 'a-cl2' }) }),
          ]),
        ),
      )

      montar()

      const pilula = await screen.findByRole('button', { name: '2 autorizações a verificar. Recolher' })
      expect(pilula).toHaveAttribute('aria-expanded', 'true')
      const cartoes = within(screen.getByRole('list', { name: 'Autorizações a verificar' })).getAllByRole('listitem')
      expect(cartoes.map((c) => c.textContent)).toEqual([
        expect.stringMatching(/Revolut.*Rui Oliveira.*Terminada.*Renovar/),
        expect.stringMatching(/Santander.*A expirar.*Renovar/),
      ])
    })

    it('a pílula recolhe os cartões, e a escolha fica guardada até os avisos mudarem', async () => {
      let contas = [conta({ id: 'a', nome: 'Quase', vinculo: ligacao(3, 'cl1') })]
      servidorMsw.use(http.get('/api/contas', () => HttpResponse.json(contas)))

      const { unmount } = montar()
      await userEvent.click(await screen.findByRole('button', { name: /1 autorização a verificar/ }))

      expect(screen.getByRole('button', { name: '1 autorização a verificar. Mostrar' })).toHaveAttribute(
        'aria-expanded',
        'false',
      )

      // Ao voltar à página, continua recolhido (mesmo conjunto de avisos).
      unmount()
      montar()
      expect(await screen.findByRole('button', { name: /Mostrar/ })).toBeInTheDocument()

      // Entra outra autorização: os avisos voltam a abrir-se sozinhos.
      unmount()
      contas = [...contas, conta({ id: 'b', nome: 'Velha', vinculo: ligacao(-1, 'cl2') })]
      montar()
      expect(await screen.findByRole('button', { name: '2 autorizações a verificar. Recolher' })).toBeInTheDocument()
    })

    it('a partir de dez autorizações, a pílula mostra «9+»', async () => {
      servidorMsw.use(
        http.get('/api/contas', () =>
          HttpResponse.json(
            Array.from({ length: 10 }, (_, i) => conta({ id: `c${i}`, nome: `Conta ${i}`, vinculo: ligacao(3, `cl${i}`) })),
          ),
        ),
      )

      montar()

      const pilula = await screen.findByRole('button', { name: /10 autorizações a verificar/ })
      expect(pilula).toHaveTextContent('9+')
    })

    it('recolhidos, os cartões ficam fora do teclado e dos leitores de ecrã (inert)', async () => {
      servidorMsw.use(http.get('/api/contas', () => HttpResponse.json([conta({ vinculo: ligacao(3, 'cl1') })])))

      montar()
      const pilula = await screen.findByRole('button', { name: /1 autorização a verificar/ })
      const carrossel = document.getElementById(pilula.getAttribute('aria-controls') as string) as HTMLElement
      expect(carrossel).not.toHaveAttribute('inert')

      await userEvent.click(pilula)

      expect(carrossel).toHaveAttribute('inert')
    })

    it('uma conta que o banco deixou de partilhar (autorização ativa) fica suspensa, sem aviso', async () => {
      servidorMsw.use(
        http.get('/api/contas', () =>
          HttpResponse.json([conta({ nome: 'Fechada', vinculo: ligacao(60, 'cl1', { indisponivel: true }) })]),
        ),
      )

      montar()

      expect(await screen.findByRole('link', { name: /Fechada.*suspensa/ })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /a verificar/ })).not.toBeInTheDocument()
    })

    it('«Renovar» pede confirmação e só depois segue para o banco, com a autorização a renovar', async () => {
      const espiao = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => {})
      servidorMsw.use(
        http.get('/api/contas', () =>
          HttpResponse.json([conta({ vinculo: ligacao(-1, 'cl1', { banco: 'Revolut', autorizacao: 'a9' }) })]),
        ),
      )

      montar()
      await userEvent.click(await screen.findByRole('button', { name: /Revolut, Rui Oliveira, terminou a .*\. Renovar/ }))

      expect(espiao).not.toHaveBeenCalled()
      await userEvent.click(screen.getByRole('button', { name: 'Continuar para Revolut' }))

      const formulario = espiao.mock.contexts[0] as HTMLFormElement
      expect(new URL(formulario.action, window.location.origin).searchParams.get('renova')).toBe('a9')
      espiao.mockRestore()
    })
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
