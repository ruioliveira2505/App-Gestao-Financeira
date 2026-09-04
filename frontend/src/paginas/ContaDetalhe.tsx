/*
 * PÁGINA DE DETALHE DE UMA CONTA (/contas/:id)
 * ===========================================
 *
 *   - O NOME da conta vive ao centro da barra de topo, entre o "‹" e o
 *     lápis de editar (à direita). Os dois são círculos do mesmo tamanho,
 *     por isso o nome fica mesmo centrado.
 *   - No conteúdo, um bloco de IDENTIDADE centrado: monograma grande e, por
 *     baixo, a legenda "SALDO ATUAL" seguida do saldo (o herói da página).
 *   - "Detalhes": banco, tipo, moeda e o ponto de partida dos movimentos,
 *     numa lista sem cartão. Cada título de secção ("Detalhes",
 *     "Reconciliações") tem um traço fino por baixo (à largura do
 *     conteúdo, para funcionar igual em desktop e mobile).
 *   - "Reconciliações": secção que anuncia as reconciliações de saldo
 *     desta conta, que vão viver aqui quando existirem.
 *
 * "Editar" (no cabeçalho) leva ao formulário de edição — e é lá, no fim
 * desse formulário, que fica o "Eliminar conta" (à maneira do ecrã de
 * edição de um contacto no iOS). Aqui não há acção destrutiva.
 *
 * Enquanto a conta carrega mostra-se um ESQUELETO com a forma da página
 * (barras cinzentas). Se o pedido falhar, uma mensagem e uma saída para a
 * lista de contas. O "‹" da barra está presente desde o início (o
 * <CabecalhoPagina> é sempre montado), por isso há sempre como voltar.
 */

import { useEffect, useState } from 'react'

import { Link, useParams } from 'react-router-dom'

import { Avatar } from '../componentes/Avatar'
import { CabecalhoPagina } from '../componentes/CabecalhoPagina'
import { IconeGrafico, IconeLapis } from '../componentes/icones'
import { LinkVoltar } from '../componentes/LinkVoltar'
import { obterConta, type Conta } from '../lib/contas'
import { formatarData } from '../lib/datas'
import { ErroApi } from '../lib/http'
import { etiquetaMoeda, formatarDinheiro } from '../lib/moedas'
import estilos from './ContaDetalhe.module.css'

/** Esqueleto mostrado enquanto a conta carrega: barras cinzentas que
 *  pulsam devagar, com a forma da página — o bloco de identidade (círculo +
 *  duas barras), um título de secção, e a lista com três linhas
 *  rótulo/valor. */
function Esqueleto() {
  return (
    <div role="status" aria-label="A carregar a conta">
      <div className={estilos.esqPerfil}>
        <span className={`${estilos.esq} ${estilos.esqAvatar}`} />
        <span className={`${estilos.esq} ${estilos.esqCaption}`} />
        <span className={`${estilos.esq} ${estilos.esqSaldoBarra}`} />
      </div>
      <span className={`${estilos.esq} ${estilos.esqTitulo}`} />
      <dl className={estilos.lista}>
        {[0, 1, 2].map((indice) => (
          <div key={indice} className={estilos.par}>
            <span className={`${estilos.esq} ${estilos.esqRotulo}`} />
            <span className={`${estilos.esq} ${estilos.esqValor}`} />
          </div>
        ))}
      </dl>
    </div>
  )
}

export function ContaDetalhe() {
  const { id } = useParams<{ id: string }>()

  const [conta, setConta] = useState<Conta | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    let activo = true
    obterConta(id)
      .then((c) => {
        if (activo) setConta(c)
      })
      .catch((e) => {
        if (activo) {
          setErro(e instanceof ErroApi ? e.message : 'Não foi possível carregar a conta.')
        }
      })
    return () => {
      activo = false
    }
  }, [id])

  const negativo = conta ? Number(conta.saldo) < 0 : false
  const rotuloMoeda = conta ? etiquetaMoeda(conta.moeda) : ''

  return (
    <div className={estilos.pagina}>
      <LinkVoltar para="/contas">Contas</LinkVoltar>

      {/* Montado sempre — mesmo a carregar ou em erro — para o "‹" da barra
          estar lá desde o início. O título e a acção só entram quando a
          conta chega. */}
      <CabecalhoPagina
        titulo={conta?.nome ?? ''}
        voltar="/contas"
        acao={
          conta ? (
            <Link
              to={`/contas/${conta.id}/editar`}
              className={estilos.acaoIcone}
              aria-label="Editar"
            >
              <IconeLapis tamanho={20} />
            </Link>
          ) : undefined
        }
      />

      {erro ? (
        <div className={estilos.erroBloco}>
          <p role="alert" className={estilos.nota}>
            {erro}
          </p>
          <Link to="/contas" className={estilos.erroVoltar}>
            Voltar às contas
          </Link>
        </div>
      ) : !conta ? (
        <Esqueleto />
      ) : (
        <>
          {/* Bloco de identidade: monograma grande e, por baixo, a legenda
              "SALDO ATUAL" a introduzir o saldo. */}
          <div className={estilos.perfil}>
            <Avatar nome={conta.banco || conta.nome} tamanho="xl" />
            <span className={estilos.saldoRotulo}>Saldo atual</span>
            <span
              className={
                negativo ? `${estilos.saldo} ${estilos.negativo}` : estilos.saldo
              }
            >
              {formatarDinheiro(conta.saldo, conta.moeda)}
            </span>
          </div>

          <section className={estilos.seccao}>
            <h2 className={estilos.seccaoTitulo}>Detalhes</h2>
            <dl className={estilos.lista}>
              {conta.banco && (
                <div className={estilos.par}>
                  <dt>Banco</dt>
                  <dd>{conta.banco}</dd>
                </div>
              )}
              {conta.tipo && (
                <div className={estilos.par}>
                  <dt>Tipo de conta</dt>
                  <dd>{conta.tipo}</dd>
                </div>
              )}
              <div className={estilos.par}>
                <dt>Moeda</dt>
                <dd>{rotuloMoeda}</dd>
              </div>
              <div className={estilos.par}>
                <dt>Início dos movimentos</dt>
                <dd>{formatarData(conta.data_ancora)}</dd>
              </div>
              <div className={estilos.par}>
                <dt>Saldo de início</dt>
                <dd>{formatarDinheiro(conta.saldo_ancora, conta.moeda)}</dd>
              </div>
            </dl>
          </section>

          <section className={estilos.seccao}>
            <h2 className={estilos.seccaoTitulo}>Reconciliações</h2>
            <div className={estilos.emBreve}>
              <span className={estilos.emBreveIcone} aria-hidden="true">
                <IconeGrafico tamanho={20} />
              </span>
              <p>As reconciliações de saldo desta conta vão aparecer aqui.</p>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
