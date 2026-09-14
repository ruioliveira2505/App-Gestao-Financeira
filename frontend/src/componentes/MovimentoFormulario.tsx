/*
 * MovimentoFormulario — FORMULÁRIO DE CRIAR / EDITAR UM MOVIMENTO
 * ================================================================
 *
 * Formulário controlado partilhado pelas rotas /movimentos/novo e
 * /movimentos/:id/editar. Quem o usa passa:
 *   - "inicial" (opcional): o movimento a editar. Se vier, o formulário
 *     está em modo de edição.
 *   - "aoGuardar": a função a correr na submissão (criar ou editar). Deve
 *     devolver uma promessa; se rejeitar com ErroApi, a mensagem é
 *     mostrada.
 *
 * ENTRADA OU SAÍDA + VALOR SEMPRE POSITIVO, NÃO UM VALOR COM SINAL: é
 * assim que se pensa em dinheiro do dia a dia ("gastei 50€", não "-50€").
 * A API guarda um único valor com sinal (ver app/models/movimento.py, no
 * backend) — a conversão faz-se aqui, num sítio só, ao submeter (para o
 * sinal) e ao entrar em modo de edição (do sinal de volta para o par
 * tipo/valor absoluto). CampoDinheiro já impede escrever um "-" (só deixa
 * dígitos e um separador decimal), por isso o valor absoluto nunca
 * precisa de validação extra nesse sentido.
 *
 * CONTA e TIPO (Saída / Entrada) são ambos CampoSelecao de conjunto
 * FECHADO — o mesmo controlo, para as duas linhas da ficha ficarem
 * uniformes. Ao contrário de banco/tipo em ContaFormulario, não há
 * "Adicionar…": a conta escolhe-se entre as que já existem (obtidas com
 * listarContas()). Sem nenhuma conta, o formulário não se mostra — pede
 * para criar uma primeiro.
 *
 * CATEGORIA, logo a seguir ao Tipo: as opções mostradas dependem da
 * direção já escolhida (só categorias de entrada para uma entrada, só de
 * saída para uma saída) — por isso vem depois, não antes. É sempre
 * obrigatória (ver a nota CATEGORIA OBRIGATÓRIA em app/models/
 * movimento.py, no backend): por omissão, começa na categoria-refúgio da
 * direção escolhida ("Outras Entradas"/"Outras Saídas" > "Outros"), sem
 * o utilizador ter de pensar nisso já; muda-se o Tipo, e se a categoria
 * escolhida deixar de bater certo com a nova direção, volta a cair nesse
 * refúgio (ver mudarTipo, abaixo). O seletor mostra as opções agrupadas
 * pelo nome do grupo (ver a nota OPÇÕES AGRUPADAS em ListaDeOpcoes.tsx) —
 * uma lista plana teria, consoante a direção, entre 24 e 59 subcategorias.
 *
 * APRESENTAÇÃO: uma única ficha (cartão com contorno, sem sombra) — ao
 * contrário de ContaFormulario, não há aqui uma segunda ficha de "ponto de
 * partida"; um movimento não tem âncora.
 */

import { useEffect, useState } from 'react'

import { Avatar } from './Avatar'
import { CaixaErro } from './CaixaErro'
import { CampoDinheiro } from './CampoDinheiro'
import { CampoSelecao } from './CampoSelecao'
import { CampoTexto } from './CampoTexto'
import { Formulario } from './Formulario'
import { Botao } from './Botao'
import { LinkBotao } from './LinkBotao'
import { type OpcaoLista } from './ListaDeOpcoes'
import { PontoCategoria } from './PontoCategoria'
import { ErroApi } from '../lib/http'
import { listarContas, type Conta } from '../lib/contas'
import {
  categoriaRefugio,
  direcaoDaCategoria,
  obterArvoreCategorias,
  type GrupoArvore,
} from '../lib/categorias'
import { simboloDe } from '../lib/moedas'
import type { Movimento } from '../lib/movimentos'
import estilos from './MovimentoFormulario.module.css'

export type DadosMovimento = {
  conta_id: string
  categoria_id: string
  data: string
  descricao: string
  valor: string
}

type Props = {
  inicial?: Movimento
  aoGuardar: (dados: DadosMovimento) => Promise<void>
  botaoNoRodape?: boolean
  idFormulario?: string
  aoMudarSubmissao?: (aSubmeter: boolean) => void
  aoMudarValidez?: (valido: boolean) => void
}

const HOJE = new Date().toISOString().slice(0, 10)
const MENSAGEM_ERRO_GENERICA = 'Não foi possível guardar. Tenta novamente.'

/** Deriva o par (tipo, valor absoluto) a partir de um valor com sinal —
 *  o inverso da conversão feita ao submeter. Usado só para pré-preencher
 *  o formulário em modo de edição. */
function paraTipoEValorAbsoluto(valorComSinal: string): { tipo: 'entrada' | 'saida'; valor: string } {
  const numero = Number(valorComSinal)
  return {
    tipo: numero < 0 ? 'saida' : 'entrada',
    valor: Math.abs(numero).toFixed(2),
  }
}

export function MovimentoFormulario({
  inicial,
  aoGuardar,
  botaoNoRodape = true,
  idFormulario,
  aoMudarSubmissao,
  aoMudarValidez,
}: Props) {
  const eEdicao = inicial !== undefined
  const inicialTipoValor = inicial ? paraTipoEValorAbsoluto(inicial.valor) : undefined

  const [contaId, setContaId] = useState(inicial?.conta_id ?? '')
  const [categoriaId, setCategoriaId] = useState(inicial?.categoria_id ?? '')
  const [data, setData] = useState(inicial?.data ?? HOJE)
  const [descricao, setDescricao] = useState(inicial?.descricao ?? '')
  const [tipo, setTipo] = useState<'entrada' | 'saida'>(inicialTipoValor?.tipo ?? 'saida')
  const [valorAbsoluto, setValorAbsoluto] = useState(inicialTipoValor?.valor ?? '')

  const [erro, setErro] = useState<string | null>(null)
  const [aSubmeter, setASubmeter] = useState(false)

  // As contas do utilizador, para o seletor de conta. "null" enquanto
  // ainda não chegaram — distingue de "chegaram e são zero" (nesse caso,
  // o formulário não se mostra: pede para criar uma conta primeiro).
  const [contas, setContas] = useState<Conta[] | null>(null)
  // A árvore de categorias, para o seletor de categoria — "null" enquanto
  // ainda não chegou. Ao contrário das contas, nunca fica vazia na
  // prática (todo o utilizador nasce com a árvore semeada), por isso não
  // há aqui um estado "sem categorias" próprio.
  const [arvore, setArvore] = useState<GrupoArvore[] | null>(null)

  useEffect(() => {
    let activo = true
    listarContas()
      .then((lista) => {
        if (activo) setContas(lista)
      })
      .catch(() => {
        if (activo) setContas([])
      })
    return () => {
      activo = false
    }
  }, [])

  useEffect(() => {
    let activo = true
    obterArvoreCategorias()
      .then((lista) => {
        if (activo) setArvore(lista)
      })
      .catch(() => {
        if (activo) setArvore([])
      })
    return () => {
      activo = false
    }
  }, [])

  const contaSelecionada = contas?.find((c) => c.id === contaId)
  // Cada opção leva o monograma da conta — o mesmo que aparece na lista de
  // contas e na linha do movimento —, para se identificar de relance qual
  // é qual.
  const opcoesConta = (contas ?? [])
    .map((c) => ({
      valor: c.id,
      etiqueta: c.nome,
      avatar: <Avatar nome={c.banco || c.nome} />,
    }))
    .sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, 'pt'))

  // Só os grupos da direção escolhida — trocar o Tipo troca as opções
  // disponíveis (ver mudarTipo, abaixo). A árvore já vem alfabética nos
  // dois níveis (backend), por isso a ordem só se herda, não se recalcula.
  const opcoesCategoria: OpcaoLista[] = (arvore ?? [])
    .filter((grupo) => grupo.direcao === tipo)
    .flatMap((grupo) =>
      grupo.subcategorias.map((sub) => ({
        valor: sub.id,
        etiqueta: sub.nome,
        grupo: grupo.nome,
        avatar: <PontoCategoria nomeGrupo={grupo.nome} />,
      })),
    )

  // O valor efetivamente usado (mostrado e submetido): a escolha explícita
  // do utilizador, ou — enquanto não houver nenhuma — a categoria-refúgio
  // da direção atual. Derivado a cada render, não guardado em estado à
  // parte, para nunca haver um instante em que o campo mostra vazio à
  // espera de um efeito (a árvore já está carregada quando este código
  // corre — ver a guarda mais abaixo, "if (contas === null || arvore ===
  // null) return null").
  const categoriaEfetiva = categoriaId || (arvore ? categoriaRefugio(arvore, tipo) ?? '' : '')

  // Ao mudar de Tipo, se a categoria escolhida já não corresponder à nova
  // direção, esvazia-se a escolha — "categoriaEfetiva" recai então,
  // sozinha, no refúgio da nova direção. Só reatribuir Tipo, sem tocar em
  // categoriaId, deixaria uma subcategoria de saída associada a uma
  // entrada (ou vice-versa), a mesma incoerência que _validar_direcao
  // recusa no backend.
  function mudarTipo(novoTipo: 'entrada' | 'saida') {
    setTipo(novoTipo)
    if (arvore && direcaoDaCategoria(arvore, categoriaId) !== novoTipo) {
      setCategoriaId('')
    }
  }

  const valido =
    contaId !== '' &&
    categoriaEfetiva !== '' &&
    data.trim() !== '' &&
    descricao.trim() !== '' &&
    valorAbsoluto.trim() !== '' &&
    Number(valorAbsoluto.replace(',', '.')) !== 0

  useEffect(() => {
    aoMudarValidez?.(valido)
  }, [valido, aoMudarValidez])

  async function submeter() {
    setErro(null)
    if (!valido) return

    setASubmeter(true)
    aoMudarSubmissao?.(true)
    try {
      const magnitude = Math.abs(Number(valorAbsoluto.replace(',', '.')))
      const valorComSinal = tipo === 'saida' ? -magnitude : magnitude
      await aoGuardar({
        conta_id: contaId,
        categoria_id: categoriaEfetiva,
        data,
        descricao: descricao.trim(),
        valor: valorComSinal.toFixed(2),
      })
    } catch (erroApanhado) {
      setErro(erroApanhado instanceof ErroApi ? erroApanhado.message : MENSAGEM_ERRO_GENERICA)
      setASubmeter(false)
      aoMudarSubmissao?.(false)
    }
  }

  // Ainda a carregar as contas ou a árvore de categorias: nada para
  // mostrar por agora (o formulário aparece assim que as duas chegarem —
  // não há campos para preencher entretanto, e esperar pelas duas evita
  // que o seletor de categoria mostre, por instantes, "" antes de cair no
  // refúgio por omissão).
  if (contas === null || arvore === null) return null

  // Sem nenhuma conta: não há onde lançar o movimento. Em vez de um
  // formulário com um seletor vazio, pede-se para criar uma conta
  // primeiro — o mesmo convite que a página Movimentos já mostra quando
  // não há contas nenhumas.
  if (contas.length === 0) {
    return (
      <div className={estilos.semContas}>
        <p className={estilos.semContasTitulo}>Precisas de uma conta primeiro.</p>
        <p>Os movimentos pertencem sempre a uma conta — cria a tua primeira conta.</p>
        <LinkBotao para="/contas/nova">Criar conta</LinkBotao>
      </div>
    )
  }

  return (
    <Formulario id={idFormulario} aoSubmeter={submeter}>
      {/* Ordem: conta → tipo → categoria → descrição → data → valor.
          Segue-se a ordem natural do lançamento: primeiro a que conta
          pertence (é o que dá contexto a tudo o resto — a moeda do valor,
          a data mínima), depois "é entrada ou saída" (que decide QUAIS
          categorias fazem sentido), a categoria em si, a seguir a
          descrição e a data, e o valor no fim (é o que fecha o
          lançamento). */}
      <fieldset className={estilos.grupo} aria-label="Detalhes do movimento">
        <CampoSelecao
          disposicao="linha"
          etiqueta="Conta"
          valor={contaId}
          aoMudar={setContaId}
          opcoes={opcoesConta}
          // Ao contrário de banco/tipo, aqui não há um "sem conta" válido —
          // um movimento tem sempre de pertencer a uma. "rotuloVazio" serve
          // só para o campo ter texto visível (e tocável) antes de se
          // escolher: sem ele, com "valor" vazio e nenhuma opção "", o
          // gatilho ficava sem texto nenhum.
          rotuloVazio="Escolher conta"
        />
        {/* Mesmo controlo que a Conta (CampoSelecao), para as duas linhas da
            ficha ficarem uniformes — em vez de o Tipo ser um "chip" à
            parte. É um conjunto fechado (só Saída / Entrada), sem "sem
            valor" possível, por isso não leva "rotuloVazio". */}
        <CampoSelecao
          disposicao="linha"
          etiqueta="Tipo"
          valor={tipo}
          aoMudar={(valor) => mudarTipo(valor as 'entrada' | 'saida')}
          opcoes={[
            { valor: 'saida', etiqueta: 'Saída' },
            { valor: 'entrada', etiqueta: 'Entrada' },
          ]}
        />
        {/* Sempre obrigatória (ver a nota CATEGORIA no topo do ficheiro) —
            por isso, tal como o Tipo, também não leva "rotuloVazio": o
            valor mostrado nunca é vazio, começa sempre na categoria-
            refúgio da direção escolhida. */}
        <CampoSelecao
          disposicao="linha"
          etiqueta="Categoria"
          valor={categoriaEfetiva}
          aoMudar={setCategoriaId}
          opcoes={opcoesCategoria}
        />
        <CampoTexto
          disposicao="linha"
          etiqueta="Descrição"
          valor={descricao}
          aoMudar={setDescricao}
          obrigatorio
        />
        <CampoTexto
          disposicao="linha"
          etiqueta="Data"
          tipo="date"
          valor={data}
          aoMudar={setData}
          obrigatorio
        />
        <CampoDinheiro
          disposicao="linha"
          etiqueta={
            contaSelecionada ? `Valor (${simboloDe(contaSelecionada.moeda)})` : 'Valor'
          }
          valor={valorAbsoluto}
          aoMudar={setValorAbsoluto}
          moeda={contaSelecionada?.moeda ?? 'EUR'}
        />
      </fieldset>

      {erro !== null && <CaixaErro>{erro}</CaixaErro>}

      {botaoNoRodape && (
        <Botao type="submit" disabled={aSubmeter || !valido}>
          {aSubmeter ? 'A guardar…' : eEdicao ? 'Guardar alterações' : 'Criar movimento'}
        </Botao>
      )}
    </Formulario>
  )
}
