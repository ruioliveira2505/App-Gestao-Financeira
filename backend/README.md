# Backend
API da aplicação, escrita em Python com o FastAPI.

## Estrutura
- `main.py` — ficheiro de entrada da aplicação.
- `pyproject.toml` — nome, versão e dependências do projecto (o que o `uv` lê para saber o que instalar).
- `uv.lock` — lockfile: fixa a versão exacta de cada dependência instalada.
- `.python-version` — versão do Python usada neste projecto.
- `.venv/` — ambiente virtual com as dependências instaladas (local, não fica no repositório).

## Requisitos
- [uv](https://docs.astral.sh/uv/) — gestor de pacotes e ambientes Python usado neste projecto.

## Instalação
1. Entrar na pasta:
   ```bash
   cd backend
   ```
2. Instalar as dependências:
   ```bash
   uv sync
   ```
   Este comando lê o `pyproject.toml` e o `uv.lock`, cria um ambiente virtual isolado (pasta `.venv/`) e instala lá dentro exactamente as versões de `fastapi` e `uvicorn` registadas no lockfile.

## Verificar que está a funcionar
```bash
uv run main.py
```
Deve imprimir `Hello from backend!`. O `uv run` executa o comando dentro do ambiente virtual criado no passo anterior, sem ser preciso activá-lo manualmente.

## Estado actual
Isto confirma que o Python e as dependências estão instalados correctamente — mas ainda não existe nenhuma API a sério. O `main.py` actual é apenas o ficheiro gerado automaticamente quando o projecto foi criado (`uv init`); não usa o FastAPI, não define nenhuma rota, não corre nenhum servidor.

O próximo passo é substituir este ficheiro por uma aplicação FastAPI real, construída junto com a primeira funcionalidade da app: autenticação (registo e início de sessão de utilizadores). É nessa altura que este README passa a ter instruções para correr o servidor da API.
