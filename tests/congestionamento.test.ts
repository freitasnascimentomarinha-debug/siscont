import { describe, expect, it } from 'vitest';
import { baixasPorFatura, FaturaGer } from '../utils/painelGerencial';
import { dividaTotal, planilhaCongestionamento, quadroPorODS, rotuloMes, serie13 } from '../utils/congestionamento';

const f = (o: Partial<FaturaGer>): FaturaGer => ({ id: 'x', numero: 'n', cliente: 'c', setor: 'DGMM', comando: 'k', tipo: 'EL', ano: 2026, mes: 1, emissao: '2026-02-01', vencimento: '2026-03-01', total: 1000, pago: 0, saldo: 1000, cancelada: false, contestada: false, omId: null, extra: false, quitadaExterna: false, quitadaEm: null, pontos: 0, ...o });
const idx = baixasPorFatura([{ invoiceId: 'b', docId: 'd', valor: 400, data: '2026-03-10', adiantamento: false }]);
const fs = [f({ id: 'a' }), f({ id: 'b', saldo: 600 }), f({ id: 'c', setor: 'SGM', vencimento: '2026-05-01' }), f({ id: 'd', cancelada: true }), f({ id: 'e', ano: 2025, total: 500, saldo: 500, vencimento: '2025-12-01', emissao: '2025-11-01' })];

describe('congestionamento', () => {
  it('dívida só vencida × todo em aberto, reconstruída pela data', () => {
    const q = quadroPorODS(fs, idx, '2026-11-09', '2026-04-30', 2026, 'vencido');
    expect(q.find(l => l.ods === 'DGMM')).toEqual({ ods: 'DGMM', faturamento: 2000, divida: 1600 }); // 1000 + (1000 − 400 pago em 10/03)
    expect(q.find(l => l.ods === 'SGM')!.divida).toBe(0);                                              // vence em 01/05
    expect(quadroPorODS(fs, idx, '2026-11-09', '2026-04-30', 2026, 'aberto').find(l => l.ods === 'SGM')!.divida).toBe(1000);
  });
  it('baixa posterior à data não conta', () => {
    expect(quadroPorODS(fs, idx, '2026-11-09', '2026-03-05', 2026, 'vencido').find(l => l.ods === 'DGMM')!.divida).toBe(2000);
  });
  it('total e série de 13 meses', () => {
    expect(dividaTotal(fs, idx, '2026-11-09', '2026-04-30', [2025, 2026], 'vencido')).toBe(2100);
    const s = serie13('2026-09', new Map([['2026-08', 5]]), 9);
    expect(s).toHaveLength(13); expect(s[0].mes).toBe('2025-09'); expect(s[11]).toEqual({ mes: '2026-08', valor: 5 }); expect(s[12]).toEqual({ mes: '2026-09', valor: 9 });
    expect(s[1].valor).toBeNull(); expect(rotuloMes('2026-09')).toBe('SET/2026');
  });
  it('planilha no mesmo posicionamento do modelo, com fórmulas', () => {
    const wb = planilhaCongestionamento({ mes: '2026-04', criterio: 'vencido', quadroAnterior: quadroPorODS(fs, idx, '2026-11-09', '2026-04-30', 2025, 'vencido'), quadroAtual: quadroPorODS(fs, idx, '2026-11-09', '2026-04-30', 2026, 'vencido'), serie: serie13('2026-04', new Map(), 2100) });
    const ws = wb.Sheets['Dívida Geral 2026'];
    expect(ws.A5.v).toBe('ABR/2025'); expect(ws.A17.v).toBe('ABR/2026'); expect(ws.B17.v).toBe(2100);
    expect(ws.A35.v).toBe('ODS'); expect(ws.B35.v).toBe('FATURAMENTO 2025'); expect(ws.B36.v).toBe(500);  // DGMM 2025 (alfabética: DGMM, SGM)
    expect(ws.C36.v).toBe(500); expect(ws.A37.v).toBe('SGM');
    expect(ws.B38.f).toBe('SUM(B36:B37)');
    expect(ws.A43.v).toBe('ODS'); expect(ws.B43.v).toBe('FATURAMENTO 2026');
    expect(wb.SheetNames).toEqual(['Dívida Geral 2026', 'Dívida Geral']);
  });
});
