import { describe, it, expect, vi } from 'vitest';

vi.mock('../services/supabaseService', () => ({
  supabaseService: {
    getDocuments: async () => [
      { id: 'a1', documentNumber: 'ALT-1', client: 'OM A', documentType: 'ALTCRED', operation: 'PAGAMENTO', totalValue: 1000, date: '2026-03-10' },
      { id: 'g1', documentNumber: 'GRU-1', client: 'Banco X', documentType: 'GRU', operation: 'PAGAMENTO', totalValue: 500, date: '2026-03-12' },
    ],
    getExits: async () => [{ id: 'e1', date: '2026-03-15', documentNumber: 'NE1', client: 'F', value: 200, isCanceled: false, documentType: 'EMPENHO' }],
  },
}));
import { db } from '../services/db';

describe('fluxo de caixa: GRU não é entrada', () => {
  it('só a ALTCRED entra como entrada recebida; a saída continua', async () => {
    db.invalidateCache();
    const itens = await db.getCashFlow();
    expect(itens.filter(i => i.type === 'ENTRY').map(i => i.documentNumber)).toEqual(['ALT-1']);
    expect(itens.find(i => i.documentNumber === 'GRU-1')).toBeUndefined();
    expect(itens.filter(i => i.type === 'EXIT')).toHaveLength(1);
    expect(itens[itens.length - 1].balanceAfter).toBe(800);   // 1.000 de entrada − 200 de saída (os 500 da GRU não contam)
  });
});
