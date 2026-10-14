/*
 * PÁGINA DE INÍCIO DE SESSÃO
 * ==========================
 *
 * Ecrã onde um utilizador com conta se autentica. É um formulário
 * controlado: o valor de cada campo vive no estado do componente
 * (useState), e cada tecla escrita passa por uma função que atualiza esse
 * estado, levando o React a redesenhar o campo. Chama-se "controlado"
 * porque a fonte da verdade do conteúdo do campo é o estado do React, e
 * não o elemento <input> do browser.
 *
 * Fluxo:
 *   1. O utilizador escreve email e password.
 *   2. Ao submeter, chama-se login() do contexto de autenticação.
 *   3. Em caso de sucesso, navega-se para a página de onde se veio (se a
 *      RotaProtegida enviou para aqui com "de"), ou para a área autenticada
 *      ("/").
 *   4. Em caso de credenciais inválidas, o backend responde 401 e
 *      mostra-se a mensagem genérica que ele devolve ("Email ou password
 *      incorretos."), ficando-se na página.
 *
 * SESSÃO TERMINADA. Se se chegou aqui porque a sessão terminou a meio da
 * utilização (30 minutos sem pedidos), aparece uns segundos, em baixo, o
 * aviso «Sessão terminada · entra outra vez» (o mesmo aviso dos resultados
 * de «Sincronizar agora»), e, depois de entrar, volta-se à página onde se
 * estava. O aviso lê-se UMA vez do estado da navegação e esse estado é
 * limpo logo a seguir, para um refresh não o repetir.
 *
 * Ao contrário do registo, não há validação de comprimento da password no
 * cliente: no início de sessão, o único propósito da password é ser
 * comparada com a que está guardada, e essa comparação falha sozinha para
 * qualquer valor incorreto.
 */

import { useCallback, useEffect, useState } from 'react'

// Link desenha uma hiperligação que navega sem recarregar a página.
// Navigate, quando renderizado, provoca uma navegação imediata.
// useNavigate devolve uma função para navegar a partir de código (aqui,
// depois de o início de sessão ter sucesso).
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'

import { ErroApi } from '../lib/api'
import { useAuth } from '../auth/useAuth'
import { AvisoEmBaixo, type Aviso } from '../componentes/AvisoEmBaixo'
import { Botao } from '../componentes/Botao'
import { CaixaErro } from '../componentes/CaixaErro'
import { CampoTexto } from '../componentes/CampoTexto'
import { Formulario } from '../componentes/Formulario'
import { LayoutAutenticacao } from './LayoutAutenticacao'

const MENSAGEM_ERRO_GENERICA = 'Ocorreu um erro inesperado. Tenta novamente.'

// O que a RotaProtegida põe no estado da navegação ao enviar para o login.
type EstadoDoLogin = { de?: string; sessaoTerminou?: boolean } | null

// Só se volta a um caminho DA APP (começa por uma barra, mas não por duas) e
// que não seja o próprio login ou o registo.
function origemValida(de: string | undefined): string {
  if (!de || !de.startsWith('/') || de.startsWith('//')) return '/'
  if (de.startsWith('/login') || de.startsWith('/registo')) return '/'
  return de
}

export function Login() {
  const { estado, login } = useAuth()
  const navegar = useNavigate()
  const localizacao = useLocation()
  const estadoDaNavegacao = localizacao.state as EstadoDoLogin
  // A página para onde voltar depois de entrar (ver SESSÃO TERMINADA).
  const origem = origemValida(estadoDaNavegacao?.de)

  // O aviso de «sessão terminada»: lido uma vez, ao montar (ver a nota no
  // topo), e fechado ao fim do tempo ou ao toque.
  const [aviso, setAviso] = useState<Aviso | null>(() =>
    estadoDaNavegacao?.sessaoTerminou
      ? { texto: 'Sessão terminada · entra outra vez', tipo: 'alerta', chave: 1 }
      : null,
  )
  const fecharAviso = useCallback(() => setAviso(null), [])

  // Limpa o "sessaoTerminou" do estado da navegação (mantém o "de"): um
  // refresh da página não repete o aviso.
  const veioComAviso = estadoDaNavegacao?.sessaoTerminou === true
  useEffect(() => {
    if (veioComAviso) {
      navegar(localizacao.pathname, { replace: true, state: { de: estadoDaNavegacao?.de } })
    }
    // Só ao montar: o estado limpo já não tem o aviso.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  // Mensagem de erro a mostrar dentro do formulário, ou null se não há
  // erro.
  const [erro, setErro] = useState<string | null>(null)
  // Verdadeiro enquanto o pedido está em curso — desativa o botão e evita
  // submissões repetidas.
  const [aSubmeter, setASubmeter] = useState(false)

  // Se já existe sessão iniciada (por exemplo, o utilizador abriu /login à
  // mão estando autenticado), reencaminha-se para a área autenticada em
  // vez de mostrar o formulário.
  if (estado === 'autenticado') {
    return <Navigate to={origem} replace />
  }

  // Chamada pelo componente Formulario na submissão (o evento do DOM e o
  // evento.preventDefault() são tratados lá dentro).
  async function submeter() {
    setErro(null)
    setASubmeter(true)

    try {
      await login(email, password)
      navegar(origem, { replace: true })
    } catch (erroApanhado) {
      const mensagem =
        erroApanhado instanceof ErroApi ? erroApanhado.message : MENSAGEM_ERRO_GENERICA
      setErro(mensagem)
      setASubmeter(false)
    }
  }

  return (
    <LayoutAutenticacao titulo="Iniciar sessão">
      <Formulario aoSubmeter={submeter}>
        <CampoTexto
          etiqueta="Email"
          tipo="email"
          valor={email}
          aoMudar={setEmail}
          obrigatorio
          autoComplete="email"
        />

        <CampoTexto
          etiqueta="Password"
          tipo="password"
          valor={password}
          aoMudar={setPassword}
          obrigatorio
          autoComplete="current-password"
        />

        {erro !== null && <CaixaErro>{erro}</CaixaErro>}

        <Botao type="submit" disabled={aSubmeter}>
          {aSubmeter ? 'A iniciar sessão…' : 'Iniciar sessão'}
        </Botao>
      </Formulario>

      <p>
        Ainda não tens conta? <Link to="/registo">Criar conta</Link>
      </p>

      {/* Sempre montado (região "status" para leitores de ecrã). */}
      <AvisoEmBaixo aviso={aviso} aoFechar={fecharAviso} />
    </LayoutAutenticacao>
  )
}
