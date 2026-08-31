/*
 * BarraLateral — NAVEGAÇÃO PRINCIPAL DA APLICAÇÃO
 * ==============================================
 *
 * A barra à esquerda, presente em todas as páginas já autenticadas
 * (renderizada pelo LayoutApp). Tem três zonas:
 *
 *   - topo: um botão que recolhe/expande a barra, e o nome da aplicação;
 *   - navegação: um ItemNav (ícone + rótulo) por secção — por agora Resumo
 *     e Contas; mais secções entram na lista ITENS_NAV à medida que as
 *     fatias chegam;
 *   - fundo: a zona de perfil — um avatar com a inicial do nome, o nome, e
 *     um menu (por agora só "Terminar sessão"; ganha "Definições", tema,
 *     etc. mais tarde).
 *
 * Dois modos:
 *   - Ecrã largo: barra fixa. Pode estar "recolhida" (só ícones, 64px) —
 *     controlado pelo LayoutApp através da prop "recolhida".
 *   - Ecrã estreito: a barra é uma "gaveta" que desliza por cima do
 *     conteúdo — o LayoutApp controla se está aberta (prop "aberta") e
 *     passa a função que a fecha ("aoFechar"). Navegar num item, ou tocar
 *     no fundo escurecido, fecha-a. (Nesse modo, "recolhida" é ignorado.)
 */

import { useNavigate } from 'react-router-dom'

import { useAuth } from '../auth/useAuth'
import { IconeContas, IconeMenu, IconeRecolher, IconeResumo } from './icones'
import { ItemNav } from './ItemNav'
import { Menu, MenuCabecalho, MenuItem } from './Menu'
import estilos from './BarraLateral.module.css'

// As secções da aplicação. Definida fora do componente porque não muda
// entre renderizações.
const ITENS_NAV = [
  { para: '/', etiqueta: 'Resumo', icone: <IconeResumo />, exato: true },
  { para: '/contas', etiqueta: 'Contas', icone: <IconeContas />, exato: false },
]

// Nome a mostrar ao lado do avatar. O registo só recolhe o email, por
// isso, na falta de um nome verdadeiro, usa-se a parte antes do "@"
// ("ana@exemplo.pt" -> "ana"). Quando existir um campo de nome, troca-se
// esta função pela leitura desse campo.
function nomeApresentado(email: string | undefined): string {
  if (!email) return 'Utilizador'
  const arroba = email.indexOf('@')
  return arroba > 0 ? email.slice(0, arroba) : email
}

// Primeira letra do nome apresentado, para o avatar.
function inicial(email: string | undefined): string {
  return nomeApresentado(email).charAt(0).toUpperCase() || '?'
}

type Props = {
  aberta: boolean
  aoFechar: () => void
  recolhida: boolean
  aoAlternarRecolher: () => void
}

export function BarraLateral({ aberta, aoFechar, recolhida, aoAlternarRecolher }: Props) {
  const { utilizador, logout } = useAuth()
  const navegar = useNavigate()

  async function terminarSessao() {
    await logout()
    navegar('/login')
  }

  const classesAside = [
    estilos.barra,
    aberta && estilos.barraAberta,
    recolhida && estilos.recolhida,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <>
      {/* Fundo escurecido: só tem aparência (via CSS) em ecrã estreito com
          a gaveta aberta. Fecha-a ao ser tocado. */}
      <div
        className={`${estilos.backdrop} ${aberta ? estilos.backdropVisivel : ''}`}
        onClick={aoFechar}
      />

      <aside id="barra-lateral" className={classesAside}>
        <div className={estilos.topo}>
          <button
            type="button"
            className={estilos.botaoRecolher}
            onClick={aoAlternarRecolher}
            aria-label={recolhida ? 'Expandir menu' : 'Recolher menu'}
          >
            {recolhida ? <IconeMenu /> : <IconeRecolher />}
          </button>
          <span className={estilos.nomeApp}>Gestão Financeira</span>
        </div>

        <nav className={estilos.nav}>
          {ITENS_NAV.map((item) => (
            <ItemNav
              key={item.para}
              para={item.para}
              etiqueta={item.etiqueta}
              icone={item.icone}
              exato={item.exato}
              compacto={recolhida}
              aoNavegar={aoFechar}
            />
          ))}
        </nav>

        <div className={estilos.perfil}>
          <Menu
            gatilho={({ aberto, alternar }) => (
              <button
                type="button"
                className={estilos.gatilhoPerfil}
                onClick={alternar}
                aria-haspopup="menu"
                aria-expanded={aberto}
              >
                <span className={estilos.avatar} aria-hidden="true">
                  {inicial(utilizador?.email)}
                </span>
                <span className={estilos.nome}>{nomeApresentado(utilizador?.email)}</span>
              </button>
            )}
          >
            <MenuCabecalho>{utilizador?.email}</MenuCabecalho>
            <MenuItem onClick={() => void terminarSessao()}>Terminar sessão</MenuItem>
          </Menu>
        </div>
      </aside>
    </>
  )
}
