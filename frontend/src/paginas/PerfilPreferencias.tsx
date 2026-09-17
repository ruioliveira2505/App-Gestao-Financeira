/*
 * PREFERÊNCIAS DO UTILIZADOR (/perfil/preferencias)
 * ==================================================
 *
 * Por agora, uma única preferência: a MOEDA PRINCIPAL — a moeda em que
 * valores agregados entre contas (ex.: um futuro património total) são
 * mostrados. Cada conta continua sempre a mostrar o seu próprio saldo na
 * sua própria moeda; esta escolha não muda nada nas contas ou nos
 * movimentos, só nos ecrãs que um dia vierem a juntar valores de contas
 * em moedas diferentes.
 *
 * GRAVA AO ESCOLHER, SEM BOTÃO "GUARDAR": ao contrário dos formulários de
 * criar/editar uma conta ou um movimento, esta página não pede uma
 * submissão à parte. O gesto de escolher uma opção no <CampoSelecao> já
 * é, por si, uma ação deliberada — pedir a seguir um "Guardar" separado
 * seria fricção a mais para uma única definição. Se o pedido ao servidor
 * falhar, a moeda mostrada não muda (só é atualizada depois de o backend
 * confirmar — ver AuthProvider.tsx, atualizarPreferencias) e aparece uma
 * mensagem de erro por baixo.
 *
 * "aGuardar" impede um segundo pedido enquanto o primeiro ainda está em
 * curso — o mesmo cuidado usado noutros sítios da app (ex.: CategoriaGrupo.
 * tsx) para um duplo toque não disparar dois pedidos concorrentes; aqui é
 * ainda mais improvável de acontecer (a lista fecha-se ao escolher), mas o
 * custo de o evitar é uma linha. Enquanto "aGuardar" é verdadeiro, mostra-se
 * "A atualizar…" por baixo do campo — sem isto, entre o toque e a resposta
 * do servidor (mais visível numa rede lenta), o campo continuava a mostrar
 * a moeda ANTIGA sem nada a distinguir "a processar" de "não aconteceu
 * nada", ao contrário de qualquer outra ação assíncrona da app (que troca
 * sempre o texto de um botão, ex.: "A guardar…").
 *
 * Ver a nota em PerfilSeccao.tsx sobre "voltar"/<PaginaDeslizante> — esta
 * página usa exatamente a mesma moldura, só que com conteúdo a sério em
 * vez de "Em breve".
 */

import { useState } from 'react'

import { useAuth } from '../auth/useAuth'
import { CabecalhoPagina } from '../componentes/CabecalhoPagina'
import { CaixaErro } from '../componentes/CaixaErro'
import { CampoSelecao } from '../componentes/CampoSelecao'
import { LinkVoltar } from '../componentes/LinkVoltar'
import { PaginaDeslizante } from '../componentes/PaginaDeslizante'
import { ErroApi } from '../lib/http'
import { OPCOES_MOEDA } from '../lib/moedas'
import estilos from './PerfilPreferencias.module.css'

const MENSAGEM_ERRO_GENERICA = 'Não foi possível guardar. Tenta novamente.'

export function PerfilPreferencias() {
  const { utilizador, atualizarPreferencias } = useAuth()
  const [aGuardar, setAGuardar] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const moedaAtual = utilizador?.moeda_principal ?? 'EUR'

  async function escolherMoeda(moeda: string) {
    // Sem esta segunda condição, escolher a moeda que já está definida
    // (ex.: tocar em "Euro" quando já é "Euro" — fácil de acontecer, já
    // que a lista mostra sempre a opção actual) disparava sempre um PATCH
    // ao servidor sem necessidade nenhuma.
    if (aGuardar || moeda === moedaAtual) return
    setAGuardar(true)
    setErro(null)
    try {
      await atualizarPreferencias(moeda)
    } catch (erroApanhado) {
      setErro(erroApanhado instanceof ErroApi ? erroApanhado.message : MENSAGEM_ERRO_GENERICA)
    } finally {
      setAGuardar(false)
    }
  }

  return (
    <PaginaDeslizante>
      {(aoRecuar) => (
        <div>
          <LinkVoltar para="/perfil">Perfil</LinkVoltar>
          <CabecalhoPagina titulo="Preferências" voltar="/perfil" aoRecuar={aoRecuar} />

          <fieldset className={estilos.grupo} aria-label="Moeda">
            <CampoSelecao
              disposicao="linha"
              etiqueta="Moeda principal"
              // "moedaAtual" cai para 'EUR' só quando "utilizador" é null
              // — na app real isto nunca acontece (esta rota vive sempre
              // dentro de RotaProtegida, que só mostra os filhos quando
              // já há um utilizador autenticado, sempre com
              // moeda_principal preenchido); o fallback existe só para um
              // teste que monte esta página sozinha, sem essa guarda.
              valor={moedaAtual}
              aoMudar={(valor) => void escolherMoeda(valor)}
              opcoes={OPCOES_MOEDA}
              // Esta página não é um modal em folha — é uma página normal
              // (ver a nota "DUAS DIREÇÕES" em PainelDeEscolha.tsx): em
              // mobile, o seletor sobe de baixo, não entra da direita.
              direcaoPainel="baixo"
            />
          </fieldset>
          {aGuardar && <p className={estilos.aAtualizar}>A atualizar…</p>}
          {erro !== null && <CaixaErro>{erro}</CaixaErro>}
        </div>
      )}
    </PaginaDeslizante>
  )
}
