/*
 * "NOVO MOVIMENTO" (/movimentos/novo) — FOLHA QUE SOBE DE BAIXO
 * ================================================================
 *
 * A mesma concha de ContaNova (o componente Folha, direcao="baixo") — ver
 * lá a explicação completa do mecanismo. Aqui só se descreve o que é
 * próprio desta rota.
 *
 * O seletor de "Conta" (dentro de MovimentoFormulario) é um CampoSelecao,
 * que em mobile abre outra folha por cima desta — por isso, tal como
 * ContaNova, esta rota fornece o ContextoFolha: enquanto essa folha é
 * arrastada para baixo, o deslocamento é espelhado aqui para as duas
 * descerem juntas, e um arrasto para lá do limiar abandona o fluxo
 * inteiro.
 *
 * AO CONTRÁRIO DE ContaNova: não há aqui um destino diferente consoante o
 * resultado. ContaNova, ao criar com sucesso, vai para o DETALHE da conta
 * criada; um movimento não tem página de detalhe (ver a nota em
 * Movimentos.tsx) — por isso sair desta folha, com ou sem sucesso, leva
 * sempre ao mesmo sítio: a lista de movimentos (ou, se a rota foi aberta
 * directamente pelo URL, sem histórico — location.key === 'default' — o
 * "voltar" do sistema, tal como em toda a aplicação).
 */

import { useMemo, useRef, useState } from 'react'

import { useLocation, useNavigate } from 'react-router-dom'

import { Folha } from '../componentes/Folha'
import { ContextoFolha } from '../componentes/contextoFolha'
import { MovimentoFormulario, type DadosMovimento } from '../componentes/MovimentoFormulario'
import { IconeCheck, IconeFechar } from '../componentes/icones'
import { criarMovimento } from '../lib/movimentos'
import estilos from './MovimentoNovo.module.css'

const ID_FORM = 'form-novo-movimento'

export function MovimentoNovo() {
  const navegar = useNavigate()
  const localizacao = useLocation()

  const [aSubmeter, setASubmeter] = useState(false)
  const [valido, setValido] = useState(false)

  const [espelhoY, setEspelhoY] = useState(0)
  const [aEspelhar, setAEspelhar] = useState(false)
  const [aAbandonar, setAAbandonar] = useState(false)

  // Para onde ir ao sair, com ou sem sucesso — ver a nota no topo do
  // ficheiro. Sem histórico dentro da app, "/movimentos" como recurso;
  // caso contrário, recua (navigate(-1)).
  const destino = useRef<string | number>(
    localizacao.key === 'default' ? '/movimentos' : -1,
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

  async function guardar(dados: DadosMovimento, fechar: () => void) {
    await criarMovimento(dados)
    fechar()
  }

  return (
    <ContextoFolha.Provider value={contextoFolha}>
      <Folha
        titulo="Novo movimento"
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
            aria-label="Criar movimento"
          >
            <IconeCheck tamanho={22} />
          </button>
        }
      >
        {(fechar) => (
          <div className={estilos.formulario}>
            <MovimentoFormulario
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
