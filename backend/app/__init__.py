"""
PACOTE DA APLICAÇÃO
=======================

O código da aplicação de gestão de finanças pessoais, do lado do backend.
Este ficheiro está vazio de propósito — não há nada a inicializar ao nível
do pacote "app" em si; serve só para o Python reconhecer esta pasta como
um pacote importável (para se poder escrever, por exemplo,
"from app.core.config import settings" a partir de qualquer sítio).

Os subpacotes, cada um com o seu próprio papel:
  - core/ — configuração, segurança (hash de password, sessões) e as
    dependências partilhadas pelas rotas (ex.: "quem é o utilizador
    autenticado?").
  - db/ — a ligação à base de dados (o motor assíncrono e a fábrica de
    sessões).
  - models/ — as tabelas da aplicação (User, UserSession, Conta,
    Categoria, Movimento).
  - schemas/ — os formatos de dados dos pedidos e respostas da API
    (Pydantic), separados dos modelos da base de dados.
  - routers/ — os endpoints da API, um ficheiro por área (auth, contas,
    categorias, movimentos).
  - services/ — lógica de domínio partilhada por mais do que uma rota.
"""
