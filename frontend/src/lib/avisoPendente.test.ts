/*
 * TESTES DO AVISO PENDENTE (o «correio» entre Editar e a página da conta)
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import { deixarAviso, escutarAvisos } from './avisoPendente'

describe('avisoPendente', () => {
  it('quem escuta recebe o aviso logo que é entregue', () => {
    const ouvinte = vi.fn()
    const parar = escutarAvisos('c1', ouvinte)

    deixarAviso('c1', 'Alterações guardadas')

    expect(ouvinte).toHaveBeenCalledWith('Alterações guardadas')
    parar()
  })

  it('sem ninguém à escuta, o aviso espera e é entregue (uma só vez) a quem começar a escutar', () => {
    deixarAviso('c2', 'Alterações guardadas')

    const primeiro = vi.fn()
    escutarAvisos('c2', primeiro)()
    const segundo = vi.fn()
    escutarAvisos('c2', segundo)()

    expect(primeiro).toHaveBeenCalledWith('Alterações guardadas')
    expect(segundo).not.toHaveBeenCalled()
  })

  it('os avisos de uma conta não chegam a outra, nem a quem já deixou de escutar', () => {
    const outra = vi.fn()
    const pararOutra = escutarAvisos('c3', outra)
    const antiga = vi.fn()
    escutarAvisos('c4', antiga)()

    deixarAviso('c4', 'Alterações guardadas')

    expect(outra).not.toHaveBeenCalled()
    expect(antiga).not.toHaveBeenCalled()
    pararOutra()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('um aviso à espera há mais de 10 segundos já não é entregue', () => {
    vi.useFakeTimers()
    deixarAviso('c5', 'Alterações guardadas')
    vi.advanceTimersByTime(11_000)

    const tardio = vi.fn()
    escutarAvisos('c5', tardio)()

    expect(tardio).not.toHaveBeenCalled()
  })
})
