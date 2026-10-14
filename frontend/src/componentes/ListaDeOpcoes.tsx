/*
 * ListaDeOpcoes — A LISTA DE UM SELETOR
 * ====================================
 *
 * A lista de opções de um CampoSelecao. Usa-se dentro do PainelDeEscolha
 * (folha, em telemóvel) e da divulgação em linha do CampoSelecao (desktop)
 * — o "casco" (folha ou painel em linha) é de quem a monta.
 *
 * Cada opção é um <button> a toda a largura; a escolhida leva um "✓" à
 * direita. Ao escolher, chama "aoEscolher(valor)" — quem monta a lista é
 * que trata de FECHAR o casco.
 *
 * ADICIONAR À MÃO. Quando "aoAdicionar" é passado (campos abertos: banco,
 * tipo), a última linha é uma acção ("Adicionar banco" / "Adicionar
 * tipo"). Ao tocar-lhe transforma-se num campo de escrita, com o foco
 * automático; confirmar (Enter ou o "✓") chama "aoAdicionar(texto)".
 * O Escape no campo cancela a escrita (e faz "stopPropagation", para o
 * casco por fora não fechar).
 *
 * OPÇÕES AGRUPADAS. Quando uma opção traz "grupo" (ex.: o seletor de
 * categoria, onde dezenas de subcategorias se repartem por vários grupos),
 * aparece um cabeçalho não-tocável antes da primeira opção de cada grupo —
 * como as secções da app Definições do iOS. As opções já vêm ordenadas de
 * quem as passa (a API devolve-as alfabeticamente); esta lista só repara
 * quando "grupo" muda de uma opção para a seguinte, nunca reordena nada.
 * Uma lista sem nenhuma opção com "grupo" fica exactamente como antes,
 * sem cabeçalhos.
 *
 * PROCURAR OU ADICIONAR. Com "procura" (o texto do campo, ex.: "Procurar
 * ou adicionar banco"), a lista ganha no topo um campo de escrita que faz
 * duas coisas ao mesmo tempo — o padrão das etiquetas no Gmail e no
 * Notion:
 *   - escrever FILTRA as opções (sem distinguir maiúsculas nem acentos),
 *     pelo texto visível OU pelo valor por trás dele — numa moeda, "usd"
 *     encontra "Dólar americano ($)", cujo valor é o código "USD";
 *   - se o texto não corresponder a nenhuma opção e houver "aoAdicionar",
 *     aparece em destaque, ACIMA da lista, "Adicionar «…»" — tocar-lhe
 *     (ou Enter) cria esse valor e escolhe-o de uma só vez.
 * Neste modo a linha "Adicionar…" do fundo deixa de existir (o campo do
 * topo já faz esse papel), a opção de "nenhum" (valor "") só aparece sem
 * nada escrito, e, com a lista vazia (nada usado ainda), mostra-se
 * "textoVazio" a ensinar como adicionar, com o cursor já no campo.
 * Sem "aoAdicionar" (listas fechadas, como a moeda), o campo só procura:
 * quando nada corresponde, diz "Sem resultados", em vez de uma lista
 * vazia sem explicação.
 *
 * APRESENTAÇÃO NO MODO PROCURAR: a mesma linguagem das fichas dos
 * formulários (listas agrupadas do iOS) — o campo de procura com a forma
 * do da página Contas (pílula), mas cinzento, para contrastar com os
 * cartões brancos por baixo; a opção de "nenhum" ("Sem banco") num cartão
 * PRÓPRIO, por cima, para não se misturar com os valores a sério; e as
 * opções num cartão branco com contorno, com "Adicionar «…»" como a sua
 * primeira linha (um "+" num círculo). Cada linha pode ter, à direita, um
 * texto ténue ("detalhe", ex.: o código "EUR"). O traço entre linhas
 * começa onde começa o texto, como no iOS. Opções com "grupo" (ex.: a
 * letra de cada banco) ficam num cartão por grupo, com o nome do grupo
 * por cima. Na lista em linha do
 * desktop ("esbatido"), que já vive dentro de uma ficha, os cartões
 * perdem o contorno — um cartão dentro de outro seria ruído — e a lista
 * ganha o aspeto de um menu: a procura com respiro à volta, as opções em
 * linhas de 44px, TODAS em tinta plena (o escolhido leva o "✓", como no
 * telemóvel), com os traços finos de sempre e um fundo claro ao passar o
 * rato. O campo de procura leva, quando há texto, um "✕" que o limpa e lhe
 * devolve o foco (o mesmo do CampoPesquisa das páginas). Só a zona das opções rola (cinco linhas à vista), para a procura
 * não rolar com elas.
 */

import { Fragment, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

import { IconeCheck, IconeFechar, IconeLupa, IconeMais } from './icones'
import estilos from './ListaDeOpcoes.module.css'

export type OpcaoLista = {
  // O valor guardado (ex.: "EUR", ou o id de uma conta).
  valor: string
  // O texto mostrado (ex.: "Euro (€)", ou o nome de uma conta).
  etiqueta: string
  // Elemento à esquerda da etiqueta — ex.: o monograma (Avatar) de uma
  // conta, para a identificar de relance. Opcional: moeda/banco/tipo não o
  // passam.
  avatar?: ReactNode
  // Texto ténue à direita (ex.: o código "EUR" de uma moeda). Só no modo
  // procurar (ver a nota no topo do ficheiro).
  detalhe?: string
  // O grupo a que esta opção pertence (ex.: o nome do grupo de uma
  // subcategoria) — ver a nota OPÇÕES AGRUPADAS no topo do ficheiro.
  // Opcional: a maioria dos seletores (moeda, conta, tipo) não agrupa.
  grupo?: string
}

type Props = {
  opcoes: OpcaoLista[]
  valor: string
  aoEscolher: (valor: string) => void
  // Última linha "Adicionar…" com campo de escrita. Recebe o texto cortado.
  aoAdicionar?: (valor: string) => void
  rotuloAdicionar?: string
  // "esbatido" (lista em linha do desktop, dentro de uma ficha): sem
  // cartões, linhas de 44px, só a zona das opções rola (ver a nota no topo
  // do ficheiro). O nome é histórico: já não esbate nenhuma opção.
  esbatido?: boolean
  // Liga o modo PROCURAR OU ADICIONAR (ver a nota no topo do ficheiro): o
  // texto do campo de escrita no topo (também o seu nome acessível).
  procura?: string
  // Só com "procura": o que se mostra quando ainda não há opção nenhuma
  // (ex.: "Escreve o nome do banco no campo acima para o adicionar.").
  textoVazio?: string
  // Só com "procura": algo a mostrar ENTRE o campo de procura e as opções
  // (ex.: a ficha do país, na lista de bancos — o país filtra a lista, por
  // isso fica logo por cima dela, com a procura no topo do ecrã).
  depoisDaProcura?: ReactNode
}

/** Sem acentos e sem maiúsculas — para "poupanca" encontrar "Poupança".
 *  A decomposição "NFD" separa cada letra acentuada na letra e no acento;
 *  o intervalo \u0300-\u036f apanha esses acentos soltos. */
function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

export function ListaDeOpcoes({
  opcoes,
  valor,
  aoEscolher,
  aoAdicionar,
  rotuloAdicionar = 'Adicionar…',
  esbatido = false,
  procura,
  textoVazio,
  depoisDaProcura,
}: Props) {
  // A linha "Adicionar…" está em modo de escrita? E o que já se escreveu.
  const [aEscrever, setAEscrever] = useState(false)
  const [texto, setTexto] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (aEscrever) inputRef.current?.focus()
  }, [aEscrever])

  // --- Modo PROCURAR OU ADICIONAR ---
  const [pesquisa, setPesquisa] = useState('')
  const pesquisaRef = useRef<HTMLInputElement>(null)
  const termo = normalizar(pesquisa)
  // As opções "a sério" (sem a de "nenhum", de valor "").
  const reais = opcoes.filter((opcao) => opcao.valor !== '')
  const semOpcoes = reais.length === 0
  // Com algo escrito: só as que contêm o texto, e nunca a de "nenhum".
  const visiveis =
    procura !== undefined && termo !== ''
      ? reais.filter(
          (opcao) =>
            normalizar(opcao.etiqueta).includes(termo) || normalizar(opcao.valor).includes(termo),
        )
      : opcoes
  const igual = reais.find((opcao) => normalizar(opcao.etiqueta) === termo)
  const podeAdicionar = procura !== undefined && aoAdicionar !== undefined && termo !== '' && !igual

  // Sem nada usado ainda, o cursor vai logo para o campo — a única coisa
  // a fazer é escrever.
  useEffect(() => {
    if (procura !== undefined && semOpcoes) pesquisaRef.current?.focus()
  }, [procura, semOpcoes])

  function aoTeclarNaPesquisa(evento: KeyboardEvent<HTMLInputElement>) {
    if (evento.key !== 'Enter') return
    evento.preventDefault()
    // Enter: escolhe a opção que corresponde exactamente, ou acrescenta.
    if (igual) aoEscolher(igual.valor)
    else if (podeAdicionar) aoAdicionar?.(pesquisa.trim())
  }

  // Uma linha do modo procurar: [monograma] etiqueta [detalhe] [✓].
  // O "✓" tem sempre o seu espaço reservado, mesmo invisível, para o
  // detalhe ficar alinhado em todas as linhas.
  function linhaComProcura(opcao: OpcaoLista) {
    const selecionada = opcao.valor === valor
    return (
      <li key={opcao.valor}>
        <button
          type="button"
          aria-current={selecionada ? 'true' : undefined}
          className={selecionada ? `${estilos.linha} ${estilos.linhaSelecionada}` : estilos.linha}
          onClick={() => aoEscolher(opcao.valor)}
        >
          {/* O monograma é decorativo (aria-hidden): o nome acessível da
              linha fica só a etiqueta ("Revolut", não "R Revolut"). */}
          {opcao.avatar && (
            <span className={estilos.avatar} aria-hidden="true">
              {opcao.avatar}
            </span>
          )}
          <span className={estilos.rotulo}>{opcao.etiqueta}</span>
          {opcao.detalhe && <span className={estilos.detalhe}>{opcao.detalhe}</span>}
          <span className={estilos.marca}>{selecionada && <IconeCheck tamanho={18} />}</span>
        </button>
      </li>
    )
  }

  if (procura !== undefined) {
    // A opção de "nenhum" vai num cartão à parte, e só sem nada escrito.
    const nenhuma = termo === '' ? opcoes.find((opcao) => opcao.valor === '') : undefined
    const comValor = visiveis.filter((opcao) => opcao.valor !== '')
    // Opções com "grupo" (ex.: a letra de cada banco): um cartão por
    // grupo, com o nome do grupo por cima — os grupos que ficam vazios ao
    // procurar desaparecem. Sem grupos, um só cartão.
    const grupos: { grupo: string | undefined; opcoes: OpcaoLista[] }[] = []
    for (const opcao of comValor) {
      const ultimo = grupos[grupos.length - 1]
      if (ultimo && ultimo.grupo === opcao.grupo) ultimo.opcoes.push(opcao)
      else grupos.push({ grupo: opcao.grupo, opcoes: [opcao] })
    }
    const comGrupos = grupos.some((g) => g.grupo !== undefined)
    return (
      <div className={esbatido ? `${estilos.comProcura} ${estilos.esbatido}` : estilos.comProcura}>
        <label className={estilos.procura}>
          <IconeLupa tamanho={18} />
          <input
            ref={pesquisaRef}
            className={estilos.procuraInput}
            value={pesquisa}
            placeholder={procura}
            aria-label={procura}
            onChange={(evento) => setPesquisa(evento.target.value)}
            onKeyDown={aoTeclarNaPesquisa}
          />
          {/* Limpar de uma vez, só com texto escrito; devolve o foco ao
              campo, porque quem limpa quer, quase sempre, escrever outra
              coisa a seguir. */}
          {pesquisa !== '' && (
            <button
              type="button"
              className={estilos.procuraLimpar}
              aria-label="Limpar pesquisa"
              onClick={() => {
                setPesquisa('')
                pesquisaRef.current?.focus()
              }}
            >
              <IconeFechar tamanho={16} />
            </button>
          )}
        </label>

        {depoisDaProcura}

        {/* Procurar numa lista fechada, sem nada a corresponder. */}
        {termo !== '' && visiveis.length === 0 && !podeAdicionar && (
          <p className={estilos.textoVazio}>Sem resultados para «{pesquisa.trim()}».</p>
        )}

        {semOpcoes && termo === '' && textoVazio && (
          <p className={estilos.textoVazio}>{textoVazio}</p>
        )}

        {/* A zona das opções. No telemóvel não tem efeito (os cartões são
            filhos diretos da coluna); no desktop ("esbatido") é ela que
            rola, com a procura parada por cima. */}
        <div className={estilos.rolagem}>
          {nenhuma && <ul className={estilos.cartao}>{linhaComProcura(nenhuma)}</ul>}

          {(podeAdicionar || (comValor.length > 0 && !comGrupos)) && (
            <ul className={estilos.cartao}>
              {podeAdicionar && (
                <li>
                  <button
                    type="button"
                    className={`${estilos.linha} ${estilos.linhaAdicionar}`}
                    onClick={() => aoAdicionar?.(pesquisa.trim())}
                  >
                    <span className={estilos.adicionarMais} aria-hidden="true">
                      <IconeMais tamanho={14} traco={2.6} />
                    </span>
                    <span className={estilos.rotulo}>Adicionar «{pesquisa.trim()}»</span>
                  </button>
                </li>
              )}
              {!comGrupos && comValor.map(linhaComProcura)}
            </ul>
          )}

          {comGrupos &&
            grupos.map((g) => (
              <div key={g.grupo ?? ''} className={estilos.grupoComProcura}>
                {g.grupo !== undefined && (
                  <span className={estilos.cabecalhoProcura}>{g.grupo}</span>
                )}
                <ul className={estilos.cartao}>{g.opcoes.map(linhaComProcura)}</ul>
              </div>
            ))}
        </div>
      </div>
    )
  }

  function confirmarNovo() {
    const limpo = texto.trim()
    if (!limpo || !aoAdicionar) return
    aoAdicionar(limpo)
  }

  function aoTeclarNoInput(evento: KeyboardEvent<HTMLInputElement>) {
    if (evento.key === 'Enter') {
      evento.preventDefault()
      confirmarNovo()
    } else if (evento.key === 'Escape') {
      // Não deixar o Escape chegar ao casco (que fecharia o seletor):
      // aqui só cancela a escrita e volta à linha "Adicionar…".
      evento.stopPropagation()
      setAEscrever(false)
      setTexto('')
    }
  }

  return (
    <ul className={esbatido ? `${estilos.lista} ${estilos.esbatido}` : estilos.lista}>
      {opcoes.map((opcao, indice) => {
        const selecionada = opcao.valor === valor
        // Cabeçalho de grupo: só quando "grupo" está presente e é
        // diferente do da opção anterior (a primeira opção de um grupo
        // sempre o mostra, porque não há "anterior" com esse valor).
        const mostrarCabecalho = opcao.grupo !== undefined && opcao.grupo !== opcoes[indice - 1]?.grupo
        return (
          <Fragment key={opcao.valor}>
            {mostrarCabecalho && (
              <li className={estilos.cabecalhoGrupo}>{opcao.grupo}</li>
            )}
            <li>
              <button
                type="button"
                aria-current={selecionada ? 'true' : undefined}
                className={
                  selecionada
                    ? `${estilos.linha} ${estilos.linhaSelecionada}`
                    : estilos.linha
                }
                onClick={() => aoEscolher(opcao.valor)}
              >
                {opcao.avatar && <span className={estilos.avatar}>{opcao.avatar}</span>}
                <span className={estilos.rotulo}>{opcao.etiqueta}</span>
                {selecionada && <IconeCheck tamanho={18} />}
              </button>
            </li>
          </Fragment>
        )
      })}

      {aoAdicionar &&
        (aEscrever ? (
          <li className={`${estilos.linha} ${estilos.linhaNovo}`}>
            <input
              ref={inputRef}
              className={estilos.novoInput}
              value={texto}
              placeholder="Escrever…"
              aria-label={rotuloAdicionar}
              onChange={(evento) => setTexto(evento.target.value)}
              onKeyDown={aoTeclarNoInput}
            />
            <button
              type="button"
              className={estilos.novoConfirmar}
              disabled={texto.trim() === ''}
              onClick={confirmarNovo}
              aria-label="Confirmar"
            >
              <IconeCheck tamanho={18} />
            </button>
          </li>
        ) : (
          <li>
            <button
              type="button"
              className={`${estilos.linha} ${estilos.linhaAcao}`}
              onClick={() => setAEscrever(true)}
            >
              <IconeMais tamanho={18} />
              <span className={estilos.rotulo}>{rotuloAdicionar}</span>
            </button>
          </li>
        ))}
    </ul>
  )
}
