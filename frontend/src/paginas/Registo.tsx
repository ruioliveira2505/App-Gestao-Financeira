/*
 * PÁGINA DE REGISTO
 * =================
 *
 * Ecrã onde alguém sem conta a cria. É um formulário controlado: o valor
 * de cada campo vive no estado do componente (useState), e cada tecla
 * escrita passa por uma função que atualiza esse estado. O React volta a
 * desenhar o campo com o novo valor. Chama-se "controlado" porque a
 * fonte da verdade do que está no campo é o estado do React, não o
 * próprio elemento <input> do browser.
 *
 * Fluxo:
 *   1. O utilizador escreve email e password.
 *   2. Ao submeter, é feita uma validação mínima no cliente (comprimento
 *      da password), igual à regra do backend, para dar uma resposta
 *      imediata sem ida à rede.
 *   3. Se passar, chama-se registar() do contexto de autenticação, que
 *      cria a conta e inicia logo a sessão.
 *   4. Em caso de sucesso, navega-se para a área autenticada ("/").
 *   5. Em caso de erro devolvido pelo servidor (ex.: email já registado),
 *      mostra-se a mensagem e fica-se na página.
 */

import { useState, type FormEvent } from 'react'

// Link desenha um hiperligação que navega sem recarregar a página.
// Navigate, quando renderizado, provoca uma navegação imediata.
// useNavigate devolve uma função para navegar a partir de código (aqui,
// depois de o registo ter sucesso).
import { Link, Navigate, useNavigate } from 'react-router-dom'

import { ErroApi } from '../lib/api'
import { useAuth } from '../auth/useAuth'

// Mesma regra do schema UserRegisto no backend (backend/app/schemas/auth.py):
// a password tem de ter pelo menos 8 caracteres.
const COMPRIMENTO_MINIMO_PASSWORD = 8

const MENSAGEM_ERRO_GENERICA = 'Ocorreu um erro inesperado. Tenta novamente.'

export function Registo() {
  const { estado, registar } = useAuth()
  const navegar = useNavigate()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  // Mensagem de erro a mostrar por baixo do formulário, ou null se não há
  // erro.
  const [erro, setErro] = useState<string | null>(null)
  // Verdadeiro enquanto o pedido de registo está em curso — usado para
  // desativar o botão e evitar submissões repetidas.
  const [aSubmeter, setASubmeter] = useState(false)

  // Se já existe sessão iniciada (por exemplo, o utilizador abriu /registo
  // à mão estando autenticado), não faz sentido mostrar este formulário —
  // reencaminha-se para a área autenticada.
  if (estado === 'autenticado') {
    return <Navigate to="/" replace />
  }

  async function submeter(evento: FormEvent) {
    // Por omissão, submeter um formulário HTML recarrega a página. Isto
    // impede esse comportamento — a submissão é tratada aqui, em
    // JavaScript.
    evento.preventDefault()
    setErro(null)

    if (password.length < COMPRIMENTO_MINIMO_PASSWORD) {
      setErro(`A password tem de ter pelo menos ${COMPRIMENTO_MINIMO_PASSWORD} caracteres.`)
      return
    }

    setASubmeter(true)
    try {
      await registar(email, password)
      // Sucesso: a sessão já está iniciada. Vai para a área autenticada.
      navegar('/')
    } catch (erroApanhado) {
      // ErroApi traz a mensagem do backend (ex.: "Já existe uma conta
      // registada com este email."). Qualquer outra falha usa a mensagem
      // genérica.
      const mensagem =
        erroApanhado instanceof ErroApi ? erroApanhado.message : MENSAGEM_ERRO_GENERICA
      setErro(mensagem)
      setASubmeter(false)
    }
  }

  return (
    <main>
      <h1>Criar conta</h1>

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
            minLength={COMPRIMENTO_MINIMO_PASSWORD}
          />
        </label>

        {/* role="alert" faz os leitores de ecrã anunciarem a mensagem
            assim que ela aparece. */}
        {erro !== null && <p role="alert">{erro}</p>}

        <button type="submit" disabled={aSubmeter}>
          {aSubmeter ? 'A criar conta…' : 'Criar conta'}
        </button>
      </form>

      <p>
        Já tens conta? <Link to="/login">Iniciar sessão</Link>
      </p>
    </main>
  )
}
