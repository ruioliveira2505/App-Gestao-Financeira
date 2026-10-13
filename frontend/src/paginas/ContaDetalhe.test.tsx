/*
 * TESTES DA PÁGINA DE UMA CONTA («VER CONTA»)
 * ==========================================
 *
 * Cada teste monta a página com a API simulada pelo MSW (a conta e as suas
 * reconciliações) e verifica o que um utilizador veria e poderia fazer:
 * o cabeçalho, o painel do banco (autorização e sincronização), os
 * detalhes e as reconciliações, e os estados de erro.
 */

import { act, render as renderBase, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { delay, http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

import { servidorMsw } from '../test/servidor-msw'
import { AuthProvider } from '../auth/AuthProvider'
import { ContaDetalhe } from './ContaDetalhe'
import { ComConsultas } from '../test/consultas'
import type { Conta, Vinculo } from '../lib/contas'
import type { Reconciliacao } from '../lib/reconciliacoes'
import { deixarAviso } from '../lib/avisoPendente'

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

const HORA = 60 * 60 * 1000
const DIA = 24 * HORA

// Um vínculo ao banco. As datas são relativas ao momento em que o teste
// corre (com datas fixas, a autorização passaria a "a expirar" sozinha no
// dia em que a data se aproximasse, e o teste falharia sem nada ter mudado).
function vinculo(sobrepor: Partial<Vinculo> = {}): Vinculo {
  return {
    conta_bancaria_id: 'cb-1',
    banco: 'Caixa Geral de Depósitos',
    titular: 'Rui Oliveira',
    valido_ate: new Date(Date.now() + 90 * DIA).toISOString(),
    autorizacao_id: 'a-1',
    iban: 'PT50000201231234567890154',
    sincronizado_em: new Date(Date.now() - 2 * HORA).toISOString(),
    suspensa_desde: null,
    autorizacao_terminada_em: null,
    falha_em: null,
    falha_motivo: null,
    estado: 'vinculada',
    motivo: null,
    ...sobrepor,
  }
}

function reconciliacao(sobrepor: Partial<Reconciliacao> = {}): Reconciliacao {
  return {
    id: 'r1',
    conta_id: 'c1',
    data: '2026-06-30',
    saldo: '12480.00',
    origem: 'utilizador',
    acerto: '-35.00',
    lido_em: null,
    ...sobrepor,
  }
}

/** Monta a página de /contas/c1, com a conta e as reconciliações dadas.
 *  Com "conta" ou "reconciliacoes" a null, o teste regista a resposta ele
 *  próprio, antes de montar (ex.: um erro). */
function montar(
  conta: Conta | null = CONTA,
  reconciliacoes: Reconciliacao[] | null = [],
  estado?: unknown,
) {
  servidorMsw.use(http.get('/api/auth/me', () => HttpResponse.json(UTILIZADOR)))
  if (reconciliacoes) {
    servidorMsw.use(http.get('/api/contas/c1/reconciliacoes', () => HttpResponse.json(reconciliacoes)))
  }
  if (conta) servidorMsw.use(http.get('/api/contas/c1', () => HttpResponse.json(conta)))
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[{ pathname: '/contas/c1', state: estado }]}>
        <Routes>
          <Route path="/contas/:id" element={<ContaDetalhe />} />
          <Route path="/contas/:id/editar" element={<p>página de edição</p>} />
          <Route path="/contas" element={<p>lista de contas</p>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  )
}

describe('Ver conta — o essencial', () => {
  it('mostra o nome, o saldo e os detalhes (campo em cima, valor por baixo)', async () => {
    montar()

    // O nome da conta é o título (vai para a barra de topo em mobile).
    expect(await screen.findByRole('heading', { name: 'Conta à ordem' })).toBeInTheDocument()
    const detalhes = screen.getByRole('region', { name: 'Detalhes' })
    for (const texto of ['Banco', 'BPI', 'Tipo de conta', 'Conta corrente', 'Moeda', 'Data inicial', 'Saldo inicial']) {
      expect(within(detalhes).getByText(texto)).toBeInTheDocument()
    }
  })

  it('banco e tipo aparecem sempre, mesmo vazios («Sem banco», «Sem tipo»)', async () => {
    montar({ ...CONTA, banco: null, tipo: null })

    expect(await screen.findByText('Sem banco')).toBeInTheDocument()
    expect(screen.getByText('Sem tipo')).toBeInTheDocument()
  })

  it('o lápis leva a Editar; aqui não há eliminar nem desvincular', async () => {
    montar({ ...CONTA, vinculo: vinculo() })

    const editar = await screen.findByRole('link', { name: 'Editar conta' })
    expect(editar).toHaveAttribute('href', '/contas/c1/editar')
    expect(screen.queryByRole('button', { name: /eliminar|desvincular/i })).not.toBeInTheDocument()

    await userEvent.click(editar)
    expect(await screen.findByText('página de edição')).toBeInTheDocument()
  })

  it('mostra o aviso que chega com a navegação (ex.: «Conta criada»)', async () => {
    montar(CONTA, [], { aviso: 'Conta criada' })

    expect(await screen.findByText('Conta criada')).toBeInTheDocument()
  })

  it('ao voltar de Editar depois de guardar, mostra «Alterações guardadas»', async () => {
    montar()
    await screen.findByRole('heading', { name: 'Conta à ordem' })

    // É o que Editar faz ao guardar (ver ContaEditar.tsx): a página da conta,
    // montada por baixo, recebe o aviso.
    act(() => deixarAviso('c1', 'Alterações guardadas'))

    expect(await screen.findByText('Alterações guardadas')).toBeInTheDocument()
  })

  it('mostra um esqueleto enquanto a conta carrega', async () => {
    servidorMsw.use(
      http.get('/api/contas/c1', async () => {
        await delay()
        return HttpResponse.json(CONTA)
      }),
    )
    montar(null)

    expect(screen.getByRole('status', { name: 'A carregar a conta' })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Conta à ordem' })).toBeInTheDocument()
    expect(screen.queryByRole('status', { name: 'A carregar a conta' })).not.toBeInTheDocument()
  })

  it('uma conta que já não existe (404) diz isso, com «Voltar a Contas»', async () => {
    servidorMsw.use(
      http.get('/api/contas/c1', () => HttpResponse.json({ detail: 'Conta não encontrada.' }, { status: 404 })),
    )
    montar(null)

    expect(await screen.findByText('Esta conta já não existe')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Voltar a Contas' })).toHaveAttribute('href', '/contas')
  })

  it('sem ligação, diz que não foi possível carregar e «Tentar outra vez» volta a pedir', async () => {
    let pedidos = 0
    servidorMsw.use(
      http.get('/api/contas/c1', () => {
        pedidos += 1
        return pedidos === 1 ? HttpResponse.error() : HttpResponse.json(CONTA)
      }),
    )
    montar(null)

    await userEvent.click(await screen.findByRole('button', { name: 'Tentar outra vez' }))

    expect(await screen.findByRole('heading', { name: 'Conta à ordem' })).toBeInTheDocument()
  })
})

describe('Ver conta — o saldo e a moeda', () => {
  // O cabeçalho é o bloco que contém o «Saldo atual» (só para leitores de
  // ecrã): conta-se ali dentro quantas vezes aparece o valor.
  function cabecalho() {
    return screen.getByText('Saldo atual').parentElement as HTMLElement
  }

  it('na moeda principal: só o saldo, sem legenda visível nem valor original', async () => {
    montar()

    await screen.findByText('Saldo atual')
    expect(cabecalho().textContent?.match(/1.?000,00/g)?.length).toBe(1)
  })

  it('noutra moeda, com taxa: o convertido em destaque e o original por baixo', async () => {
    montar({ ...CONTA, moeda: 'USD', saldo_convertido: '925.00' })

    await screen.findByText('Saldo atual')
    expect(within(cabecalho()).getByText(/925,00 ?€/)).toBeInTheDocument()
    expect(cabecalho().textContent?.match(/1.?000,00/g)?.length).toBe(1)
  })

  it('noutra moeda, sem taxa: só o saldo na moeda da conta', async () => {
    montar({ ...CONTA, moeda: 'USD', saldo_convertido: null })

    await screen.findByText('Saldo atual')
    expect(cabecalho().textContent?.match(/1.?000,00/g)?.length).toBe(1)
  })
})

describe('Ver conta — o painel do banco', () => {
  it('uma conta manual não tem painel do banco', async () => {
    montar()

    await screen.findByRole('heading', { name: 'Conta à ordem' })
    expect(screen.queryByText('Autorização')).not.toBeInTheDocument()
  })

  it('vinculada: autorização «Ativa» e «Sincronizada · há 2 horas», com o IBAN em grupos de quatro', async () => {
    montar({ ...CONTA, vinculo: vinculo() })

    expect(await screen.findByText('Ativa')).toBeInTheDocument()
    expect(screen.getByText('Sincronizada · há 2 horas')).toBeInTheDocument()
    expect(screen.getByText('PT50 0002 0123 1234 5678 9015 4')).toBeInTheDocument()
  })

  it('a autorização a 7 dias ou menos do fim diz «A expirar»', async () => {
    montar({ ...CONTA, vinculo: vinculo({ valido_ate: new Date(Date.now() + 3 * DIA).toISOString() }) })

    expect(await screen.findByText('A expirar')).toBeInTheDocument()
  })

  it('acabada de vincular, ainda sem sincronização: «Ainda não sincronizada»', async () => {
    montar({ ...CONTA, vinculo: vinculo({ sincronizado_em: null }) })

    expect(await screen.findByText('Ainda não sincronizada')).toBeInTheDocument()
  })

  it('suspensa: autorização «Terminada», «Suspensa · desde …» e sem botão de sincronizar', async () => {
    montar({
      ...CONTA,
      vinculo: vinculo({
        estado: 'suspensa',
        motivo: 'expirada',
        valido_ate: '2026-09-02T10:00:00Z',
        suspensa_desde: '2026-09-02T10:00:00Z',
        autorizacao_terminada_em: '2026-09-02T10:00:00Z',
        falha_em: null,
        falha_motivo: null,
      }),
    })

    expect(await screen.findByText('Terminada')).toBeInTheDocument()
    expect(screen.getByText(/^Suspensa · desde 2 set/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /sincronizar/i })).not.toBeInTheDocument()
  })

  it('o banco deixou de partilhar a conta, com a autorização ativa: «Ativa» e «Suspensa · desde …»', async () => {
    montar({
      ...CONTA,
      vinculo: vinculo({ estado: 'suspensa', motivo: 'indisponivel', suspensa_desde: '2026-09-10T10:00:00Z' }),
    })

    expect(await screen.findByText('Ativa')).toBeInTheDocument()
    expect(screen.getByText(/^Suspensa · desde 10 set/)).toBeInTheDocument()
  })

  it('o banco deixou de partilhar a conta e a autorização também terminou: «Terminada», nunca «Ativa»', async () => {
    montar({
      ...CONTA,
      vinculo: vinculo({
        estado: 'suspensa',
        motivo: 'indisponivel',
        suspensa_desde: '2026-09-10T10:00:00Z',
        autorizacao_terminada_em: '2026-09-20T10:00:00Z',
        falha_em: null,
        falha_motivo: null,
      }),
    })

    expect(await screen.findByText('Terminada')).toBeInTheDocument()
    expect(screen.queryByText('Ativa')).not.toBeInTheDocument()
  })

  it('um conflito (409) ao sincronizar diz «tenta mais tarde», e não «sem ligação»', async () => {
    servidorMsw.use(
      http.post('/api/open-banking/contas-bancarias/cb-1/sincronizar', () =>
        HttpResponse.json({ detail: 'Outra operação a decorrer.' }, { status: 409 }),
      ),
    )
    montar({ ...CONTA, vinculo: vinculo() })

    await userEvent.click(await screen.findByRole('button', { name: 'Sincronizar agora' }))

    expect(await screen.findByText('Falhou · tenta mais tarde')).toBeInTheDocument()
    expect(screen.getByText('Não atualizado · tenta mais tarde')).toBeInTheDocument()
  })

  it('uma falha guardada pelo backend continua a ver-se ao reabrir a página', async () => {
    montar({ ...CONTA, vinculo: vinculo({ falha_em: new Date(Date.now() - HORA).toISOString(), falha_motivo: 'sem-ligacao' }) })

    expect(await screen.findByText('Falhou · sem ligação')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tentar sincronizar outra vez' })).not.toHaveAttribute('aria-disabled')
  })

  it('o limite do banco guardado hoje desativa o ↻; guardado ontem, já não', async () => {
    const { unmount } = montar({ ...CONTA, vinculo: vinculo({ falha_em: new Date().toISOString(), falha_motivo: 'limite' }) })
    expect(await screen.findByText('Falhou · limite do banco')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sincronizar agora' })).toHaveAttribute('aria-disabled', 'true')
    unmount()

    montar({ ...CONTA, vinculo: vinculo({ falha_em: new Date(Date.now() - 2 * DIA).toISOString(), falha_motivo: 'limite' }) })
    expect(await screen.findByText('Falhou · limite do banco')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sincronizar agora' })).not.toHaveAttribute('aria-disabled')
  })

  it('o ↻ sincroniza e diz o resultado num aviso em baixo', async () => {
    servidorMsw.use(
      http.post('/api/open-banking/contas-bancarias/cb-1/sincronizar', () =>
        HttpResponse.json({ movimentos_importados: 2 }),
      ),
    )
    montar({ ...CONTA, vinculo: vinculo() })

    await userEvent.click(await screen.findByRole('button', { name: 'Sincronizar agora' }))

    expect(await screen.findByText('Atualizado · 2 movimentos novos')).toBeInTheDocument()
  })

  it('sem ligação ao banco: «Falhou · sem ligação», o aviso e o ↻ para tentar outra vez', async () => {
    servidorMsw.use(
      http.post('/api/open-banking/contas-bancarias/cb-1/sincronizar', () =>
        HttpResponse.json({ detail: 'O banco não respondeu.' }, { status: 502 }),
      ),
    )
    montar({ ...CONTA, vinculo: vinculo() })

    await userEvent.click(await screen.findByRole('button', { name: 'Sincronizar agora' }))

    expect(await screen.findByText('Falhou · sem ligação')).toBeInTheDocument()
    expect(screen.getByText('Não atualizado · sem ligação')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tentar sincronizar outra vez' })).not.toHaveAttribute('aria-disabled')
  })

  it('limite do banco: «Falhou · limite do banco» e o ↻ fica desativado', async () => {
    servidorMsw.use(
      http.post('/api/open-banking/contas-bancarias/cb-1/sincronizar', () =>
        HttpResponse.json({ detail: 'Tenta outra vez amanhã.' }, { status: 429 }),
      ),
    )
    montar({ ...CONTA, vinculo: vinculo() })

    await userEvent.click(await screen.findByRole('button', { name: 'Sincronizar agora' }))

    expect(await screen.findByText('Falhou · limite do banco')).toBeInTheDocument()
    expect(screen.getByText('Não atualizado · limite do banco')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sincronizar agora' })).toHaveAttribute('aria-disabled', 'true')
  })

  it('copiar o IBAN copia-o sem espaços e confirma com um aviso', async () => {
    const escrever = vi.fn().mockResolvedValue(undefined)
    // A área de transferência do browser não existe no ambiente de teste:
    // simula-se só o que a página usa.
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: escrever }, configurable: true })
    montar({ ...CONTA, vinculo: vinculo() })

    await userEvent.click(await screen.findByRole('button', { name: 'Copiar IBAN' }))

    expect(escrever).toHaveBeenCalledWith('PT50000201231234567890154')
    expect(await screen.findByText('IBAN copiado')).toBeInTheDocument()
  })

  it('se copiar o IBAN falhar, diz isso', async () => {
    const escrever = vi.fn().mockRejectedValue(new Error('sem permissão'))
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: escrever }, configurable: true })
    montar({ ...CONTA, vinculo: vinculo() })

    await userEvent.click(await screen.findByRole('button', { name: 'Copiar IBAN' }))

    expect(await screen.findByText('Não foi possível copiar o IBAN')).toBeInTheDocument()
  })
})

describe('Ver conta — as reconciliações', () => {
  it('numa conta manual sem nenhuma: «Ainda sem reconciliações»', async () => {
    montar()

    expect(await screen.findByText('Ainda sem reconciliações')).toBeInTheDocument()
  })

  it('mostra só as três mais recentes, com o acerto e o seu sinal', async () => {
    montar(CONTA, [
      reconciliacao({ id: 'r1', data: '2026-01-31', acerto: '5.00' }),
      reconciliacao({ id: 'r2', data: '2026-03-31', acerto: '15.00' }),
      reconciliacao({ id: 'r3', data: '2026-05-31', acerto: '0.00' }),
      reconciliacao({ id: 'r4', data: '2026-06-30', acerto: '-35.00' }),
    ])

    const painel = await screen.findByRole('region', { name: 'Reconciliações' })
    // Espera pela lista (as reconciliações chegam num pedido à parte).
    await within(painel).findByText(/−?-?35,00/)
    expect(within(painel).getByText(/\+15,00/)).toBeInTheDocument()
    // A mais antiga (31 jan) não cabe nas três mais recentes.
    expect(within(painel).queryByText(/\+5,00/)).not.toBeInTheDocument()
    // A mais recente primeiro (30 jun antes de 31 mar).
    const texto = painel.textContent ?? ''
    expect(texto.indexOf('30/06') >= 0 ? texto.indexOf('30/06') : texto.search(/30.{0,6}jun/)).toBeLessThan(
      texto.indexOf('31/03') >= 0 ? texto.indexOf('31/03') : texto.search(/31.{0,6}mar/),
    )
    // Um acerto que passou a zero diz-se a quem usa um leitor de ecrã.
    expect(within(painel).getByText('Sem acerto:', { exact: false })).toBeInTheDocument()
  })

  it('se as reconciliações não carregarem, diz isso (e não «Ainda sem reconciliações»)', async () => {
    servidorMsw.use(
      http.get('/api/contas/c1/reconciliacoes', () => HttpResponse.json({ detail: 'Erro.' }, { status: 500 })),
    )
    montar(CONTA, null)

    expect(await screen.findByText('Não foi possível carregar as reconciliações')).toBeInTheDocument()
    expect(screen.queryByText('Ainda sem reconciliações')).not.toBeInTheDocument()
  })

  it('numa conta vinculada sem reconciliações, o painel não aparece', async () => {
    montar({ ...CONTA, vinculo: vinculo() })

    await screen.findByText('Ativa')
    expect(screen.queryByRole('region', { name: 'Reconciliações' })).not.toBeInTheDocument()
  })

  it('as criadas ao vincular dizem «Ao vincular»', async () => {
    montar({ ...CONTA, vinculo: vinculo() }, [reconciliacao({ origem: 'banco', acerto: '5.00' })])

    expect(await screen.findByText('Ao vincular')).toBeInTheDocument()
  })
})
