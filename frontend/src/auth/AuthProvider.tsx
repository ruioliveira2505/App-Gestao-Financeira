/*
 * AuthProvider — FORNECEDOR DO ESTADO DE AUTENTICAÇÃO
 * ===================================================
 *
 * Este componente envolve a aplicação inteira (ver src/main.tsx) e é o
 * único sítio onde vive o estado "há sessão iniciada? de quem?". Expõe
 * esse estado, e as ações que o alteram (registar, login, logout,
 * atualizarPreferencias), através do contexto definido em contexto.ts.
 * Qualquer componente abaixo lê tudo isto com o hook useAuth (ver
 * useAuth.ts), sem receber nada por "props".
 *
 * Ao montar, faz um pedido a GET /auth/me para descobrir se o browser já
 * tem um cookie de sessão válido de uma visita anterior — é isso que
 * mantém o utilizador com sessão iniciada depois de recarregar a página.
 *
 * SESSÃO TERMINADA A MEIO. A sessão dura 30 minutos desde o último pedido.
 * Se terminar enquanto a pessoa está na app, o primeiro pedido seguinte
 * recebe 401 e o cliente HTTP (src/lib/http.ts) avisa este componente, que
 * passa logo a 'anonimo' com o motivo 'expirou': a RotaProtegida leva ao
 * login, que explica o que aconteceu. Sem isto, a app ficava a mostrar
 * erros de «ligação» sem dizer que o problema era a sessão.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'

// Funções do cliente HTTP. São importadas com outro nome (apiLogin, etc.)
// para não colidirem com as funções locais deste componente, que têm o
// mesmo nome mas acrescentam a atualização do estado.
import {
  login as apiLogin,
  logout as apiLogout,
  mudarPreferencias as apiMudarPreferencias,
  obterUtilizadorAtual,
  registar as apiRegistar,
  type Utilizador,
} from '../lib/api'
import { definirAoSessaoTerminar } from '../lib/http'
import { AuthContexto, type EstadoAutenticacao, type MotivoSemSessao } from './contexto'

export function AuthProvider({ children }: { children: ReactNode }) {
  // Dois pedaços de estado, mantidos em sincronia pelas funções abaixo:
  // quem é o utilizador (ou null), e em que fase está a autenticação.
  const [utilizador, setUtilizador] = useState<Utilizador | null>(null)
  const [estado, setEstado] = useState<EstadoAutenticacao>('a-carregar')
  const [motivoSemSessao, setMotivoSemSessao] = useState<MotivoSemSessao>('inicio')

  // O estado atual, numa referência, para o aviso de «sessão terminada»
  // (registado uma só vez, mais abaixo) o ler sempre atualizado e para vários
  // pedidos a falhar ao mesmo tempo só provocarem UMA saída.
  const estadoRef = useRef<EstadoAutenticacao>('a-carregar')
  useEffect(() => {
    estadoRef.current = estado
  }, [estado])

  // Regista-se no cliente HTTP para saber quando um pedido devolve 401.
  // Só conta se havia sessão (estado 'autenticado'): ao arrancar, o 401 de
  // GET /auth/me quer só dizer «ainda não entraste».
  useEffect(() => {
    definirAoSessaoTerminar(() => {
      if (estadoRef.current !== 'autenticado') return
      estadoRef.current = 'anonimo'
      setUtilizador(null)
      setMotivoSemSessao('expirou')
      setEstado('anonimo')
    })
    return () => definirAoSessaoTerminar(null)
  }, [])

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
    setMotivoSemSessao('inicio')
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
      setMotivoSemSessao('logout')
      setEstado('anonimo')
    }
  }

  // Muda a moeda principal do utilizador autenticado. Se apiMudarPreferencias
  // rejeitar (ex.: 422 numa moeda não suportada, ou um erro de rede), a
  // exceção propaga-se para quem chamou — "utilizador" só é atualizado em
  // caso de sucesso, para o ecrã que mostra a moeda escolhida nunca
  // avançar otimisticamente para um valor que o servidor não confirmou.
  async function atualizarPreferencias(moedaPrincipal: string) {
    const u = await apiMudarPreferencias(moedaPrincipal)
    setUtilizador(u)
  }

  return (
    <AuthContexto.Provider
      value={{ estado, utilizador, motivoSemSessao, registar, login, logout, atualizarPreferencias }}
    >
      {children}
    </AuthContexto.Provider>
  )
}
