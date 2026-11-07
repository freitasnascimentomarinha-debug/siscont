/**
 * Ordem da lista de faturas: competência → vencimento → cliente (alfabética) → número.
 * A coluna escolhida passa a ser a primeira chave; as demais desempatam nessa mesma sequência.
 */
export type CampoOrdem = 'competencia' | 'vencimento' | 'cliente' | 'numero';
export interface Ordem { campo: CampoOrdem; asc: boolean }
export const ORDEM_PADRAO: Ordem = { campo: 'competencia', asc: false };

interface F { yearCompetence: number; monthCompetence: number; dueDate: string; client: string; invoiceNumber: string }
const comp = (f: F) => (f.yearCompetence || 0) * 100 + (f.monthCompetence || 0);
const alfa = (a: string, b: string) => (a || '').localeCompare(b || '', 'pt-BR', { sensitivity: 'base', numeric: true });
const CHAVES: Record<CampoOrdem, (a: F, b: F) => number> = {
  competencia: (a, b) => comp(a) - comp(b),
  vencimento: (a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'),
  cliente: (a, b) => alfa(a.client, b.client),
  numero: (a, b) => alfa(a.invoiceNumber, b.invoiceNumber),
};
/** Desempate: competência mais recente primeiro, vencimento mais antigo primeiro, cliente A–Z, número. */
const DESEMPATE: [CampoOrdem, number][] = [['competencia', -1], ['vencimento', 1], ['cliente', 1], ['numero', 1]];

export function ordenarFaturas<T extends F>(lista: T[], ordem: Ordem = ORDEM_PADRAO): T[] {
  return [...lista].sort((a, b) => {
    const p = CHAVES[ordem.campo](a, b) * (ordem.asc ? 1 : -1);
    if (p) return p;
    for (const [c, s] of DESEMPATE) { if (c === ordem.campo) continue; const r = CHAVES[c](a, b) * s; if (r) return r; }
    return 0;
  });
}
