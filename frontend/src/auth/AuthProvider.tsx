/*
 * AuthProvider — FORNECEDOR DO ESTADO DE AUTENTICAÇÃO
 * ===================================================
 *
 * Este componente envolve a aplicação inteira (ver src/main.tsx) e é o
 * único sítio onde vive o estado "há sessão iniciada? de quem?". Expõe
 * esse estado, e as ações que o alteram (registar, login, logout), através
 * do contexto definido em contexto.ts. Qualquer componente abaixo lê tudo
 * isto com o hook useAuth (ver useAuth.ts), sem receber nada por
 * "props".
 *
 * Ao montar, faz um pedido a GET /auth/me para descobrir se o browser já
 * tem um cookie de sessão válido de uma visita anterior — é isso que
 * mantém o utilizador com sessão iniciada depois de recarregar a página.
 */

import { useEffect, useState, type ReactNode } from 'react'

// Funções do cliente HTTP. São importadas com outro nome (apiLogin, etc.)
// para não colidirem com as funções locais deste componente, que têm o
// mesmo nome mas acrescentam a atualização do estado.
import {
  login as apiLogin,
  logout as apiLogout,
  obterUtilizadorAtual,
  registar as apiRegistar,
  type Utilizador,
} from '../lib/api'
import { AuthContexto, type EstadoAutenticacao } from './contexto'

export function AuthProvider({ children }: { children: ReactNode }) {
  // Dois pedaços de estado, mantidos em sincronia pelas funções abaixo:
  // quem é o utilizador (ou null), e em que fase está a autenticação.
  const [utilizador, setUtilizador] = useState<Utilizador | null>(null)
  const [estado, setEstado] = useState<EstadoAutenticacao>('a-carregar')

  // useEffect com lista de dependências vazia ([]) corre uma única vez,
  // depois da primeira renderização. É aqui que se verifica, ao arrancar,
  // se já existe uma sessão.
  useEffect(() => {
    // "activo" protege contra um caso específico: se este componente for
    // desmontado antes de o pedido terminar (ou for montado duas vezes
    // seguidas, como o React faz em modo de desenvolvimento estrito),
    // não se deve chamar setUtilizador/setEstado sobre um componente que
    // já não está no ecrã. A função de limpeza devolvida no fim marca
    // "activo" como false.
    let activo = true

    obterUtilizadorAtual()
      .then((u) => {
        if (!activo) return
        setUtilizador(u)
        setEstado('autenticado')
      })
      .catch(() => {
        // Qualquer falha (401 por não haver sessão, ou até um erro de
        // rede) é tratada da mesma forma para efeitos do arranque: não há
        // sessão utilizável, portanto 'anonimo'.
        if (!activo) return
        setUtilizador(null)
        setEstado('anonimo')
      })

    return () => {
      activo = false
    }
  }, [])

  // Inicia a sessão de um utilizador existente. Se apiLogin rejeitar
  // (credenciais inválidas), a exceção propaga-se para quem chamou esta
  // função — o estado local não é alterado nesse caso.
  async function login(email: string, password: string) {
    const u = await apiLogin(email, password)
    setUtilizador(u)
    setEstado('autenticado')
  }

  // Regista e, de seguida, inicia a sessão com as mesmas credenciais. O
  // endpoint de registo do backend não cria sessão, por isso é preciso o
  // segundo passo para o utilizador ficar autenticado sem ter de escrever
  // as credenciais outra vez.
  async function registar(email: string, password: string) {
    await apiRegistar(email, password)
    await login(email, password)
  }

  // Termina a sessão. O bloco try/finally garante que o estado local
  // passa sempre a 'anonimo', mesmo que o pedido ao servidor falhe — do
  // ponto de vista do utilizador, o objetivo (deixar de ter sessão neste
  // dispositivo) fica cumprido de qualquer forma.
  async function logout() {
    try {
      await apiLogout()
    } finally {
      setUtilizador(null)
      setEstado('anonimo')
    }
  }

  return (
    <AuthContexto.Provider value={{ estado, utilizador, registar, login, logout }}>
      {children}
    </AuthContexto.Provider>
  )
}
