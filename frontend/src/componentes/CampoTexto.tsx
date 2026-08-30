/*
 * CampoTexto — CAMPO DE FORMULÁRIO COM RÓTULO
 * ==========================================
 *
 * Junta, numa peça reutilizável, um rótulo (<label>) e um campo de texto
 * (<input>) já ligados entre si. Usado nos formulários de registo e de
 * início de sessão, e disponível para os formulários do resto da
 * aplicação.
 *
 * É um "componente controlado": o valor do campo vive no estado de quem o
 * usa, que o passa em "valor" e recebe cada alteração em "aoMudar". O
 * CampoTexto não guarda estado nenhum.
 */

// useId gera um identificador único e estável para esta instância do
// componente. Serve para ligar o <label> ao <input> através do par
// htmlFor / id: clicar no rótulo passa o foco para o campo, e um leitor
// de ecrã anuncia o rótulo ao chegar ao campo.
import { useId } from 'react'

import estilos from './CampoTexto.module.css'

type Props = {
  // Texto do rótulo mostrado por cima do campo.
  etiqueta: string
  // Valor actual do campo (vem do estado de quem usa o componente).
  valor: string
  // Chamada a cada alteração, já com o novo texto do campo (não com o
  // evento do DOM).
  aoMudar: (valor: string) => void
  // Tipo do <input>. "password" esconde o que é escrito; "email" ajusta o
  // teclado em telemóvel. Por omissão, "text".
  tipo?: 'text' | 'email' | 'password'
  // Marca o campo como de preenchimento obrigatório.
  obrigatorio?: boolean
  // Pista para o browser e para os gestores de passwords sobre o que este
  // campo contém (ex.: "email", "current-password", "new-password").
  autoComplete?: string
}

export function CampoTexto({
  etiqueta,
  valor,
  aoMudar,
  tipo = 'text',
  obrigatorio = false,
  autoComplete,
}: Props) {
  const id = useId()

  return (
    <div className={estilos.campo}>
      <label htmlFor={id} className={estilos.etiqueta}>
        {etiqueta}
      </label>
      <input
        id={id}
        type={tipo}
        value={valor}
        onChange={(evento) => aoMudar(evento.target.value)}
        required={obrigatorio}
        autoComplete={autoComplete}
      />
    </div>
  )
}
