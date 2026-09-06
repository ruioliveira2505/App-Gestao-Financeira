/*
 * "EDITAR MOVIMENTO" (/movimentos/:id/editar)
 * ==========================================
 *
 * Obtém o movimento pelo id do endereço, mostra o MovimentoFormulario
 * preenchido, e ao guardar chama o endpoint PATCH e volta à lista.
 *
 * APRESENTAÇÃO: uma folha (o componente Folha, direcao="baixo"), IGUAL ao
 * "Novo movimento" — sobe de baixo em telemóvel, diálogo ao centro em
 * ecrã largo; "X" à esquerda, "✓" à direita para guardar. É a folha de
 * FUNDO do fluxo de edição: fornece o ContextoFolha, por isso arrastar
 * para baixo o seletor de conta (aberto por cima) faz as duas folhas
 * saírem juntas.
 *
 * SAIR (guardar OU fechar): recua no histórico — a lista está lá, e assim
 * não fica /movimentos/:id/editar empilhado a ser reaberto pelo "recuar"
 * seguinte. Só quando a rota foi aberta diretamente pelo URL é que se vai
 * para "/movimentos" como recurso. Ao contrário de ContaEditar, não há um
 * detalhe para onde voltar (um movimento não tem página de detalhe — ver
 * a nota em Movimentos.tsx), por isso o recurso é sempre a lista.
 *
 * É também aqui, no fim, que fica o "Eliminar movimento" — a acção
 * destrutiva vive no ecrã de edição (à maneira do iOS), num cartão a
 * vermelho e protegida por um "action sheet" de confirmação. Ao eliminar,
 * volta-se à lista.
 */

import { useEffect, useMemo, useState } from 'react'

import { useLocation, useNavigate, useParams } from 'react-router-dom'

import { Confirmacao } from '../componentes/Confirmacao'
import { MovimentoFormulario, type DadosMovimento } from '../componentes/MovimentoFormulario'
import { ContextoFolha } from '../componentes/contextoFolha'
import { Folha } from '../componentes/Folha'
import { IconeCheck, IconeFechar } from '../componentes/icones'
import { ErroApi } from '../lib/http'
import { apagarMovimento, editarMovimento, obterMovimento, type Movimento } from '../lib/movimentos'
import estilos from './MovimentoEditar.module.css'

// "id" do <form> — o "✓" (fora do <form>) submete-o via <button form={ID}>.
const ID_FORM = 'form-editar-movimento'

export function MovimentoEditar() {
  const { id } = useParams<{ id: string }>()
  const navegar = useNavigate()
  const localizacao = useLocation()

  // Para onde ir ao sair da edição: recuar no histórico; só se a rota foi
  // aberta diretamente pelo URL é que se vai para a lista como recurso.
  const destino: string | number = localizacao.key === 'default' ? '/movimentos' : -1

  const [movimento, setMovimento] = useState<Movimento | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [aSubmeter, setASubmeter] = useState(false)
  const [valido, setValido] = useState(false)
  const [aConfirmarEliminar, setAConfirmarEliminar] = useState(false)
  const [aEliminar, setAEliminar] = useState(false)

  // Coordenação com a folha do seletor de conta aberta por cima desta:
  // enquanto é arrastada para baixo, "espelhoY" espelha o deslocamento e
  // "aEspelhar" diz que segue o dedo; ao largar para lá do limiar,
  // "aAbandonar" faz esta folha sair também. Igual ao "Novo movimento".
  const [espelhoY, setEspelhoY] = useState(0)
  const [aEspelhar, setAEspelhar] = useState(false)
  const [aAbandonar, setAAbandonar] = useState(false)

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

  useEffect(() => {
    if (!id) return
    let activo = true
    obterMovimento(id)
      .then((m) => {
        if (activo) setMovimento(m)
      })
      .catch((e) => {
        if (activo) {
          setErro(e instanceof ErroApi ? e.message : 'Não foi possível carregar o movimento.')
        }
      })
    return () => {
      activo = false
    }
  }, [id])

  function sairDaEdicao() {
    if (typeof destino === 'number') navegar(destino)
    else navegar(destino)
  }

  async function guardar(dados: DadosMovimento, fechar: () => void) {
    if (!id) return
    await editarMovimento(id, dados)
    // "fechar" anima a saída da folha e só depois "aoDispensar" navega.
    fechar()
  }

  async function eliminar() {
    if (!id) return
    setAEliminar(true)
    try {
      await apagarMovimento(id)
      navegar('/movimentos')
    } catch {
      setAEliminar(false)
      setAConfirmarEliminar(false)
      setErro('Não foi possível eliminar o movimento.')
    }
  }

  if (erro) {
    return (
      <p role="alert" className={estilos.nota}>
        {erro}
      </p>
    )
  }
  if (!movimento) {
    return <p className={estilos.nota}>A carregar…</p>
  }

  return (
    <>
      <ContextoFolha.Provider value={contextoFolha}>
        <Folha
          titulo="Editar movimento"
          direcao="baixo"
          varianteFechar="circulo"
          iconeFechar={<IconeFechar tamanho={22} />}
          rotuloFechar="Fechar"
          deslocamentoExterno={espelhoY}
          aSeguirExterno={aEspelhar}
          aExternamenteASair={aAbandonar}
          aoDispensar={sairDaEdicao}
          acao={
            <button
              type="submit"
              form={ID_FORM}
              className={estilos.botaoConfirmar}
              disabled={aSubmeter || !valido}
              aria-label="Guardar alterações"
            >
              <IconeCheck tamanho={22} />
            </button>
          }
        >
          {(fechar) => (
            <div className={estilos.formulario}>
              <MovimentoFormulario
                inicial={movimento}
                aoGuardar={(dados) => guardar(dados, fechar)}
                idFormulario={ID_FORM}
                botaoNoRodape={false}
                aoMudarSubmissao={setASubmeter}
                aoMudarValidez={setValido}
              />
              <div className={estilos.cartaoEliminar}>
                <button
                  type="button"
                  className={estilos.linhaEliminar}
                  onClick={() => setAConfirmarEliminar(true)}
                >
                  Eliminar movimento
                </button>
              </div>
            </div>
          )}
        </Folha>
      </ContextoFolha.Provider>

      {aConfirmarEliminar && (
        <Confirmacao
          titulo="Eliminar movimento"
          textoConfirmar="Eliminar"
          aConfirmar={aEliminar}
          aoConfirmar={eliminar}
          aoCancelar={() => setAConfirmarEliminar(false)}
        >
          <p>O movimento é apagado e deixa de contar para o saldo da conta.</p>
          <p>Esta ação é irreversível.</p>
        </Confirmacao>
      )}
    </>
  )
}
