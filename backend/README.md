# Backend
API da aplicação, escrita em Python com o FastAPI.

## Estrutura
- `app/` — pacote da aplicação:
  - `main.py` — instância da FastAPI, liga os routers.
  - `core/config.py` — configuração da aplicação (lê o `.env`).
  - `core/security.py` — hash e verificação de passwords (Argon2id).
  - `db/session.py` — ligação à base de dados.
  - `models/user.py`, `models/session.py` — tabelas `users` e `sessions`.
  - `schemas/auth.py` — formato dos pedidos e respostas dos endpoints de autenticação.
  - `routers/auth.py` — os endpoints de autenticação em si (por agora, o registo).
- `tests/` — testes automatizados:
  - `conftest.py` — fixtures partilhadas por todos os testes (base de dados de teste, isolamento por transacção, cliente HTTP).
  - `test_auth_registo.py` — testes ao endpoint `POST /auth/registo`.
- `alembic/` — migrações da base de dados; `env.py` liga o Alembic à configuração e aos modelos da aplicação.
- `alembic.ini` — configuração do Alembic (onde ficam as migrações, o logging).
- `pyproject.toml` — nome, versão e dependências do projecto (o que o `uv` lê para saber o que instalar); inclui também a configuração do pytest.
- `uv.lock` — lockfile: fixa a versão exacta de cada dependência instalada.
- `.python-version` — versão do Python usada neste projecto.
- `.venv/` — ambiente virtual com as dependências instaladas (local, não fica no repositório).
- `.env` — variáveis de ambiente da base de dados de desenvolvimento; local, não fica no repositório.
- `.env.test` — o mesmo, mas para a base de dados de teste; local, não fica no repositório.
- `.env.example` — modelo do `.env`, sem valores reais, incluído no repositório.

## Requisitos
- [uv](https://docs.astral.sh/uv/) — gestor de pacotes e ambientes Python usado neste projecto.
- PostgreSQL, com uma base de dados e um utilizador criados (ver `.env.example` para o formato da ligação).
- Para correr os testes, uma segunda base de dados PostgreSQL, dedicada a esse fim (ver secção "Correr os testes", abaixo).

## Instalação
1. Entrar na pasta:
   ```bash
   cd backend
   ```
2. Instalar as dependências:
   ```bash
   uv sync
   ```
   Este comando lê o `pyproject.toml` e o `uv.lock`, cria um ambiente virtual isolado (pasta `.venv/`) e instala lá dentro exactamente as versões de cada dependência registadas no lockfile.
3. Aplicar as migrações, para criar as tabelas na base de dados:
   ```bash
   uv run alembic upgrade head
   ```

## Correr em desenvolvimento
```bash
uv run uvicorn app.main:app --reload
```
Arranca o servidor local (por omissão em `http://127.0.0.1:8000`), com recarregamento automático sempre que um ficheiro é alterado. A documentação interactiva da API (gerada automaticamente pelo FastAPI, a partir dos routers e schemas) fica disponível em `http://127.0.0.1:8000/docs` — inclui um formulário para testar cada endpoint directamente no browser.

## Correr os testes
Os testes correm contra uma base de dados PostgreSQL própria, separada da de desenvolvimento — nunca contra dados reais.

1. Criar a base de dados de teste (uma única vez, com o mesmo utilizador já existente como dono):
   ```sql
   CREATE DATABASE app_gestao_financeira_test OWNER app_gestao_financeira_user;
   ```
2. Criar `.env.test`, com o mesmo formato do `.env`, mas apontando a essa base de dados:
   ```
   DATABASE_URL=postgresql+asyncpg://app_gestao_financeira_user:<password>@localhost/app_gestao_financeira_test
   ```
3. Correr os testes:
   ```bash
   uv run pytest -v
   ```
   As tabelas da base de dados de teste são criadas automaticamente, a partir dos modelos, no início da execução — não é preciso aplicar migrações Alembic aí. Cada teste corre isolado dos restantes (o que gravar é sempre revertido no final), pelo que a suite pode ser corrida repetidamente sem qualquer limpeza manual.

## Estado actual
Já existe um primeiro endpoint real, testado automaticamente: `POST /auth/registo`, que cria um novo utilizador com a password guardada em hash (Argon2id), rejeitando emails já registados. Login, logout e a rota "quem sou eu" ainda faltam, para fechar a fatia vertical da autenticação.
