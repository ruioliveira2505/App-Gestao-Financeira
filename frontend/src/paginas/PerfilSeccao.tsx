/*
 * SUB-ECRÃ DE UMA SECÇÃO DO PERFIL (/perfil/conta, /perfil/seguranca,
 * /perfil/preferencias)
 * =====================================================================
 *
 * Um marcador temporário, partilhado pelas três secções do perfil. Existe
 * para as linhas da lista da página de Perfil terem um destino real — com
 * "‹ voltar" para /perfil e o título certo na barra de topo — enquanto o
 * conteúdo de cada secção não está construído.
 *
 * Quando uma secção for feita a sério (editar nome/email, mudar
 * palavra-passe, escolher o tema, …), passa a ter o seu próprio ficheiro e
 * esta rota deixa de a usar.
 *
 * "voltar" no <CabecalhoPagina>: em mobile põe "‹ voltar" na barra de topo
 * em vez do botão ☰ (recua no histórico; /perfil é o recurso quando não há
 * histórico dentro da app). Em desktop não há barra de topo, por isso a
 * página mostra o seu próprio <LinkVoltar> no conteúdo.
 */

import { CabecalhoPagina } from '../componentes/CabecalhoPagina'
import { LinkVoltar } from '../componentes/LinkVoltar'
import estilos from './PerfilSeccao.module.css'

type Props = {
  // O nome da secção — vai para o título da barra de topo e para o
  // <LinkVoltar>.
  titulo: string
}

export function PerfilSeccao({ titulo }: Props) {
  return (
    <div>
      <LinkVoltar para="/perfil">Perfil</LinkVoltar>
      <CabecalhoPagina titulo={titulo} voltar="/perfil" />
      <p className={estilos.nota}>Em breve.</p>
    </div>
  )
}
