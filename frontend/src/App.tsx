/*
 * App — TABELA DE ROTAS DA APLICAÇÃO
 * ==================================
 *
 * Define que componente é mostrado para cada endereço:
 *
 *   /registo             → ecrã de criação de conta     (público)
 *   /login               → ecrã de início de sessão     (público)
 *   /             (Início)     ┐ as secções de navegação (SECCOES) —
 *   /movimentos   (Movimentos) │ área autenticada, dentro da moldura da
 *   /contas       (Contas)     ┘ app. "Categorias" NÃO está aqui — é uma
 *                                 classificação sobre estas entidades, não
 *                                 uma entidade real como elas (ver a nota
 *                                 em src/lib/seccoes.ts); alcança-se a
 *                                 partir de /perfil.
 *   /movimentos/novo         ┐ criar e editar um movimento, cada um como
 *   /movimentos/:id/editar   ┘ folha sobre a lista (um movimento não tem
 *                              página de detalhe própria)
 *   /categorias         → lista dos grupos, alcançada a partir de /perfil
 *   /categorias/novo    → criar um GRUPO, como folha sobre a lista
 *   /categorias/:grupoId → um grupo: as suas subcategorias e todas as
 *                          ações (renomear, mover, eliminar), como folha
 *                          sobre a lista, tal como "Novo grupo" — sem
 *                          detalhe/edição separados nem página de detalhe
 *                          própria (ver a nota em CategoriaGrupo.tsx)
 *   /perfil     (Perfil)     → a conta do utilizador: identidade, as
 *                              secções (Conta · Segurança · Preferências ·
 *                              Categorias), terminar sessão; alcançada
 *                              pela zona de perfil da navegação, não é
 *                              uma secção
 *   /perfil/conta        ┐ sub-ecrãs de cada secção do perfil. Conta e
 *   /perfil/seguranca    ┘ Segurança são marcadores "Em breve"
 *                          (PerfilSeccao); ganham conteúdo próprio quando
 *                          forem feitos
 *   /perfil/preferencias   a moeda principal (PerfilPreferencias) — a
 *                          primeira das três secções a ter conteúdo real
 *   qualquer outro       → redireciona para /
 *
 * As rotas autenticadas são filhas de uma "rota de layout" sem caminho
 * próprio: essa rota renderiza <RotaProtegida><LayoutApp /></RotaProtegida>,
 * e cada rota-filha aparece dentro do <Outlet /> do LayoutApp — ou seja,
 * com a barra lateral sempre à volta. A RotaProtegida reencaminha para
 * /login quem não tenha sessão, antes de o layout sequer aparecer.
 */

import { Navigate, Outlet, Route, Routes } from 'react-router-dom'

import { RotaProtegida } from './auth/RotaProtegida'
import { LayoutApp } from './componentes/LayoutApp'
import { PilhaDePaginas } from './componentes/PilhaDePaginas'
import { Categorias } from './paginas/Categorias'
import { CategoriaGrupo } from './paginas/CategoriaGrupo'
import { CategoriaNova } from './paginas/CategoriaNova'
import { CategoriaResumoDetalhe } from './paginas/CategoriaResumoDetalhe'
import { CategoriasResumo } from './paginas/CategoriasResumo'
import { Contas } from './paginas/Contas'
import { ContaDetalhe } from './paginas/ContaDetalhe'
import { ContaEditar } from './paginas/ContaEditar'
import { ContaNova } from './paginas/ContaNova'
import { Inicio } from './paginas/Inicio'
import { Login } from './paginas/Login'
import { Movimentos } from './paginas/Movimentos'
import { MovimentoEditar } from './paginas/MovimentoEditar'
import { MovimentoNovo } from './paginas/MovimentoNovo'
import { Perfil } from './paginas/Perfil'
import { PerfilPreferencias } from './paginas/PerfilPreferencias'
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
        {/* PILHAS DE PÁGINAS (ver componentes/PilhaDePaginas.tsx): em cada
            secção, a página principal ("fundo") fica SEMPRE montada, e as
            rotas filhas — páginas de detalhe e folhas — abrem-se POR CIMA
            dela. Ao navegar entre filhas da mesma pilha, o React nunca
            desmonta o fundo: ao abrir o detalhe de uma conta, a lista
            continua por baixo (e o detalhe desliza por cima, em vez de
            sobre um fundo vazio); ao recuar, a lista está lá tal como
            estava — mesmo scroll, sem recarregar. "index" com "null": no
            endereço da própria secção, não há nada por cima. */}

        {/* Início → as páginas da repartição por categoria (ver a nota
            "DÉCIMA TERCEIRA FATIA" em Inicio.tsx) — nomes distintos de
            "/categorias", mais abaixo, que é a GESTÃO de categorias, uma
            funcionalidade diferente. Duas camadas encaixadas: a lista de
            categorias por cima do Início, e a de subcategorias por cima
            dessa (uma pilha dentro da outra). */}
        <Route path="/" element={<PilhaDePaginas fundo={<Inicio />} />}>
          <Route index element={null} />
          <Route
            path="resumo/categorias"
            element={<PilhaDePaginas fundo={<CategoriasResumo />} />}
          >
            <Route index element={null} />
            <Route path=":grupoId" element={<CategoriaResumoDetalhe />} />
          </Route>
        </Route>

        {/* Movimentos: novo e editar são folhas sobre a lista (um movimento
            não tem página de detalhe — tocar numa linha abre a edição). */}
        <Route path="/movimentos" element={<PilhaDePaginas fundo={<Movimentos />} />}>
          <Route index element={null} />
          <Route path="novo" element={<MovimentoNovo />} />
          <Route path=":id/editar" element={<MovimentoEditar />} />
        </Route>

        {/* Contas: "Nova conta" é uma folha sobre a lista; o detalhe de uma
            conta é uma página por cima da lista — e a folha de editar
            abre-se, por sua vez, sobre o detalhe (rota filha dele, para o
            detalhe também não ser recriado ao abri-la). */}
        <Route path="/contas" element={<PilhaDePaginas fundo={<Contas />} />}>
          <Route index element={null} />
          <Route path="nova" element={<ContaNova />} />
          <Route
            path=":id"
            element={
              <>
                <ContaDetalhe />
                <Outlet />
              </>
            }
          >
            <Route index element={null} />
            <Route path="editar" element={<ContaEditar />} />
          </Route>
        </Route>

        {/* Perfil: as suas secções e a gestão de categorias são páginas por
            cima do Perfil. Rota de layout SEM "path" — "/categorias" não
            começa por "/perfil", mas recua para lá, por isso pertence a
            esta pilha. Dentro de "/categorias", o grupo e o "Novo grupo"
            são folhas sobre a lista de categorias. */}
        <Route element={<PilhaDePaginas fundo={<Perfil />} />}>
          <Route path="/perfil" element={null} />
          <Route path="/perfil/conta" element={<PerfilSeccao titulo="Conta" />} />
          <Route path="/perfil/seguranca" element={<PerfilSeccao titulo="Segurança" />} />
          <Route path="/perfil/preferencias" element={<PerfilPreferencias />} />
          <Route
            path="/categorias"
            element={
              <>
                <Categorias />
                <Outlet />
              </>
            }
          >
            <Route index element={null} />
            <Route path="novo" element={<CategoriaNova />} />
            <Route path=":grupoId" element={<CategoriaGrupo />} />
          </Route>
        </Route>
      </Route>

      {/* path="*" corresponde a qualquer endereço não apanhado acima. */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
