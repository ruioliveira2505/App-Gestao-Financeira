"""
SEGURANÇA: HASH DE PASSWORDS
==============================

Este ficheiro isola tudo o que diz respeito ao hash e à verificação de
passwords, usando o algoritmo Argon2id (biblioteca argon2-cffi) — o
algoritmo actualmente recomendado pela OWASP para este fim, por ser
"memory-hard" (exige muita memória para calcular), o que torna ataques por
força bruta com hardware dedicado (GPUs) muito mais caros de executar.

Nunca se guarda a password em texto simples, em lado nenhum — nem na base
de dados, nem em memória mais tempo do que o necessário. O que se guarda é
o resultado da função hash_password, e a verificação de login nunca
"desfaz" o hash para comparar — em vez disso, verify_password recalcula o
hash da password recebida e compara os dois hashes entre si.
"""

# PasswordHasher é a classe da biblioteca argon2-cffi que sabe calcular e
# verificar hashes Argon2id. VerifyMismatchError é a excepção que essa
# mesma biblioteca levanta quando uma password não corresponde ao hash
# fornecido — é apanhada mais abaixo, em verify_password.
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError

# PasswordHasher() usa os parâmetros por omissão da biblioteca (custo de
# memória, tempo e paralelismo), escolhidos pelos autores do Argon2 como um
# equilíbrio razoável entre segurança e desempenho para a generalidade dos
# casos de uso.
#
# O nome começa por um underscore (_password_hasher) por convenção em
# Python: indica que esta variável é interna a este ficheiro, não
# destinada a ser importada ou usada directamente a partir de outros
# ficheiros — quem precisar de calcular ou verificar um hash deve usar as
# funções hash_password e verify_password, definidas abaixo, e não esta
# instância directamente.
_password_hasher = PasswordHasher()


def hash_password(password: str) -> str:
    """Calcula o hash Argon2id de uma password, para guardar na base de dados."""
    # O método .hash() da biblioteca gera, internamente, um valor aleatório
    # (chamado "salt"), incorpora-o no cálculo do hash, e devolve tudo
    # junto numa única cadeia de texto (incluindo os parâmetros usados e o
    # salt) — por isso não é preciso guardar o salt à parte: já vem
    # embutido no valor devolvido.
    return _password_hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    """
    Verifica se uma password corresponde a um hash já guardado.

    Devolve True se corresponder, False caso contrário — nunca deixa
    propagar uma excepção para o código que chama esta função, mesmo que a
    password esteja errada. VerifyMismatchError, a excepção que a
    biblioteca argon2-cffi levanta quando a password não corresponde ao
    hash, é apanhada aqui e traduzida num simples False.
    """
    try:
        _password_hasher.verify(password_hash, password)
        return True
    except VerifyMismatchError:
        return False
