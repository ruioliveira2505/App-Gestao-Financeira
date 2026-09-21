"""
TESTES DE app/core/params.py
================================

"uuids_de_csv" é uma função pura (sem base de dados, sem pedido de rede)
— testada aqui directamente, sem passar por nenhuma rota da API. Até
agora só tinha cobertura INDIRECTA, através dos filtros "contas"/
"categorias" de GET /movimentos e GET /resumo (ver test_movimentos.py,
test_resumo.py) — o que cobre bem o caminho "422 com um id inválido" e
"None quando o parâmetro está ausente", mas nunca isolou os casos-limite
da própria função: uma string vazia, vírgulas a mais/a menos entre ids,
e o comportamento exacto da excepção levantada.
"""

import uuid

import pytest

from fastapi import HTTPException

from app.core.params import uuids_de_csv


def test_none_devolve_none():
    assert uuids_de_csv(None) is None


def test_string_vazia_devolve_none():
    # Distingue-se de "None" só na origem (parâmetro ausente vs. parâmetro
    # presente mas vazio) — o resultado, para quem chama, é o mesmo: "sem
    # filtro".
    assert uuids_de_csv("") is None


def test_um_unico_id_valido():
    id_ = uuid.uuid4()
    assert uuids_de_csv(str(id_)) == [id_]


def test_varios_ids_validos_separados_por_virgula():
    id1, id2, id3 = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    resultado = uuids_de_csv(f"{id1},{id2},{id3}")
    assert resultado == [id1, id2, id3]


def test_virgulas_a_mais_sao_ignoradas_em_vez_de_dar_erro():
    # "if parte" no list comprehension (ver params.py) — um id vazio entre
    # duas vírgulas, ou uma vírgula a mais no início/fim, não deviam
    # contar como um "id inválido" (nem levantar 422), só ser ignorados.
    id1, id2 = uuid.uuid4(), uuid.uuid4()
    resultado = uuids_de_csv(f",{id1},,{id2},")
    assert resultado == [id1, id2]


def test_string_só_de_vírgulas_devolve_none():
    # Depois de filtrar as partes vazias, fica uma lista vazia — o mesmo
    # caso de "sem filtro" que uma string vazia já dá, não uma lista
    # vazia literal (que o chamador teria de tratar como um terceiro
    # caso, sem necessidade).
    assert uuids_de_csv(",,,") is None


def test_um_id_invalido_levanta_422_em_vez_de_deixar_rebentar_um_valueerror():
    with pytest.raises(HTTPException) as excinfo:
        uuids_de_csv("não-é-um-uuid")

    assert excinfo.value.status_code == 422
    assert "UUID" in excinfo.value.detail


def test_um_so_id_invalido_no_meio_de_vários_válidos_também_levanta_422():
    id1 = uuid.uuid4()
    with pytest.raises(HTTPException) as excinfo:
        uuids_de_csv(f"{id1},não-é-um-uuid")

    assert excinfo.value.status_code == 422
