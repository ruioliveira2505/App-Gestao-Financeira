/*
 * Cabecalho — BARRA SUPERIOR DAS PÁGINAS AUTENTICADAS
 * ==================================================
 *
 * Barra fixa no topo dos ecrãs a que só se acede com sessão iniciada.
 * Mostra o nome da aplicação à esquerda e o botão de terminar sessão à
 * direita. À medida que forem sendo acrescentados ecrãs (contas,
 * movimentos, categorias), a navegação entre eles viverá também aqui.
 *
 * A acção de terminar sessão pertence a este componente (e não ao ecrã
 * que o usa): chama logout() do contexto de autenticação e, de seguida,
 * envia o utilizador para o ecrã de início de sessão.
 */

import { useNavigate } from 'react-router-dom'

import { useAuth } from '../auth/useAuth'
import { Botao } from './Botao'
import estilos from './Cabecalho.module.css'

export function Cabecalho() {
  const { logout } = useAuth()
  const navegar = useNavigate()

  async function terminarSessao() {
    // logout() apaga a sessão no servidor e limpa o estado local para
    // 'anonimo'. Mesmo que o pedido ao servidor falhe, o estado local é
    // limpo à mesma (ver AuthProvider).
    await logout()
    navegar('/login')
  }

  return (
    <header className={estilos.cabecalho}>
      <span className={estilos.nome}>App Gestão Financeira</span>

      {/* Variante secundária: terminar sessão é uma acção utilitária, não
          a acção principal de um ecrã — não deve pesar visualmente como um
          botão de acento. */}
      <Botao variante="secundario" type="button" onClick={() => void terminarSessao()}>
        Terminar sessão
      </Botao>
    </header>
  )
}
