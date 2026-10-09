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
 * moeda) e a âncora — data e saldo de início, e se esse saldo é negativo,
 * só na criação. Cada grupo é um cartão; não há título visível. Por BAIXO
 * dos campos da âncora há uma nota pequena a explicar o que ela é (o
 * rodapé de grupo das listas agrupadas do iOS).
 *
 * BANCO e TIPO são seletores de campos ABERTOS (CampoSelecao com
 * "permiteNovo"), no modo "procurar ou adicionar" (ver ListaDeOpcoes.tsx):
 * a lista tem só os valores já usados noutras contas — sem listas
 * pré-feitas (decisão de desenho: não restringir a um país nem influenciar
 * a escolha) —, "Sem banco"/"Sem tipo" no topo, e escrever um nome novo
 * oferece "Adicionar «…»". MOEDA é um seletor de conjunto fechado (o
 * símbolo e a futura conversão dependem do código).
 *
 * DATA DE INÍCIO: o calendário SeletorData (sobe de baixo como o teclado,
 * em telemóvel), sem dias futuros — o backend não os aceita.
 *
 * MOEDA: numa conta nova, começa na moeda principal do utilizador (a das
 * Preferências), não sempre em Euro — é a que a maioria das contas dele
 * vai usar.
 *
 * SALDO NEGATIVO: o teclado numérico do iPhone não tem a tecla "−", por
 * isso o sinal escolhe-se num interruptor à parte ("Saldo negativo") — ex.:
 * um cartão de crédito com dívida. O valor escreve-se sempre sem sinal,
 * mas o campo MOSTRA o efeito do interruptor: "−412,90 €", a vermelho
 * (o símbolo da moeda escolhida aparece sempre depois do valor).
 *
 * MONOGRAMA: a cor e a inicial saem do banco (ou do nome); sem nenhum dos
 * dois, um círculo neutro com uma carteira (no lugar do antigo "?" rosa).
 *
 * APRESENTAÇÃO: fichas ao estilo das listas agrupadas do iOS — cartão
 * branco com contorno (sem sombra), cada campo numa linha com o nome à
 * esquerda e o valor à direita (disposicao="lado", como nas Definições do
 * iOS e como a linha do interruptor), e um traço fino recuado a separar as
 * linhas. O Nome, vazio, mostra um exemplo esbatido ("Ex.: Conta
 * ordenado"), tal como o saldo mostra "0,00 €" — diz o que escrever sem
 * repetir o rótulo. Os rótulos da âncora são curtos ("Data inicial",
 * "Saldo inicial") para caberem ao lado do valor; o que significam
 * explica-o a nota por baixo da ficha.
 *
 * AGRUPAMENTO: cada grupo é um <fieldset> SEM <legend> — o rótulo do grupo
 * vai num "aria-label" do <fieldset>. Um <legend>, mesmo escondido fora do
 * ecrã, faz o Safari reservar-lhe espaço no topo do <fieldset>.
 *
 * ERRO AO GUARDAR: a caixa de erro fica no TOPO do formulário, logo
 * abaixo do monograma, e o formulário desliza até ela quando aparece. No
 * fundo (onde estava antes) ficava escondida fora do ecrã num telemóvel,
 * e o toque no "✓" parecia não ter feito nada. No topo fica também junto
 * do Nome — o campo do erro mais provável ("Já tens uma conta chamada…").
 *
 * BOTÃO DE SUBMETER: por omissão, no rodapé do formulário ("Criar conta" /
 * "Guardar alterações"). Quem preferir um botão FORA (ex.: o "✓" no
 * cabeçalho do modal Nova conta) passa "botaoNoRodape={false}", dá um
 * "idFormulario" (para o botão externo o submeter via <button form={id}>)
 * e um "aoMudarSubmissao" (para saber quando desativar esse botão).
 */

import { useEffect, useRef, useState } from 'react'

import { Avatar } from './Avatar'
import { Botao } from './Botao'
import { CaixaErro } from './CaixaErro'
import { CampoDinheiro } from './CampoDinheiro'
import { CampoSelecao } from './CampoSelecao'
import { CampoTexto } from './CampoTexto'
import { Formulario } from './Formulario'
import { IconeCarteira } from './icones'
import { Interruptor } from './Interruptor'
import { SeletorData } from './SeletorData'
import { useAuth } from '../auth/useAuth'
import { ErroApi } from '../lib/http'
import { useContas } from '../hooks/useContas'
import { sugestoes, type Conta } from '../lib/contas'
import { hojeIso } from '../lib/datas'
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
  // Ver a nota MOEDA, no topo. "?? 'EUR'" só para o caso de o utilizador
  // ainda não estar carregado (na app, este formulário só aparece depois).
  const { utilizador } = useAuth()
  const [moeda, setMoeda] = useState(inicial?.moeda ?? utilizador?.moeda_principal ?? 'EUR')
  const hoje = hojeIso()
  const [dataAncora, setDataAncora] = useState(inicial?.data_ancora ?? hoje)
  // O saldo sem sinal, e o sinal à parte (ver a nota SALDO NEGATIVO).
  const [saldoAncora, setSaldoAncora] = useState(inicial?.saldo_ancora?.replace('-', '') ?? '')
  const [negativo, setNegativo] = useState(inicial ? Number(inicial.saldo_ancora) < 0 : false)

  const [erro, setErro] = useState<string | null>(null)
  const [aSubmeter, setASubmeter] = useState(false)

  // Quando aparece um erro, traz a caixa para dentro do ecrã (ver ERRO AO
  // GUARDAR). "center" deixa à vista também o que está à volta (o
  // monograma e o Nome). Sem animação se o sistema pedir movimento
  // reduzido. "?." porque o jsdom dos testes não implementa scrollIntoView.
  const erroRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (erro === null) return
    const reduzido = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    erroRef.current?.scrollIntoView?.({ block: 'center', behavior: reduzido ? 'auto' : 'smooth' })
  }, [erro])

  // Opções dos seletores de banco e tipo: só o que o utilizador já usou
  // noutras contas — sem listas pré-feitas. As contas vêm da cache
  // partilhada (useContas). A TanStack Query (uma biblioteca de gestão de
  // dados vindos do servidor) guarda numa cache (uma cópia em memória)
  // os dados já pedidos, identificados por uma "chave" (ex.: ['contas']).
  // "Invalidar" uma chave marca esses dados como desatualizados: todas as
  // páginas que os mostram voltam a pedi-los e redesenham-se sozinhas.
  // Normalmente as contas já lá estão (a página
  // Contas, por baixo, acabou de as pedir), por isso as opções aparecem
  // logo. Sem contas (ou se o pedido falhar), as listas ficam vazias e
  // escreve-se o valor à mão — não é impeditivo.
  const { data: contasExistentes = [] } = useContas()
  const bancosSugeridos = sugestoes([], contasExistentes.map((c) => c.banco))
  const tiposSugeridos = sugestoes([], contasExistentes.map((c) => c.tipo))

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
        // espera o ponto. O sinal vem do interruptor "Saldo negativo" (um
        // zero fica sempre sem sinal).
        saldo_ancora: `${negativo && Number(saldoAncora.replace(',', '.')) !== 0 ? '-' : ''}${saldoAncora
          .replace(',', '.')
          .trim()}`,
      })
    } catch (erroApanhado) {
      setErro(erroApanhado instanceof ErroApi ? erroApanhado.message : MENSAGEM_ERRO_GENERICA)
      setASubmeter(false)
      aoMudarSubmissao?.(false)
    }
  }

  // Pré-visualização do monograma: a cor e a inicial saem do banco (ou, na
  // falta dele, do nome) — como no monograma real de uma conta. Atualiza-se
  // à medida que se escreve. Sem nenhum dos dois: o monograma neutro.
  const monograma = banco.trim() || nome.trim()

  return (
    <Formulario id={idFormulario} aoSubmeter={submeter}>
      <div className={estilos.monograma}>
        {monograma ? (
          <Avatar nome={monograma} tamanho="xl" />
        ) : (
          <span className={estilos.monogramaVazio} aria-hidden="true">
            <IconeCarteira tamanho={48} traco={1.5} />
          </span>
        )}
      </div>

      {erro !== null && (
        <div ref={erroRef}>
          <CaixaErro>{erro}</CaixaErro>
        </div>
      )}

      {/* Ficha 1 — identificação. */}
      <fieldset className={estilos.grupo} aria-label="Identificação">
        <CampoTexto
          disposicao="lado"
          etiqueta="Nome"
          valor={nome}
          aoMudar={setNome}
          obrigatorio
          // 120 caracteres: o limite do nome de uma conta no servidor (a
          // mesma regra do backend, para nunca se escrever um nome que ele
          // depois recusa).
          maxCaracteres={120}
          placeholder="Ex.: Conta ordenado"
        />
        <CampoSelecao
          disposicao="lado"
          etiqueta="Banco"
          valor={banco}
          aoMudar={setBanco}
          opcoes={opcoesBanco}
          rotuloVazio="Sem banco"
          permiteNovo
          rotuloNovo="Adicionar banco"
          textoVazio="Escreve o nome do banco no campo acima para o adicionar."
        />
        <CampoSelecao
          disposicao="lado"
          etiqueta="Tipo"
          valor={tipo}
          aoMudar={setTipo}
          opcoes={opcoesTipo}
          rotuloVazio="Sem tipo"
          permiteNovo
          rotuloNovo="Adicionar tipo"
          textoVazio="Escreve um tipo no campo acima (ex.: Conta à ordem) para o adicionar."
        />
        <CampoSelecao
          disposicao="lado"
          etiqueta="Moeda"
          valor={moeda}
          aoMudar={setMoeda}
          opcoes={OPCOES_MOEDA}
          pesquisavel
        />
      </fieldset>

      {/* Ficha 2 — a âncora (data + saldo de início). Só na criação: em
          edição a âncora não se toca por aqui (será um fluxo próprio, com
          as reconciliações). */}
      {!eEdicao && (
        <>
          <fieldset className={estilos.grupo} aria-label="Ponto de partida">
            <SeletorData
              disposicao="lado"
              etiqueta="Data inicial"
              valor={dataAncora}
              aoMudar={setDataAncora}
              maximo={hoje}
            />
            <CampoDinheiro
              disposicao="lado"
              etiqueta="Saldo inicial"
              valor={saldoAncora}
              aoMudar={setSaldoAncora}
              moeda={moeda}
              mostrarSimbolo
              negativo={negativo}
            />
            <Interruptor etiqueta="Saldo negativo" ligado={negativo} aoMudar={setNegativo} />
          </fieldset>
          {/* Nota a explicar a ficha acima — por baixo dela, à maneira do
              rodapé de um grupo nas listas do iOS. Diz o que a data
              significa (o início do registo) e o que não é óbvio no
              saldo: os movimentos do PRÓPRIO dia de início também contam
              (o backend aceita-os e soma-os), por isso o saldo pedido é o
              do início desse dia, antes de qualquer um deles. */}
          <p className={estilos.rodapeGrupo}>
            A data a partir da qual registas movimentos. O saldo é o do início desse dia, antes de
            qualquer movimento.
          </p>
        </>
      )}

      {botaoNoRodape && (
        <Botao type="submit" disabled={aSubmeter || !valido}>
          {aSubmeter ? 'A guardar…' : eEdicao ? 'Guardar alterações' : 'Criar conta'}
        </Botao>
      )}
    </Formulario>
  )
}
