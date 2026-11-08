/**
 * Pagar faturas já ao incluir a ALTCRED/GRU: distribui o valor do documento entre as faturas escolhidas.
 * O valor digitado numa fatura é respeitado (até o saldo dela); as demais recebem o que sobrar, na ordem escolhida.
 */
const r2 = (n: number) => Math.round(n * 100) / 100;

export interface FaturaAPagar { id: string; saldo: number }
export interface ItemPagamento { id: string; valor: number }

export function distribuirPagamento(valorDoc: number, selecionadas: FaturaAPagar[], manuais: Record<string, number | undefined> = {}): ItemPagamento[] {
  const limite = (f: FaturaAPagar, v: number) => r2(Math.max(0, Math.min(v, f.saldo)));
  const fixos = new Map<string, number>();
  selecionadas.forEach(f => { const m = manuais[f.id]; if (m !== undefined && !Number.isNaN(m)) fixos.set(f.id, limite(f, m)); });
  let resta = r2(valorDoc - [...fixos.values()].reduce((s, v) => s + v, 0));
  return selecionadas.map(f => {
    if (fixos.has(f.id)) return { id: f.id, valor: fixos.get(f.id)! };
    const v = limite(f, Math.max(0, resta));
    resta = r2(resta - v);
    return { id: f.id, valor: v };
  });
}

export function resumoPagamento(valorDoc: number, itens: ItemPagamento[]) {
  const selecionado = r2(itens.reduce((s, i) => s + i.valor, 0));
  return { selecionado, sobra: r2(valorDoc - selecionado), excedeu: selecionado > valorDoc + 0.005 };
}

/** Saldo a pagar da fatura (o calculado pelo sistema, que já considera adiantamentos, pagamentos e quitação externa). */
export const saldoDaFatura = (f: { saldoAPagar?: number; value: number; adjustmentAddition?: number; adjustmentDeduction?: number }, jaBaixado = 0) =>
  r2(f.saldoAPagar ?? Math.max(0, f.value + (f.adjustmentAddition || 0) - (f.adjustmentDeduction || 0) - jaBaixado));

/**
 * Ordem das faturas a pagar (Recebimentos): competência (a mais antiga primeiro), data de vencimento e, por último,
 * em ordem alfabética de comando / UG / cliente.
 */
export interface FaturaOrdenavel { yearCompetence?: number; monthCompetence?: number; dueDate?: string; command?: string; ug?: string; client?: string; invoiceNumber?: string }
export const competenciaDe = (f: FaturaOrdenavel) => (f.yearCompetence && f.monthCompetence ? `${String(f.monthCompetence).padStart(2, '0')}/${f.yearCompetence}` : '—');
export function ordenarFaturasAPagar<T extends FaturaOrdenavel>(lista: T[]): T[] {
  const comp = (f: T) => (f.yearCompetence || 9999) * 100 + (f.monthCompetence || 99);
  const txt = (f: T) => `${f.command || ''}\u0000${f.ug || ''}\u0000${f.client || ''}`;
  return [...lista].sort((a, b) => comp(a) - comp(b) || (a.dueDate || '9999').localeCompare(b.dueDate || '9999')
    || txt(a).localeCompare(txt(b), 'pt-BR', { sensitivity: 'base' }) || (a.invoiceNumber || '').localeCompare(b.invoiceNumber || ''));
}
