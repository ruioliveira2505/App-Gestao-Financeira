/*
 * BarraTopoMobile — A BARRA DE TOPO EM ECRÃ ESTREITO
 * ================================================
 *
 * Só existe em mobile (o LayoutApp só a renderiza quando useMediaQuery diz
 * que o ecrã é estreito). É a única barra fixa da aplicação em mobile
 * (não há barra de separadores no fundo). Três zonas — o título de uma
 * página de DETALHE fica ao centro, porque as zonas laterais têm largura
 * mínima igual; o de uma página PRINCIPAL "colapsavel", quando aparece
 * aqui, NÃO segue este centrado — ver a nota mais abaixo, sobre o
 * porquê:
 *
 *   - esquerda:
 *       · páginas principais → o botão ☰, que abre o menu (MenuMobile) —
 *         seguido, se a página for "colapsavel" e já se tiver rolado o
 *         suficiente, do seu título compacto;
 *       · páginas de detalhe (as que declaram "voltar" no <CabecalhoPagina>)
 *         → "‹ voltar";
 *   - centro: só o título de uma página de detalhe (nas páginas principais
 *     fica vazio — o título aparece grande no conteúdo, ou compacto na
 *     zona esquerda, nunca aqui);
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
 * Se a página declarou um "aoRecuar" (ver CabecalhoContexto), a navegação
 * decidida acima não acontece logo — é entregue a essa função, e é a
 * própria página quem decide quando a chamar de facto (o caso de uso é
 * PaginaDeslizante: anima a saída primeiro, só depois navega). Sem
 * "aoRecuar", navega-se de imediato, como sempre.
 *
 * Esta barra está SEMPRE visível (não se esconde ao rolar). O que se
 * recolhe ao rolar para baixo é o conteúdo de cada página — nas páginas
 * com <CabecalhoPagina colapsavel>, o título grande e (se a própria
 * página o fizer, ligada a "aoColapsar") a barra de procura. Quando isso
 * acontece, o título passa a aparecer aqui — "tituloCompacto", em
 * CabecalhoContexto —, mas À DIREITA DO ☰, dentro da própria zona
 * esquerda, NÃO ao centro como o de uma página de detalhe: a zona direita
 * de uma página principal muda de conteúdo consoante o modo (ex.: a
 * pílula "Selecionar"/"Filtros" dá lugar a um "X" no modo de seleção da
 * lista de Movimentos, larguras diferentes) — um título centrado, que
 * depende das duas zonas terem a mesma largura para ficar mesmo no meio,
 * "saltaria" de posição sempre que a zona direita mudasse de tamanho. Ao
 * ficar ancorado ao ☰, o título nunca se mexe, aconteça o que acontecer
 * do lado direito.
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

  // "undefined" (a página nem é "colapsavel") é diferente de "false"
  // (colapsavel, mas ainda não rolado o suficiente) — só no primeiro caso
  // é que nem vale a pena desenhar o título compacto (ver a nota em
  // CabecalhoPagina.tsx): sem isso, TODA página principal ganharia um
  // elemento extra na zona esquerda, mesmo sem nunca vir a mostrar nada.
  const paginaColapsavel = cabecalho?.tituloCompacto !== undefined
  const tituloCompacto = Boolean(cabecalho?.tituloCompacto)

  function aoVoltar() {
    // location.key é 'default' apenas na primeira entrada da sessão de
    // navegação — ou seja, quando não houve navegação dentro da aplicação
    // e não há para onde recuar. Nesse caso vai para o caminho de recurso;
    // caso contrário, recua no histórico como faria o botão do sistema.
    const navegarDeFacto = () => {
      if (localizacao.key === 'default') {
        navegar(cabecalho?.voltar as string)
      } else {
        navegar(-1)
      }
    }

    // Com "aoRecuar" a página quer controlar QUANDO a navegação acontece
    // (normalmente: depois de uma animação de saída) — entrega-se-lhe a
    // navegação já decidida, em vez de a fazer aqui e agora.
    if (cabecalho?.aoRecuar) {
      cabecalho.aoRecuar(navegarDeFacto)
    } else {
      navegarDeFacto()
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
          <>
            <button
              type="button"
              className={estilos.botao}
              aria-label="Abrir menu"
              onClick={aoAbrirMenu}
            >
              <IconeMenu tamanho={22} />
            </button>

            {/* O título compacto de uma página principal "colapsavel" (ver
                CabecalhoPagina.tsx) — à direita do ☰, não ao centro (ver a
                nota no topo do ficheiro sobre o porquê). Só desenhado
                quando a própria página É colapsavel ("paginaColapsavel");
                nessas, fica SEMPRE no DOM (nunca condicionalmente montado/
                desmontado), para a transição de entrada/saída poder
                animar-se em CSS — só invisível até se rolar o suficiente. */}
            {paginaColapsavel && (
              <span
                className={
                  tituloCompacto && cabecalho?.titulo
                    ? `${estilos.tituloCompacto} ${estilos.tituloCompactoVisivel}`
                    : estilos.tituloCompacto
                }
                aria-hidden={!tituloCompacto}
              >
                {cabecalho?.titulo}
              </span>
            )}
          </>
        )}
      </div>

      {/* Título ao centro — só numa página de detalhe, estático, sem
          transição nenhuma: sempre foi assim, e não há porque animar algo
          que só aparece uma vez, ao entrar na página. */}
      {ePaginaDetalhe && cabecalho?.titulo && (
        <span className={estilos.titulo}>{cabecalho.titulo}</span>
      )}

      <div className={estilos.direita}>{cabecalho?.acao}</div>
    </header>
  )
}
