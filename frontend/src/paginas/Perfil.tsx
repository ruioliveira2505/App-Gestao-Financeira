/*
 * PÁGINA PERFIL (/perfil)
 * ======================
 *
 * O ecrã da conta do utilizador. Chega-se aqui pela zona de perfil no
 * fundo da navegação — o menu ☰ em mobile, a barra lateral em desktop —,
 * que deixou de ser um menu suspenso e passou a ser só uma ligação para
 * esta página.
 *
 * A navegação (Início · Movimentos · Contas) é pura navegação, à maneira
 * de uma barra de separadores nativa; tudo o que é "a minha conta" vive
 * aqui:
 *
 *   - IDENTIDADE: o avatar com a inicial, o nome e o email. Na falta de um
 *     campo de nome verdadeiro (o registo só recolhe o email), o "nome" é
 *     a parte do email antes do "@" — a mesma regra usada na navegação.
 *   - SECÇÕES: Conta, Segurança, Preferências — e Categorias. As quatro
 *     são cada uma uma linha de uma lista ao estilo da lista de contas —
 *     um ícone à esquerda (num quadrado arredondado), o título, um
 *     subtítulo com o que lá vive, e um chevron ">". Conta e Segurança
 *     levam a um marcador "Em breve" (PerfilSeccao.tsx); Preferências já
 *     leva a um sub-ecrã real (PerfilPreferencias.tsx — a moeda
 *     principal). CATEGORIAS é a excepção: não é uma secção da navegação
 *     principal (Início/Movimentos/Contas são entidades reais do dia a
 *     dia; uma categoria é só uma classificação — ver a nota em
 *     src/lib/seccoes.ts), mas é uma página REAL, já construída
 *     (/categorias) — a linha leva lá directamente, não a um marcador "Em
 *     breve".
 *   - TERMINAR SESSÃO: em baixo, isolado, num cartão de contorno vermelho
 *     — a mesma forma do "Eliminar conta" no fim do formulário de edição
 *     de uma conta. Fecha a sessão no servidor (POST /auth/logout, tratado
 *     pelo AuthProvider) e leva ao ecrã de início de sessão.
 *
 * É a única página onde "Terminar sessão" aparece: tirá-lo da navegação
 * evita que se lhe toque por engano ao mudar de secção.
 */

import { useState, type ComponentType } from 'react'

import { Link, useNavigate } from 'react-router-dom'

import { useAuth } from '../auth/useAuth'
import { Avatar } from '../componentes/Avatar'
import { CabecalhoPagina } from '../componentes/CabecalhoPagina'
import {
  IconeAjustes,
  IconeCadeado,
  IconeCategorias,
  IconeChevronDireita,
  IconePessoa,
} from '../componentes/icones'
import { nomeApresentado } from '../lib/nomeUtilizador'
import estilos from './Perfil.module.css'

// As secções de definições. Cada uma tem um sub-ecrã próprio — Conta e
// Segurança ainda são só um marcador "Em breve", Preferências já tem
// conteúdo real (ver a nota no topo do ficheiro); a ordem aqui é a ordem
// na lista.
type SeccaoPerfil = {
  para: string
  titulo: string
  subtitulo: string
  Icone: ComponentType<{ tamanho?: number }>
}

const SECCOES_PERFIL: SeccaoPerfil[] = [
  {
    para: '/perfil/conta',
    titulo: 'Conta',
    subtitulo: 'Nome, email, eliminar conta',
    Icone: IconePessoa,
  },
  {
    para: '/perfil/seguranca',
    titulo: 'Segurança',
    subtitulo: 'Palavra-passe e sessões',
    Icone: IconeCadeado,
  },
  {
    para: '/perfil/preferencias',
    titulo: 'Preferências',
    subtitulo: 'Moeda principal',
    Icone: IconeAjustes,
  },
  {
    // Ao contrário das três de cima, leva a uma página REAL — não a um
    // marcador "Em breve" (ver a nota no topo do ficheiro sobre porque
    // Categorias vive aqui e não na navegação principal).
    para: '/categorias',
    titulo: 'Categorias',
    subtitulo: 'Grupos e subcategorias dos movimentos',
    Icone: IconeCategorias,
  },
]

export function Perfil() {
  const { utilizador, logout } = useAuth()
  const navegar = useNavigate()

  // Enquanto o pedido de logout corre, o botão fica desativado para não se
  // disparar duas vezes.
  const [aSair, setASair] = useState(false)

  const nome = nomeApresentado(utilizador?.email)

  async function terminarSessao() {
    if (aSair) return
    setASair(true)
    try {
      await logout()
      navegar('/login')
    } catch {
      // Se o pedido falhar, reativa o botão para se poder tentar de novo.
      setASair(false)
    }
  }

  return (
    <div>
      <CabecalhoPagina titulo="Perfil" />

      {/* Bloco de identidade, centrado: avatar grande, nome em destaque e o
          email por baixo. */}
      <div className={estilos.identidade}>
        <Avatar nome={nome} tamanho="xl" />
        <span className={estilos.nome}>{nome}</span>
        {utilizador?.email && <span className={estilos.email}>{utilizador.email}</span>}
      </div>

      {/* Lista de secções — a toda a largura, uma linha por secção, traço
          fino recuado entre linhas, como a lista de contas. */}
      <nav className={estilos.lista} aria-label="Definições">
        {SECCOES_PERFIL.map(({ para, titulo, subtitulo, Icone }) => (
          <Link key={para} to={para} className={estilos.item}>
            <span className={estilos.itemIcone} aria-hidden="true">
              <Icone tamanho={20} />
            </span>
            <span className={estilos.itemTexto}>
              <span className={estilos.itemTitulo}>{titulo}</span>
              <span className={estilos.itemSubtitulo}>{subtitulo}</span>
            </span>
            <span className={estilos.itemSeta} aria-hidden="true">
              <IconeChevronDireita tamanho={18} />
            </span>
          </Link>
        ))}
      </nav>

      {/* Terminar sessão — isolado, contorno vermelho, como o "Eliminar
          conta" do formulário de edição de uma conta. */}
      <div className={estilos.sair}>
        <button
          type="button"
          className={estilos.botaoSair}
          onClick={() => void terminarSessao()}
          disabled={aSair}
        >
          {aSair ? 'A terminar…' : 'Terminar sessão'}
        </button>
      </div>
    </div>
  )
}
