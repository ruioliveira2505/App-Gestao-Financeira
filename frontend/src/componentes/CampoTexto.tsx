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
 * CampoTexto guarda apenas um estado próprio, e só quando tipo="password":
 * se a password está a ser mostrada ou escondida (botão de olho).
 */

import { useId, useState } from 'react'

import { IconeOlho, IconeOlhoFechado } from './icones'
import estilos from './CampoTexto.module.css'

type Props = {
  // Texto do rótulo mostrado por cima do campo.
  etiqueta: string
  // Valor actual do campo (vem do estado de quem usa o componente).
  valor: string
  // Chamada a cada alteração, já com o novo texto do campo (não com o
  // evento do DOM).
  aoMudar: (valor: string) => void
  // Tipo do <input>. "password" esconde o que é escrito e acrescenta um
  // botão para revelar/ocultar; "email" ajusta o teclado em telemóvel.
  // Por omissão, "text".
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
  const [passwordVisivel, setPasswordVisivel] = useState(false)

  const ePassword = tipo === 'password'
  // Quando é uma password e o utilizador pediu para a ver, o <input> passa
  // a "text" (mostra os caracteres); caso contrário mantém o tipo pedido.
  const tipoEfetivo = ePassword && passwordVisivel ? 'text' : tipo

  const campo = (
    <input
      id={id}
      type={tipoEfetivo}
      value={valor}
      onChange={(evento) => aoMudar(evento.target.value)}
      required={obrigatorio}
      autoComplete={autoComplete}
    />
  )

  return (
    <div className={estilos.campo}>
      <label htmlFor={id} className={estilos.etiqueta}>
        {etiqueta}
      </label>

      {ePassword ? (
        <div className={estilos.comBotao}>
          {campo}
          <button
            type="button"
            className={estilos.botaoOlho}
            onClick={() => setPasswordVisivel((visivel) => !visivel)}
            aria-label={passwordVisivel ? 'Ocultar password' : 'Mostrar password'}
          >
            {passwordVisivel ? <IconeOlhoFechado /> : <IconeOlho />}
          </button>
        </div>
      ) : (
        campo
      )}
    </div>
  )
}
