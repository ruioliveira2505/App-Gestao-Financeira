"""
FORMATO DOS PEDIDOS E RESPOSTAS DA API DE AUTENTICAÇÃO
==========================================================

Estas classes (baseadas em BaseModel, do Pydantic) descrevem a forma dos
dados que entram e saem dos endpoints de autenticação — são diferentes dos
modelos em app/models/, que descrevem as tabelas da base de dados. Por
exemplo, o pedido de registo recebe uma password em texto simples (nunca
guardada assim na base de dados), e a resposta devolve o utilizador sem o
seu password_hash — mesmo que, por engano, alguém tentasse devolver esse
campo, o schema de resposta (UserPublico) nem sequer o conhece.
"""

# uuid é usado para anotar o tipo do campo "id", abaixo — o mesmo tipo
# usado no modelo User (app/models/user.py), para que um valor lido da
# base de dados encaixe directamente neste schema, sem conversão manual.
import uuid

# BaseModel é a classe base de que todos os schemas do Pydantic herdam.
# EmailStr é um tipo de texto que exige, automaticamente, um formato de
# email válido (depende da biblioteca email-validator, instalada à parte).
# Field permite acrescentar regras de validação a um campo, como o
# comprimento mínimo usado abaixo, em "password".
from pydantic import BaseModel, EmailStr, Field


class UserRegisto(BaseModel):
    """Dados recebidos no pedido de registo de um novo utilizador."""

    # EmailStr, por si só, já rejeita um pedido em que este campo não
    # tenha a forma de um endereço de email (ex.: sem "@"), antes mesmo de
    # o código do endpoint correr.
    email: EmailStr

    # Field(min_length=8) exige, desde já, uma password com pelo menos
    # 8 caracteres — uma validação mínima, feita automaticamente pelo
    # Pydantic antes de o código do endpoint sequer correr. Não substitui
    # o hash com Argon2id (que continua a acontecer), é só uma primeira
    # barreira contra passwords demasiado curtas.
    password: str = Field(min_length=8)


class UserPublico(BaseModel):
    """
    Dados de um utilizador devolvidos pela API — nunca inclui o
    password_hash, que existe apenas na base de dados.
    """

    # O identificador único do utilizador, do mesmo tipo (UUID) usado na
    # tabela users — ver app/models/user.py para a explicação completa de
    # porque um UUID, e não um número a incrementar, foi a escolha feita
    # para esta coluna.
    id: uuid.UUID

    # Repetido aqui, e não apenas em UserRegisto, porque este é um schema
    # completamente independente — a resposta de um pedido não reutiliza a
    # validação de um schema de pedido, mesmo que o campo tenha o mesmo
    # nome e tipo nos dois.
    email: EmailStr

    # from_attributes=True permite construir esta classe directamente a
    # partir de um objecto User (o modelo da base de dados), lendo os seus
    # atributos, em vez de exigir um dicionário já pronto. É o que permite
    # a um endpoint devolver directamente um User e o FastAPI converter
    # automaticamente para este formato, usando response_model.
    model_config = {"from_attributes": True}
