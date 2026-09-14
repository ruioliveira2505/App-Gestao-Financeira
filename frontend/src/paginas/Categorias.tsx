/*
 * PÁGINA CATEGORIAS (/categorias)
 * ================================
 *
 * A lista de topo da árvore de categorias — só os GRUPOS, em duas secções
 * fixas (Entradas / Saídas, nunca misturadas nem reordenáveis à mão — a
 * mesma ordem deliberada da árvore, ver app/services/categorias_seed.py,
 * no backend). Cada grupo é uma linha (o ponto colorido do grupo, o nome,
 * e uma contagem de subcategorias); tocar abre a sua página
 * (/categorias/:grupoId), onde se gere tudo o resto — não há aqui
 * detalhe nem edição do grupo em si, ao contrário de Contas (ver a nota em
 * CategoriaGrupo.tsx sobre porque um grupo de categorias não precisa dessa
 * separação).
 *
 * NÃO É UMA SECÇÃO DA NAVEGAÇÃO PRINCIPAL: alcança-se a partir de /perfil
 * (uma linha "Categorias", como Conta/Segurança/Preferências — ver
 * SECCOES_PERFIL em Perfil.tsx), não da barra lateral/menu ☰. Por isso
 * "voltar" aqui é "/perfil", não "/", e a página traz o seu próprio
 * <LinkVoltar> (para o desktop, sem barra de topo) — o mesmo padrão de
 * PerfilSeccao.tsx. Pela mesma razão, entra envolvida em <PaginaDeslizante>
 * (deslizamento lateral em mobile, ver a nota nesse ficheiro) — como as
 * outras secções do Perfil.
 *
 * O "+" no cabeçalho cria um GRUPO novo (/categorias/novo, uma folha sobre
 * esta lista) — é a única vez que se escolhe a direção (entrada/saída);
 * uma subcategoria herda-a sempre do grupo onde nasce.
 *
 * Sem procura nem ordenar/agrupar (ao contrário de Contas): a árvore tem
 * sempre as mesmas duas secções, e dentro delas a ordem já é deliberada,
 * não alfabética — não haveria "ordenar por" que fizesse sentido aqui.
 *
 * Estados: a carregar (esqueleto), erro, e a lista — não há "sem
 * categorias nenhumas": todo o utilizador nasce com a árvore semeada no
 * registo.
 */

import { useEffect, useState } from 'react'

import { Link } from 'react-router-dom'

import { CabecalhoPagina } from '../componentes/CabecalhoPagina'
import { IconeMais } from '../componentes/icones'
import { LinkBotao } from '../componentes/LinkBotao'
import { LinkVoltar } from '../componentes/LinkVoltar'
import { PaginaDeslizante } from '../componentes/PaginaDeslizante'
import { PontoCategoria } from '../componentes/PontoCategoria'
import { obterArvoreCategorias, type GrupoArvore } from '../lib/categorias'
import { ErroApi } from '../lib/http'
import estilos from './Categorias.module.css'

type Estado =
  | { fase: 'a-carregar' }
  | { fase: 'erro'; mensagem: string }
  | { fase: 'pronto'; arvore: GrupoArvore[] }

/** "1 subcategoria" / "N subcategorias" — sob o nome de cada grupo. */
function contagemSubcategorias(grupo: GrupoArvore): string {
  const n = grupo.subcategorias.length
  return n === 1 ? '1 subcategoria' : `${n} subcategorias`
}

/** Esqueleto mostrado enquanto a árvore carrega: a mesma forma de Contas
 *  (círculo + barra), a pulsar devagar. */
function Esqueleto() {
  return (
    <div className={estilos.lista} role="status" aria-label="A carregar categorias">
      {[0, 1, 2].map((indice) => (
        <div key={indice} className={estilos.linha}>
          <span className={`${estilos.esqueleto} ${estilos.esqueletoPonto}`} />
          <span className={`${estilos.esqueleto} ${estilos.esqueletoNome}`} />
        </div>
      ))}
    </div>
  )
}

/** Uma linha da lista: o ponto colorido do grupo (tamanho "md", igual ao
 *  Avatar), o nome, e a contagem de subcategorias à direita. Sem chevron —
 *  a linha inteira é tocável, tal como em Contas. */
function LinhaGrupo({ grupo }: { grupo: GrupoArvore }) {
  return (
    <Link to={`/categorias/${grupo.id}`} className={estilos.linha}>
      <PontoCategoria nomeGrupo={grupo.nome} tamanho="md" />
      <span className={estilos.linhaNome}>{grupo.nome}</span>
      <span className={estilos.linhaContagem}>{contagemSubcategorias(grupo)}</span>
    </Link>
  )
}

export function Categorias() {
  const [estado, setEstado] = useState<Estado>({ fase: 'a-carregar' })

  useEffect(() => {
    let activo = true
    obterArvoreCategorias()
      .then((arvore) => {
        if (activo) setEstado({ fase: 'pronto', arvore })
      })
      .catch((erro) => {
        if (!activo) return
        const mensagem =
          erro instanceof ErroApi ? erro.message : 'Não foi possível carregar as categorias.'
        setEstado({ fase: 'erro', mensagem })
      })
    return () => {
      activo = false
    }
  }, [])

  const entradas = estado.fase === 'pronto' ? estado.arvore.filter((g) => g.direcao === 'entrada') : []
  const saidas = estado.fase === 'pronto' ? estado.arvore.filter((g) => g.direcao === 'saida') : []

  return (
    <PaginaDeslizante>
      {(aoRecuar) => (
        <div>
          <LinkVoltar para="/perfil">Perfil</LinkVoltar>
          <CabecalhoPagina
            titulo="Categorias"
            voltar="/perfil"
            aoRecuar={aoRecuar}
            acao={
              <LinkBotao para="/categorias/novo" apenasIcone titulo="Novo grupo">
                <IconeMais tamanho={22} />
              </LinkBotao>
            }
          />

          {estado.fase === 'a-carregar' && <Esqueleto />}

          {estado.fase === 'erro' && (
            <p role="alert" className={estilos.nota}>
              {estado.mensagem}
            </p>
          )}

          {estado.fase === 'pronto' && (
            <div className={estilos.seccoes}>
              <section className={estilos.seccao}>
                <h2 className={estilos.seccaoTitulo}>Entradas</h2>
                <div className={estilos.lista}>
                  {entradas.map((grupo) => (
                    <LinhaGrupo key={grupo.id} grupo={grupo} />
                  ))}
                </div>
              </section>

              <section className={estilos.seccao}>
                <h2 className={estilos.seccaoTitulo}>Saídas</h2>
                <div className={estilos.lista}>
                  {saidas.map((grupo) => (
                    <LinhaGrupo key={grupo.id} grupo={grupo} />
                  ))}
                </div>
              </section>
            </div>
          )}
        </div>
      )}
    </PaginaDeslizante>
  )
}
