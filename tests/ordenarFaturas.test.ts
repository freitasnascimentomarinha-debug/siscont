import { describe, expect, it } from 'vitest';
import { ordenarFaturas } from '../utils/ordenarFaturas';

const f = (n: string, ano: number, mes: number, venc: string, cli: string) => ({ invoiceNumber: n, yearCompetence: ano, monthCompetence: mes, dueDate: venc, client: cli });
const lista = [
  f('A', 2026, 8, '2026-10-15', 'Diretoria Industrial da Marinha'),
  f('B', 2026, 9, '2026-11-14', 'AMRJ'),
  f('C', 2026, 9, '2026-10-30', 'CPMM'),
  f('D', 2026, 9, '2026-10-30', 'amazul'),
  f('E', 2025, 12, '2026-01-30', 'BNIC'),
];
describe('ordem das faturas', () => {
  it('padrão: competência mais recente › vencimento › alfabética', () => {
    expect(ordenarFaturas(lista).map(x => x.invoiceNumber)).toEqual(['D', 'C', 'B', 'A', 'E']);
  });
  it('por vencimento e por cliente (sem diferenciar maiúsculas)', () => {
    expect(ordenarFaturas(lista, { campo: 'vencimento', asc: true }).map(x => x.invoiceNumber)).toEqual(['E', 'A', 'D', 'C', 'B']);
    expect(ordenarFaturas(lista, { campo: 'cliente', asc: true }).map(x => x.client)).toEqual(['amazul', 'AMRJ', 'BNIC', 'CPMM', 'Diretoria Industrial da Marinha']);
  });
});
