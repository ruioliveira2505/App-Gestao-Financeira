"""
CONFIGURAÇÃO DA APLICAÇÃO
==========================

Este ficheiro é responsável por obter, a partir do exterior do código, os
valores que variam consoante o computador ou servidor onde a aplicação está
a correr — o endereço de acesso à base de dados e o atributo "Secure" do
cookie de sessão.

Esses valores residem num ficheiro à parte, designado ".env" (não faz parte
do código-fonte partilhado — cada máquina possui o seu próprio .env, com os
seus próprios valores). Esta separação evita a necessidade de alterar o
código sempre que a aplicação muda de ambiente (por exemplo, do computador
local para um servidor de produção).

Princípio adoptado: caso um valor obrigatório não exista no .env, a aplicação
recusa-se a arrancar e devolve de imediato um erro claro, indicando o que
está em falta — em vez de arrancar normalmente e falhar apenas mais tarde,
de forma pouco clara, quando algo tentar efectivamente aceder à base de
dados.
"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """
    Esta classe representa o conjunto de configurações da aplicação.

    BaseSettings é uma classe fornecida por uma biblioteca (Pydantic) que
    sabe ler automaticamente o ficheiro .env (ou variáveis de ambiente do
    sistema) e preencher os campos definidos abaixo com os valores
    encontrados.
    """

    # Único campo desta configuração: o endereço completo de acesso à base
    # de dados (por exemplo, "postgresql+asyncpg://utilizador:password@localhost:5432/nome_bd").
    # O "+asyncpg" indica ao SQLAlchemy qual o driver a usar para comunicar
    # com a PostgreSQL de forma assíncrona — sem este sufixo, a ligação
    # seria interpretada como síncrona, o que não corresponde ao que este
    # projecto usa.
    # Definido como texto (str). A ausência de um valor por omissão (não há
    # "= None" nem "= ''") torna este campo obrigatório — se não estiver
    # presente no .env, a criação da configuração falha de forma deliberada.
    database_url: str

    # Controla o atributo "Secure" do cookie de sessão (ver
    # app/routers/auth.py). Com "Secure", o browser só envia o cookie em
    # ligações HTTPS — o correcto em produção. Por omissão é True.
    #
    # Em desenvolvimento, quando se abre a aplicação noutro dispositivo (um
    # telemóvel) pelo endereço de rede da máquina, o acesso é por HTTP
    # simples e num endereço que não é "localhost" — nesse caso o browser
    # descartaria um cookie "Secure" e a sessão não sobreviveria a um
    # refresh. Definir COOKIE_SECURE=false no .env local resolve isso.
    # NUNCA usar false em produção.
    cookie_secure: bool = True

    # Indica à biblioteca onde procurar os valores: no ficheiro ".env",
    # localizado na mesma pasta em que a aplicação é executada.
    model_config = SettingsConfigDict(env_file=".env")


# É nesta linha que a leitura e a validação ocorrem efectivamente — a
# definição da classe acima constitui apenas a estrutura da configuração,
# sem qualquer efeito por si só.
#
# Quando este ficheiro é importado pela primeira vez por qualquer outra
# parte da aplicação, esta linha é executada e, nesse momento:
#   1. O ficheiro .env é aberto
#   2. Procura-se uma linha "database_url=..."
#   3. Caso exista, o valor é armazenado e fica disponível para o resto da
#      aplicação (por exemplo, através de settings.database_url)
#   4. Caso não exista, a aplicação termina imediatamente com um erro —
#      chegando a nem sequer arrancar (comportamento designado por "fail
#      fast", isto é, falhar o mais cedo possível)
settings = Settings()