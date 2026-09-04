/*
 * "EDITAR CONTA" (/contas/:id/editar)
 * ==================================
 *
 * Obtém a conta pelo id do endereço, mostra o ContaFormulario preenchido
 * (a ficha da âncora não aparece em edição — o PATCH não lhe toca), e ao
 * guardar chama o endpoint PATCH (só os campos descritivos) e volta ao
 * detalhe.
 *
 * APRESENTAÇÃO: uma folha (o componente Folha, direcao="baixo"), IGUAL ao
 * "Nova conta" — sobe de baixo em telemóvel, diálogo ao centro em ecrã
 * largo; "X" à esquerda, "✓" à direita para guardar. É a folha de FUNDO
 * do fluxo de edição: fornece o ContextoFolha, por isso arrastar para
 * baixo um seletor (moeda/banco/tipo) aberto por cima faz as duas folhas
 * saírem juntas.
 *
 * SAIR (guardar OU fechar): recua no histórico — o detalhe está lá, e
 * assim não fica /contas/:id/editar empilhado a ser reaberto pelo "recuar"
 * seguinte. Só quando a rota foi aberta diretamente pelo URL é que se vai
 * para o detalhe como recurso. É a mesma lógica do "Nova conta".
 *
 * É também aqui, no fim, que fica o "Eliminar conta" — a acção destrutiva
 * vive no ecrã de edição (à maneira do iOS), num cartão a vermelho e
 * protegida por um "action sheet" de confirmação. Ao eliminar, volta-se à
 * lista de contas.
 */

import { useEffect, useMemo, useState } from 'react'

import { useLocation, useNavigate, useParams } from 'react-router-dom'

import { Confirmacao } from '../componentes/Confirmacao'
import { ContaFormulario, type DadosConta } from '../componentes/ContaFormulario'
import { ContextoFolha } from '../componentes/contextoFolha'
import { Folha } from '../componentes/Folha'
import { IconeCheck, IconeFechar } from '../componentes/icones'
import { apagarConta, editarConta, obterConta, type Conta } from '../lib/contas'
import { ErroApi } from '../lib/http'
import estilos from './ContaEditar.module.css'

// "id" do <form> — o "✓" (fora do <form>) submete-o via <button form={ID}>.
const ID_FORM = 'form-editar-conta'

export function ContaEditar() {
  const { id } = useParams<{ id: string }>()
  const navegar = useNavigate()
  const localizacao = useLocation()

  // Para onde ir ao sair da edição: recuar no histórico; só se a rota foi
  // aberta diretamente pelo URL é que se vai para o detalhe como recurso.
  const destino: string | number =
    localizacao.key === 'default' ? `/contas/${id}` : -1

  const [conta, setConta] = useState<Conta | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [aSubmeter, setASubmeter] = useState(false)
  const [valido, setValido] = useState(false)
  const [aConfirmarEliminar, setAConfirmarEliminar] = useState(false)
  const [aEliminar, setAEliminar] = useState(false)

  // Coordenação com a folha de um seletor (moeda/banco/tipo) aberto por
  // cima desta: enquanto é arrastado para baixo, "espelhoY" espelha o seu
  // deslocamento e "aEspelhar" diz que segue o dedo; ao largar para lá do
  // limiar, "aAbandonar" faz esta folha sair também. Igual ao "Nova conta".
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
    obterConta(id)
      .then((c) => {
        if (activo) setConta(c)
      })
      .catch((e) => {
        if (activo) {
          setErro(e instanceof ErroApi ? e.message : 'Não foi possível carregar a conta.')
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

  async function guardar(dados: DadosConta, fechar: () => void) {
    if (!id) return
    await editarConta(id, {
      nome: dados.nome,
      banco: dados.banco,
      tipo: dados.tipo,
      moeda: dados.moeda,
    })
    // "fechar" anima a saída da folha e só depois "aoDispensar" navega.
    fechar()
  }

  async function eliminar() {
    if (!id) return
    setAEliminar(true)
    try {
      await apagarConta(id)
      navegar('/contas')
    } catch {
      setAEliminar(false)
      setAConfirmarEliminar(false)
      setErro('Não foi possível eliminar a conta.')
    }
  }

  if (erro) {
    return (
      <p role="alert" className={estilos.nota}>
        {erro}
      </p>
    )
  }
  if (!conta) {
    return <p className={estilos.nota}>A carregar…</p>
  }

  return (
    <>
      <ContextoFolha.Provider value={contextoFolha}>
        <Folha
          titulo="Editar conta"
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
              <ContaFormulario
                inicial={conta}
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
                  Eliminar conta
                </button>
              </div>
            </div>
          )}
        </Folha>
      </ContextoFolha.Provider>

      {aConfirmarEliminar && (
        <Confirmacao
          titulo="Eliminar conta"
          textoConfirmar="Eliminar"
          aConfirmar={aEliminar}
          aoConfirmar={eliminar}
          aoCancelar={() => setAConfirmarEliminar(false)}
        >
          <p>A conta e os movimentos associados serão apagados.</p>
          <p>Esta ação é irreversível.</p>
        </Confirmacao>
      )}
    </>
  )
}
