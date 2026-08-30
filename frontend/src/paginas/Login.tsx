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
 *   3. Em caso de sucesso, navega-se para a área autenticada ("/").
 *   4. Em caso de credenciais inválidas, o backend responde 401 e
 *      mostra-se a mensagem genérica que ele devolve ("Email ou password
 *      incorretos."), ficando-se na página.
 *
 * Ao contrário do registo, não há validação de comprimento da password no
 * cliente: no início de sessão, o único propósito da password é ser
 * comparada com a que está guardada, e essa comparação falha sozinha para
 * qualquer valor incorreto.
 */

import { useState, type FormEvent } from 'react'

// Link desenha uma hiperligação que navega sem recarregar a página.
// Navigate, quando renderizado, provoca uma navegação imediata.
// useNavigate devolve uma função para navegar a partir de código (aqui,
// depois de o início de sessão ter sucesso).
import { Link, Navigate, useNavigate } from 'react-router-dom'

import { ErroApi } from '../lib/api'
import { useAuth } from '../auth/useAuth'

const MENSAGEM_ERRO_GENERICA = 'Ocorreu um erro inesperado. Tenta novamente.'

export function Login() {
  const { estado, login } = useAuth()
  const navegar = useNavigate()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  // Mensagem de erro a mostrar por baixo do formulário, ou null se não há
  // erro.
  const [erro, setErro] = useState<string | null>(null)
  // Verdadeiro enquanto o pedido está em curso — desativa o botão e evita
  // submissões repetidas.
  const [aSubmeter, setASubmeter] = useState(false)

  // Se já existe sessão iniciada (por exemplo, o utilizador abriu /login à
  // mão estando autenticado), reencaminha-se para a área autenticada em
  // vez de mostrar o formulário.
  if (estado === 'autenticado') {
    return <Navigate to="/" replace />
  }

  async function submeter(evento: FormEvent) {
    // Impede o comportamento por omissão de um formulário HTML, que é
    // recarregar a página ao submeter.
    evento.preventDefault()
    setErro(null)
    setASubmeter(true)

    try {
      await login(email, password)
      navegar('/')
    } catch (erroApanhado) {
      const mensagem =
        erroApanhado instanceof ErroApi ? erroApanhado.message : MENSAGEM_ERRO_GENERICA
      setErro(mensagem)
      setASubmeter(false)
    }
  }

  return (
    <main>
      <h1>Iniciar sessão</h1>

      <form onSubmit={submeter}>
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(evento) => setEmail(evento.target.value)}
            required
          />
        </label>

        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(evento) => setPassword(evento.target.value)}
            required
          />
        </label>

        {/* role="alert" faz os leitores de ecrã anunciarem a mensagem
            assim que ela aparece. */}
        {erro !== null && <p role="alert">{erro}</p>}

        <button type="submit" disabled={aSubmeter}>
          {aSubmeter ? 'A iniciar sessão…' : 'Iniciar sessão'}
        </button>
      </form>

      <p>
        Ainda não tens conta? <Link to="/registo">Criar conta</Link>
      </p>
    </main>
  )
}
