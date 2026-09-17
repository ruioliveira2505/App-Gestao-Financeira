/*
 * SUB-ECRÃ DE UMA SECÇÃO DO PERFIL (/perfil/conta, /perfil/seguranca)
 * =====================================================================
 *
 * Um marcador temporário, partilhado pelas secções do perfil ainda por
 * construir a sério. Existe para as linhas da lista da página de Perfil
 * terem um destino real — com "‹ voltar" para /perfil e o título certo na
 * barra de topo — enquanto o conteúdo de cada secção não está construído.
 *
 * Quando uma secção for feita a sério (editar nome/email, mudar
 * palavra-passe, …), passa a ter o seu próprio ficheiro e esta rota deixa
 * de a usar — foi o que já aconteceu a Preferências (a moeda principal),
 * ver PerfilPreferencias.tsx.
 *
 * "voltar" no <CabecalhoPagina>: em mobile põe "‹ voltar" na barra de topo
 * em vez do botão ☰ (recua no histórico; /perfil é o recurso quando não há
 * histórico dentro da app). Em desktop não há barra de topo, por isso a
 * página mostra o seu próprio <LinkVoltar> no conteúdo.
 *
 * <PaginaDeslizante>: em mobile, entra a deslizar da direita e sai a
 * deslizar de volta para lá, ao estilo do "push"/"pop" do iOS (ver a nota
 * em PaginaDeslizante.tsx); em desktop não muda nada. O "aoRecuar" que
 * recebe por render-prop passa-se directamente ao <CabecalhoPagina>.
 */

import { CabecalhoPagina } from '../componentes/CabecalhoPagina'
import { LinkVoltar } from '../componentes/LinkVoltar'
import { PaginaDeslizante } from '../componentes/PaginaDeslizante'
import estilos from './PerfilSeccao.module.css'

type Props = {
  // O nome da secção — vai para o título da barra de topo e para o
  // <LinkVoltar>.
  titulo: string
}

export function PerfilSeccao({ titulo }: Props) {
  return (
    <PaginaDeslizante>
      {(aoRecuar) => (
        <div>
          <LinkVoltar para="/perfil">Perfil</LinkVoltar>
          <CabecalhoPagina titulo={titulo} voltar="/perfil" aoRecuar={aoRecuar} />
          <p className={estilos.nota}>Em breve.</p>
        </div>
      )}
    </PaginaDeslizante>
  )
}
