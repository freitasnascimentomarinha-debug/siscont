import { describe, expect, it } from 'vitest';
import { montarMapa } from '../utils/mapaAnalitico';
import { pdfCobrancaEnxuto } from '../utils/pdfArvore';

describe('PDF enxuto da cobrança', () => {
  it('uma coluna de valor; o crédito NÃO é abatido (só observação) enquanto não for atribuído às faturas', () => {
    const mapa = montarMapa(
      [{ id: 'f1', omId: 'o1', client: 'DIM', sector: 'DGMM', command: '40030 - DIM', numero: '40030-AE-01-2026-001-0', tipo: 'AE', vencimento: '2026-03-01', saldo: 1000 }],
      [{ id: 'c1', client: 'DIM', sector: 'DGMM', command: '40030 - DIM', numero: 'G1.2026.AC.00001', valor: 300 }, { id: 'c2', client: 'DIM', sector: 'DGMM', command: '40030 - DIM', numero: 'G1.2026.AC.00002', valor: 100 }],
      [{ omId: 'o1', nome: 'DIM', setor: 'DGMM', comando: '40030 - DIM' }],
      { hoje: '2026-11-08', faturas: 'vencidas' });
    const txt = pdfCobrancaEnxuto(mapa, { titulo: 'Teste', linhas: [], rotuloTotal: 'VALOR A PAGAR PELA OM' }).output();
    expect(txt).toContain('R$ 1.000,00');
    expect(txt).not.toContain('R$ 600,00');
    expect(txt).not.toContain('- R$');
    expect(txt).toContain('R$ 400,00 de cr');
    expect(txt).not.toContain('A vencer');
  });
});
