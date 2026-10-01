/*
 * ContaLigadaFormulario — CONFIGURAR CONTAS VINDAS DO BANCO
 * =========================================================
 *
 * O formulário que aparece depois de ligar um banco (Open Banking), para
 * o utilizador dizer como quer ver cada conta descoberta nesta app. É o
 * PARALELO do ContaFormulario (a criação manual) — de propósito, com o
 * mesmo aspecto e a mesma ordem de campos, para as duas formas de criar
 * uma conta parecerem a mesma coisa:
 *
 *   ContaFormulario (manual)        ContaLigadaFormulario (banco)
 *   ------------------------        -----------------------------
 *   Nome                            Nome (sugerido: o nome do banco)
 *   Banco                           Banco  — bloqueado, vem do banco
 *   Tipo                            Tipo   — o mesmo seletor
 *   Moeda                           Moeda  — bloqueada, vem do banco
 *                                   IBAN   — bloqueado, vem do banco
 *   Data de início + Saldo início   Importar movimentos (+ Desde)
 *
 * A última ficha é o equivalente do "ponto de partida" manual: no manual,
 * o utilizador diz a data e o saldo; aqui o SALDO vem sempre do banco, e
 * a pergunta passa a ser "desde quando trazer movimentos" — trazer todo o
 * histórico de uma vez também significa um backlog de movimentos por
 * categorizar à mão (a app ainda não categoriza sozinha).
 *
 * VÁRIAS CONTAS NO MESMO FORMULÁRIO: quando o banco devolve mais do que
 * uma (e o utilizador escolheu mais do que uma), cada conta tem a sua
 * própria ficha, com uma legenda por cima ("Conta 1 · ••4021 · EUR"), e a
 * escolha de "importar movimentos" é uma só, para todas — em vez de um
 * assistente "conta 1 de N, seguinte…", que precisaria de uma folha por
 * conta. O monograma grande só aparece quando há uma conta só (tal como
 * no formulário manual).
 *
 * CAMPOS BLOQUEADOS (CampoFixo, abaixo): a primeira vez que a app mostra
 * um campo que existe mas não se pode editar — a mesma linha de uma ficha
 * (rótulo ténue em cima, valor por baixo), com o valor esbatido e um
 * cadeado à direita, e uma nota por baixo da ficha a explicar porquê. Não
 * é um <input> desactivado: é texto, porque nunca é editável aqui.
 *
 * Como o ContaFormulario, o botão de submeter vive FORA (o "✓" no
 * cabeçalho da folha): quem usa passa "idFormulario" e "aoMudarValidez".
 * Não grava nada: "aoConfirmar" devolve o que foi preenchido, e quem usa
 * trata da importação (que mostra progresso próprio).
 */

import { Fragment, useEffect, useState } from 'react'

import { Avatar } from './Avatar'
import { CampoSelecao } from './CampoSelecao'
import { CampoTexto } from './CampoTexto'
import { Formulario } from './Formulario'
import { IconeCadeado } from './icones'
import { TIPOS_COMUNS, listarContas, sugestoes } from '../lib/contas'
import { etiquetaMoeda } from '../lib/moedas'
import type { ContaLigada } from '../lib/openBanking'
// As MESMAS fichas do formulário manual (cartão, linhas, traço recuado,
// rodapé) — importadas daqui e não copiadas, para as duas formas de criar
// uma conta nunca poderem divergir visualmente.
import ficha from './ContaFormulario.module.css'
import estilos from './ContaLigadaFormulario.module.css'

export type DadosContasLigadas = {
  contas: { id: string; nome: string; tipo: string | null }[]
  // null = todo o histórico disponível; "AAAA-MM-DD" = desde essa data.
  dataDe: string | null
}

type Props = {
  // As contas a configurar (todas do mesmo banco).
  contas: ContaLigada[]
  idFormulario: string
  aoConfirmar: (dados: DadosContasLigadas) => void
  aoMudarValidez?: (valido: boolean) => void
}

// Por omissão, "desde uma data" propõe o início do ano corrente — um ponto
// de partida natural para acompanhar finanças, e bem menos histórico do
// que "tudo".
const INICIO_DO_ANO = `${new Date().getFullYear()}-01-01`

// "PT50001800031497057802084" → "PT50 0018 0003 1497 0578 0208 4" — o IBAN
// lê-se (e confere-se contra o extracto) em grupos de quatro.
function formatarIban(iban: string): string {
  return iban.replace(/\s+/g, '').replace(/(.{4})/g, '$1 ').trim()
}

// "••4021": os últimos quatro dígitos chegam para distinguir contas do
// mesmo banco, sem ocupar uma linha inteira.
function ibanCurto(iban: string | null): string | null {
  if (!iban) return null
  const limpo = iban.replace(/\s+/g, '')
  return `••${limpo.slice(-4)}`
}

// Nome sugerido: o banco, quando há uma conta só (é como o utilizador
// costuma chamar à conta); com várias, o banco mais algo que as distinga
// — a moeda, se forem diferentes, senão o fim do IBAN.
function nomeSugerido(conta: ContaLigada, todas: ContaLigada[]): string {
  if (todas.length === 1) return conta.banco
  const moedasDiferentes = new Set(todas.map((c) => c.moeda)).size > 1
  if (moedasDiferentes) return `${conta.banco} ${conta.moeda}`
  const fim = ibanCurto(conta.iban)
  return fim ? `${conta.banco} ${fim}` : conta.banco
}

/** Uma linha de ficha que mostra um valor que não se pode editar. */
function CampoFixo({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className={estilos.fixo}>
      <span className={estilos.fixoEtiqueta}>{etiqueta}</span>
      <span className={estilos.fixoValor}>
        {valor}
        <span className={estilos.fixoCadeado} aria-hidden="true">
          <IconeCadeado tamanho={14} />
        </span>
      </span>
    </div>
  )
}

const OPCOES_IMPORTAR = [
  { valor: 'tudo', etiqueta: 'Todo o histórico' },
  { valor: 'data', etiqueta: 'A partir de uma data' },
]

export function ContaLigadaFormulario({ contas, idFormulario, aoConfirmar, aoMudarValidez }: Props) {
  const [nomes, setNomes] = useState<Record<string, string>>(() =>
    Object.fromEntries(contas.map((c) => [c.id, nomeSugerido(c, contas)])),
  )
  const [tipos, setTipos] = useState<Record<string, string>>({})
  const [importar, setImportar] = useState<'tudo' | 'data'>('tudo')
  const [dataDe, setDataDe] = useState(INICIO_DO_ANO)

  // Os mesmos tipos que o formulário manual oferece: a lista-semente mais
  // os que o utilizador já usou noutras contas.
  const [tiposSugeridos, setTiposSugeridos] = useState<string[]>(TIPOS_COMUNS)
  useEffect(() => {
    let activo = true
    listarContas()
      .then((existentes) => {
        if (activo) setTiposSugeridos(sugestoes(TIPOS_COMUNS, existentes.map((c) => c.tipo)))
      })
      // Sem a lista de contas, fica-se com a lista-semente.
      .catch(() => {})
    return () => {
      activo = false
    }
  }, [])

  const valido =
    contas.every((c) => (nomes[c.id] ?? '').trim() !== '') &&
    (importar === 'tudo' || dataDe.trim() !== '')

  useEffect(() => {
    aoMudarValidez?.(valido)
  }, [valido, aoMudarValidez])

  function opcoesTipo(atual: string) {
    const extra = atual && !tiposSugeridos.includes(atual) ? [atual] : []
    return sugestoes(tiposSugeridos, extra).map((t) => ({ valor: t, etiqueta: t }))
  }

  function submeter() {
    if (!valido) return
    aoConfirmar({
      contas: contas.map((c) => ({
        id: c.id,
        nome: nomes[c.id].trim(),
        tipo: (tipos[c.id] ?? '').trim() || null,
      })),
      dataDe: importar === 'data' ? dataDe : null,
    })
  }

  const varias = contas.length > 1

  return (
    <Formulario id={idFormulario} aoSubmeter={submeter}>
      {!varias && (
        <div className={ficha.monograma}>
          <Avatar nome={contas[0].banco} tamanho="xl" />
        </div>
      )}

      {contas.map((conta, indice) => (
        <Fragment key={conta.id}>
          {varias && (
            <p className={estilos.legendaConta}>
              Conta {indice + 1}
              {conta.iban ? ` · ${ibanCurto(conta.iban)}` : ''} · {conta.moeda}
            </p>
          )}
          <fieldset className={ficha.grupo} aria-label={`Conta ${indice + 1}`}>
            <CampoTexto
              disposicao="linha"
              etiqueta="Nome"
              valor={nomes[conta.id] ?? ''}
              aoMudar={(v) => setNomes((atual) => ({ ...atual, [conta.id]: v }))}
              obrigatorio
            />
            <CampoFixo etiqueta="Banco" valor={conta.banco} />
            <CampoSelecao
              disposicao="linha"
              etiqueta="Tipo"
              valor={tipos[conta.id] ?? ''}
              aoMudar={(v) => setTipos((atual) => ({ ...atual, [conta.id]: v }))}
              opcoes={opcoesTipo(tipos[conta.id] ?? '')}
              rotuloVazio="Sem tipo"
              permiteNovo
              rotuloNovo="Adicionar tipo"
            />
            <CampoFixo etiqueta="Moeda" valor={etiquetaMoeda(conta.moeda)} />
            {conta.iban && <CampoFixo etiqueta="IBAN" valor={formatarIban(conta.iban)} />}
          </fieldset>
        </Fragment>
      ))}
      <p className={ficha.rodapeGrupo}>
        Banco, moeda e IBAN vêm do banco — não se alteram enquanto a conta estiver ligada.
      </p>

      <fieldset className={ficha.grupo} aria-label="Movimentos a importar">
        <CampoSelecao
          disposicao="linha"
          etiqueta="Importar movimentos"
          valor={importar}
          aoMudar={(v) => setImportar(v === 'data' ? 'data' : 'tudo')}
          opcoes={OPCOES_IMPORTAR}
        />
        {importar === 'data' && (
          <CampoTexto
            disposicao="linha"
            etiqueta="Desde"
            tipo="date"
            valor={dataDe}
            aoMudar={setDataDe}
            obrigatorio
          />
        )}
      </fieldset>
      {/* O histórico que "Todo o histórico" traz depende de cada banco: pela
          regra do PSD2 (a directiva europeia que regula o Open Banking),
          muitos só disponibilizam os últimos ~90 dias, e a API não diz de
          antemão quanto — por isso avisa-se aqui de forma geral, e o ecrã
          final mostra a data real a partir da qual os movimentos vieram. */}
      <p className={ficha.rodapeGrupo}>
        O saldo vem sempre do banco. O histórico disponível depende de cada banco — muitos só
        disponibilizam os últimos 90 dias. Trazer todo o histórico pode deixar muitos movimentos
        por categorizar de uma vez.
      </p>
    </Formulario>
  )
}
