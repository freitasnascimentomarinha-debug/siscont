import { describe, it, expect, vi, beforeEach } from 'vitest';

// Banco falso: guarda as baixas em memória e deixa a leitura "demorar" quando pedimos.
const estado = { baixas: [{ id: 'b1', documentId: 'd1', invoiceId: 'f1', amount: 100 }] as any[], atraso: null as null | Promise<void> };
vi.mock('../services/supabaseService', () => ({
  supabaseService: {
    getInvoices: async () => [{ id: 'f1', value: 100, dueDate: '2099-01-01', invoiceNumber: 'F1', client: 'X', ug: '1', type: 'TC' }],
    getDocuments: async () => [{ id: 'd1', totalValue: 100, operation: 'PAGAMENTO', documentType: 'ALTCRED', documentNumber: 'D1' }],
    getAllocations: async () => { const foto = estado.baixas.map(b => ({ ...b })); if (estado.atraso) await estado.atraso; return foto; },
    deleteAllocation: async (id: string) => { estado.baixas = estado.baixas.filter(b => b.id !== id); },
    deleteDocument: async () => undefined,
  },
}));

import { db } from '../services/db';

describe('cache do db: uma leitura que estava em andamento não pode repor o dado antigo', () => {
  beforeEach(() => { db.invalidateCache(); estado.baixas = [{ id: 'b1', documentId: 'd1', invoiceId: 'f1', amount: 100 }]; estado.atraso = null; });

  it('depois de cancelar a baixa, a fatura volta a ter saldo', async () => {
    expect((await db.getInvoices())[0].saldoAPagar).toBe(0);           // quitada pela baixa
    db.invalidateCache();
    let liberar!: () => void; estado.atraso = new Promise<void>(r => { liberar = r; });
    const leituraLenta = db.getInvoices();                              // começa ANTES do cancelamento (ex.: outra tela atualizando)
    await new Promise(r => setTimeout(r, 5));
    estado.atraso = null;
    await db.deleteAllocation('b1');                                    // cancela a baixa
    liberar(); await leituraLenta;                                      // a leitura antiga termina depois
    const f = (await db.getInvoices())[0];
    expect(f.saldoAPagar).toBe(100);
  });
});
