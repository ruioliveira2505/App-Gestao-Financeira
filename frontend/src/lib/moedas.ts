/*
 * MOEDAS E FORMATAÇÃO DE DINHEIRO
 * ==============================
 *
 * O conjunto de moedas suportadas espelha o do backend
 * (backend/app/core/moedas.py) — quando uma moeda for acrescentada lá,
 * tem de ser acrescentada aqui também. (Se um dia isto se tornar um
 * incómodo, o backend passará a expor um GET /moedas e este ficheiro
 * consumi-lo-á.)
 */

// Código ISO -> nome e símbolo.
// Nem todas as moedas têm um glifo próprio em Unicode: o franco suíço não
// tem, e a forma convencional escrita é "Fr." (por vezes "SFr."). Nesses
// casos usa-se a abreviatura, não o código ISO.
export const MOEDAS: Record<string, { nome: string; simbolo: string }> = {
  EUR: { nome: 'Euro', simbolo: '€' },
  USD: { nome: 'Dólar americano', simbolo: '$' },
  GBP: { nome: 'Libra esterlina', simbolo: '£' },
  BRL: { nome: 'Real brasileiro', simbolo: 'R$' },
  CHF: { nome: 'Franco suíço', simbolo: 'Fr.' },
}

/*
 * MOEDA BASE (de apresentação)
 * ---------------------------
 * A moeda em que os totais são mostrados. Por agora está FIXA em euros.
 * Virá a ser uma definição do utilizador, e os saldos das contas noutras
 * moedas passarão a ser convertidos para ela (falta uma fonte de câmbios).
 * Enquanto isso não existe, o total em destaque é só o das contas que já
 * estão nesta moeda, e as outras aparecem resumidas à parte.
 */
export const MOEDA_BASE = 'EUR'

/**
 * Etiqueta de apresentação de uma moeda: "Nome (símbolo)" — ex.:
 * "Euro (€)". Usada tanto no seletor de moeda como na página de detalhe
 * de uma conta, para o texto ser o mesmo nos dois sítios. Uma moeda
 * desconhecida devolve o próprio código.
 */
export function etiquetaMoeda(codigo: string): string {
  const m = MOEDAS[codigo]
  return m ? `${m.nome} (${m.simbolo})` : codigo
}

// Lista pronta para preencher um seletor de moeda, por ordem alfabética
// da etiqueta.
export const OPCOES_MOEDA = Object.keys(MOEDAS)
  .map((valor) => ({ valor, etiqueta: etiquetaMoeda(valor) }))
  .sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, 'pt'))

/** Símbolo de uma moeda (ex.: "€"), ou o próprio código se for desconhecida. */
export function simboloDe(moeda: string): string {
  return MOEDAS[moeda]?.simbolo ?? moeda
}

/**
 * Formata um valor monetário (que vem da API como texto, ex.: "1234.56")
 * para apresentação em português: "1 234,56 €".
 *
 * Usa Intl.NumberFormat, que trata sozinho do separador de milhares, da
 * vírgula decimal e da posição do símbolo, para qualquer código de moeda.
 * A conversão para Number é só para exibição — a magnitude de valores de
 * finanças pessoais está muito longe do limite de precisão do Number.
 */
export function formatarDinheiro(valor: string, moeda: string): string {
  const numero = Number(valor)
  try {
    return new Intl.NumberFormat('pt-PT', {
      style: 'currency',
      currency: moeda,
    }).format(numero)
  } catch {
    // Código de moeda que o browser não reconhece: mostra o número mais o
    // código.
    return `${numero.toFixed(2)} ${moeda}`
  }
}
