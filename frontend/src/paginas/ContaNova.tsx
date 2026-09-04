/*
 * "NOVA CONTA" (/contas/nova) — FOLHA QUE SOBE DE BAIXO
 * ===================================================
 *
 * Esta rota apresenta-se como um modal em "folha" (o componente Folha),
 * com direcao="baixo": sobe de baixo do ecrã e para um pouco abaixo do
 * topo, com a página esbatida por cima; em ecrã largo é um diálogo
 * centrado. Toda a mecânica da concha — arrasto para descartar, animação
 * de saída, armadilha de foco, Escape, toque no fundo — vive no Folha; a
 * ContaNova só trata do que é seu: o formulário e a navegação.
 *
 * É a folha DE FUNDO do fluxo de criação: a partir do formulário abre-se
 * outra folha (a da moeda) por cima desta. Por isso a ContaNova fornece o
 * ContextoFolha — enquanto a folha da moeda é arrastada para baixo, o seu
 * deslocamento é espelhado aqui ("espelhoY" / "aEspelhar") para ESTA folha
 * descer ao mesmo tempo; ao largar para lá do limiar, "aAbandonar" faz
 * esta folha sair também, e no fim navega-se para a página Contas.
 *
 * O URL mantém-se (/contas/nova), por isso o "voltar" do sistema e um link
 * direto continuam a funcionar. Ao SAIR sem criar, comporta-se como o "‹"
 * das páginas de detalhe: recua no histórico (navigate(-1)); só quando a
 * rota foi aberta diretamente pelo URL (location.key === 'default') é que
 * vai para "/contas" como recurso. Ao CRIAR com sucesso, vai para o
 * detalhe da conta acabada de criar. Para onde ir a seguir é guardado numa
 * "ref" ("destino"), lida no fim da animação de saída.
 *
 * O botão "✓" do cabeçalho (a prop "acao" do Folha) é a acção principal:
 * vive FORA do <form> e submete-o via <button type="submit" form={ID_FORM}>.
 * Fica cinzento e não clicável enquanto faltam campos obrigatórios — o
 * ContaFormulario avisa da validez por "aoMudarValidez" e da submissão em
 * curso por "aoMudarSubmissao".
 */

import { useMemo, useRef, useState } from 'react'

import { useLocation, useNavigate } from 'react-router-dom'

import { Folha } from '../componentes/Folha'
import { ContextoFolha } from '../componentes/contextoFolha'
import { ContaFormulario, type DadosConta } from '../componentes/ContaFormulario'
import { IconeCheck, IconeFechar } from '../componentes/icones'
import { criarConta } from '../lib/contas'
import estilos from './ContaNova.module.css'

// "id" do <form> — o "✓" do cabeçalho submete-o com <button form={ID_FORM}>.
const ID_FORM = 'form-nova-conta'

export function ContaNova() {
  const navegar = useNavigate()
  const localizacao = useLocation()

  // A submissão do formulário está a decorrer? (vem do ContaFormulario) —
  // desativa o "✓" durante o pedido.
  const [aSubmeter, setASubmeter] = useState(false)
  // Os campos obrigatórios estão preenchidos? (vem do ContaFormulario) — o
  // "✓" só fica ativo (preto e clicável) quando sim.
  const [valido, setValido] = useState(false)

  // Coordenação com a folha da moeda (aberta por cima desta): enquanto ela
  // é arrastada para baixo, "espelhoY" espelha o seu deslocamento e
  // "aEspelhar" diz que está a seguir o dedo (sem suavização); ao largar
  // para lá do limiar, "aAbandonar" faz esta folha sair também.
  const [espelhoY, setEspelhoY] = useState(0)
  const [aEspelhar, setAEspelhar] = useState(false)
  const [aAbandonar, setAAbandonar] = useState(false)

  // Para onde navegar quando a Folha acabar de sair. Por omissão, sair do
  // fluxo (recuar); ao criar com sucesso, o detalhe da nova conta.
  const destino = useRef<string | number>(
    localizacao.key === 'default' ? '/contas' : -1,
  )

  const contextoFolha = useMemo(
    () => ({
      espelharDeslocamento: (y: number) => {
        setAEspelhar(true)
        setEspelhoY(y > 0 ? y : 0)
      },
      concluirArrasto: (descartar: boolean) => {
        setAEspelhar(false)
        if (descartar) setAAbandonar(true)
        else setEspelhoY(0)
      },
    }),
    [],
  )

  function aoSair() {
    if (typeof destino.current === 'number') navegar(destino.current)
    else navegar(destino.current)
  }

  async function guardar(
    dados: DadosConta,
    fechar: () => void,
  ) {
    const conta = await criarConta(dados)
    destino.current = `/contas/${conta.id}`
    fechar()
  }

  return (
    <ContextoFolha.Provider value={contextoFolha}>
      <Folha
        titulo="Nova conta"
        direcao="baixo"
        varianteFechar="circulo"
        iconeFechar={<IconeFechar tamanho={22} />}
        rotuloFechar="Fechar"
        deslocamentoExterno={espelhoY}
        aSeguirExterno={aEspelhar}
        aExternamenteASair={aAbandonar}
        aoDispensar={aoSair}
        acao={
          <button
            type="submit"
            form={ID_FORM}
            className={estilos.botaoConfirmar}
            disabled={aSubmeter || !valido}
            aria-label="Criar conta"
          >
            <IconeCheck tamanho={22} />
          </button>
        }
      >
        {(fechar) => (
          <div className={estilos.formulario}>
            <ContaFormulario
              aoGuardar={(dados) => guardar(dados, fechar)}
              idFormulario={ID_FORM}
              botaoNoRodape={false}
              aoMudarSubmissao={setASubmeter}
              aoMudarValidez={setValido}
            />
          </div>
        )}
      </Folha>
    </ContextoFolha.Provider>
  )
}
