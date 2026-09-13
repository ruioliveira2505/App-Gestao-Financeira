"""
SEMENTE DA ÁRVORE DE CATEGORIAS
=================================

Define a árvore de categorias com que todo o utilizador novo começa
(ARVORE_PADRAO) e a função que a grava na base de dados para um
utilizador (semear_categorias). Ver app/models/categoria.py para o
desenho da tabela — parent_id auto-referencial, dois níveis, direcao
herdada do grupo pela subcategoria.

DOIS CRITÉRIOS, NUNCA MISTURADOS DENTRO DA MESMA DIREÇÃO: dentro das
entradas, cada grupo representa uma ORIGEM do dinheiro (Trabalho,
Investimentos, um Empréstimo recebido, uma Transferência entre contas
próprias). Dentro das saídas, a maioria dos grupos representa uma ÁREA DE
VIDA (Habitação, Alimentação, Transportes, Saúde) — mas quatro grupos são
excepções deliberadas, porque descrevem antes um TIPO de evento financeiro
que atravessa qualquer área de vida, e forçá-los a viver dentro de uma
área específica perderia informação: Seguros (protecção financeira,
independente do que está seguro), Impostos e Encargos (obrigações para com
o Estado e a banca), Compra de Ativos (dinheiro que sai para investimento,
não para consumo pessoal — o espelho de "Venda de Ativos" do lado das
entradas) e Transferências (movimento entre contas do próprio
utilizador). Um exemplo do porquê desta separação: a prestação de uma casa
fica em Habitação (é o custo de lá viver, todos os meses), mas o seguro
dessa casa fica em Seguros (é dinheiro pago para se proteger de um risco,
não para viver lá) — e comprar a própria casa (o valor do imóvel, ou a
entrada inicial) fica em Compra de Ativos (é um evento de capital pontual,
não uma despesa recorrente de viver nela).

CADA GRUPO TEM O SEU PRÓPRIO "OUTROS": além do "Outros" de cada grupo
normal (uma subcategoria comum, tão editável ou apagável como qualquer
outra — serve só de destino óbvio para "sei a área, não quero detalhar
mais"), há dois grupos especiais, "Outras Entradas" e "Outras Saídas", cujo
"Outros" é que fica com protegida=True (ver a nota PROTEGIDA em
app/models/categoria.py): são o refúgio ÚLTIMO, garantido, para quando nem
a área nem o tipo de evento são conhecidos — o destino por omissão de um
movimento novo, e o único destino que nunca pode ser apagado nem
renomeado.
"""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.categoria import Categoria

# Cada grupo é (nome, direcao, subcategorias). Uma subcategoria é, na
# maioria dos casos, só o seu nome (nasce com protegida=False); as duas
# excepções — o "Outros" de "Outras Entradas" e de "Outras Saídas" — vêm
# como um par (nome, protegida=True), para ficar explícito no próprio
# dado, sem o código de semear ter de adivinhar "isto é um grupo especial"
# a partir do nome do grupo.
ARVORE_PADRAO: list[tuple[str, str, list[str | tuple[str, bool]]]] = [
    # --- Entradas: cada grupo é uma ORIGEM do dinheiro ---
    ("Trabalho", "entrada", ["Salário", "Prémios", "Recibos Verdes", "Outros"]),
    ("Investimentos", "entrada", ["Renda de Imóveis", "Dividendos", "Juros", "Outros"]),
    ("Venda de Ativos", "entrada", ["Imóveis", "Veículos", "Equipamentos", "Ativos Financeiros", "Outros"]),
    ("Empréstimos", "entrada", ["Crédito Pessoal", "Empréstimo Particular", "Outros"]),
    ("Transferências", "entrada", ["Entre Contas Bancárias", "Depósito em Numerário", "Outros"]),
    ("Outras Entradas", "entrada", ["Reembolsos", "Presentes", "Donativos", "Heranças", ("Outros", True)]),
    # --- Saídas: a maioria dos grupos é uma ÁREA DE VIDA ---
    (
        "Habitação",
        "saida",
        [
            "Prestação",
            "Renda",
            "Água, Eletricidade e Gás",
            "Telecomunicações",
            "Bens Mobiliários",
            "Segurança",
            "Condomínio",
            "Serviços Domésticos",
            "Outros",
        ],
    ),
    ("Alimentação", "saida", ["Supermercado", "Restaurantes e Cafés", "Take-away e Entregas", "Outros"]),
    (
        "Transportes",
        "saida",
        [
            "Prestação",
            "Combustível",
            "Manutenção e Inspeção",
            "Portagens e Estacionamento",
            "Transportes Públicos e TVDE",
            "Outros",
        ],
    ),
    ("Bens de Consumo", "saida", ["Vestuário", "Cosmética", "Tecnologia", "Outros"]),
    (
        "Saúde e Autocuidado",
        "saida",
        ["Consultas e Exames", "Tratamentos e Medicamentos", "Ginásio e Desporto", "Serviços de Bem-Estar", "Outros"],
    ),
    ("Educação", "saida", ["Cursos e Formações", "Livros e Material", "Outros"]),
    ("Entretenimento", "saida", ["Viagens", "Eventos", "Subscrições", "Outros"]),
    # --- Saídas: quatro excepções por TIPO de evento financeiro (ver a nota no topo) ---
    ("Seguros", "saida", ["Habitação", "Automóvel", "Saúde", "Vida", "Outros"]),
    ("Impostos e Encargos", "saida", ["IRS", "IUC", "IMI", "Coimas", "Juros", "Comissões", "Outros"]),
    ("Compra de Ativos", "saida", ["Imóveis", "Veículos", "Equipamentos", "Ativos Financeiros", "Outros"]),
    ("Transferências", "saida", ["Entre Contas Bancárias", "Levantamento em Numerário", "Outros"]),
    ("Outras Saídas", "saida", ["Presentes", "Donativos", "Quotas", ("Outros", True)]),
]


async def semear_categorias(db: AsyncSession, user_id: uuid.UUID) -> None:
    """
    Cria a ARVORE_PADRAO para este utilizador, se ele ainda não tiver
    nenhuma categoria própria.

    Chamada duas vezes na aplicação: uma vez no registo (app/routers/
    auth.py), na mesma transacção que cria o utilizador — se a semente
    falhasse a meio, o registo inteiro é desfeito, em vez de deixar um
    utilizador com uma árvore de categorias incompleta; e uma vez em
    backend/scripts/semear_dados.py, para o utilizador de demonstração que
    já existia antes desta funcionalidade.

    A verificação "já tem categorias?" torna esta função idempotente:
    corrê-la outra vez sobre um utilizador que já tem a sua árvore (mesmo
    que entretanto a tenha editado) não faz nada, em vez de duplicar tudo.
    Não faz sentido verificar categoria a categoria — se a primeira leitura
    já não encontrar nenhuma linha, sabemos que a árvore inteira está por
    criar.
    """
    ja_tem_categorias = await db.scalar(
        select(Categoria.id).where(Categoria.user_id == user_id).limit(1)
    )
    if ja_tem_categorias is not None:
        return

    for nome_grupo, direcao, subcategorias in ARVORE_PADRAO:
        grupo = Categoria(user_id=user_id, parent_id=None, nome=nome_grupo, direcao=direcao)
        db.add(grupo)
        # Tal como em backend/scripts/semear_dados.py: o "default=uuid.uuid4"
        # da coluna id só é resolvido no INSERT — um flush força-o agora,
        # para as subcategorias já poderem referenciar grupo.id como
        # parent_id, sem terminar a transacção (isso cabe a quem chamar
        # esta função).
        await db.flush()

        for entrada in subcategorias:
            # Uma subcategoria vem como só o nome (o caso comum, protegida
            # fica no valor por omissão da coluna, False) ou como um par
            # (nome, protegida) — só usado nos dois "Outros" descritos na
            # nota PROTEGIDA no topo do ficheiro.
            if isinstance(entrada, tuple):
                nome_subcategoria, protegida = entrada
            else:
                nome_subcategoria, protegida = entrada, False

            db.add(
                Categoria(
                    user_id=user_id,
                    parent_id=grupo.id,
                    nome=nome_subcategoria,
                    direcao=direcao,
                    protegida=protegida,
                )
            )
