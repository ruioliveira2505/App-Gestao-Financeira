/*
 * MODAL DE UM GRUPO DE CATEGORIAS (/categorias/:grupoId)
 * ==========================================================
 *
 * Ao contrário de uma conta (`/contas/:id`, uma página de detalhe própria),
 * um grupo de categorias abre como FOLHA sobre a lista — a mesma concha de
 * "Novo movimento"/"Editar conta" (`Folha`, direcao="baixo"): sobe de baixo
 * em telemóvel, diálogo ao centro em ecrã largo. A rota compõe-se, em
 * App.tsx, como `<Categorias /><CategoriaGrupo />` — a lista fica por trás,
 * visível ao arrastar a folha para baixo, tal como "Nova conta" sobre
 * "Contas". Um grupo não tem "identidade" nenhuma para só mostrar — nome e
 * direção são tudo o que tem, e a direção nunca muda depois de criado (ver
 * a nota em CategoriaNova.tsx). O que HÁ para fazer com um grupo é sempre
 * GERIR as suas subcategorias — por isso não há aqui "detalhe" e "editar"
 * separados: uma única folha trata das duas coisas.
 *
 * AÇÕES DO GRUPO (menu "⋯" no cabeçalho, ícone de reticências NA VERTICAL —
 * ver a nota do ícone em icones.tsx — para se distinguir do "⋯" horizontal
 * de cada subcategoria, aqui bem perto): Renomear (uma folha pequena, um
 * só campo) e Eliminar (leva as subcategorias em cascata; não aparece num
 * grupo com uma subcategoria protegida — "Outros" de "Outras
 * Entradas"/"Outras Saídas" nunca pode ser eliminado, ver a nota PROTEGIDA
 * em app/models/categoria.py, no backend). Chegou a experimentar-se dois
 * ícones diretos (lápis + lixo) em vez do menu, mas com dois botões a
 * mais no lado direito do cabeçalho o título deixava de ficar centrado
 * (as duas zonas do cabeçalho da Folha têm larguras mínimas iguais, para
 * centrar o título — ver Folha.module.css) — um menu com um único gatilho
 * resolve isso, mantendo os dois lados equilibrados.
 *
 * AÇÕES DE UMA SUBCATEGORIA (menu "⋯" na sua linha, reticências na
 * HORIZONTAL — a forma "normal", usada em toda a app): Renomear — em
 * LINHA, a etiqueta vira um campo de texto ali mesmo (a ação mais
 * frequente, merece ser a mais rápida); Mover para outro grupo — uma
 * folha com a lista dos outros grupos da MESMA direção; Eliminar. Uma
 * subcategoria PROTEGIDA não tem "⋯" nenhum.
 *
 * ADICIONAR SUBCATEGORIA: uma linha "+" no fundo da lista que, ao ser
 * tocada, vira um campo de texto — o mesmo padrão já usado para banco/tipo
 * no formulário de conta (ListaDeOpcoes). Só pede um nome; a direção
 * herda-se sempre do grupo.
 *
 * ELIMINAR (grupo ou subcategoria) PODE EXIGIR MIGRAÇÃO: tenta-se primeiro
 * sem mais nada; se o backend recusar com 409 (há movimentos a usar a
 * categoria, ou uma das subcategorias que cairiam com ela em cascata), a
 * folha de confirmação fecha-se e abre-se um seletor "Para onde migram os
 * movimentos?" — subcategorias da mesma direção, agrupadas pelo seu
 * grupo (a mesma lista, em forma, do seletor de categoria do formulário de
 * movimento), excluindo o que está a ser eliminado. Só depois de escolher
 * é que a eliminação é repetida, agora com o destino.
 *
 * COORDENAÇÃO DE ARRASTO (ContextoFolha) com as três folhas aninhadas
 * (Renomear grupo / Mover para / Migração): esta página fornece o
 * ContextoFolha, tal como "Editar conta"/"Editar movimento" o fornecem
 * para o seu seletor de moeda/conta — arrastar qualquer uma dessas três
 * folhas para BAIXO faz a folha do grupo descer com ela (espelhada), e
 * largar para lá do limiar fecha as duas juntas. A app usa sempre este
 * comportamento onde há folhas aninhadas, por consistência — mesmo aqui,
 * em que as três são consultas avulsas sobre um grupo já existente, não
 * campos de um formulário a meio de ser preenchido.
 *
 * SAIR (fechar sem eliminar o grupo): recua no histórico — a lista de
 * categorias está lá, e assim não fica /categorias/:grupoId empilhado a
 * ser reaberto pelo "recuar" seguinte. Só quando a rota foi aberta
 * diretamente pelo URL é que se vai para "/categorias" como recurso — a
 * mesma heurística "location.key === 'default'" já usada em toda a
 * aplicação. Eliminar o GRUPO é diferente: vai sempre para "/categorias"
 * (depois de eliminado, não há "grupo" nenhum para onde recuar).
 *
 * Depois de qualquer alteração, a árvore inteira é pedida de novo à API —
 * é pequena, e simplifica muito não ter de simular localmente o que o
 * servidor fez (renumerar "ordem", resolver a direção herdada, etc.).
 */

import { useEffect, useMemo, useState } from 'react'

import { useLocation, useNavigate, useParams } from 'react-router-dom'

import { CaixaErro } from '../componentes/CaixaErro'
import { Confirmacao } from '../componentes/Confirmacao'
import { ContextoFolha } from '../componentes/contextoFolha'
import { Folha } from '../componentes/Folha'
import { Formulario } from '../componentes/Formulario'
import { CampoTexto } from '../componentes/CampoTexto'
import {
  IconeCheck,
  IconeFechar,
  IconeMais,
  IconeReticencias,
  IconeReticenciasVertical,
} from '../componentes/icones'
import { ListaDeOpcoes, type OpcaoLista } from '../componentes/ListaDeOpcoes'
import { Menu, MenuItem } from '../componentes/Menu'
import { PontoCategoria } from '../componentes/PontoCategoria'
import {
  criarSubcategoria,
  editarCategoria,
  eliminarCategoria,
  obterArvoreCategorias,
  type GrupoArvore,
  type SubcategoriaArvore,
} from '../lib/categorias'
import { ErroApi } from '../lib/http'
import estilos from './CategoriaGrupo.module.css'

type Estado =
  | { fase: 'a-carregar' }
  | { fase: 'erro'; mensagem: string }
  | { fase: 'pronto'; arvore: GrupoArvore[] }

type AlvoEliminar = { id: string; nome: string; ehGrupo: boolean }
type AlvoMigracao = AlvoEliminar & { mensagem: string }

const MENSAGEM_ERRO_GENERICA = 'Não foi possível concluir. Tenta novamente.'

export function CategoriaGrupo() {
  const { grupoId } = useParams<{ grupoId: string }>()
  const navegar = useNavigate()
  const localizacao = useLocation()

  // Para onde ir ao fechar sem eliminar o grupo: recuar no histórico; só se
  // a rota foi aberta diretamente pelo URL é que se vai para a lista como
  // recurso (a mesma heurística de CategoriaNova/ContaEditar).
  const destino: string | number = localizacao.key === 'default' ? '/categorias' : -1

  const [estado, setEstado] = useState<Estado>({ fase: 'a-carregar' })
  const [erroAcao, setErroAcao] = useState<string | null>(null)

  // Renomear (grupo OU subcategoria — o mesmo estado serve os dois): uma
  // folha pequena para o grupo, um campo em linha para a subcategoria (ver
  // a nota no topo do ficheiro).
  const [alvoRenomear, setAlvoRenomear] = useState<{ id: string; nomeAtual: string; ehGrupo: boolean } | null>(
    null,
  )
  const [textoRenomear, setTextoRenomear] = useState('')
  const [aGuardarRenomear, setAGuardarRenomear] = useState(false)
  // Erro do renomear do GRUPO especificamente — mostrado DENTRO da sua
  // folha (ver a nota ERROS DENTRO DA SUA FOLHA, mais abaixo). O renomear
  // de uma subcategoria é em linha, sem folha a tapar a página — usa o
  // "erroAcao" partilhado, que já fica visível.
  const [erroRenomearGrupo, setErroRenomearGrupo] = useState<string | null>(null)

  // Adicionar subcategoria — inline, no fundo da lista.
  const [aAdicionarSub, setAAdicionarSub] = useState(false)
  const [textoNovaSub, setTextoNovaSub] = useState('')
  const [aGuardarSub, setAGuardarSub] = useState(false)

  // Mover uma subcategoria para outro grupo.
  const [alvoMover, setAlvoMover] = useState<{ id: string; nome: string } | null>(null)
  const [erroMover, setErroMover] = useState<string | null>(null)

  // Eliminar (grupo ou subcategoria) — confirmação, e o seletor de
  // migração que só aparece se o backend a exigir (409).
  const [alvoEliminar, setAlvoEliminar] = useState<AlvoEliminar | null>(null)
  const [alvoMigracao, setAlvoMigracao] = useState<AlvoMigracao | null>(null)
  const [aProcessarEliminar, setAProcessarEliminar] = useState(false)
  const [erroMigracao, setErroMigracao] = useState<string | null>(null)

  // Coordenação com a folha de uma das três ações aninhadas (Renomear
  // grupo / Mover para / Migração) aberta por cima desta: enquanto é
  // arrastada para baixo, "espelhoY" espelha o seu deslocamento e
  // "aEspelhar" diz que segue o dedo; ao largar para lá do limiar,
  // "aAbandonar" faz esta folha (a do grupo) sair também. Igual a
  // ContaEditar/MovimentoEditar/CategoriaNova.
  const [espelhoY, setEspelhoY] = useState(0)
  const [aEspelhar, setAEspelhar] = useState(false)
  const [aAbandonar, setAAbandonar] = useState(false)

  const contextoFolha = useMemo(
    () => ({
      espelharDeslocamento: (y: number) => {
        setAEspelhar(true)
        setEspelhoY(y > 0 ? y : 0)
      },
      concluirArrasto: (descartar: boolean) => {
        setAEspelhar(false)
        if (descartar) setAAbandonar(true)
        else setEspelhoY(0)
      },
    }),
    [],
  )

  useEffect(() => {
    if (!grupoId) return
    let activo = true
    obterArvoreCategorias()
      .then((arvore) => {
        if (activo) setEstado({ fase: 'pronto', arvore })
      })
      .catch((erro) => {
        if (activo) {
          setEstado({
            fase: 'erro',
            mensagem: erro instanceof ErroApi ? erro.message : 'Não foi possível carregar o grupo.',
          })
        }
      })
    return () => {
      activo = false
    }
  }, [grupoId])

  async function recarregar() {
    const arvore = await obterArvoreCategorias()
    setEstado({ fase: 'pronto', arvore })
  }

  const arvore = estado.fase === 'pronto' ? estado.arvore : []
  const grupo = arvore.find((g) => g.id === grupoId)
  // "Outras Entradas" e "Outras Saídas" têm uma subcategoria "Outros"
  // protegida — o refúgio para onde tudo migra ao eliminar outra
  // categoria (ver a nota PROTEGIDA em app/models/categoria.py, no
  // backend). Sem estes dois grupos não haveria destino de migração
  // possível, por isso não podem ser eliminados — o lixo nem aparece.
  const grupoProtegido = grupo?.subcategorias.some((s) => s.protegida) ?? false

  function sair() {
    if (typeof destino === 'number') navegar(destino)
    else navegar(destino)
  }

  // --- Renomear ---

  function abrirRenomear(alvo: { id: string; nomeAtual: string; ehGrupo: boolean }) {
    setErroAcao(null)
    setErroRenomearGrupo(null)
    setAlvoRenomear(alvo)
    setTextoRenomear(alvo.nomeAtual)
  }

  async function confirmarRenomear() {
    if (!alvoRenomear || !grupo) return
    const nome = textoRenomear.trim()
    if (!nome) return
    setAGuardarRenomear(true)
    try {
      // Renomear nunca muda o grupo a que pertence: para o próprio grupo,
      // parent_id é sempre nulo; para uma subcategoria, o grupo actual.
      await editarCategoria(alvoRenomear.id, nome, alvoRenomear.ehGrupo ? null : grupo.id)
      await recarregar()
      setAlvoRenomear(null)
    } catch (erro) {
      // Ver a nota ERROS DENTRO DA SUA FOLHA no topo do ficheiro: o
      // renomear do GRUPO tem folha própria (o erro fica lá dentro); a
      // subcategoria renomeia-se em linha, sem folha a tapar a página.
      const mensagem = erro instanceof ErroApi ? erro.message : MENSAGEM_ERRO_GENERICA
      if (alvoRenomear.ehGrupo) setErroRenomearGrupo(mensagem)
      else setErroAcao(mensagem)
    } finally {
      setAGuardarRenomear(false)
    }
  }

  // --- Adicionar subcategoria ---

  async function confirmarNovaSub() {
    if (!grupo) return
    const nome = textoNovaSub.trim()
    if (!nome) return
    setAGuardarSub(true)
    try {
      await criarSubcategoria(nome, grupo.id)
      await recarregar()
      setTextoNovaSub('')
      setAAdicionarSub(false)
    } catch (erro) {
      setErroAcao(erro instanceof ErroApi ? erro.message : MENSAGEM_ERRO_GENERICA)
    } finally {
      setAGuardarSub(false)
    }
  }

  // --- Mover subcategoria para outro grupo ---

  async function confirmarMover(novoGrupoId: string) {
    if (!alvoMover) return
    setErroMover(null)
    try {
      await editarCategoria(alvoMover.id, alvoMover.nome, novoGrupoId)
      await recarregar()
      setAlvoMover(null)
    } catch (erro) {
      // Mostrado DENTRO da folha "Mover para" (ver ERROS DENTRO DA SUA
      // FOLHA): o erro mais comum aqui é um nome duplicado no grupo de
      // destino, e a folha tapa a página — um erro lá em baixo, atrás
      // dela, nunca chegaria a ser visto em mobile.
      setErroMover(erro instanceof ErroApi ? erro.message : MENSAGEM_ERRO_GENERICA)
    }
  }

  // --- Eliminar (com o passo de migração, se o backend o exigir) ---

  async function tentarEliminar(alvo: AlvoEliminar, migrarParaId?: string) {
    setAProcessarEliminar(true)
    try {
      await eliminarCategoria(alvo.id, migrarParaId)
      setAlvoEliminar(null)
      setAlvoMigracao(null)
      if (alvo.ehGrupo) {
        navegar('/categorias')
      } else {
        await recarregar()
      }
    } catch (erro) {
      if (erro instanceof ErroApi && erro.estado === 409) {
        // Precisa de saber para onde migrar — troca a confirmação pelo
        // seletor de destino, sem fechar o fluxo.
        setAlvoEliminar(null)
        setErroMigracao(null)
        setAlvoMigracao({ ...alvo, mensagem: erro.message })
      } else if (migrarParaId !== undefined) {
        // Já estávamos no passo de migração (um destino foi escolhido) e
        // mesmo assim falhou: o erro fica DENTRO dessa folha, não na
        // página por trás dela.
        setErroMigracao(erro instanceof ErroApi ? erro.message : MENSAGEM_ERRO_GENERICA)
      } else {
        // Falhou logo na confirmação inicial (sem folha nenhuma a tapar
        // a página) — a caixa de erro partilhada, já visível, chega.
        setErroAcao(erro instanceof ErroApi ? erro.message : MENSAGEM_ERRO_GENERICA)
        setAlvoEliminar(null)
      }
    } finally {
      setAProcessarEliminar(false)
    }
  }

  if (estado.fase === 'erro') {
    return (
      <p role="alert" className={estilos.nota}>
        {estado.mensagem}
      </p>
    )
  }

  if (estado.fase === 'a-carregar') {
    return <p className={estilos.nota}>A carregar…</p>
  }

  if (!grupo) {
    // O grupo foi eliminado entretanto (ex.: noutro separador) — a lista
    // de categorias já está visível por trás (a rota compõe-na sempre),
    // não há folha nenhuma para abrir.
    return <p className={estilos.nota}>Este grupo já não existe.</p>
  }

  // Opções para "mover subcategoria": os OUTROS grupos da mesma direção.
  const opcoesMover: OpcaoLista[] = arvore
    .filter((g) => g.direcao === grupo.direcao && g.id !== grupo.id)
    .map((g) => ({ valor: g.id, etiqueta: g.nome, avatar: <PontoCategoria nomeGrupo={g.nome} /> }))

  // Opções para "migrar movimentos": subcategorias da mesma direção,
  // agrupadas pelo seu grupo — a mesma forma do seletor de categoria do
  // formulário de movimento —, excluindo o que está a desaparecer (o
  // próprio grupo eliminado leva consigo todas as suas subcategorias).
  const idsAExcluirDaMigracao = alvoMigracao
    ? alvoMigracao.ehGrupo
      ? [alvoMigracao.id, ...grupo.subcategorias.map((s) => s.id)]
      : [alvoMigracao.id]
    : []
  const opcoesMigracao: OpcaoLista[] = arvore
    .filter((g) => g.direcao === grupo.direcao)
    .flatMap((g) =>
      g.subcategorias
        .filter((s) => !idsAExcluirDaMigracao.includes(s.id))
        .map((s) => ({
          valor: s.id,
          etiqueta: s.nome,
          grupo: g.nome,
          avatar: <PontoCategoria nomeGrupo={g.nome} />,
        })),
    )

  return (
    <ContextoFolha.Provider value={contextoFolha}>
      <Folha
        titulo={grupo.nome}
        direcao="baixo"
        varianteFechar="circulo"
        iconeFechar={<IconeFechar tamanho={22} />}
        rotuloFechar="Fechar"
        deslocamentoExterno={espelhoY}
        aSeguirExterno={aEspelhar}
        aExternamenteASair={aAbandonar}
        aoDispensar={sair}
        acao={
          <Menu
            posicao="baixo"
            alinhamento="direita"
            gatilho={({ aberto, alternar }) => (
              <button
                type="button"
                className={estilos.acaoIcone}
                aria-label="Opções do grupo"
                aria-haspopup="menu"
                aria-expanded={aberto}
                onClick={alternar}
              >
                <IconeReticenciasVertical tamanho={20} />
              </button>
            )}
          >
            <MenuItem onClick={() => abrirRenomear({ id: grupo.id, nomeAtual: grupo.nome, ehGrupo: true })}>
              Renomear grupo
            </MenuItem>
            {!grupoProtegido && (
              <MenuItem
                perigo
                onClick={() => setAlvoEliminar({ id: grupo.id, nome: grupo.nome, ehGrupo: true })}
              >
                Eliminar grupo
              </MenuItem>
            )}
          </Menu>
        }
      >
        {() => (
          <div className={estilos.formulario}>
            {erroAcao !== null && <CaixaErro>{erroAcao}</CaixaErro>}

            <div className={estilos.lista}>
              {grupo.subcategorias.map((sub) => (
                <LinhaSubcategoria
                  key={sub.id}
                  sub={sub}
                  grupo={grupo}
                  aRenomear={alvoRenomear?.id === sub.id}
                  textoRenomear={textoRenomear}
                  aoMudarTextoRenomear={setTextoRenomear}
                  aGuardarRenomear={aGuardarRenomear}
                  aoConfirmarRenomear={confirmarRenomear}
                  aoCancelarRenomear={() => setAlvoRenomear(null)}
                  aoAbrirRenomear={() => abrirRenomear({ id: sub.id, nomeAtual: sub.nome, ehGrupo: false })}
                  aoMover={() => {
                    setErroMover(null)
                    setAlvoMover({ id: sub.id, nome: sub.nome })
                  }}
                  aoEliminar={() => setAlvoEliminar({ id: sub.id, nome: sub.nome, ehGrupo: false })}
                />
              ))}

              {aAdicionarSub ? (
                <div className={`${estilos.linha} ${estilos.linhaNova}`}>
                  <input
                    autoFocus
                    className={estilos.novoInput}
                    value={textoNovaSub}
                    placeholder="Nome da subcategoria"
                    onChange={(evento) => setTextoNovaSub(evento.target.value)}
                    onKeyDown={(evento) => {
                      if (evento.key === 'Enter') confirmarNovaSub()
                      else if (evento.key === 'Escape') {
                        setAAdicionarSub(false)
                        setTextoNovaSub('')
                      }
                    }}
                  />
                  <button
                    type="button"
                    className={estilos.novoConfirmar}
                    disabled={textoNovaSub.trim() === '' || aGuardarSub}
                    onClick={confirmarNovaSub}
                    aria-label="Confirmar"
                  >
                    <IconeCheck tamanho={18} />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className={`${estilos.linha} ${estilos.linhaAcao}`}
                  onClick={() => setAAdicionarSub(true)}
                >
                  <IconeMais tamanho={18} />
                  Adicionar subcategoria
                </button>
              )}
            </div>
          </div>
        )}
      </Folha>

      {/* Renomear o GRUPO — folha pequena, um só campo (a subcategoria
          renomeia-se em linha, ver LinhaSubcategoria). Arrastá-la para
          baixo espelha-se na folha do grupo, por trás (ver a nota
          COORDENAÇÃO DE ARRASTO no topo do ficheiro). */}
      {alvoRenomear?.ehGrupo && (
        <Folha
          titulo="Renomear grupo"
          direcao="direita"
          varianteFechar="circulo"
          aoRecuar={() => {
            setAlvoRenomear(null)
            setErroRenomearGrupo(null)
          }}
          aoDispensar={() => {
            setAlvoRenomear(null)
            setErroRenomearGrupo(null)
          }}
        >
          {() => (
            <Formulario aoSubmeter={confirmarRenomear}>
              {erroRenomearGrupo !== null && <CaixaErro>{erroRenomearGrupo}</CaixaErro>}
              <CampoTexto
                disposicao="linha"
                etiqueta="Nome"
                valor={textoRenomear}
                aoMudar={setTextoRenomear}
                obrigatorio
              />
              <button
                type="submit"
                className={estilos.botaoGuardar}
                disabled={textoRenomear.trim() === '' || aGuardarRenomear}
              >
                {aGuardarRenomear ? 'A guardar…' : 'Guardar'}
              </button>
            </Formulario>
          )}
        </Folha>
      )}

      {/* Mover uma subcategoria — a lista dos outros grupos da mesma direção. */}
      {alvoMover && (
        <Folha
          titulo="Mover para"
          direcao="direita"
          varianteFechar="circulo"
          aoRecuar={() => {
            setAlvoMover(null)
            setErroMover(null)
          }}
          aoDispensar={() => {
            setAlvoMover(null)
            setErroMover(null)
          }}
        >
          {() => (
            <>
              {erroMover !== null && <CaixaErro>{erroMover}</CaixaErro>}
              <ListaDeOpcoes opcoes={opcoesMover} valor="" aoEscolher={confirmarMover} />
            </>
          )}
        </Folha>
      )}

      {/* Confirmação de eliminação (grupo ou subcategoria). */}
      {alvoEliminar && (
        <Confirmacao
          titulo={alvoEliminar.ehGrupo ? 'Eliminar grupo' : 'Eliminar subcategoria'}
          textoConfirmar="Eliminar"
          aConfirmar={aProcessarEliminar}
          aoConfirmar={() => tentarEliminar(alvoEliminar)}
          aoCancelar={() => setAlvoEliminar(null)}
        >
          {alvoEliminar.ehGrupo ? (
            <p>"{alvoEliminar.nome}" e todas as suas subcategorias serão eliminados.</p>
          ) : (
            <p>"{alvoEliminar.nome}" será eliminada.</p>
          )}
          <p>Esta ação é irreversível.</p>
        </Confirmacao>
      )}

      {/* Seletor de migração — só aparece quando o backend recusou eliminar
          sem saber para onde vão os movimentos afectados. */}
      {alvoMigracao && (
        <Folha
          titulo="Para onde migram os movimentos?"
          direcao="direita"
          varianteFechar="circulo"
          iconeFechar={<IconeFechar tamanho={22} />}
          rotuloFechar="Cancelar"
          aoDispensar={() => {
            setAlvoMigracao(null)
            setErroMigracao(null)
          }}
        >
          {() => (
            <div className={estilos.migracao}>
              <p className={estilos.migracaoMensagem}>{alvoMigracao.mensagem}</p>
              {erroMigracao !== null && <CaixaErro>{erroMigracao}</CaixaErro>}
              <ListaDeOpcoes
                opcoes={opcoesMigracao}
                valor=""
                aoEscolher={(destinoId) => tentarEliminar(alvoMigracao, destinoId)}
              />
            </div>
          )}
        </Folha>
      )}
    </ContextoFolha.Provider>
  )
}

/** Uma linha de subcategoria: o ponto colorido (herda a cor do grupo), o
 *  nome — ou, enquanto "aRenomear", um campo de texto no lugar do nome — e
 *  um "⋯" com Renomear / Mover / Eliminar. Sem "⋯" nenhum se a
 *  subcategoria for protegida (ver a nota PROTEGIDA em app/models/
 *  categoria.py, no backend). */
function LinhaSubcategoria({
  sub,
  grupo,
  aRenomear,
  textoRenomear,
  aoMudarTextoRenomear,
  aGuardarRenomear,
  aoConfirmarRenomear,
  aoCancelarRenomear,
  aoAbrirRenomear,
  aoMover,
  aoEliminar,
}: {
  sub: SubcategoriaArvore
  grupo: GrupoArvore
  aRenomear: boolean
  textoRenomear: string
  aoMudarTextoRenomear: (valor: string) => void
  aGuardarRenomear: boolean
  aoConfirmarRenomear: () => void
  aoCancelarRenomear: () => void
  aoAbrirRenomear: () => void
  aoMover: () => void
  aoEliminar: () => void
}) {
  if (aRenomear) {
    return (
      <div className={`${estilos.linha} ${estilos.linhaNova}`}>
        <input
          autoFocus
          className={estilos.novoInput}
          value={textoRenomear}
          onChange={(evento) => aoMudarTextoRenomear(evento.target.value)}
          onKeyDown={(evento) => {
            if (evento.key === 'Enter') aoConfirmarRenomear()
            else if (evento.key === 'Escape') aoCancelarRenomear()
          }}
        />
        <button
          type="button"
          className={estilos.novoConfirmar}
          disabled={textoRenomear.trim() === '' || aGuardarRenomear}
          onClick={aoConfirmarRenomear}
          aria-label="Confirmar"
        >
          <IconeCheck tamanho={18} />
        </button>
      </div>
    )
  }

  return (
    <div className={estilos.linha}>
      <PontoCategoria nomeGrupo={grupo.nome} />
      <span className={estilos.linhaNome}>{sub.nome}</span>
      {!sub.protegida && (
        <Menu
          posicao="baixo"
          alinhamento="direita"
          gatilho={({ aberto, alternar }) => (
            <button
              type="button"
              className={estilos.acaoIconeLinha}
              aria-label={`Opções de ${sub.nome}`}
              aria-haspopup="menu"
              aria-expanded={aberto}
              onClick={alternar}
            >
              <IconeReticencias tamanho={18} />
            </button>
          )}
        >
          <MenuItem onClick={aoAbrirRenomear}>Renomear</MenuItem>
          <MenuItem onClick={aoMover}>Mover para outro grupo</MenuItem>
          <MenuItem perigo onClick={aoEliminar}>
            Eliminar
          </MenuItem>
        </Menu>
      )}
    </div>
  )
}
