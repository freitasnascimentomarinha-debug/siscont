/**
 * Datas do banco vêm como "AAAA-MM-DD" (sem horário). `new Date("2026-10-15")` é lido como meia-noite UTC e,
 * no horário de Brasília, mostra 14/10: um dia a menos. Estas funções só reorganizam o texto, sem fuso.
 */
const RE = /^(\d{4})-(\d{2})-(\d{2})/;

/** "2026-10-15" (ou com horário) → "15/10/2026"; vazio ou inválido → "" */
export function dataBR(iso?: string | null): string {
  const m = RE.exec(String(iso ?? ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}
/** Igual a dataBR, mas devolve um traço quando não há data (para tabelas). */
export const dataBROuTraco = (iso?: string | null) => dataBR(iso) || '—';
/** Hoje no formato AAAA-MM-DD, pelo calendário local (não UTC). */
export function hojeISO(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
