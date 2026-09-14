/*
 * "NOVO GRUPO" (/categorias/novo) — FOLHA QUE SOBE DE BAIXO
 * ============================================================
 *
 * A mesma concha de ContaNova/MovimentoNovo — ver lá a explicação completa
 * do mecanismo (Folha, direcao="baixo", ContextoFolha para a folha aninhada
 * do seletor de Direção). Aqui só o que é próprio desta rota: dois campos,
 * Nome e Direção — é a ÚNICA vez que se escolhe a direção de uma categoria;
 * uma subcategoria (criada dentro de um grupo, em CategoriaGrupo.tsx)
 * herda-a sempre do grupo onde nasce, sem a voltar a perguntar.
 *
 * Sair (criar OU fechar): sempre para "/categorias" como recurso, ou a
 * recuar no histórico se a rota tiver sido alcançada por navegação dentro
 * da app — a mesma heurística "location.key === 'default'" já usada em
 * toda a aplicação.
 */

import { useMemo, useRef, useState } from 'react'

import { useLocation, useNavigate } from 'react-router-dom'

import { CaixaErro } from '../componentes/CaixaErro'
import { CampoSelecao } from '../componentes/CampoSelecao'
import { CampoTexto } from '../componentes/CampoTexto'
import { ContextoFolha } from '../componentes/contextoFolha'
import { Folha } from '../componentes/Folha'
import { Formulario } from '../componentes/Formulario'
import { IconeCheck, IconeFechar } from '../componentes/icones'
import { criarGrupo, type Direcao } from '../lib/categorias'
import { ErroApi } from '../lib/http'
import estilos from './CategoriaNova.module.css'

const ID_FORM = 'form-novo-grupo'
const MENSAGEM_ERRO_GENERICA = 'Não foi possível guardar. Tenta novamente.'

export function CategoriaNova() {
  const navegar = useNavigate()
  const localizacao = useLocation()

  const [nome, setNome] = useState('')
  const [direcao, setDirecao] = useState<Direcao>('saida')
  const [erro, setErro] = useState<string | null>(null)
  const [aSubmeter, setASubmeter] = useState(false)

  const [espelhoY, setEspelhoY] = useState(0)
  const [aEspelhar, setAEspelhar] = useState(false)
  const [aAbandonar, setAAbandonar] = useState(false)

  const destino = useRef<string | number>(
    localizacao.key === 'default' ? '/categorias' : -1,
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

  const valido = nome.trim() !== ''

  function aoSair() {
    navegar(destino.current as string)
  }

  async function submeter(fechar: () => void) {
    setErro(null)
    if (!valido) return
    setASubmeter(true)
    try {
      await criarGrupo(nome.trim(), direcao)
      fechar()
    } catch (erroApanhado) {
      setErro(erroApanhado instanceof ErroApi ? erroApanhado.message : MENSAGEM_ERRO_GENERICA)
      setASubmeter(false)
    }
  }

  return (
    <ContextoFolha.Provider value={contextoFolha}>
      <Folha
        titulo="Novo grupo"
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
            aria-label="Criar grupo"
          >
            <IconeCheck tamanho={22} />
          </button>
        }
      >
        {(fechar) => (
          <div className={estilos.formulario}>
            <Formulario id={ID_FORM} aoSubmeter={() => submeter(fechar)}>
              <fieldset className={estilos.grupo} aria-label="Detalhes do grupo">
                <CampoTexto
                  disposicao="linha"
                  etiqueta="Nome"
                  valor={nome}
                  aoMudar={setNome}
                  obrigatorio
                />
                <CampoSelecao
                  disposicao="linha"
                  etiqueta="Direção"
                  valor={direcao}
                  aoMudar={(valor) => setDirecao(valor as Direcao)}
                  opcoes={[
                    { valor: 'saida', etiqueta: 'Saída' },
                    { valor: 'entrada', etiqueta: 'Entrada' },
                  ]}
                />
              </fieldset>

              {erro !== null && <CaixaErro>{erro}</CaixaErro>}
            </Formulario>
          </div>
        )}
      </Folha>
    </ContextoFolha.Provider>
  )
}
