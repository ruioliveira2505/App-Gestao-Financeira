/*
 * CampoTexto — CAMPO DE FORMULÁRIO COM RÓTULO
 * ==========================================
 *
 * Junta, numa peça reutilizável, um rótulo e um campo (<input>) já ligados
 * entre si. Usado nos formulários da aplicação.
 *
 * É um "componente controlado": o valor do campo vive no estado de quem o
 * usa, que o passa em "valor" e recebe cada alteração em "aoMudar".
 * Guarda apenas um estado próprio, e só quando tipo="password": se a
 * password está a ser mostrada ou escondida (botão de olho).
 *
 * Opcionalmente, "sugestoes" preenche uma lista de valores propostos
 * (via <datalist> nativo): o campo continua de texto livre, mas oferece
 * completação a partir dessa lista.
 *
 * "disposicao" escolhe o arranjo:
 *   - "empilhado" (por omissão) — o rótulo por cima do campo, cada campo
 *     com o seu contorno. Para formulários soltos (login, registo).
 *   - "linha" — uma linha de um formulário em ficha: o nome do campo em
 *     cima, ténue, e o valor por baixo. Sem contorno próprio (o contorno e
 *     os traços de separação vêm da ficha à volta).
 *
 * tipo="date"/"month" mostram sempre um ícone de calendário, decorativo,
 * do lado direito (nas duas disposições) — só um sinal visual de "isto é
 * um campo tocável" (o toque já abre o seletor nativo do browser, o
 * ícone não intercepta nada); em disposição "linha", ganham também um
 * traço por baixo (ver CampoTexto.module.css), porque essa disposição
 * tira a borda a TODOS os campos, e sem nenhuma delas um campo de
 * data/mês vazio era indistinguível de texto solto.
 */

import { useId, useState } from 'react'

import { IconeCalendario, IconeOlho, IconeOlhoFechado } from './icones'
import estilos from './CampoTexto.module.css'

type Props = {
  // Nome do campo (texto do <label>).
  etiqueta: string
  // Valor actual do campo (vem do estado de quem usa o componente).
  valor: string
  // Chamada a cada alteração, já com o novo texto do campo (não com o
  // evento do DOM).
  aoMudar: (valor: string) => void
  // Tipo do <input>. "password" esconde o que é escrito e acrescenta um
  // botão para revelar/ocultar; "email", "date" e "month" ajustam o teclado
  // e o seletor em telemóvel (o "month" abre a roda mês/ano no iPhone). Por
  // omissão, "text".
  tipo?: 'text' | 'email' | 'password' | 'date' | 'month'
  // Marca o campo como de preenchimento obrigatório.
  obrigatorio?: boolean
  // Valores propostos por completação (<datalist>). O campo continua de
  // texto livre.
  sugestoes?: string[]
  // Pista para o browser e para os gestores de passwords sobre o que este
  // campo contém (ex.: "email", "current-password", "new-password").
  autoComplete?: string
  // Arranjo: "empilhado" (rótulo por cima, com contorno) ou "linha" (linha
  // de ficha: rótulo ténue em cima, valor por baixo). Ver docstring.
  disposicao?: 'empilhado' | 'linha'
  // Limite superior nativo do campo — só relevante em tipo="date"/"month"
  // (ex.: impedir escolher um mês no futuro). Mesmo formato do valor
  // ("AAAA-MM-DD"/"AAAA-MM").
  max?: string
}

export function CampoTexto({
  etiqueta,
  valor,
  aoMudar,
  tipo = 'text',
  obrigatorio = false,
  sugestoes,
  autoComplete,
  disposicao = 'empilhado',
  max,
}: Props) {
  const id = useId()
  const idSugestoes = useId()
  const [passwordVisivel, setPasswordVisivel] = useState(false)

  const ePassword = tipo === 'password'
  const eData = tipo === 'date' || tipo === 'month'
  // Quando é uma password e o utilizador pediu para a ver, o <input> passa
  // a "text" (mostra os caracteres); caso contrário mantém o tipo pedido.
  const tipoEfetivo = ePassword && passwordVisivel ? 'text' : tipo

  const campo = (
    <>
      <input
        id={id}
        type={tipoEfetivo}
        value={valor}
        onChange={(evento) => aoMudar(evento.target.value)}
        required={obrigatorio}
        autoComplete={autoComplete}
        list={sugestoes ? idSugestoes : undefined}
        max={max}
      />
      {sugestoes && (
        <datalist id={idSugestoes}>
          {sugestoes.map((sugestao) => (
            <option key={sugestao} value={sugestao} />
          ))}
        </datalist>
      )}
    </>
  )

  const rotulo = (
    <label htmlFor={id} className={estilos.etiqueta}>
      {etiqueta}
    </label>
  )

  const controlo = ePassword ? (
    <div className={estilos.comIcone}>
      {campo}
      <button
        type="button"
        className={estilos.botaoIcone}
        onClick={() => setPasswordVisivel((visivel) => !visivel)}
        aria-label={passwordVisivel ? 'Ocultar password' : 'Mostrar password'}
      >
        {passwordVisivel ? <IconeOlhoFechado /> : <IconeOlho />}
      </button>
    </div>
  ) : eData ? (
    <div className={estilos.comIcone}>
      {campo}
      <span className={estilos.iconeDecorativo} aria-hidden="true">
        <IconeCalendario tamanho={18} />
      </span>
    </div>
  ) : (
    campo
  )

  // Disposição "linha": rótulo ténue em cima, valor por baixo.
  if (disposicao === 'linha') {
    return (
      <div className={`${estilos.campo} ${estilos.linha}`}>
        {rotulo}
        {controlo}
      </div>
    )
  }

  return (
    <div className={estilos.campo}>
      {rotulo}
      {controlo}
    </div>
  )
}
