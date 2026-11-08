import { describe, expect, it } from 'vitest';
import { competenciaDe, ordenarFaturasAPagar } from '../utils/pagamentoDocumento';

describe('ordem das faturas a pagar (Recebimentos)', () => {
  it('competência (mais antiga primeiro) → vencimento → comando / UG / cliente', () => {
    const l = ordenarFaturasAPagar([
      { invoiceNumber: 'C', yearCompetence: 2026, monthCompetence: 3, dueDate: '2026-04-15', command: '81000 - Com1ºDN', ug: '81000', client: 'Presídio' },
      { invoiceNumber: 'B', yearCompetence: 2026, monthCompetence: 3, dueDate: '2026-04-15', command: '40030 - DIM', ug: '40032', client: 'Mangaratiba' },
      { invoiceNumber: 'A', yearCompetence: 2026, monthCompetence: 3, dueDate: '2026-04-15', command: '40030 - DIM', ug: '40030', client: 'DIM' },
      { invoiceNumber: 'D', yearCompetence: 2026, monthCompetence: 3, dueDate: '2026-04-10', command: '91500 - ComForS', ug: '91500', client: 'ComForS' },
      { invoiceNumber: 'E', yearCompetence: 2025, monthCompetence: 12, dueDate: '2026-01-15', command: '99999 - Z', ug: '99999', client: 'Z' },
      { invoiceNumber: 'F', yearCompetence: 2026, monthCompetence: 2, dueDate: '2026-03-15', command: '10000 - A', ug: '10000', client: 'A' },
    ]);
    expect(l.map(f => f.invoiceNumber)).toEqual(['E', 'F', 'D', 'A', 'B', 'C']);
  });
  it('competência no formato MM/AAAA', () => {
    expect(competenciaDe({ yearCompetence: 2026, monthCompetence: 3 })).toBe('03/2026');
    expect(competenciaDe({})).toBe('—');
  });
});
