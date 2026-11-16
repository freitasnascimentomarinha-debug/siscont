/**
 * Ordem da lista de faturas: competência → vencimento → cliente (alfabética) → número.
 * A coluna escolhida passa a ser a primeira chave; as demais desempatam nessa mesma sequência.
 */
export type CampoOrdem = 'competencia' | 'vencimento' | 'cliente' | 'numero' | 'status' | 'servico' | 'valor' | 'saldo';
export interface Ordem { campo: CampoOrdem; asc: boolean }
export const ORDEM_PADRAO: Ordem = { campo: 'competencia', asc: false };

interface F { yearCompetence: number; monthCompetence: number; dueDate: string; client: string; invoiceNumber: string; status?: string; type?: string }
/** Valores calculados da fatura (o valor da fatura e o saldo a pagar), para as colunas de dinheiro. */
export type Valores<T> = (f: T) => { valor: number; saldo: number };
const comp = (f: F) => (f.yearCompetence || 0) * 100 + (f.monthCompetence || 0);
const alfa = (a: string, b: string) => (a || '').localeCompare(b || '', 'pt-BR', { sensitivity: 'base', numeric: true });
const CHAVES: Record<Exclude<CampoOrdem, 'valor' | 'saldo'>, (a: F, b: F) => number> = {
  competencia: (a, b) => comp(a) - comp(b),
  vencimento: (a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'),
  cliente: (a, b) => alfa(a.client, b.client),
  numero: (a, b) => alfa(a.invoiceNumber, b.invoiceNumber),
  status: (a, b) => alfa(a.status || '', b.status || ''),
  servico: (a, b) => alfa(a.type || '', b.type || ''),
};
/** Desempate: competência mais recente primeiro, vencimento mais antigo primeiro, cliente A–Z, número. */
const DESEMPATE: [Exclude<CampoOrdem, 'valor' | 'saldo' | 'status' | 'servico'>, number][] = [['competencia', -1], ['vencimento', 1], ['cliente', 1], ['numero', 1]];

export function ordenarFaturas<T extends F>(lista: T[], ordem: Ordem = ORDEM_PADRAO, valores?: Valores<T>): T[] {
  const cache = new Map<T, { valor: number; saldo: number }>();
  const v = (f: T) => { let x = cache.get(f); if (!x) { x = valores ? valores(f) : { valor: 0, saldo: 0 }; cache.set(f, x); } return x; };
  const chave = (c: CampoOrdem, a: T, b: T) => (c === 'valor' ? v(a).valor - v(b).valor : c === 'saldo' ? v(a).saldo - v(b).saldo : CHAVES[c](a, b));
  return [...lista].sort((a, b) => {
    const p = chave(ordem.campo, a, b) * (ordem.asc ? 1 : -1);
    if (p) return p;
    for (const [c, s] of DESEMPATE) { if (c === ordem.campo) continue; const r = CHAVES[c](a, b) * s; if (r) return r; }
    return 0;
  });
}
