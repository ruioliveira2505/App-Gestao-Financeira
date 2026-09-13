"""
SCRIPT: SEMEAR DADOS DE DEMONSTRAÇÃO
=======================================

Deixa a base de dados num estado conhecido para desenvolvimento: APAGA
todas as contas e movimentos de um utilizador e volta a criar um conjunto
realista — três contas (duas em euros, uma em dólares) e ~6 meses de
movimentos gerados de forma DETERMINÍSTICA (a mesma semente de números
aleatórios dá sempre os mesmos dados, para os testes manuais serem
repetíveis), cada um já com uma categoria atribuída.

Só mexe nos dados DESSE utilizador (as suas contas e, por elas, os seus
movimentos) — não toca em `users` nem em `sessions`, nem nos dados de
outro utilizador. Como por agora há um só utilizador registado, o efeito
prático é "limpar as tabelas contas e movimentos".

CATEGORIAS: um utilizador registado depois desta funcionalidade já tem a
sua árvore de categorias criada no próprio registo (ver
app/services/categorias_seed.py, chamada a partir de app/routers/
auth.py). O utilizador de demonstração usado por este script foi
registado antes disso existir, por isso semear_categorias() é chamada
aqui também — sem qualquer efeito se ele já tiver uma árvore (é
idempotente), e é o que lhe cria uma na primeira vez que este script
corre depois desta funcionalidade.

Escreve directamente nos modelos (não passa pela API), por isso repete
aqui as regras que a API impõe: a data de um movimento nunca é anterior à
âncora da sua conta, o valor nunca é zero, e todo o movimento tem de ter
uma categoria (a coluna categoria_id é obrigatória — ver app/models/
movimento.py).

USO
---
A partir da pasta backend/:

    uv run python -m scripts.semear_dados                # o único utilizador
    uv run python -m scripts.semear_dados alguem@mail.pt # utilizador por email
    uv run python -m scripts.semear_dados --limpar       # só apagar, sem semear

Correr várias vezes é seguro: cada execução repõe o mesmo estado de
contas e movimentos (as categorias, essas, só são criadas da primeira
vez — apagar e semear de novo os movimentos não deve apagar uma árvore de
categorias que o utilizador já possa ter editado à mão).
"""

import argparse
import asyncio
import random
import uuid
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import async_session
from app.models.categoria import Categoria
from app.models.conta import Conta
from app.models.movimento import Movimento
from app.models.user import User
from app.services.categorias_seed import semear_categorias

# Semente fixa → os "números aleatórios" (que dia do mês, que supermercado,
# que valor exacto) saem sempre iguais. Assim os dados de demonstração são
# reproduzíveis entre execuções e entre máquinas.
SEMENTE = 42

_CENTIMOS = Decimal("0.01")

# A chave usada para identificar uma categoria neste script: (direcao,
# nome do grupo, nome da subcategoria). A direcao entra na chave porque
# "Transferências" existe duas vezes — um grupo do lado das entradas, outro
# do lado das saídas — com os mesmos nomes de grupo e de subcategoria; sem
# a direcao não haveria como distinguir qual das duas se quer.
CategoriaChave = tuple[str, str, str]


def _eur(valor: float) -> Decimal:
    """float legível no código → Decimal exacto com 2 casas (o tipo das
    colunas de dinheiro). Nunca se guarda float numa coluna monetária."""
    return Decimal(str(valor)).quantize(_CENTIMOS)


def _instante(dia: date, ordem: int) -> datetime:
    """Um `created_at` derivado da data do movimento (meio-dia UTC + a sua
    ordem dentro do dia). As colunas created_at/updated_at têm um valor por
    omissão do lado da base de dados ("agora"); passá-lo explicitamente faz
    com que os movimentos do mesmo dia fiquem com uma ordem estável — a
    lista global usa created_at para desempatar."""
    return datetime.combine(dia, time(12, 0), tzinfo=timezone.utc) + timedelta(seconds=ordem)


def _contas(user_id) -> tuple[Conta, Conta, Conta]:
    """As três contas de demonstração. As âncoras ficam antes do movimento
    mais antigo que vamos gerar."""
    hoje = date.today()
    ordem = Conta(
        user_id=user_id,
        nome="Conta à ordem",
        banco="Millennium BCP",
        tipo="Conta corrente",
        moeda="EUR",
        data_ancora=hoje - timedelta(days=200),
        saldo_ancora=_eur(1240.00),
    )
    poupanca = Conta(
        user_id=user_id,
        nome="Poupança",
        banco="Millennium BCP",
        tipo="Poupança",
        moeda="EUR",
        data_ancora=hoje - timedelta(days=200),
        saldo_ancora=_eur(5000.00),
    )
    revolut = Conta(
        user_id=user_id,
        nome="Revolut",
        banco="Revolut",
        tipo="Conta corrente",
        moeda="USD",
        data_ancora=hoje - timedelta(days=130),
        saldo_ancora=_eur(320.00),
    )
    return ordem, poupanca, revolut


# Listas de descrições para variar os movimentos recorrentes.
_SUPERMERCADOS = ["Continente", "Pingo Doce", "Lidl", "Auchan", "Mercearia do bairro"]
_CAFES = ["Café", "Padaria", "Pastelaria", "Bar"]
_ONLINE_USD = ["Amazon", "Compra online", "AliExpress", "App Store"]

# (nome, valor mínimo, valor máximo, categoria) de despesas avulsas.
_EXTRAS: list[tuple[str, float, float, CategoriaChave]] = [
    ("Farmácia", 12, 45, ("saida", "Saúde e Autocuidado", "Tratamentos e Medicamentos")),
    ("Combustível", 40, 70, ("saida", "Transportes", "Combustível")),
    ("Passe Navegante", 40, 40, ("saida", "Transportes", "Transportes Públicos e TVDE")),
    ("Livraria", 12, 30, ("saida", "Educação", "Livros e Material")),
    ("Roupa - Zara", 25, 90, ("saida", "Bens de Consumo", "Vestuário")),
    ("Cabeleireiro", 12, 25, ("saida", "Saúde e Autocuidado", "Serviços de Bem-Estar")),
]


def _gerar_movimentos(
    ordem: Conta, poupanca: Conta, revolut: Conta, categoria_ids: dict[CategoriaChave, uuid.UUID]
) -> list[Movimento]:
    """Gera ~6 meses de movimentos: um ciclo mensal de despesas fixas
    (salário, renda, ginásio, subscrições, transferência para a poupança)
    mais compras e cafés espalhados pelos dias — cada um já associado à
    categoria correspondente em categoria_ids."""
    rnd = random.Random(SEMENTE)
    hoje = date.today()
    movimentos: list[Movimento] = []
    # Contador de movimentos por dia, para o created_at (ver _instante).
    por_dia: dict[date, int] = {}

    def add(conta: Conta, dia: date, descricao: str, valor: Decimal, categoria: CategoriaChave) -> None:
        # Respeita as mesmas regras da API: nunca antes da âncora, nunca zero.
        if dia < conta.data_ancora or dia > hoje or valor == 0:
            return
        ordem_no_dia = por_dia.get(dia, 0)
        por_dia[dia] = ordem_no_dia + 1
        movimentos.append(
            Movimento(
                conta_id=conta.id,
                data=dia,
                descricao=descricao,
                valor=valor.quantize(_CENTIMOS),
                categoria_id=categoria_ids[categoria],
                created_at=_instante(dia, ordem_no_dia),
                updated_at=_instante(dia, ordem_no_dia),
            )
        )

    # --- Ciclo mensal, do mês da âncora mais antiga até ao mês corrente ---
    inicio = min(ordem.data_ancora, poupanca.data_ancora, revolut.data_ancora)
    ano, mes = inicio.year, inicio.month
    while (ano, mes) <= (hoje.year, hoje.month):
        def d(dia_do_mes: int) -> date:
            return date(ano, mes, min(dia_do_mes, 28))

        # Conta à ordem — entradas e despesas fixas
        add(ordem, d(1), "Salário", _eur(2450.00), ("entrada", "Trabalho", "Salário"))
        add(ordem, d(3), "Renda", _eur(-720.00), ("saida", "Habitação", "Renda"))
        add(
            ordem,
            d(4),
            "Eletricidade EDP",
            _eur(-round(rnd.uniform(38, 62), 2)),
            ("saida", "Habitação", "Água, Eletricidade e Gás"),
        )
        add(ordem, d(6), "Internet + TV MEO", _eur(-44.90), ("saida", "Habitação", "Telecomunicações"))
        add(ordem, d(7), "Ginásio", _eur(-29.99), ("saida", "Saúde e Autocuidado", "Ginásio e Desporto"))
        add(ordem, d(8), "Netflix", _eur(-13.99), ("saida", "Entretenimento", "Subscrições"))
        add(ordem, d(9), "Spotify", _eur(-6.99), ("saida", "Entretenimento", "Subscrições"))

        # Transferência mensal para a poupança (dois movimentos, mesmo dia)
        add(
            ordem,
            d(10),
            "Transferência para poupança",
            _eur(-250.00),
            ("saida", "Transferências", "Entre Contas Bancárias"),
        )
        add(
            poupanca,
            d(10),
            "Transferência da conta à ordem",
            _eur(250.00),
            ("entrada", "Transferências", "Entre Contas Bancárias"),
        )
        add(poupanca, d(28), "Juros", _eur(round(rnd.uniform(6, 16), 2)), ("entrada", "Investimentos", "Juros"))

        # Supermercado ~2x por semana
        for semana in range(4):
            for _ in range(rnd.randint(1, 2)):
                dia = d(2 + semana * 7 + rnd.randint(0, 5))
                loja = rnd.choice(_SUPERMERCADOS)
                add(ordem, dia, loja, _eur(-round(rnd.uniform(18, 82), 2)), ("saida", "Alimentação", "Supermercado"))

        # Cafés / refeições fora — alguns dias por mês
        for _ in range(rnd.randint(6, 12)):
            dia = d(rnd.randint(1, 28))
            if rnd.random() < 0.7:
                add(
                    ordem,
                    dia,
                    rnd.choice(_CAFES),
                    _eur(-round(rnd.uniform(1.2, 9.5), 2)),
                    ("saida", "Alimentação", "Restaurantes e Cafés"),
                )
            elif rnd.random() < 0.5:
                add(
                    ordem,
                    dia,
                    "Take-away",
                    _eur(-round(rnd.uniform(9, 26), 2)),
                    ("saida", "Alimentação", "Take-away e Entregas"),
                )
            else:
                nome = "Almoço fora" if rnd.random() < 0.5 else "Jantar fora"
                add(
                    ordem,
                    dia,
                    nome,
                    _eur(-round(rnd.uniform(9, 26), 2)),
                    ("saida", "Alimentação", "Restaurantes e Cafés"),
                )

        # 1–2 despesas "extra" avulsas
        for _ in range(rnd.randint(1, 2)):
            nome, lo, hi, categoria = rnd.choice(_EXTRAS)
            add(ordem, d(rnd.randint(2, 27)), nome, _eur(-round(rnd.uniform(lo, hi), 2)), categoria)

        # De vez em quando, uma entrada extra
        if rnd.random() < 0.25:
            add(
                ordem,
                d(rnd.randint(10, 25)),
                "Reembolso",
                _eur(round(rnd.uniform(15, 120), 2)),
                ("entrada", "Outras Entradas", "Reembolsos"),
            )

        # Revolut (USD) — pequenas compras e um carregamento
        if rnd.random() < 0.6:
            add(
                revolut,
                d(rnd.randint(1, 10)),
                "Carregamento",
                _eur(round(rnd.uniform(80, 200), 2)),
                ("entrada", "Transferências", "Entre Contas Bancárias"),
            )
        for _ in range(rnd.randint(2, 5)):
            add(
                revolut,
                d(rnd.randint(1, 28)),
                rnd.choice(_ONLINE_USD),
                _eur(-round(rnd.uniform(4, 48), 2)),
                ("saida", "Bens de Consumo", "Outros"),
            )

        mes += 1
        if mes == 13:
            mes, ano = 1, ano + 1

    # Um levantamento grande da poupança, uma vez, a meio do período — para
    # obras em casa, por isso fica em Habitação (é a área a que a despesa
    # pertence), não em Transferências (o dinheiro não voltou a aparecer
    # nas contas seguidas por esta app depois de sair da poupança).
    add(poupanca, hoje - timedelta(days=95), "Levantamento para obras", _eur(-800.00), ("saida", "Habitação", "Outros"))

    return movimentos


async def _categoria_ids_do_utilizador(db: AsyncSession, user_id: uuid.UUID) -> dict[CategoriaChave, uuid.UUID]:
    """Constrói o mapa (direcao, grupo, subcategoria) -> id a partir da
    árvore de categorias já semeada para este utilizador — é como
    _gerar_movimentos traduz os nomes usados acima no id que a coluna
    categoria_id, de facto, exige."""
    categorias = (await db.scalars(select(Categoria).where(Categoria.user_id == user_id))).all()
    por_id = {c.id: c for c in categorias}
    mapa: dict[CategoriaChave, uuid.UUID] = {}
    for categoria in categorias:
        if categoria.parent_id is None:
            continue  # só as subcategorias (folhas) são destino de um movimento aqui
        grupo = por_id[categoria.parent_id]
        mapa[(categoria.direcao, grupo.nome, categoria.nome)] = categoria.id
    return mapa


async def _principal(email: str | None, so_limpar: bool) -> None:
    # async_session() (não get_db()): este script não corre dentro de um
    # pedido HTTP — abre a sua própria sessão e fecha-a no fim.
    async with async_session() as db:
        # 1. Encontrar o utilizador: por email, ou o único que existir.
        if email:
            user = await db.scalar(select(User).where(User.email == email))
            if user is None:
                raise SystemExit(f"Não há utilizador com o email {email!r}.")
        else:
            users = (await db.scalars(select(User))).all()
            if len(users) != 1:
                raise SystemExit(
                    f"Há {len(users)} utilizadores registados — indica qual pelo email "
                    "(ex.: uv run python -m scripts.semear_dados alguem@mail.pt)."
                )
            user = users[0]

        # 2. Apagar as contas do utilizador (e, com elas, os movimentos).
        #    O Movimento.conta_id tem ondelete="CASCADE", mas apaga-se aqui
        #    de forma explícita para não depender disso. As categorias NÃO
        #    se apagam aqui — ao contrário de contas/movimentos, que são
        #    dados de demonstração descartáveis, a árvore de categorias é
        #    algo que o utilizador poderia já ter editado à mão.
        conta_ids = (
            await db.scalars(select(Conta.id).where(Conta.user_id == user.id))
        ).all()
        if conta_ids:
            await db.execute(delete(Movimento).where(Movimento.conta_id.in_(conta_ids)))
        apagadas = await db.execute(delete(Conta).where(Conta.user_id == user.id))
        await db.commit()
        print(f"Apagadas {apagadas.rowcount} conta(s) de {user.email} (e os seus movimentos).")

        if so_limpar:
            return

        # 3. Garantir que o utilizador tem a árvore de categorias por
        # omissão — sem efeito se já a tiver (ver o docstring de
        # semear_categorias). Um utilizador registado depois desta
        # funcionalidade já a traz do próprio registo; este passo serve
        # sobretudo o utilizador de demonstração, registado antes dela
        # existir.
        await semear_categorias(db, user.id)
        await db.commit()
        categoria_ids = await _categoria_ids_do_utilizador(db, user.id)

        # 4. Criar as contas e os movimentos novos.
        ordem, poupanca, revolut = _contas(user.id)
        db.add_all([ordem, poupanca, revolut])
        # O "default=uuid.uuid4" das colunas id só é resolvido no INSERT —
        # um flush força-o agora (sem terminar a transacção), para os
        # movimentos já poderem referenciar conta.id.
        await db.flush()
        movimentos = _gerar_movimentos(ordem, poupanca, revolut, categoria_ids)
        db.add_all(movimentos)
        await db.commit()
        print(f"Criadas 3 contas e {len(movimentos)} movimentos para {user.email}.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Semear dados de demonstração para um utilizador.")
    parser.add_argument("email", nargs="?", help="email do utilizador (por omissão, o único que existir)")
    parser.add_argument("--limpar", action="store_true", help="apenas apagar as contas/movimentos, sem semear")
    args = parser.parse_args()
    asyncio.run(_principal(args.email, args.limpar))
