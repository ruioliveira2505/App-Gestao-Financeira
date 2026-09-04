/*
 * ContaFormulario — FORMULÁRIO DE CRIAR / EDITAR UMA CONTA
 * ======================================================
 *
 * Formulário controlado partilhado pelas rotas /contas/nova e
 * /contas/:id/editar. Quem o usa passa:
 *   - "inicial" (opcional): a conta a editar. Se vier, o formulário está
 *     em modo de edição — a ficha da âncora (data e saldo de início) NÃO
 *     aparece, porque o endpoint de edição (PATCH) não lhe toca (será um
 *     fluxo próprio, com as reconciliações).
 *   - "aoGuardar": a função a correr na submissão (criar ou editar). Deve
 *     devolver uma promessa; se rejeitar com ErroApi, a mensagem é
 *     mostrada.
 *
 * Os campos estão em dois grupos: "Identificação" (nome, banco, tipo,
 * moeda) e a âncora — data e saldo de início, só na criação. Cada grupo é
 * um cartão; não há título visível. Por BAIXO dos campos da âncora há uma
 * nota pequena a explicar o que ela é (o rodapé de grupo das listas
 * agrupadas do iOS).
 *
 * BANCO e TIPO são seletores de campos ABERTOS (CampoSelecao com
 * "permiteNovo"): "Sem banco"/"Sem tipo" no topo, a seguir a lista (banco
 * começa vazia e cresce com o uso; tipo tem a lista-semente TIPOS_COMUNS
 * mais o uso), e no fim "Outro banco"/"Outro tipo" para escrever um valor
 * à mão. MOEDA é um seletor de conjunto fechado (o símbolo e a futura
 * conversão dependem do código).
 *
 * APRESENTAÇÃO: fichas ao estilo das listas agrupadas do iOS — cartão
 * branco com contorno (sem sombra), cada campo com o nome em cima (ténue)
 * e o valor por baixo, e um traço fino recuado a separar as linhas.
 *
 * AGRUPAMENTO: cada grupo é um <fieldset> SEM <legend> — o rótulo do grupo
 * vai num "aria-label" do <fieldset>. Um <legend>, mesmo escondido fora do
 * ecrã, faz o Safari reservar-lhe espaço no topo do <fieldset>.
 *
 * BOTÃO DE SUBMETER: por omissão, no rodapé do formulário ("Criar conta" /
 * "Guardar alterações"). Quem preferir um botão FORA (ex.: o "✓" no
 * cabeçalho do modal Nova conta) passa "botaoNoRodape={false}", dá um
 * "idFormulario" (para o botão externo o submeter via <button form={id}>)
 * e um "aoMudarSubmissao" (para saber quando desativar esse botão).
 */

import { useEffect, useState } from 'react'

import { Avatar } from './Avatar'
import { Botao } from './Botao'
import { CaixaErro } from './CaixaErro'
import { CampoDinheiro } from './CampoDinheiro'
import { CampoSelecao } from './CampoSelecao'
import { CampoTexto } from './CampoTexto'
import { Formulario } from './Formulario'
import { ErroApi } from '../lib/http'
import { TIPOS_COMUNS, listarContas, sugestoes, type Conta } from '../lib/contas'
import { OPCOES_MOEDA } from '../lib/moedas'
import estilos from './ContaFormulario.module.css'

export type DadosConta = {
  nome: string
  banco: string | null
  tipo: string | null
  moeda: string
  data_ancora: string
  saldo_ancora: string
}

type Props = {
  inicial?: Conta
  aoGuardar: (dados: DadosConta) => Promise<void>
  // Renderiza o botão de submeter no rodapé do formulário (por omissão).
  // "false" quando o botão vive fora (ver docstring).
  botaoNoRodape?: boolean
  // "id" do <form> — necessário quando o botão de submeter é externo.
  idFormulario?: string
  // Avisa quando a submissão começa (true) e quando falha (false) — para o
  // botão externo se poder desativar durante o pedido.
  aoMudarSubmissao?: (aSubmeter: boolean) => void
  // Avisa se os campos OBRIGATÓRIOS estão preenchidos — para o botão
  // externo ("✓") só ficar ativo quando dá para guardar.
  aoMudarValidez?: (valido: boolean) => void
}

const HOJE = new Date().toISOString().slice(0, 10)
const MENSAGEM_ERRO_GENERICA = 'Não foi possível guardar. Tenta novamente.'

export function ContaFormulario({
  inicial,
  aoGuardar,
  botaoNoRodape = true,
  idFormulario,
  aoMudarSubmissao,
  aoMudarValidez,
}: Props) {
  const eEdicao = inicial !== undefined

  const [nome, setNome] = useState(inicial?.nome ?? '')
  const [banco, setBanco] = useState(inicial?.banco ?? '')
  const [tipo, setTipo] = useState(inicial?.tipo ?? '')
  const [moeda, setMoeda] = useState(inicial?.moeda ?? 'EUR')
  const [dataAncora, setDataAncora] = useState(inicial?.data_ancora ?? HOJE)
  const [saldoAncora, setSaldoAncora] = useState(inicial?.saldo_ancora ?? '')

  const [erro, setErro] = useState<string | null>(null)
  const [aSubmeter, setASubmeter] = useState(false)

  // Opções dos seletores de banco e tipo. Banco começa vazio; tipo com a
  // lista-semente. Ambos crescem com o que o utilizador já usou (obtido a
  // seguir).
  const [bancosSugeridos, setBancosSugeridos] = useState<string[]>([])
  const [tiposSugeridos, setTiposSugeridos] = useState<string[]>(TIPOS_COMUNS)

  useEffect(() => {
    let activo = true
    listarContas()
      .then((contas) => {
        if (!activo) return
        setBancosSugeridos(sugestoes([], contas.map((c) => c.banco)))
        setTiposSugeridos(sugestoes(TIPOS_COMUNS, contas.map((c) => c.tipo)))
      })
      // Falhar a obter as contas não é impeditivo — fica-se com as listas
      // de partida.
      .catch(() => {})
    return () => {
      activo = false
    }
  }, [])

  // O banco/tipo ESCOLHIDO AGORA, se for um valor à mão que ainda não está
  // nas sugestões, entra já como opção da lista — mas só ESSE. Um valor
  // que se escreveu e depois se substituiu por outro não fica a "sujar" a
  // lista, e nada disto é gravado: ao fechar o formulário sem criar a
  // conta, o que se escreveu desaparece; ao criar, só o valor que ficou no
  // campo vai na conta (e passa então a estar na lista "a sério", porque
  // as sugestões saem das contas).
  const bancoExtra = banco && !bancosSugeridos.includes(banco) ? [banco] : []
  const tipoExtra = tipo && !tiposSugeridos.includes(tipo) ? [tipo] : []

  // Sugestões + o valor à mão atual, sem duplicados, viradas em opções
  // {valor, etiqueta} (no banco/tipo, o valor É o próprio texto).
  const opcoesBanco = sugestoes(bancosSugeridos, bancoExtra).map((b) => ({
    valor: b,
    etiqueta: b,
  }))
  const opcoesTipo = sugestoes(tiposSugeridos, tipoExtra).map((t) => ({
    valor: t,
    etiqueta: t,
  }))

  // Campos obrigatórios (também o são na API — o schema ContaCriar não
  // aceita "data_ancora" nem "saldo_ancora" vazios). O "✓" / o botão de
  // guardar só ficam ativos quando todos estão preenchidos.
  const valido =
    nome.trim() !== '' && dataAncora.trim() !== '' && saldoAncora.trim() !== ''

  useEffect(() => {
    aoMudarValidez?.(valido)
  }, [valido, aoMudarValidez])

  async function submeter() {
    setErro(null)

    if (!valido) return

    setASubmeter(true)
    aoMudarSubmissao?.(true)
    try {
      await aoGuardar({
        nome: nome.trim(),
        banco: banco.trim() || null,
        tipo: tipo.trim() || null,
        moeda,
        data_ancora: dataAncora,
        // O utilizador pode escrever a vírgula decimal portuguesa; a API
        // espera o ponto.
        saldo_ancora: saldoAncora.replace(',', '.').trim(),
      })
    } catch (erroApanhado) {
      setErro(erroApanhado instanceof ErroApi ? erroApanhado.message : MENSAGEM_ERRO_GENERICA)
      setASubmeter(false)
      aoMudarSubmissao?.(false)
    }
  }

  // Pré-visualização do monograma: a cor e a inicial saem do banco (ou, na
  // falta dele, do nome) — como no monograma real de uma conta. Atualiza-se
  // à medida que se escreve.
  const monograma = banco.trim() || nome.trim() || '?'

  return (
    <Formulario id={idFormulario} aoSubmeter={submeter}>
      <div className={estilos.monograma}>
        <Avatar nome={monograma} tamanho="xl" />
      </div>

      {/* Ficha 1 — identificação. */}
      <fieldset className={estilos.grupo} aria-label="Identificação">
        <CampoTexto
          disposicao="linha"
          etiqueta="Nome"
          valor={nome}
          aoMudar={setNome}
          obrigatorio
        />
        <CampoSelecao
          disposicao="linha"
          etiqueta="Banco"
          valor={banco}
          aoMudar={setBanco}
          opcoes={opcoesBanco}
          rotuloVazio="Sem banco"
          permiteNovo
          rotuloNovo="Adicionar banco"
        />
        <CampoSelecao
          disposicao="linha"
          etiqueta="Tipo"
          valor={tipo}
          aoMudar={setTipo}
          opcoes={opcoesTipo}
          rotuloVazio="Sem tipo"
          permiteNovo
          rotuloNovo="Adicionar tipo"
        />
        <CampoSelecao
          disposicao="linha"
          etiqueta="Moeda"
          valor={moeda}
          aoMudar={setMoeda}
          opcoes={OPCOES_MOEDA}
        />
      </fieldset>

      {/* Ficha 2 — a âncora (data + saldo de início). Só na criação: em
          edição a âncora não se toca por aqui (será um fluxo próprio, com
          as reconciliações). */}
      {!eEdicao && (
        <>
          <fieldset className={estilos.grupo} aria-label="Ponto de partida">
            <CampoTexto
              disposicao="linha"
              etiqueta="Data de início"
              tipo="date"
              valor={dataAncora}
              aoMudar={setDataAncora}
              obrigatorio
            />
            <CampoDinheiro
              disposicao="linha"
              etiqueta="Saldo início"
              valor={saldoAncora}
              aoMudar={setSaldoAncora}
              moeda={moeda}
            />
          </fieldset>
          {/* Nota a explicar a ficha acima — por baixo dela, à maneira do
              rodapé de um grupo nas listas do iOS. */}
          <p className={estilos.rodapeGrupo}>
            Data a partir da qual vais registar movimentos nesta conta, e o saldo
            nessa data — antes do primeiro movimento.
          </p>
        </>
      )}

      {erro !== null && <CaixaErro>{erro}</CaixaErro>}

      {botaoNoRodape && (
        <Botao type="submit" disabled={aSubmeter || !valido}>
          {aSubmeter ? 'A guardar…' : eEdicao ? 'Guardar alterações' : 'Criar conta'}
        </Botao>
      )}
    </Formulario>
  )
}
