/*
 * BarraTopoMobile — A BARRA DE TOPO EM ECRÃ ESTREITO
 * ================================================
 *
 * Só existe em mobile (o LayoutApp só a renderiza quando useMediaQuery diz
 * que o ecrã é estreito). É a única barra fixa da aplicação em mobile
 * (não há barra de separadores no fundo). Três zonas — o título ao centro
 * fica visualmente centrado porque as zonas laterais têm largura mínima
 * igual:
 *
 *   - esquerda:
 *       · páginas principais → o botão ☰, que abre o menu (MenuMobile);
 *       · páginas de detalhe (as que declaram "voltar" no <CabecalhoPagina>)
 *         → "‹ voltar";
 *   - centro: o título da página de detalhe (nas páginas principais fica
 *     vazio — o título aparece grande no conteúdo);
 *   - direita: a ação da página atual (ex.: o "+" ou o menu "⋯").
 *
 * A navegação entre secções é toda pelo menu ☰ (não há controlo segmentado
 * nem barra de separadores). O título, a ação e o "voltar" vêm da página,
 * através do CabecalhoContexto (a página declara-os com o
 * <CabecalhoPagina>). O "abrir o menu" vem do LayoutApp, que é quem guarda
 * o estado aberto/fechado do MenuMobile.
 *
 * O "‹ voltar" comporta-se como o "voltar" do sistema: recua no histórico
 * do navegador (navigate(-1)). Só quando não há histórico dentro da
 * aplicação — a página foi aberta diretamente pelo URL, e o React Router
 * marca location.key como 'default' — é que usa o caminho fixo que a
 * página declarou no "voltar" (ex.: "/contas"), como recurso.
 *
 * Esta barra está SEMPRE visível (não se esconde ao rolar). O que se
 * recolhe ao rolar para baixo é o conteúdo de cada página — o título
 * grande e, na página de Contas, o campo de procura.
 */

import { useLocation, useNavigate } from 'react-router-dom'

import { useCabecalhoAtual } from './useCabecalho'
import { IconeChevronEsquerda, IconeMenu } from './icones'
import estilos from './BarraTopoMobile.module.css'

type Props = {
  // Chamada quando se toca no ☰. Sem efeito nas páginas de detalhe (onde a
  // esquerda mostra "‹ voltar" em vez do ☰).
  aoAbrirMenu: () => void
}

export function BarraTopoMobile({ aoAbrirMenu }: Props) {
  const cabecalho = useCabecalhoAtual()
  const navegar = useNavigate()
  const localizacao = useLocation()

  // Sem "voltar" a página é principal → ☰ à esquerda. Com "voltar" é de
  // detalhe → "‹ voltar" à esquerda.
  const ePaginaDetalhe = Boolean(cabecalho?.voltar)

  function aoVoltar() {
    // location.key é 'default' apenas na primeira entrada da sessão de
    // navegação — ou seja, quando não houve navegação dentro da aplicação
    // e não há para onde recuar. Nesse caso vai para o caminho de recurso;
    // caso contrário, recua no histórico como faria o botão do sistema.
    if (localizacao.key === 'default') {
      navegar(cabecalho?.voltar as string)
    } else {
      navegar(-1)
    }
  }

  return (
    <header className={estilos.barra}>
      <div className={estilos.esquerda}>
        {ePaginaDetalhe ? (
          <button
            type="button"
            className={estilos.botao}
            aria-label="Voltar"
            onClick={aoVoltar}
          >
            <IconeChevronEsquerda tamanho={22} />
          </button>
        ) : (
          <button
            type="button"
            className={estilos.botao}
            aria-label="Abrir menu"
            onClick={aoAbrirMenu}
          >
            <IconeMenu tamanho={22} />
          </button>
        )}
      </div>

      {/* Título ao centro. Só nas páginas de detalhe — nas principais o
          título é grande, no conteúdo (ver CabecalhoPagina). */}
      {ePaginaDetalhe && cabecalho?.titulo && (
        <span className={estilos.titulo}>{cabecalho.titulo}</span>
      )}

      <div className={estilos.direita}>{cabecalho?.acao}</div>
    </header>
  )
}
