/*
 * App — TABELA DE ROTAS DA APLICAÇÃO
 * ==================================
 *
 * Define que componente é mostrado para cada endereço:
 *
 *   /registo             → ecrã de criação de conta     (público)
 *   /login               → ecrã de início de sessão     (público)
 *   /           (Início)     ┐
 *   /movimentos (Movimentos) │ as secções de navegação (SECCOES)
 *   /contas     (Contas)     ┘ área autenticada, dentro da moldura da app
 *   /perfil     (Perfil)     → a conta do utilizador: identidade, as
 *                              secções (Conta · Segurança · Preferências),
 *                              terminar sessão; alcançada pela zona de
 *                              perfil da navegação, não é uma secção
 *   /perfil/conta        ┐ sub-ecrãs de cada secção do perfil. Por agora
 *   /perfil/seguranca    │ são marcadores "Em breve" (PerfilSeccao);
 *   /perfil/preferencias ┘ ganham conteúdo próprio quando forem feitos
 *   qualquer outro       → redireciona para /
 *
 * As rotas autenticadas são filhas de uma "rota de layout" sem caminho
 * próprio: essa rota renderiza <RotaProtegida><LayoutApp /></RotaProtegida>,
 * e cada rota-filha aparece dentro do <Outlet /> do LayoutApp — ou seja,
 * com a barra lateral sempre à volta. A RotaProtegida reencaminha para
 * /login quem não tenha sessão, antes de o layout sequer aparecer.
 */

import { Navigate, Route, Routes } from 'react-router-dom'

import { RotaProtegida } from './auth/RotaProtegida'
import { LayoutApp } from './componentes/LayoutApp'
import { Contas } from './paginas/Contas'
import { ContaDetalhe } from './paginas/ContaDetalhe'
import { ContaEditar } from './paginas/ContaEditar'
import { ContaNova } from './paginas/ContaNova'
import { Inicio } from './paginas/Inicio'
import { Login } from './paginas/Login'
import { Movimentos } from './paginas/Movimentos'
import { Perfil } from './paginas/Perfil'
import { PerfilSeccao } from './paginas/PerfilSeccao'
import { Registo } from './paginas/Registo'

function App() {
  return (
    <Routes>
      <Route path="/registo" element={<Registo />} />
      <Route path="/login" element={<Login />} />

      {/* Rota de layout: sem "path", só fornece o elemento que envolve as
          filhas. */}
      <Route
        element={
          <RotaProtegida>
            <LayoutApp />
          </RotaProtegida>
        }
      >
        <Route path="/" element={<Inicio />} />
        <Route path="/movimentos" element={<Movimentos />} />
        <Route path="/contas" element={<Contas />} />
        {/* O modal "Nova conta" é uma folha sobre a lista de contas: a
            rota rende a lista POR TRÁS e a folha por cima, para que, ao
            arrastar a folha para baixo, se veja a página Contas a
            aparecer (e não um fundo vazio). */}
        <Route
          path="/contas/nova"
          element={
            <>
              <Contas />
              <ContaNova />
            </>
          }
        />
        <Route path="/contas/:id" element={<ContaDetalhe />} />
        {/* Tal como o "Nova conta": a folha de editar é desenhada SOBRE o
            detalhe da conta, para o que está por trás não ser um vazio. */}
        <Route
          path="/contas/:id/editar"
          element={
            <>
              <ContaDetalhe />
              <ContaEditar />
            </>
          }
        />
        <Route path="/perfil" element={<Perfil />} />
        <Route path="/perfil/conta" element={<PerfilSeccao titulo="Conta" />} />
        <Route
          path="/perfil/seguranca"
          element={<PerfilSeccao titulo="Segurança" />}
        />
        <Route
          path="/perfil/preferencias"
          element={<PerfilSeccao titulo="Preferências" />}
        />
      </Route>

      {/* path="*" corresponde a qualquer endereço não apanhado acima. */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
