"""
FORMATO DOS PEDIDOS E RESPOSTAS DA API DE CATEGORIAS
=======================================================

Estas classes (baseadas em BaseModel, do Pydantic) descrevem o formato dos
dados que entram e saem dos endpoints de categorias — são diferentes do
modelo em app/models/categoria.py, que descreve a tabela da base de dados.

Um GRUPO (parent_id NULO) e uma SUBCATEGORIA (parent_id preenchido) usam o
mesmo schema de entrada tanto para criar como para editar — o que muda é
se parent_id vem vazio ou preenchido, e se direcao é indicada:

  - Um grupo novo TEM de indicar a direcao (entrada ou saida) — não há
    onde a herdar.
  - Uma subcategoria nova NUNCA indica direcao — herda-a sempre do grupo
    apontado por parent_id (a rota, em app/routers/categorias.py, é quem
    resolve esse valor; este schema só garante que não chega ambíguo).

Isto é validado aqui (na FORMA do pedido), não na rota: um pedido com as
duas coisas erradas ao mesmo tempo (ou nenhuma) nunca chega a executar
qualquer lógica de negócio, falha logo com 422.
"""

import uuid
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

Direcao = Literal["entrada", "saida"]


class CategoriaCriar(BaseModel):
    """Dados recebidos no pedido de criação de uma categoria (POST /categorias)."""

    nome: str = Field(min_length=1, max_length=80)

    # NULO cria um grupo; preenchido (com o id de um grupo do próprio
    # utilizador) cria uma subcategoria desse grupo — verificado na rota,
    # não aqui, porque exige uma consulta à base de dados.
    parent_id: uuid.UUID | None = None

    # Só faz sentido (e é obrigatória) quando parent_id é NULO — ver
    # _direcao_coerente_com_parent_id, abaixo.
    direcao: Direcao | None = None

    @field_validator("nome")
    @classmethod
    def _nome_sem_espacos_e_nao_vazio(cls, valor: str) -> str:
        valor = valor.strip()
        if not valor:
            raise ValueError("O nome não pode ser vazio.")
        return valor

    @model_validator(mode="after")
    def _direcao_coerente_com_parent_id(self) -> "CategoriaCriar":
        if self.parent_id is None and self.direcao is None:
            raise ValueError("Um grupo novo tem de indicar a direção (entrada ou saída).")
        if self.parent_id is not None and self.direcao is not None:
            raise ValueError(
                "Uma subcategoria herda a direção do grupo a que pertence — não se indica aqui."
            )
        return self


class CategoriaEditar(BaseModel):
    """
    Dados recebidos no pedido de edição de uma categoria (PATCH
    /categorias/{id}).

    Sempre um nome novo (mesmo que igual ao antigo) e, para uma
    subcategoria, o grupo onde deve ficar — que pode ser o mesmo de antes
    (só a renomear) ou outro (a "mover" a subcategoria, uma das operações
    pedidas para esta fatia). Para um GRUPO, parent_id tem de vir vazio: um
    grupo não pode tornar-se subcategoria de outro grupo — verificado na
    rota, que também impede o inverso (uma subcategoria "subir" a grupo).
    """

    nome: str = Field(min_length=1, max_length=80)
    parent_id: uuid.UUID | None = None

    @field_validator("nome")
    @classmethod
    def _nome_sem_espacos_e_nao_vazio(cls, valor: str) -> str:
        valor = valor.strip()
        if not valor:
            raise ValueError("O nome não pode ser vazio.")
        return valor


class CategoriaOut(BaseModel):
    """Dados de uma categoria devolvidos pela API, após criar ou editar."""

    id: uuid.UUID
    nome: str
    parent_id: uuid.UUID | None
    direcao: Direcao
    protegida: bool


class SubcategoriaArvoreOut(BaseModel):
    """Uma subcategoria, tal como aparece aninhada dentro do seu grupo em GrupoArvoreOut."""

    id: uuid.UUID
    nome: str
    protegida: bool


class GrupoArvoreOut(BaseModel):
    """Um grupo com as suas subcategorias aninhadas — a forma usada pelos
    seletores da interface (GET /categorias/arvore)."""

    id: uuid.UUID
    nome: str
    direcao: Direcao
    subcategorias: list[SubcategoriaArvoreOut]
