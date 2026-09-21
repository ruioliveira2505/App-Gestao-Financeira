/*
 * PÁGINA INÍCIO (/)
 * =================
 *
 * A página de ANÁLISE da app — ao contrário de Contas (gestão pura, sem
 * totais agregados — ver a nota no topo de Contas.tsx) e de Movimentos
 * (o histórico linha a linha), aqui vivem os números que juntam valores
 * ENTRE contas, mesmo quando têm moedas diferentes: a razão de ser da
 * moeda principal (Perfil → Preferências) e de toda a conversão de
 * moeda construída antes desta página.
 *
 * DESENHO DELIBERADAMENTE DIFERENTE do resto da app: as outras páginas
 * são fichas neutras, uniformes entre si; esta é a única página de
 * "destino" (é onde se cai ao abrir a app) e a única de análise — faz
 * sentido destacar-se. Por isso:
 *   - SEM o título de página "Início" habitual (<CabecalhoPagina>) — por
 *     agora, sem NENHUM título visível (uma saudação pessoal foi
 *     experimentada e posta de lado, por agora — ver caderno/decisoes.md,
 *     secção "Resumo"). Ainda assim chama-se useDefinirCabecalho()
 *     directamente (sem montar <CabecalhoPagina>) só para repor o
 *     cabeçalho partilhado (sem "voltar", sem ação) — sem isto, a barra
 *     de topo em mobile ficaria a mostrar o que quer que a página
 *     anterior lá tivesse deixado (ex.: "‹ voltar", de ContaDetalhe).
 *   - Saldo Total como NÚMERO SOLTO, sem cartão nenhum à volta — o
 *     próprio tamanho do número (`--texto-3xl`, o maior da app) já
 *     assinala, ao primeiro relance, que esta zona é diferente do resto
 *     da app, sem precisar de fundo nem de contorno. Chegou a ter fundo
 *     cinzento (`--cor-superficie`), depois um contorno — as duas
 *     reversões pela mesma razão: qualquer caixa à volta ia contra o
 *     princípio abaixo (cor/relevo só onde há significado), sem
 *     acrescentar nada que o tamanho do número não dissesse já sozinho.
 *   - Cor: DELIBERADAMENTE conservadora — só as duas cores semânticas já
 *     estabelecidas (positivo/negativo, de Movimentos.tsx), sem nenhum
 *     acento novo, com UMA excepção: a barra EMPILHADA de categorias (ver
 *     a nota "DÉCIMA PRIMEIRA FATIA", abaixo). A app continua a seguir
 *     "cor só onde há significado" — só que, nessa barra, o significado
 *     que interessa passou a ser "que categoria é esta", não "entrada ou
 *     saída" (o valor ao lado, e o alternador "+/−" no título do cartão,
 *     já dizem isso de sobra).
 *
 * DÉCIMA TERCEIRA FATIA (a mais recente) — O TÍTULO "CATEGORIAS" GANHA
 * DESTINO: desde a "NONA FATIA" (abaixo) que o contorno do cartão e a
 * seta junto do título preparavam terreno para uma página de detalhe,
 * sem ela existir. Construída agora, precedida por dois mockups
 * interactivos ("Novo Início" e "Todas as Categorias") que validaram o
 * desenho de ponta a ponta antes de qualquer código: `/resumo/categorias`
 * (`src/paginas/CategoriasResumo.tsx`) — a lista COMPLETA de categorias
 * do período, sem o `LIMITE_CATEGORIAS` desta página — e
 * `/resumo/categorias/:grupoId` (`src/paginas/CategoriaResumoDetalhe.
 * tsx`) — a repartição por subcategoria de UM grupo, cada uma com a sua
 * PRÓPRIA cor (não herdada do grupo). O título "Categorias" (abaixo,
 * "Categorias" + <IconeChevronDireita>) é agora um `<Link>` para a
 * primeira, levando consigo o período e a selecção de contas já
 * resolvidos NESTA página (via query string, não "state" de navegação —
 * ver a nota em CategoriasResumo.tsx para o porquê). Ver
 * caderno/decisoes.md para o histórico completo desta fatia, incluindo
 * as decisões tomadas ainda na fase de mockup (uma página por nível, não
 * um acordeão; a seta sempre presente, mesmo para um grupo com uma só
 * subcategoria).
 *
 * DÉCIMA SEGUNDA FATIA — DUAS CORREÇÕES À FATIA
 * ANTERIOR: depois de ver a "DÉCIMA PRIMEIRA FATIA" (abaixo) implementada,
 * o utilizador pediu-a de volta em dois pontos concretos:
 *   - O "chip" (fundo + contorno) do gatilho de `SeletorPeriodo` saiu —
 *     voltou a ser só texto, como era antes dessa fatia. O alvo de
 *     toque alargado (o padding) manteve-se; só o aspecto reverteu.
 *   - As réguas finas VERTICAIS entre Entradas/Saídas/Líquido saíram —
 *     a linha de resumo voltou a ter só as duas réguas horizontais
 *     (acima/abaixo), sem divisões entre as três colunas.
 * Além disso, um pedido novo: o TAMANHO das letras de Entradas/Saídas/
 * Líquido tinha de ser "no mínimo" do tamanho das da categoria. Os dois
 * já tinham o MESMO valor em pixels (`--texto-md` e `--texto-base` são
 * ambos 16px) — mas `.resumoValor` usava peso 700 e um `letter-spacing`
 * negativo, contra o peso 600 sem `letter-spacing` de `.categoriaValor`,
 * o que o fazia parecer maior/mais carregado apesar de a dimensão já
 * ser idêntica. Corrigido igualando também o peso e removendo o
 * `letter-spacing` — agora é uma cópia fiel da tipografia da categoria,
 * não só do número em rem.
 *
 * DÉCIMA PRIMEIRA FATIA — REVISÃO DE DESIGN/UX
 * ALARGADA: a pedido explícito ("olha com maior rigor para esta página,
 * não olhes só para isso"), uma revisão que não se limitou à cor da
 * barra — cobriu hierarquia, espaço vazio e alvos de toque, apresentada
 * primeiro como um artefacto ("Novo Início") com um mockup interactivo
 * antes/depois, só depois implementada. Mudanças:
 *   - A barra deixou de ser UMA POR CATEGORIA (espalhando cor pela lista
 *     inteira) e passou a ser UMA SÓ, EMPILHADA, no topo do cartão — um
 *     segmento por categoria visível, mais um segmento cinzento neutro
 *     para o que fica de fora do `LIMITE_CATEGORIAS` (`BarraEmpilhada`,
 *     abaixo) — ao estilo do Ecrã de Utilização da Apple (uma barra,
 *     lista de texto simples por baixo). Concentra a cor num único
 *     elemento deliberado, em vez de a espalhar por quatro barras
 *     soltas — essa dispersão, mais do que o tom exacto de cada cor, foi
 *     identificada como a causa provável de "não parecer bem desenhado".
 *   - Cada linha da lista perdeu a sua barra própria e ganhou a
 *     percentagem em texto (arredondada, sem "do total" — pedido
 *     explícito), por baixo do VALOR, não do nome: os dois números da
 *     mesma categoria lêem-se em coluna, alinhados à direita.
 *   - O alternador "+/−" cresceu de 28×24px para 36×32px — o único
 *     controlo interactivo desta secção estava bem abaixo do alvo de
 *     toque mínimo recomendado pela Apple (~44px).
 *   - O gatilho de `SeletorPeriodo` ganhou um fundo e um contorno
 *     próprios ("chip") — antes era só texto, sem nenhum sinal de
 *     "isto é tocável", destoando do botão-ícone de `FiltroContas` ao
 *     lado (ver "QUINTA FATIA", abaixo).
 *   - A linha de resumo (Entradas/Saídas/Líquido) ganhou réguas finas
 *     VERTICAIS entre as três colunas, além das já existentes acima/
 *     abaixo — lê-se mais claramente como três blocos.
 *   - DELIBERADAMENTE NÃO incluído nesta fatia: a ligação "Ver todas as
 *     categorias" que aparecia no mockup — sem nenhuma página de
 *     detalhe construída ainda para onde apontar, seria uma ligação
 *     morta; fica para quando essa página existir.
 *   - Também não incluído: qualquer forma de comparação com o mês
 *     anterior ou tendência ao longo do tempo — exigem dados novos do
 *     backend, marcados no artefacto como ideias futuras, não como
 *     trabalho pronto a avançar.
 *
 * DÉCIMA FATIA — A BARRA DE CATEGORIA GANHA A COR DO
 * PONTO: depois de o cartão de categorias (ver "NONA FATIA", abaixo) ter
 * ficado estável, sobrou uma tensão por resolver: o PontoCategoria ao
 * lado do nome já identifica a categoria com uma cor própria (ver
 * PontoCategoria.tsx), mas a barra por baixo continuava verde/vermelho
 * por DIRECÇÃO — a mesma informação que o alternador "+/−" e o sinal do
 * valor já davam, repetida. Foram tentadas várias formas de a barra usar
 * a cor da categoria em vez da direcção (ver caderno/decisoes.md para o
 * histórico completo: preenchimento com "-bg" sobre fundo cinzento
 * claro a mais para se ver bem; "-fg" escuro a mais e sem correspondência
 * ao ponto ao lado; contorno; fundo mais escuro) — nenhuma agradou, e a
 * barra chegou a voltar, por inteiro, a verde/vermelho por direcção.
 * A versão final resolve a tensão com um TERCEIRO tom por cor,
 * "--avatar-N-solido" (seis novos tokens em src/index.css, a par dos
 * "-bg"/"-fg" já existentes) — pensado especificamente para um
 * preenchimento SÓLIDO, sem texto por cima nem fundo por baixo a dar-lhe
 * contraste: mais saturado do que "-bg", mais claro do que "-fg". Usa-se
 * SÓ aqui — nem o Avatar (Contas/ContaDetalhe) nem o PontoCategoria
 * (Movimentos, seletores de categoria) foram tocados, e os seus "-bg"/
 * "-fg" continuam com os valores de sempre.
 *
 * NONA FATIA — CARTÃO DE CATEGORIAS COM UM "+/−"
 * LOCAL, SEM CONTROLO SEGMENTADO: o antigo controlo segmentado
 * "Entradas"/"Saídas" (ver a nota "CORREÇÃO DE DESENHO", abaixo) saiu —
 * repetia, em palavras, exactamente os mesmos dois rótulos que já
 * aparecem na linha de resumo, mais acima (ver "OITAVA FATIA", abaixo).
 * A escolha de direcção mudou-se para um alternador pequeno ("+"/"−",
 * SÍMBOLOS, não palavras — por isso já não lê como a mesma coisa
 * repetida), preso ao cabeçalho do cartão "Categorias", não à página
 * inteira: fica junto do que afecta directamente, sem depender de nada
 * lá em cima. `LIMITE_CATEGORIAS` desceu de 5 para 3 (depois subiu para
 * 4 — ver caderno/decisoes.md), e "Ver mais"/"Ver menos" e o acordeão
 * de subcategoria (ver "QUARTA FATIA", abaixo) saíram por agora — sem
 * eles, o cartão fica sempre com o mesmo tamanho, mas também sem forma
 * de ver mais do que as maiores já mostradas nesta página — a página de
 * detalhe (`/resumo/categorias`, com as subcategorias a abrir numa
 * segunda página), que na altura desta fatia só existia em mockup, foi
 * construída mais tarde (ver "DÉCIMA TERCEIRA FATIA", acima); esta
 * fatia tratou só do que está visível na própria página Início, de
 * propósito ("vamos por partes", pedido explícito, para poder mudar de
 * ideias sem ter construído a parte de trás toda primeiro).
 *
 * OITAVA FATIA — ENTRADAS/SAÍDAS/LÍQUIDO NUMA LINHA,
 * COM DUAS RÉGUAS FINAS, logo a seguir ao Saldo Total: ao contrário da
 * secção do fluxo, mais abaixo (que já não tem um controlo segmentado
 * próprio — ver a nota "NONA FATIA", acima), esta linha mostra sempre as
 * DUAS direcções ao mesmo tempo —
 * é um resumo, não uma repartição por categoria. Fica FORA da
 * <section> do fluxo, pela mesma razão de posição de FiltroContas (ver
 * "QUINTA FATIA", abaixo): não depende de qual direcção está
 * seleccionada. Substitui DOIS sítios que mostravam isto antes:
 * "Líquido" ao lado do título do mês (dentro do "cabecalhoFluxo"), e o
 * total da direcção activa que ficava por cima da lista de categorias
 * (ver a nota "CORREÇÃO DE DESENHO", abaixo — esse total deixou de
 * existir, redundante com este resumo). SEM contorno completo — só
 * ".resumoFluxo" com "border-top"/"border-bottom", sem lados nem cantos
 * arredondados: uma versão anterior tentou isto com um cartão de
 * contorno inteiro e foi revertida por parecer voltar ao "modo caixa"
 * logo a seguir a tirarmos o contorno ao Saldo Total (ver
 * caderno/decisoes.md) — duas réguas finas são o mesmo recurso visual
 * (uma borda, não uma caixa), só mais leve.
 *
 * SÉTIMA FATIA — FILTRO DE CATEGORIA/SUBCATEGORIA: CONSTRUÍDO, MAS EM
 * PAUSA (não usado nesta página, por agora): chegou a existir aqui um
 * botão (funil) junto ao controlo segmentado, abrindo a árvore de
 * categorias em multi-escolha, só da direcção activa, com duas
 * selecções independentes (uma por direcção — necessário porque GET
 * /resumo devolve as duas listas na MESMA resposta: uma selecção
 * partilhada deixaria a direcção não filtrada com ZERO categorias).
 * Numa revisão de design/UX, ao decidir ONDE lhe dar destaque (ver a
 * nota "SEXTA FATIA", abaixo, sobre o período ter o MESMO problema),
 * surgiu a dúvida sobre se a semântica certa é mesmo "escolher que
 * categorias INCLUIR" — talvez fizesse mais sentido "EXCLUIR" uma
 * categoria da análise (o caso de uso mais comum: tirar uma despesa
 * pontual grande que distorce o mês, não escolher uma a uma as que
 * ficam). Por decidir ainda — por isso o componente
 * (`FiltroCategoriasResumo`, em componentes/FiltroCategoriasResumo.tsx),
 * o endpoint (GET /resumo com `categorias_entradas`/`categorias_saidas`,
 * em app/routers/resumo.py) e os seus testes de backend
 * (test_resumo.py) ficam tal como estão, só DESLIGADOS desta página —
 * nada foi apagado, para não se perder trabalho já testado se a
 * semântica de inclusão vier a ser reaproveitada.
 *
 * SEXTA FATIA — FILTRO DE PERÍODO, ENTRE O SALDO TOTAL E O RESUMO: ao
 * contrário de "contas" (global — ver a nota "QUINTA FATIA", abaixo), o
 * período NUNCA afecta o Saldo Total (`_saldo_total` é sempre "quanto
 * tenho agora" — ver app/routers/resumo.py); só afecta o resumo de
 * Entradas/Saídas/Líquido (ver a nota "OITAVA FATIA", acima) e a
 * repartição por categoria, mais abaixo. Por isso o seu gatilho
 * (`SeletorPeriodo`, em componentes/SeletorPeriodo.tsx) fica numa linha
 * própria, CENTRADA, logo a seguir ao Saldo Total — depois do único
 * número que o período nunca muda, antes de tudo o resto, que muda
 * sempre. Já viveu embutido no próprio rótulo do mês, dentro do que era
 * o "cabecalhoFluxo" — ver a nota em SeletorPeriodo.tsx para o histórico
 * completo desta posição. TODA a lógica de escolha
 * (mostrador, "Mês específico"/"Data personalizada", aplicar ao vivo)
 * vive dentro de SeletorPeriodo.tsx, deliberadamente a MESMA de
 * ListaDatas (dentro de FiltroMovimentos.tsx) — a única diferença é
 * começar sempre em "Mês específico", já preenchido com o mês em vista,
 * em vez de "Todo o período" (que nem existe aqui: esta página é sempre
 * um resumo de ALGUM período concreto). Duas versões anteriores
 * desviaram-se disto, inventando uma escolha ENTRE "Mês actual" e outra
 * coisa; uma TERCEIRA versão chegou a mudar este gatilho de sítio (uma
 * linha própria logo a seguir ao Saldo Total) — revertida, por não ser
 * o que tinha sido pedido — ver caderno/decisoes.md.
 *
 * "periodoOverride" (`{ de, ate } | null`) — null é "ainda não foi
 * tocado, usa o mês corrente" (o estado inicial); um valor é o período
 * escolhido em SeletorPeriodo (`aoMudar`, um único callback — a
 * conversão de um mês para um intervalo, ou não, já foi feita lá
 * dentro). Mudar o período segue uma reposição de estado parecida com a
 * de mudarContas, mas com uma diferença DELIBERADA: `mudarPeriodo` NÃO
 * repõe "resumo" a null (só "erro", "expandido", "grupoAberto" e
 * "detalhes") — o seletor de período vive DENTRO da secção que só
 * existe quando "resumo" não é null; se o repusesse, a própria folha do
 * seletor desapareceria a meio da escolha (o ramo "pronto" trocaria para
 * o esqueleto). Os números antigos ficam visíveis (ligeiramente
 * desactualizados) até o novo pedido responder.
 *
 * QUINTA FATIA — FILTRO DE CONTAS É GLOBAL: o primeiro
 * dos filtros planeados (ver caderno/decisoes.md) — desselecionar contas
 * a incluir. Ao contrário do filtro de período (ver a nota "SEXTA
 * FATIA", acima) ou do de categoria/subcategoria (ver a nota "SÉTIMA
 * FATIA", acima) — que só afectam a secção do fluxo, mais abaixo, nunca
 * "saldo_total" — o filtro de CONTAS é GLOBAL: muda tanto o Saldo Total
 * como o fluxo. Por isso o seu gatilho (FiltroContas, em
 * componentes/FiltroContas.tsx) NÃO vive no conteúdo desta página: vive
 * na barra de topo mobile, passado como "acao" a useDefinirCabecalho
 * (revisão de design/UX — era antes uma pílula com texto, fisicamente
 * fora e acima das duas secções da página; passou a um botão-ícone na
 * própria barra, junto ao ☰, a mesma "ranhura de acção" que qualquer
 * outra página usa via `<CabecalhoPagina acao={...}>` — ver a nota
 * "GATILHO NA BARRA DE TOPO" em FiltroContas.tsx). Continua visível nos
 * três estados (a carregar, erro, pronto), agora por construção — a
 * barra de topo não depende do estado do resumo: mudar de filtro
 * não deve fazer o próprio filtro desaparecer enquanto os novos números
 * chegam.
 *
 * Mudar a selecção de contas RECARREGA o resumo (obterResumo(ids) e, se
 * algum grupo estiver aberto, também obterDetalheGrupo) e invalida tudo o
 * que dependia da selecção anterior: a cache de "detalhes" (um grupo
 * fetchado com um filtro diferente já não é válido), "grupoAberto" e
 * "expandido" — a mesma "simetria de reposição de estado" já usada em
 * mudarDirecao/alternarExpandido, agora também aqui (ver mudarContas).
 * "resumo" volta a null NO PRÓPRIO mudarContas, nunca dentro do efeito
 * que faz o pedido (um "setState" síncrono logo à entrada de um efeito
 * provoca uma renderização em cascata evitável), para mostrar de novo o
 * esqueleto (mesma lógica do carregamento inicial) — a mudança é
 * suficientemente grande (afecta a página toda) para justificá-lo.
 *
 * QUARTA FATIA — REMOVIDA nesta página (a subcategoria mudou-se para uma
 * página própria): chegou a existir aqui um acordeão — abrir uma barra
 * de categoria revelava, por baixo, a sua repartição por SUBCATEGORIA
 * (GET /resumo/categorias/{grupo_id}, em src/lib/resumo.ts). Saiu junto
 * com o controlo segmentado e o "Ver mais" (ver a nota "NONA FATIA",
 * acima) — o cartão de categorias, nesta página, só mostra os grupos,
 * nunca as suas subcategorias. A função `obterDetalheGrupo` voltou a
 * ser chamada, mais tarde, mas NUM SÍTIO diferente — a página de
 * detalhe `/resumo/categorias/:grupoId` (ver "DÉCIMA TERCEIRA FATIA",
 * acima), não de volta a este acordeão.
 *
 * TERCEIRA FATIA — CORREÇÃO DE DESENHO: a primeira versão desta página
 * mostrava a barra comparativa, as três linhas Entradas/Saídas/Líquido, E
 * as duas secções de categorias, uma por baixo da outra — o
 * verde/vermelho repetia-se em três sítios diferentes a dizer a mesma
 * coisa, e a página ficava confusa/comprida. Trocado por:
 *   - Sem barra comparativa (redundante com as barras de categoria).
 *   - Um CONTROLO SEGMENTADO "Entradas"/"Saídas" (à maneira do iOS) — SÓ
 *     A REPARTIÇÃO POR CATEGORIA DA DIRECÇÃO ACTIVA FICAVA VISÍVEL, ideia
 *     que continua válida hoje, embora o controlo em si tenha sido
 *     substituído (ver a nota "NONA FATIA", acima, pelo "+/−" preso ao
 *     cartão de categorias). Chegou a ter, por cima da lista, o total
 *     dessa direcção em destaque — removido quando Entradas/Saídas
 *     passaram a viver juntas acima da secção (ver a nota "OITAVA
 *     FATIA", acima): mostrar o mesmo número duas vezes na mesma página
 *     era redundante. O controlo em si chegou também a ser um par de
 *     abas num fundo cinzento (o mesmo padrão "pill" do resto da app);
 *     revisto para duas abas sem fundo, só um sublinhado sob a activa —
 *     mais um sítio onde o cinzento foi trocado por um sinal mais fino
 *     (ver a nota sobre o Saldo Total, acima) — antes de o controlo
 *     inteiro sair de cena.
 *   - Líquido passou a UMA LINHA fixa, junto ao título do mês (mais
 *     tarde mudou-se outra vez, para junto de Entradas/Saídas — ver a
 *     nota "OITAVA FATIA", acima) — não tem categorias próprias, não
 *     fazia sentido dentro do alternador.
 *   - Só as categorias maiores (já vêm ordenadas do backend) — o limite
 *     em si mudou de 5 (com "Ver mais"/"Ver menos" a expandir) para 3,
 *     sem forma de ver mais, na "NONA FATIA" acima — evita uma lista
 *     comprida de barras muito pequenas, pouco informativas.
 *   - A percentagem de cada categoria deixou de aparecer em TEXTO junto
 *     do valor ("-320,00 € · 64%", denso a mais) — fica só na LARGURA da
 *     própria barra, que já a mostra visualmente; repeti-la em texto era
 *     a mesma informação duas vezes.
 *   - Nas Saídas (total E cada categoria), o "-" à frente do valor foi
 *     removido (ver formatarSemSinal, abaixo) — dentro da aba "Saídas",
 *     já com a tinta vermelha, o sinal negativo só repete o que o
 *     contexto já diz. As Entradas nunca tiveram este problema (nunca
 *     são negativas).
 *
 * SEGUNDA FATIA: a repartição de Entradas e de Saídas por GRUPO de
 * categoria — uma barra horizontal por grupo, preenchida consoante a
 * "percentagem" já calculada pelo backend (ver GrupoResumo, em
 * src/lib/resumo.ts), com o valor em texto ao lado.
 *
 * PRIMEIRA FATIA: só os quatro números estáticos do resumo, vindos de
 * GET /resumo — Saldo Total (não depende de nenhum período) e
 * Entradas/Saídas/Líquido do mês atual, por omissão (o BACKEND decide o
 * período por omissão — ver a nota em app/routers/resumo.py; o mês
 * mostrado no título da secção vem sempre de "periodo_inicio", nunca
 * calculado aqui de novo). Os três filtros planeados (contas, período,
 * categoria/subcategoria) já existem — ver as notas "QUINTA FATIA",
 * "SEXTA FATIA" e "SÉTIMA FATIA", acima.
 *
 * Estados: a carregar (esqueleto), erro, e pronto — o mesmo padrão já
 * usado em ContaDetalhe.tsx.
 */

import { useCallback, useEffect, useState } from 'react'

import { Link } from 'react-router-dom'

import { useAuth } from '../auth/useAuth'
import { FiltroContas } from '../componentes/FiltroContas'
import { PontoCategoria } from '../componentes/PontoCategoria'
import { SeletorPeriodo } from '../componentes/SeletorPeriodo'
import { useDefinirCabecalho } from '../componentes/useCabecalho'
import { IconeChevronDireita, IconeMais, IconeMenos } from '../componentes/icones'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { listarContas, type Conta } from '../lib/contas'
import { indiceDeCor } from '../lib/corDeterministica'
import { ErroApi } from '../lib/http'
import { formatarDinheiro, formatarSemSinal } from '../lib/moedas'
import { obterResumo, type GrupoResumo, type Resumo } from '../lib/resumo'
import estilos from './Inicio.module.css'

// Quantas categorias mostrar no cartão — sem "Ver mais" (ver a nota
// "NONA FATIA" no topo do ficheiro): por agora é mesmo um limite, não um
// "por omissão"; o resto fica visível na página de detalhe
// (`/resumo/categorias`, ver "DÉCIMA TERCEIRA FATIA", no topo do
// ficheiro).
const LIMITE_CATEGORIAS = 4

type Direcao = 'entrada' | 'saida'

/** A data de hoje em "AAAA-MM-DD", no fuso local — passada ao
 *  SeletorPeriodo como limite superior dos seus campos (não se pode
 *  escolher um período no futuro). */
function hojeIso(): string {
  const hoje = new Date()
  const ano = hoje.getFullYear()
  const mes = String(hoje.getMonth() + 1).padStart(2, '0')
  const dia = String(hoje.getDate()).padStart(2, '0')
  return `${ano}-${mes}-${dia}`
}

/** Esqueleto mostrado enquanto o resumo carrega: o bloco do cartão de
 *  saldo, o título do mês, o cabeçalho do cartão de categorias e algumas
 *  barras — a pulsar devagar, o mesmo padrão usado nas outras páginas da
 *  app (ex.: Contas.tsx, ContaDetalhe.tsx). */
function Esqueleto() {
  return (
    <div role="status" aria-label="A carregar o resumo">
      <div className={`${estilos.cartaoSaldo} ${estilos.cartaoSaldoEsq}`}>
        <span className={`${estilos.esq} ${estilos.esqRotulo}`} />
        <span className={`${estilos.esq} ${estilos.esqSaldo}`} />
      </div>
      <span className={`${estilos.esq} ${estilos.esqTitulo}`} />
      <span className={`${estilos.esq} ${estilos.esqCartaoCategorias}`} />
      {[0, 1, 2].map((indice) => (
        <span key={indice} className={`${estilos.esq} ${estilos.esqBarraCategoria}`} />
      ))}
    </div>
  )
}

/** A barra EMPILHADA no topo do cartão de categorias: um segmento por
 *  categoria VISÍVEL (a mesma cor determinística de PontoCategoria,
 *  `indiceDeCor(grupo.nome)`, sobre o tom "--avatar-N-solido" — ver
 *  Inicio.module.css) e, se houver categorias escondidas pelo
 *  `LIMITE_CATEGORIAS`, um último segmento cinzento neutro
 *  (".segmentoOutras") com o que sobra — nunca com nome nem legenda
 *  própria (a mesma regra já usada nos mockups do gráfico circular:
 *  mostrar o resto tal como é, nunca inventar uma categoria "Outras").
 *  Substitui uma barra POR categoria (ver caderno/decisoes.md,
 *  "barra empilhada") — concentra toda a cor da lista num único
 *  elemento, ao estilo do Ecrã de Utilização da Apple. */
function BarraEmpilhada({ categorias, visiveis }: { categorias: GrupoResumo[]; visiveis: GrupoResumo[] }) {
  const somaVisiveis = visiveis.reduce((total, grupo) => total + Number(grupo.percentagem), 0)
  const haCategoriasEscondidas = categorias.length > visiveis.length
  const restante = haCategoriasEscondidas ? Math.max(0, 100 - somaVisiveis) : 0

  return (
    // "aria-hidden": puramente decorativa — a mesma proporção já se lê
    // em texto em cada linha da lista, logo abaixo (a percentagem, ao
    // lado do valor) — tal como o ponto de PontoCategoria, que segue a
    // mesma regra.
    <div className={estilos.barraEmpilhada} aria-hidden="true">
      {visiveis.map((grupo) => (
        <span
          key={grupo.grupo_id}
          className={estilos.categoriaBarraPreenchimento}
          data-cor={indiceDeCor(grupo.nome)}
          style={{ width: `${grupo.percentagem}%` }}
        />
      ))}
      {restante > 0 && <span className={estilos.segmentoOutras} style={{ width: `${restante}%` }} />}
    </div>
  )
}

/** Uma linha do cartão de categorias: o ponto de cor de PontoCategoria
 *  (a MESMA peça já usada nas linhas de movimento e nos seletores de
 *  categoria — cor determinística a partir do NOME DO GRUPO, só para
 *  identificar a categoria ao relance) + nome + valor. Já NÃO tem barra
 *  própria — essa proporção agora só se vê em BarraEmpilhada, acima, e
 *  em texto aqui: a percentagem por baixo do valor (não do nome — os
 *  dois números da mesma categoria lêem-se em coluna, alinhados à
 *  direita). */
function LinhaCategoria({
  grupo,
  moeda,
  cor,
}: {
  grupo: GrupoResumo
  moeda: string
  cor: Direcao
}) {
  return (
    <div className={estilos.linhaCategoria}>
      <PontoCategoria nomeGrupo={grupo.nome} tamanho="sm" />
      <span className={estilos.categoriaNome}>{grupo.nome}</span>
      <span className={estilos.categoriaValores}>
        <span className={estilos.categoriaValor}>
          {cor === 'entrada' ? formatarDinheiro(grupo.valor, moeda) : formatarSemSinal(grupo.valor, moeda)}
        </span>
        <span className={estilos.categoriaPercentagem}>{Math.round(Number(grupo.percentagem))}%</span>
      </span>
    </div>
  )
}

export function Inicio() {
  const { utilizador } = useAuth()
  const [resumo, setResumo] = useState<Resumo | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  // Qual direcção o cartão de categorias mostra — "saida" por omissão: é
  // a que mais se costuma consultar numa análise de gastos (o mesmo
  // ponto de partida da Revolut/N26, por exemplo).
  const [direcaoActiva, setDirecaoActiva] = useState<Direcao>('saida')
  // As contas do utilizador (para a lista de opções do FiltroContas) e a
  // selecção actual — [] é "todas" (sem filtro), o mesmo estado canónico
  // já usado em src/lib/filtrosMovimentos.ts. Carregadas à parte do
  // resumo: uma falha aqui não deve impedir a página de mostrar os
  // números (o filtro só fica invisível — ver FiltroContas.tsx).
  const [contas, setContas] = useState<Conta[]>([])
  const [contasSeleccionadas, setContasSeleccionadas] = useState<string[]>([])
  // O período escolhido no SeletorPeriodo — null é "ainda não foi
  // tocado" (usa o mês corrente, decidido pelo backend); um valor é o
  // mês escolhido, já resolvido num intervalo (ver a nota "SEXTA FATIA"
  // no topo do ficheiro).
  const [periodoOverride, setPeriodoOverride] = useState<{ de: string; ate: string } | null>(null)

  // Muda a selecção de contas do filtro global — ver a nota "QUINTA
  // FATIA" no topo do ficheiro. O próprio pedido do novo resumo corre no
  // useEffect mais abaixo, que reage a esta mudança de estado. Envolvida
  // em "useCallback" (deps vazias — só
  // usa "setters", estáveis por definição) para ter uma referência
  // ESTÁVEL entre renderizações: é passada a "FiltroContas" dentro do
  // objecto "acao" do efeito seguinte, e sem isso o efeito repetiria a
  // chamada a "definirCabecalho" em TODA a renderização (uma função
  // declarada de novo a cada vez nunca é "==" à anterior).
  const mudarContas = useCallback((ids: string[]) => {
    setContasSeleccionadas(ids)
    setResumo(null)
    setErro(null)
  }, [])

  // Repõe o cabeçalho partilhado (sem "voltar") — ver a nota "DESENHO
  // DELIBERADAMENTE DIFERENTE" no topo do ficheiro sobre porquê esta
  // página não usa <CabecalhoPagina> para o seu título visível. A "acao"
  // é o FiltroContas — ver a nota "QUINTA FATIA": em mobile, DENTRO da
  // moldura da app, vive na barra de topo, não no conteúdo. "eMobile"
  // replica a MESMA condição que <CabecalhoPagina> usa internamente
  // (useMediaQuery + "definirCabecalho" truthy, ver CabecalhoPagina.tsx)
  // — sem ela, em desktop (ou num teste isolado, sem <CabecalhoProvider>
  // por cima) o botão de Contas não apareceria em lado nenhum: só a
  // barra de topo mobile lê "acao" do contexto, e esta página nunca
  // desenha esse botão no seu próprio conteúdo.
  const eMobile = useMediaQuery('(max-width: 768px)')
  const definirCabecalho = useDefinirCabecalho()
  const filtroContasNaBarraDeTopo = eMobile && Boolean(definirCabecalho)
  useEffect(() => {
    definirCabecalho?.({
      titulo: 'Início',
      acao: filtroContasNaBarraDeTopo ? (
        <FiltroContas contas={contas} selecionadas={contasSeleccionadas} aoMudar={mudarContas} />
      ) : undefined,
    })
  }, [definirCabecalho, filtroContasNaBarraDeTopo, contas, contasSeleccionadas, mudarContas])

  // Carrega as contas uma única vez — não dependem do filtro nem do
  // resumo (é a própria lista de OPÇÕES do filtro). Falha em silêncio: o
  // FiltroContas simplesmente não aparece sem elas (ver a nota acima),
  // nunca impede o resto da página de funcionar.
  useEffect(() => {
    let activo = true
    listarContas()
      .then((cs) => {
        if (activo) setContas(cs)
      })
      .catch(() => {})
    return () => {
      activo = false
    }
  }, [])

  // Repete sempre que "contasSeleccionadas" ou "periodoOverride" muda —
  // os "mudar*" correspondentes já repõem "resumo"/"erro" a null ANTES
  // desta mudança (repor estado aqui dentro, de forma síncrona, é o
  // padrão que o React desaconselha para efeitos: um "setState" que
  // corre logo ao entrar no efeito provoca uma segunda renderização em
  // cascata, evitável ao fazê-lo já no PRÓPRIO evento que muda a
  // dependência).
  useEffect(() => {
    let activo = true
    obterResumo({
      contas: contasSeleccionadas,
      de: periodoOverride?.de,
      ate: periodoOverride?.ate,
    })
      .then((r) => {
        if (activo) setResumo(r)
      })
      .catch((e) => {
        if (activo) {
          setErro(e instanceof ErroApi ? e.message : 'Não foi possível carregar o resumo.')
        }
      })
    return () => {
      activo = false
    }
  }, [contasSeleccionadas, periodoOverride])

  // Muda qual direcção o cartão de categorias mostra — já não reinicia
  // mais nada (nem "Ver mais" nem grupo aberto existem: ver a nota "NONA
  // FATIA" no topo do ficheiro).
  function mudarDirecao(nova: Direcao) {
    setDirecaoActiva(nova)
  }

  // Muda o período escolhido no SeletorPeriodo (que já resolveu, lá
  // dentro, um mês ou um intervalo directo num par [de, ate] — ver
  // SeletorPeriodo.tsx). NÃO repõe "resumo" a null, ao contrário de
  // mudarContas: o seletor de período vive DENTRO da secção que só
  // existe quando "resumo" não é null (é o próprio rótulo do mês) — se
  // "resumo" fosse a null aqui, a secção inteira desapareceria a meio da
  // escolha, levando a folha do seletor consigo. Os números antigos
  // ficam visíveis até o novo pedido responder.
  function escolherPeriodo(de: string, ate: string) {
    setPeriodoOverride({ de, ate })
    setErro(null)
  }

  // "?? 'EUR'" só entra em jogo enquanto "utilizador" ainda é null — na
  // app real isto nunca acontece (esta rota vive sempre dentro de
  // RotaProtegida); o alçapão existe só para um teste que monte esta
  // página sozinha, sem essa guarda (o mesmo padrão de Contas.tsx).
  const moeda = utilizador?.moeda_principal ?? 'EUR'

  const categorias = resumo
    ? direcaoActiva === 'entrada'
      ? resumo.categorias_entradas
      : resumo.categorias_saidas
    : []
  const categoriasVisiveis = categorias.slice(0, LIMITE_CATEGORIAS)

  // O link do título "Categorias" leva o MESMO período que esta página
  // está a mostrar (nunca recalculado de novo lá — "resumo.periodo_*" já
  // é o intervalo resolvido, mês actual por omissão ou o escolhido em
  // SeletorPeriodo) e a MESMA selecção de contas, para a página de
  // detalhe continuar a mostrar exactamente o que se via aqui. Sem
  // "contas" no URL quando a selecção é "todas" (o estado por omissão),
  // tal como filtrosMovimentos.ts evita parâmetros redundantes.
  const parametrosCategorias = new URLSearchParams()
  if (resumo) {
    parametrosCategorias.set('de', resumo.periodo_inicio)
    parametrosCategorias.set('ate', resumo.periodo_fim)
  }
  if (contasSeleccionadas.length > 0) {
    parametrosCategorias.set('contas', contasSeleccionadas.join(','))
  }
  const linkCategorias = `/resumo/categorias?${parametrosCategorias.toString()}`

  return (
    <div>
      {/* Só quando NÃO vai para a barra de topo (desktop, ou um teste
          isolado sem <CabecalhoProvider> por cima — ver a nota acima) —
          nos três estados (erro/esqueleto/pronto), tal como o próprio
          botão da barra de topo também não depende do resumo. Alinhado à
          direita, com margem própria por baixo — sem isto, o botão
          ficava encostado (quase sobreposto) ao cartão do Saldo Total, à
          esquerda, por não ter nenhum espaçamento nem alinhamento
          próprios (só os que o gatilho tem para SI mesmo — largura e
          altura fixas, sem margem). */}
      {!filtroContasNaBarraDeTopo && (
        <div className={estilos.acaoDesktop}>
          <FiltroContas contas={contas} selecionadas={contasSeleccionadas} aoMudar={mudarContas} />
        </div>
      )}

      {erro ? (
        <p role="alert" className={estilos.nota}>
          {erro}
        </p>
      ) : !resumo ? (
        <Esqueleto />
      ) : (
        <>
          {/* Saldo Total: o herói da página, sem cartão à volta — não
              depende de nenhum período. */}
          <div className={estilos.cartaoSaldo}>
            <span className={estilos.rotulo}>Saldo total</span>
            <span
              className={
                Number(resumo.saldo_total) < 0
                  ? `${estilos.saldo} ${estilos.negativo}`
                  : estilos.saldo
              }
            >
              {formatarDinheiro(resumo.saldo_total, moeda)}
            </span>
          </div>

          {/* O mês vem de "periodo_inicio"/"periodo_fim" (ex.:
              "2026-09-01"/"2026-09-18" -> "Setembro 2026") — nunca
              recalculado aqui: é o BACKEND que decide o período (mês
              actual por omissão, ou o escolhido em SeletorPeriodo — ver
              a nota "SEXTA FATIA" no topo do ficheiro); o próprio
              SeletorPeriodo deriva o texto do rótulo a partir de
              "de"/"ate", esta página só lhos passa. Fica ENTRE o Saldo
              Total e o resumo de Entradas/Saídas/Líquido — depois do
              único número que NUNCA muda com o período (o Saldo Total),
              e antes de tudo o que muda (o resumo, a repartição por
              categoria, mais abaixo). O <h2> mantém o título como
              cabeçalho de secção (para quem navega por cabeçalhos) — o
              SeletorPeriodo, lá dentro, é só o botão tocável. */}
          <h2 className={estilos.tituloFluxo}>
            <SeletorPeriodo
              de={resumo.periodo_inicio}
              ate={resumo.periodo_fim}
              hojeIso={hojeIso()}
              aoMudar={escolherPeriodo}
            />
          </h2>

          {/* Entradas/Saídas/Líquido, numa única linha com duas réguas
              finas (cima/baixo) — logo a seguir ao Saldo Total, fora da
              secção do fluxo (a mesma razão de posição de FiltroContas:
              não depende de qual direcção está activa no alternador
              "+/−" do cartão de categorias, mais abaixo — mostra sempre
              as duas AO MESMO TEMPO, um resumo, não a repartição por
              categoria). SEM contorno completo (sem lados, sem cantos
              arredondados) — já experimentámos um cartão com contorno
              para isto e foi revertido por parecer voltar ao "modo
              caixa", logo a seguir a tirarmos o contorno ao Saldo Total
              (ver caderno/decisoes.md); duas réguas finas é o mesmo
              recurso visual, mais leve. Substitui DOIS sítios que
              mostravam isto antes:
              "Líquido" ao lado do título do mês, e o total da direcção
              activa por cima da lista de categorias — os dois ficariam
              repetidos com este resumo já visível aqui. */}
          <div className={estilos.resumoFluxo}>
            <div className={estilos.resumoColuna}>
              <span className={estilos.resumoRotulo}>Entradas</span>
              <span className={`${estilos.resumoValor} ${estilos.positivo}`}>
                {formatarDinheiro(resumo.entradas, moeda)}
              </span>
            </div>
            <div className={estilos.resumoColuna}>
              <span className={estilos.resumoRotulo}>Saídas</span>
              <span className={`${estilos.resumoValor} ${estilos.negativo}`}>
                {formatarSemSinal(resumo.saidas, moeda)}
              </span>
            </div>
            <div className={estilos.resumoColuna}>
              <span className={estilos.resumoRotulo}>Líquido</span>
              <span
                className={
                  Number(resumo.liquido) < 0
                    ? `${estilos.resumoValor} ${estilos.negativo}`
                    : `${estilos.resumoValor} ${estilos.positivo}`
                }
              >
                {formatarDinheiro(resumo.liquido, moeda)}
              </span>
            </div>
          </div>

          <section className={estilos.seccao}>
            {/* NONA FATIA — CARTÃO DE CATEGORIAS, COM UM "+/−" LOCAL A
                SUBSTITUIR O CONTROLO SEGMENTADO: ver a nota no topo do
                ficheiro para a razão da mudança (evitar "Entradas"/
                "Saídas" repetido). O título "Categorias" é agora um
                LINK para `/resumo/categorias` (ver "DÉCIMA TERCEIRA
                FATIA", no topo do ficheiro) — o contorno e a seta já
                preparavam este destino antes mesmo de ele existir. O
                resto do cartão continua sem reagir ao toque (só o
                alternador e o título, agora, respondem). */}
            <div className={estilos.cartaoCategorias}>
              <div className={estilos.cartaoCategoriasCabecalho}>
                <h2 className={estilos.cartaoCategoriasTitulo}>
                  <Link to={linkCategorias} className={estilos.cartaoCategoriasLink}>
                    Categorias
                    <IconeChevronDireita tamanho={16} />
                  </Link>
                </h2>
                <div className={estilos.miniToggle} role="group" aria-label="Direcção">
                  <button
                    type="button"
                    className={
                      direcaoActiva === 'entrada'
                        ? `${estilos.miniToggleBotao} ${estilos.miniToggleActivo} ${estilos.miniToggleEntrada}`
                        : estilos.miniToggleBotao
                    }
                    aria-pressed={direcaoActiva === 'entrada'}
                    aria-label="Entradas"
                    onClick={() => mudarDirecao('entrada')}
                  >
                    <IconeMais tamanho={14} traco={2.6} />
                  </button>
                  <button
                    type="button"
                    className={
                      direcaoActiva === 'saida'
                        ? `${estilos.miniToggleBotao} ${estilos.miniToggleActivo}`
                        : estilos.miniToggleBotao
                    }
                    aria-pressed={direcaoActiva === 'saida'}
                    aria-label="Saídas"
                    onClick={() => mudarDirecao('saida')}
                  >
                    <IconeMenos tamanho={14} traco={2.6} />
                  </button>
                </div>
              </div>

              {categorias.length === 0 ? (
                <p className={estilos.semCategorias}>
                  Sem {direcaoActiva === 'entrada' ? 'entradas' : 'saídas'} este mês.
                </p>
              ) : (
                <>
                  <BarraEmpilhada categorias={categorias} visiveis={categoriasVisiveis} />
                  <div className={estilos.listaCategorias}>
                    {categoriasVisiveis.map((grupo) => (
                      <LinhaCategoria key={grupo.grupo_id} grupo={grupo} moeda={moeda} cor={direcaoActiva} />
                    ))}
                  </div>
                </>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  )
}
