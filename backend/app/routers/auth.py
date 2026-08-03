"""
ROTAS DE AUTENTICAÇÃO
========================

Este ficheiro define os endpoints relacionados com autenticação. Por
agora, apenas o registo de um novo utilizador; o login, o logout e a rota
"quem sou eu" serão acrescentados aqui mais adiante, como parte da mesma
fatia vertical.
"""

# APIRouter permite agrupar rotas relacionadas, como explicado abaixo.
# Depends é o mecanismo de injecção de dependências do FastAPI — é o que
# permite à rota, mais abaixo, receber automaticamente uma sessão de base
# de dados através de get_db, sem ter de a criar manualmente.
# HTTPException permite interromper um pedido a meio, devolvendo um erro
# HTTP específico (usado abaixo para o caso de email duplicado). status
# fornece os códigos HTTP como constantes com nome (ex.: status.HTTP_409_CONFLICT),
# mais legível do que escrever directamente o número 409.
from fastapi import APIRouter, Depends, HTTPException, status

# select é a função do SQLAlchemy usada para construir consultas (o
# equivalente ao SELECT em SQL), usada abaixo para procurar um utilizador
# pelo email.
from sqlalchemy import select

# AsyncSession é o tipo da sessão de base de dados assíncrona — usado aqui
# apenas como anotação de tipo, para o editor e para o FastAPI perceberem
# o que get_db (importado a seguir) devolve.
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password
from app.db.session import get_db
from app.models.user import User
from app.schemas.auth import UserPublico, UserRegisto

# APIRouter agrupa rotas relacionadas entre si; é depois incluído na
# aplicação principal (app/main.py). prefix="/auth" faz com que todas as
# rotas aqui definidas fiquem disponíveis a partir de "/auth/...", e
# tags=["auth"] agrupa-as, com esse nome, na documentação automática que o
# FastAPI gera.
router = APIRouter(prefix="/auth", tags=["auth"])


# response_model=UserPublico diz ao FastAPI para converter o que esta
# função devolver para esse formato antes de responder — é isso que
# garante que o password_hash nunca sai na resposta, mesmo que a função
# devolva um objecto User completo, como acontece aqui.
# status_code=status.HTTP_201_CREATED define o código HTTP devolvido
# quando tudo corre bem; 201 (Created) é o código convencional para um
# pedido que cria um novo recurso, em vez do 200 genérico.
@router.post("/registo", response_model=UserPublico, status_code=status.HTTP_201_CREATED)
async def registar(dados: UserRegisto, db: AsyncSession = Depends(get_db)) -> User:
    """
    Regista um novo utilizador.

    Recebe email e password (em texto simples, apenas neste pedido, nunca
    guardada assim); grava o utilizador com o hash da password. Se o email
    já estiver registado, devolve um erro 409 (Conflict) em vez de criar um
    segundo utilizador com o mesmo email.
    """
    # "dados: UserRegisto" recebe e já vem validado — o FastAPI lê o corpo
    # do pedido (JSON), valida-o contra o schema UserRegisto (rejeitando
    # automaticamente, com erro 422, um pedido que não cumpra as regras
    # definidas nesse schema, como a password com menos de 8 caracteres) e
    # só depois entrega o resultado a esta função.
    # "db: AsyncSession = Depends(get_db)" é o que entrega a esta função
    # uma sessão de base de dados já aberta, através do mecanismo descrito
    # em app/db/session.py — a rota não precisa de saber como essa sessão
    # é criada ou fechada.
    # Verifica se já existe um utilizador com este email antes de tentar
    # criar um novo. Isto dá um erro claro e específico ao pedido; sem esta
    # verificação, a restrição UNIQUE da coluna email na base de dados
    # rejeitaria a mesma situação, mas com um erro genérico de base de
    # dados, menos informativo para quem está a usar a API.
    resultado = await db.execute(select(User).where(User.email == dados.email))
    if resultado.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Já existe uma conta registada com este email.",
        )

    # O objecto User é criado em memória, com o hash da password calculado
    # a partir da password em texto simples recebida em "dados". Nenhuma
    # destas linhas, por si só, escreve na base de dados.
    novo_utilizador = User(
        email=dados.email,
        password_hash=hash_password(dados.password),
    )

    # db.add() marca o objecto para ser inserido; db.commit() é o que de
    # facto grava essa alteração na base de dados de forma permanente.
    # db.refresh() volta a ler o objecto a partir da base de dados depois
    # do commit, preenchendo campos que só a base de dados sabe (como
    # created_at, calculado pela própria PostgreSQL).
    db.add(novo_utilizador)
    await db.commit()
    await db.refresh(novo_utilizador)

    # O FastAPI converte automaticamente este objecto User no formato
    # definido por response_model (UserPublico), graças ao
    # model_config = {"from_attributes": True} definido nesse schema —
    # é aí, nessa conversão, que o password_hash fica de fora da resposta.
    return novo_utilizador
