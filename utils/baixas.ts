/**
 * Regras das baixas (ligação ALTCRED/GRU → fatura).
 * Uma mesma ALTCRED pode pagar faturas e, com a sobra, virar adiantamento ("SALDO ENVIADO PARA
 * ADIANTAMENTO"). Por isso o tipo é da BAIXA (script 006); sem ele, vale a operação do documento.
 */
export interface BaixaTipada { tipoBaixa?: 'PAGAMENTO' | 'ADIANTAMENTO' | null }
export interface DocOperacao { operation: string; sobraAdiantamento?: boolean }

export const ehAdiantamento = (b: BaixaTipada, doc?: DocOperacao | null): boolean =>
  b.tipoBaixa ? b.tipoBaixa === 'ADIANTAMENTO' : doc?.operation === 'ADIANTAMENTO';

/** Documento que pode ser usado como adiantamento ao lançar uma fatura. */
/**
 * Saldo que o documento ainda oferece para baixar faturas. Documento da operação "Outros" (ALTCRED recebida na R.901.16 para outros
 * serviços, sem fatura) não paga fatura nenhuma: não tem saldo para baixa (continua listada no Fluxo de caixa como toda ALTCRED).
 */
export const saldoDisponivelDoc = (d: { operation: string; totalValue: number; pendencia?: string | null }, usado: number): number =>
  d.operation === 'OUTROS' || !!d.pendencia?.trim() ? 0 : Math.round((d.totalValue - usado) * 100) / 100 + 0;   // "+ 0": troca -0 por 0 (evita "R$ -0,00")

export const aceitaAdiantamento = (d: DocOperacao) => d.operation === 'ADIANTAMENTO' || !!d.sobraAdiantamento;
