"""
MODELO DA TABELA "categorias"
================================

Representa uma categoria de movimento — o "porquê" de uma entrada ou saída
de dinheiro ("Alimentação", "Salário", "Transportes"). Serve para agrupar
movimentos na análise de entradas e saídas; sem categoria, um movimento é
só um valor e uma descrição em texto livre.

DOIS NÍVEIS, UMA SÓ TABELA: em vez de duas tabelas separadas (uma para
"grupos" e outra para "subcategorias"), esta tabela guarda as duas coisas
na mesma estrutura, e distingue-as pela coluna parent_id:
  - parent_id NULO        → é um GRUPO de topo (ex.: "Alimentação").
  - parent_id preenchido  → é uma SUBCATEGORIA (ex.: "Supermercado"), e o
    valor de parent_id é o id do grupo a que pertence.
Chama-se a isto uma relação AUTO-REFERENCIAL: a chave estrangeira de
parent_id aponta para a própria tabela categorias, não para outra tabela.
A aplicação só permite dois níveis (um grupo nunca é subcategoria de outra
subcategoria); essa regra não está escrita aqui na base de dados — o tipo
da coluna não impede, por si só, uma cadeia mais longa — e é antes
verificada no código dos endpoints (app/routers/categorias.py, em
"criar_categoria" e "editar_categoria") sempre que uma categoria é criada
ou movida.

DIRECÇÃO (entrada ou saída): cada GRUPO tem de indicar se pertence às
entradas ("entrada") ou às saídas ("saida"); uma subcategoria HERDA essa
direcção do grupo a que pertence — o valor é copiado para a sua própria
coluna direcao no momento em que é criada, ou actualizado se for movida
para outro grupo, e não recalculado sempre que é lida. Isto permite ao
formulário de um movimento mostrar só as categorias do lado certo (só as
de saída para uma saída, só as de entrada para uma entrada) sem ter de
percorrer a árvore a cada pedido.

ORDEM: cada categoria guarda a sua posição entre os irmãos (mesmo
user_id, mesmo parent_id) — não é alfabética. A árvore por omissão
(app/services/categorias_seed.py) organiza deliberadamente os grupos por
área de vida primeiro e por tipo de encargo financeiro depois (ver a nota
nesse ficheiro); ordenar por nome apagaria essa organização na
apresentação. Uma categoria criada à mão entra sempre no fim dos seus
irmãos (a maior ordem entre eles, mais um) — não há, nesta fatia, uma
forma de o utilizador reordenar à mão (arrastar-e-largar); só a posição
inicial é deliberada.

SEM COR NEM ÍCONE nesta tabela: por agora, a cor mostrada junto de uma
categoria é calculada no frontend a partir do nome do grupo (a mesma ideia
já usada no avatar das contas) — não há nada para guardar aqui. Se um dia
a aplicação passar a deixar escolher a cor à mão, essa coluna acrescenta-se
então, sem alterar o que já existe.

TODO O MOVIMENTO TEM CATEGORIA — nunca "nenhuma": a coluna categoria_id em
app/models/movimento.py é obrigatória (NOT NULL). Um movimento sem
categoria seria um caso especial que qualquer soma ou agrupamento por
categoria (nas estatísticas, ou mais tarde na categorização automática por
modelo de linguagem) teria de saber contornar; em vez disso, "ainda não
categorizado" é ele próprio uma categoria real, igual a qualquer outra —
os grupos "Outras Entradas" e "Outras Saídas" (ver a semente em
app/services/categorias_seed.py), um por cada direcao.

PROTEGIDA: sinaliza precisamente esses dois grupos-refúgio. Uma categoria
com protegida=True não pode ser renomeada nem apagada (aplicado no
serviço, não aqui) — têm de continuar sempre disponíveis, para que:
  (a) exista sempre um destino de categoria válido para um movimento novo
      antes de o utilizador escolher algo mais específico, e
  (b) ao apagar QUALQUER OUTRA categoria que ainda tenha movimentos (dela
      ou de subcategorias que vão cair com ela em cascata), o serviço
      exija que se escolha explicitamente para onde esses movimentos
      migram — nunca uma reatribuição silenciosa, e "Outras Entradas"/
      "Outras Saídas" são sempre um destino possível dessa migração.
Todas as outras categorias nascem com protegida=False (o valor por
omissão) e podem ser livremente renomeadas ou apagadas.

ELIMINAR: apagar um grupo apaga também as suas subcategorias (ver o
ondelete="CASCADE" abaixo, em parent_id) — mas apagar uma categoria NUNCA
apaga os movimentos que a usavam: o serviço reatribui-os primeiro (ver a
nota TODO O MOVIMENTO TEM CATEGORIA acima), nunca os apaga nem os deixa
sem categoria. Um movimento continua sempre a fazer sentido, com ou sem
uma categoria específica; uma conta, pelo contrário, não faz sentido sem
os movimentos deixarem de existir com ela — por isso ali a regra é a
oposta (CASCADE, em app/models/movimento.py).
"""

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.session import Base


class Categoria(Base):
    """Uma categoria (grupo) ou subcategoria de movimento, consoante parent_id."""

    __tablename__ = "categorias"

    # Chave primária. UUID, pela mesma razão das outras tabelas (users,
    # contas, movimentos): um id sequencial expõe quantas categorias
    # existem e é fácil de adivinhar.
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # Chave estrangeira para o dono da categoria. Cada utilizador tem a sua
    # própria árvore de categorias, semeada automaticamente no registo;
    # index=True porque toda e qualquer consulta a categorias filtra por
    # este campo ("as categorias deste utilizador"). SEM "ondelete" — a
    # mesma nota de "user_id" em conta.py: não há, por agora, nenhum
    # endpoint que apague um User; quando existir, esta relação precisa de
    # uma política explícita, não a ausência de uma.
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )

    # A auto-referência descrita no topo do ficheiro: NULO para um grupo de
    # topo, ou o id de outro registo desta mesma tabela para uma
    # subcategoria. index=True porque listar a árvore agrupa sempre as
    # subcategorias pelo respectivo grupo ("todas as filhas deste pai").
    #
    # ondelete="CASCADE": ao apagar um grupo, as suas subcategorias são
    # apagadas com ele, ao nível da própria base de dados — sem isto,
    # apagar um grupo com subcategorias falharia com um erro de
    # integridade referencial (subcategorias "órfãs", a apontar para um
    # grupo que deixou de existir).
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("categorias.id", ondelete="CASCADE"), nullable=True, index=True
    )

    # Nome dado pelo utilizador ("Alimentação", "Supermercado"). Limite de
    # comprimento para evitar valores absurdos; nomes repetidos entre
    # categorias irmãs (mesmo parent_id) são rejeitados no serviço, não
    # aqui — o Postgres não impede duas linhas com parent_id NULO de terem
    # o mesmo nome através de uma restrição UNIQUE simples, porque trata
    # cada NULO como distinto de qualquer outro.
    nome: Mapped[str] = mapped_column(String(80), nullable=False)

    # "entrada" ou "saida" — ver a explicação de DIRECÇÃO no topo do
    # ficheiro. Guardada como texto (e não, por exemplo, um booleano do
    # tipo "eh_entrada") para corresponder directamente ao vocabulário já
    # usado no resto da aplicação: o campo "Tipo" do formulário de um
    # movimento, e o filtro de movimentos, usam estes mesmos dois valores.
    direcao: Mapped[str] = mapped_column(String(7), nullable=False)

    # Ver a nota PROTEGIDA no topo do ficheiro. False por omissão: só as
    # duas categorias-refúgio semeadas automaticamente ("Outras Entradas",
    # "Outras Saídas") nascem com este valor a True.
    protegida: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # Ver a nota ORDEM no topo do ficheiro. Sem valor por omissão de
    # propósito: quem cria uma categoria (a semente, ou o serviço ao criar
    # uma nova) tem sempre de decidir explicitamente a posição — nunca um
    # 0 silencioso que colidiria com outra categoria já nessa posição.
    ordem: Mapped[int] = mapped_column(Integer, nullable=False)

    # Momento de criação da linha, preenchido pela própria base de dados.
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # Momento da última alteração. server_default preenche na criação;
    # onupdate faz o SQLAlchemy actualizar este valor sempre que a linha é
    # modificada e gravada.
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
