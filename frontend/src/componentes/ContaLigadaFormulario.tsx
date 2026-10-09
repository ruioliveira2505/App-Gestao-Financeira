/*
 * ContaLigadaFormulario — CONFIGURAR CONTAS VINDAS DO BANCO
 * =========================================================
 *
 * O formulário que aparece depois de ligar um banco (Open Banking), para
 * o utilizador dizer como quer ver cada conta nova nesta app. É o
 * PARALELO do ContaFormulario (a criação manual): o mesmo aspecto e a
 * mesma ordem de campos, para as duas formas de criar uma conta
 * parecerem a mesma coisa:
 *
 *   ContaFormulario (manual)        ContaLigadaFormulario (banco)
 *   ------------------------        -----------------------------
 *   Nome (com exemplo)              Nome (com exemplo: a sugestão)
 *   Banco                           Banco  · bloqueado, vem do banco
 *   Tipo                            Tipo   · já preenchido, editável
 *   Moeda                           Moeda  · bloqueada, vem do banco
 *                                   IBAN   · bloqueado, vem do banco
 *   Data inicial + Saldo inicial    Todo o histórico (+ Desde)
 *
 * NOME: começa VAZIO, com a sugestão do backend como exemplo esbatido
 * ("Ex.: Conta à ordem CGD" — o tipo de conta mais o banco abreviado; ver
 * nome_sugerido, em backend/app/services/contas_bancarias.py). Como no
 * manual, o "✓" só fica ativo com o nome escrito: é o utilizador que dá o
 * nome às suas contas.
 *
 * TIPO: já vem preenchido quando o banco diz que tipo de conta é (ex.:
 * "Conta à ordem", a partir do código que o banco envia), e muda-se no
 * mesmo seletor do manual.
 *
 * A ÚLTIMA FICHA é o equivalente do "ponto de partida" manual: no manual,
 * o utilizador diz a data e o saldo; aqui o SALDO vem sempre do banco, e a
 * pergunta passa a ser a partir de quando registar os movimentos. «Todo o
 * histórico» é um interruptor (o padrão da app para um sim/não); desligado,
 * aparece «Desde», com o calendário da app. «Todo o histórico» é o que o
 * banco partilha, que às vezes são só os últimos 90 dias (o rodapé diz
 * isso; o ecrã final mostra desde quando vieram).
 *
 * VÁRIAS CONTAS NO MESMO FORMULÁRIO: cada conta tem a sua ficha, com uma
 * legenda por cima ("Conta à ordem · ••4021 · EUR"), e a escolha dos
 * movimentos é uma só, para todas — em vez de um assistente "conta 1 de
 * N, seguinte…". O monograma grande só aparece com uma conta só (como no
 * manual).
 *
 * CAMPOS BLOQUEADOS (CampoFixo, abaixo): um campo que existe mas não se
 * pode editar — a mesma linha das outras (nome à esquerda, valor à
 * direita), com o valor esbatido e um cadeado. O cadeado já diz que não se
 * altera, sem precisar de nota. Não é um <input> desactivado: é texto,
 * porque nunca é editável aqui. O IBAN aparece abreviado ("PT50 •••• 2084"),
 * para caber na linha como os outros.
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
import { Interruptor } from './Interruptor'
import { SeletorData } from './SeletorData'
import { IconeCadeado } from './icones'
import { useContas } from '../hooks/useContas'
import { sugestoes } from '../lib/contas'
import { etiquetaMoeda } from '../lib/moedas'
import type { ContaBancaria } from '../lib/openBanking'
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
  contas: ContaBancaria[]
  idFormulario: string
  aoConfirmar: (dados: DadosContasLigadas) => void
  aoMudarValidez?: (valido: boolean) => void
}

// Desligado «Todo o histórico», «Desde» propõe o início do ano corrente —
// um ponto de partida natural para acompanhar finanças.
const INICIO_DO_ANO = `${new Date().getFullYear()}-01-01`

// A data de HOJE em ISO ("AAAA-MM-DD"), no fuso local — o último dia que o
// calendário do "Desde" deixa escolher (não há movimentos no futuro).
// Não serve "toISOString()": daria a data em UTC, o dia errado perto da
// meia-noite.
function hojeLocal(): string {
  const agora = new Date()
  const mes = String(agora.getMonth() + 1).padStart(2, '0')
  const dia = String(agora.getDate()).padStart(2, '0')
  return `${agora.getFullYear()}-${mes}-${dia}`
}

// "PT50001800031497057802084" → "PT50 •••• 2084": os primeiros quatro
// caracteres (país e controlo) e os últimos quatro, o bastante para conferir com o extracto, numa linha.
function ibanAbreviado(iban: string): string {
  const limpo = iban.replace(/\s+/g, '')
  return `${limpo.slice(0, 4)} •••• ${limpo.slice(-4)}`
}

// "••4021": os últimos quatro dígitos chegam para distinguir contas do
// mesmo banco, na legenda de cada ficha.
function ibanCurto(iban: string | null): string | null {
  if (!iban) return null
  return `••${iban.replace(/\s+/g, '').slice(-4)}`
}

/** Uma linha de ficha que mostra um valor que não se pode editar: nome à
 *  esquerda, valor esbatido e cadeado à direita. */
function CampoFixo({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className={`${estilos.fixo} ${estilos.fixoLado}`}>
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

export function ContaLigadaFormulario({ contas, idFormulario, aoConfirmar, aoMudarValidez }: Props) {
  // Os nomes começam vazios (ver a nota NOME, no topo).
  const [nomes, setNomes] = useState<Record<string, string>>({})
  // Os tipos começam no sugerido pelo banco, quando o há (ver TIPO).
  const [tipos, setTipos] = useState<Record<string, string>>(() =>
    Object.fromEntries(contas.map((c) => [c.id, c.tipo_sugerido ?? ''])),
  )
  const [todoHistorico, setTodoHistorico] = useState(true)
  const [dataDe, setDataDe] = useState(INICIO_DO_ANO)

  // A lista do seletor de tipo: os tipos já usados noutras contas (sem
  // lista pré-feita, para não impor uma classificação) — o mesmo do
  // manual. As contas vêm da cache partilhada (useContas): a TanStack Query (uma biblioteca de gestão de
  // dados vindos do servidor) guarda numa cache (uma cópia em memória)
  // os dados já pedidos, identificados por uma "chave" (ex.: ['contas']).
  // "Invalidar" uma chave marca esses dados como desatualizados: todas as
  // páginas que os mostram voltam a pedi-los e redesenham-se sozinhas.
  // Sem contas, a lista fica vazia e escreve-se o tipo à mão.
  const { data: contasExistentes = [] } = useContas()
  const tiposSugeridos = sugestoes([], contasExistentes.map((c) => c.tipo))

  const valido = contas.every((c) => (nomes[c.id] ?? '').trim() !== '')

  useEffect(() => {
    aoMudarValidez?.(valido)
  }, [valido, aoMudarValidez])

  // O tipo escolhido agora, se ainda não estiver na lista (ex.: o sugerido
  // pelo banco), entra como opção — mas só esse.
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
      dataDe: todoHistorico ? null : dataDe,
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
              {conta.tipo_sugerido ?? `Conta ${indice + 1}`}
              {conta.iban ? ` · ${ibanCurto(conta.iban)}` : ''} · {conta.moeda}
            </p>
          )}
          <fieldset className={ficha.grupo} aria-label={`Conta ${indice + 1}`}>
            <CampoTexto
              disposicao="lado"
              etiqueta="Nome"
              valor={nomes[conta.id] ?? ''}
              aoMudar={(v) => setNomes((atual) => ({ ...atual, [conta.id]: v }))}
              placeholder={`Ex.: ${conta.nome_sugerido}`}
              obrigatorio
              // 120 caracteres: o limite do nome de uma conta no servidor (a
              // mesma regra do backend, para nunca se escrever um nome que ele
              // depois recusa).
              maxCaracteres={120}
            />
            <CampoFixo etiqueta="Banco" valor={conta.banco} />
            <CampoSelecao
              disposicao="lado"
              etiqueta="Tipo"
              valor={tipos[conta.id] ?? ''}
              aoMudar={(v) => setTipos((atual) => ({ ...atual, [conta.id]: v }))}
              opcoes={opcoesTipo(tipos[conta.id] ?? '')}
              rotuloVazio="Sem tipo"
              permiteNovo
              rotuloNovo="Adicionar tipo"
              textoVazio="Escreve um tipo no campo acima (ex.: Conta à ordem) para o adicionar."
            />
            <CampoFixo etiqueta="Moeda" valor={etiquetaMoeda(conta.moeda)} />
            {conta.iban && <CampoFixo etiqueta="IBAN" valor={ibanAbreviado(conta.iban)} />}
          </fieldset>
        </Fragment>
      ))}

      <fieldset className={ficha.grupo} aria-label="Movimentos a importar">
        <Interruptor
          etiqueta="Todo o histórico"
          ligado={todoHistorico}
          aoMudar={setTodoHistorico}
        />
        {!todoHistorico && (
          // O calendário da app (o mesmo da data inicial de uma conta
          // manual), sem dias no futuro.
          <SeletorData
            disposicao="lado"
            etiqueta="Desde"
            valor={dataDe}
            aoMudar={setDataDe}
            maximo={hojeLocal()}
          />
        )}
      </fieldset>
      {/* A primeira frase é a mesma do formulário manual: os dois explicam
          a data da mesma maneira. A segunda diz o que «Todo o histórico»
          traz de facto: o que cada banco partilha por Open Banking, que a
          API não diz de antemão — o ecrã final mostra desde quando veio. */}
      <p className={ficha.rodapeGrupo}>
        A data a partir da qual registas os movimentos desta conta. «Todo o histórico» é tudo o
        que o banco partilha, que às vezes são só os últimos 90 dias.
      </p>
    </Formulario>
  )
}
