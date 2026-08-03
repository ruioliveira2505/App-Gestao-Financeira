"""
ROTAS DE AUTENTICAÇÃO
========================

Este ficheiro define os endpoints relacionados com autenticação: registo,
login, logout e a rota "quem sou eu".
"""

import secrets
from datetime import datetime, timezone

# APIRouter permite agrupar rotas relacionadas, como explicado abaixo.
# Cookie declara, de forma explícita, que um parâmetro vem de um cookie do
# pedido — usado abaixo, no logout, para ler "session_token" tal como
# obter_utilizador_atual já faz (app/core/deps.py).
# Depends é o mecanismo de injecção de dependências do FastAPI — é o que
# permite a uma rota receber automaticamente uma sessão de base de dados
# (get_db) ou o utilizador autenticado (obter_utilizador_atual), sem ter
# de os obter manualmente.
# HTTPException permite interromper um pedido a meio, devolvendo um erro
# HTTP específico (usado abaixo para os casos de email duplicado e de
# credenciais inválidas). Response é o objecto de resposta HTTP, usado no
# login e no logout para lhe anexar ou remover o cookie de sessão. status
# fornece os códigos HTTP como constantes com nome (ex.:
# status.HTTP_409_CONFLICT), mais legível do que escrever directamente o
# número.
from fastapi import APIRouter, Cookie, Depends, HTTPException, Response, status

# select é a função do SQLAlchemy usada para construir consultas (o
# equivalente ao SELECT em SQL), usada abaixo para procurar um utilizador
# pelo email ou uma sessão pelo hash do seu token.
from sqlalchemy import select

# AsyncSession é o tipo da sessão de base de dados assíncrona — usado aqui
# apenas como anotação de tipo, para o editor e para o FastAPI perceberem
# o que get_db (importado a seguir) devolve.
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import obter_utilizador_atual
from app.core.security import hash_password, verify_password
from app.core.sessions import SESSION_DURATION, gerar_token_sessao, hash_token
from app.db.session import get_db
from app.models.session import UserSession
from app.models.user import User
from app.schemas.auth import UserLogin, UserPublico, UserRegisto

# APIRouter agrupa rotas relacionadas entre si; é depois incluído na
# aplicação principal (app/main.py). prefix="/auth" faz com que todas as
# rotas aqui definidas fiquem disponíveis a partir de "/auth/...", e
# tags=["auth"] agrupa-as, com esse nome, na documentação automática que o
# FastAPI gera.
router = APIRouter(prefix="/auth", tags=["auth"])

# Hash de uma password "fantasma", calculado uma única vez quando este
# módulo é importado — nunca corresponde a nenhuma password real, e serve
# apenas para a rota de login gastar um tempo semelhante ao de uma
# verificação real quando o email indicado nem sequer existe. Ver o
# comentário em login(), mais abaixo, para a razão desta cautela.
_HASH_FANTASMA = hash_password(secrets.token_urlsafe(32))


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


@router.post("/login", response_model=UserPublico)
async def login(
    dados: UserLogin, response: Response, db: AsyncSession = Depends(get_db)
) -> User:
    """
    Autentica um utilizador existente e inicia uma sessão.

    Em caso de sucesso, cria uma linha em "sessions" e entrega o respectivo
    token num cookie httpOnly do browser (nunca no corpo da resposta), e
    devolve os dados públicos do utilizador. Em caso de falha — email
    inexistente ou password incorrecta — devolve sempre o mesmo erro
    genérico (401), sem indicar qual dos dois motivos se aplica.
    """
    resultado = await db.execute(select(User).where(User.email == dados.email))
    utilizador = resultado.scalar_one_or_none()

    if utilizador is not None:
        password_correcta = verify_password(dados.password, utilizador.password_hash)
    else:
        # Mesmo quando o email não existe, verifica-se a password na mesma
        # — contra o hash fantasma definido no topo deste ficheiro, sem
        # qualquer relação com o pedido — em vez de responder de imediato.
        # O Argon2id é deliberadamente lento; sem esta linha, "email não
        # existe" responderia muito mais depressa do que "email existe,
        # password errada" (que exige uma verificação real), e essa
        # diferença de tempo, por si só, revelaria a quem está a tentar
        # entrar quais os emails que têm conta registada.
        verify_password(dados.password, _HASH_FANTASMA)
        password_correcta = False

    if not password_correcta:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Email ou password incorretos.",
        )

    # Gera um novo token aleatório e grava apenas o seu hash (nunca o token
    # em si) numa nova sessão, associada a este utilizador e válida durante
    # SESSION_DURATION a partir de agora — ver app/core/sessions.py para a
    # razão de ser um hash diferente do usado para as passwords, e para o
    # significado desta duração (expiração deslizante, renovada a cada
    # pedido autenticado, a partir da rota "quem sou eu").
    token = gerar_token_sessao()
    nova_sessao = UserSession(
        token_hash=hash_token(token),
        user_id=utilizador.id,
        expires_at=datetime.now(timezone.utc) + SESSION_DURATION,
    )
    db.add(nova_sessao)
    await db.commit()

    # httponly=True: o cookie não fica acessível a JavaScript no browser, só
    # é enviado automaticamente pelo browser em cada pedido — protege
    # contra um ataque de XSS conseguir ler o token e roubar a sessão.
    # samesite="lax": o cookie só é enviado em pedidos que partam deste
    # site (ou de navegação directa a ele), não em pedidos despoletados por
    # outros sites — mitigação contra CSRF.
    # secure=True: o cookie só é enviado em ligações HTTPS — os browsers
    # actuais tratam "localhost" como um contexto seguro mesmo sem HTTPS,
    # por isso isto não impede o funcionamento em desenvolvimento local.
    # max_age, em segundos: tempo de vida do cookie no próprio browser,
    # coerente com SESSION_DURATION — o tempo de vida da sessão no servidor.
    response.set_cookie(
        key="session_token",
        value=token,
        httponly=True,
        samesite="lax",
        secure=True,
        max_age=int(SESSION_DURATION.total_seconds()),
    )

    return utilizador


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    response: Response,
    session_token: str | None = Cookie(default=None),
    db: AsyncSession = Depends(get_db),
) -> None:
    """
    Termina a sessão actual: apaga a linha correspondente em "sessions" e
    remove o cookie do browser.

    Ao contrário da rota "quem sou eu", não usa obter_utilizador_atual como
    dependência — não interessa aqui validar se a sessão ainda é válida
    antes de a apagar. Um pedido sem cookie, ou com uma sessão já expirada
    ou inexistente, não tem nada para apagar, mas continua a ser um logout
    bem-sucedido do ponto de vista de quem o pede (não há sessão activa no
    fim, que era o objectivo).
    """
    if session_token is not None:
        resultado = await db.execute(
            select(UserSession).where(UserSession.token_hash == hash_token(session_token))
        )
        sessao = resultado.scalar_one_or_none()
        if sessao is not None:
            await db.delete(sessao)
            await db.commit()

    # status_code=204 (No Content) não devolve corpo — por isso esta rota
    # não declara response_model nem devolve nada além de remover o
    # cookie. delete_cookie() funciona enviando um Set-Cookie com uma data
    # de expiração já passada, instrução que faz o browser descartar
    # imediatamente o cookie existente.
    response.delete_cookie("session_token")


@router.get("/me", response_model=UserPublico)
async def obter_utilizador_autenticado(
    utilizador: User = Depends(obter_utilizador_atual),
) -> User:
    """
    Devolve os dados do utilizador actualmente autenticado.

    Toda a lógica de validação da sessão (ler o cookie, confirmar que
    corresponde a uma sessão válida, renovar a sua expiração) vive em
    obter_utilizador_atual (app/core/deps.py) — esta rota seria a mesma
    para qualquer outro endpoint que exigisse um utilizador autenticado,
    só muda o que devolve depois de o obter.
    """
    return utilizador
