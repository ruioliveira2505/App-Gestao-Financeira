"""
PACOTE DE SCRIPTS
====================

Pequenos programas de linha de comandos — correm-se a partir da pasta
backend/ com "uv run python -m scripts.<nome>". Nunca fazem parte da API
em si (não são rotas): são tarefas pontuais ou de manutenção, chamadas à
mão ou agendadas (ex.: por cron), nunca por um pedido HTTP.
"""
