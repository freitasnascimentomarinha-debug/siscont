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
export const aceitaAdiantamento = (d: DocOperacao) => d.operation === 'ADIANTAMENTO' || !!d.sobraAdiantamento;
