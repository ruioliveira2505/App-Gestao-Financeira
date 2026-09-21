"""
PARÂMETROS DE QUERY PARTILHADOS
===================================

Uma única função, "uuids_de_csv" — a leitura de uma lista de ids vinda de
um parâmetro de query como texto separado por vírgulas ("id1,id2,id3"),
usada por vários routers para filtros do tipo "contas"/"categorias" (ver
GET /movimentos, em app/routers/movimentos.py, e GET /resumo, em
app/routers/resumo.py). Vive aqui, em app/core/ (não num dos routers),
precisamente porque não pertence a nenhum deles em particular — é uma
regra sobre a FORMA de um parâmetro de URL, não sobre movimentos, contas
ou categorias.
"""

import uuid

from fastapi import HTTPException, status


def uuids_de_csv(valor: str | None) -> list[uuid.UUID] | None:
    """
    Converte "id1,id2,id3" (a forma que filtros como "contas"/"categorias"
    já têm no URL do frontend — ver, por exemplo,
    src/lib/filtrosMovimentos.ts) numa lista de UUID. None quando o
    parâmetro não veio, ou veio vazio — para o chamador conseguir
    distinguir "sem filtro" de "filtro com zero ids" (que nunca devia
    acontecer, mas não há razão para tratar os dois casos de forma
    diferente aqui).

    422 (não 500) se algum dos ids não for um UUID válido: ao contrário de
    um id que faz parte do CAMINHO da rota (ex.: "/movimentos/{movimento_
    id}", validado automaticamente pelo FastAPI por ser parte da
    assinatura da rota como uuid.UUID), este parâmetro chega como texto
    livre e só se converte aqui dentro — sem este try/except, um id mal
    formado (um URL escrito à mão, um bug no cliente) levantaria um
    ValueError não apanhado, que o FastAPI devolve como 500, em vez do 422
    que qualquer outro id inválido já dá nesta API.
    """
    if not valor:
        return None
    try:
        ids = [uuid.UUID(parte) for parte in valor.split(",") if parte]
    except ValueError as erro:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Um ou mais ids no filtro não são UUID válidos.",
        ) from erro
    return ids or None
