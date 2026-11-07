import { describe, it, expect } from 'vitest';
import { SEM_FILTROS, passaFiltrosExtras, resumoCabecalho, temFiltroExtra } from '../utils/filtrosFaturas';
import { Invoice } from '../types';

const f = (p: Partial<Invoice>): Invoice => ({ id: 'x', sector: 'DGMM', command: 'Com A', client: 'OM A', omId: 'o1', value: 100, isCanceled: false, ...p } as Invoice);

describe('faturas emitidas: filtros extras', () => {
  it('sem filtros passa tudo', () => { expect(passaFiltrosExtras(f({}), SEM_FILTROS)).toBe(true); expect(temFiltroExtra(SEM_FILTROS)).toBe(false); });
  it('setor, comando e cliente excluídos', () => {
    expect(passaFiltrosExtras(f({}), { ...SEM_FILTROS, setoresExcluidos: new Set(['DGMM']) })).toBe(false);
    expect(passaFiltrosExtras(f({}), { ...SEM_FILTROS, comandosExcluidos: new Set(['Com B']) })).toBe(true);
    expect(passaFiltrosExtras(f({ client: '' }), { ...SEM_FILTROS, clientesExcluidos: new Set(['(sem)']) })).toBe(false);
  });
  it('só sem OM ligada', () => {
    const fl = { ...SEM_FILTROS, cadastro: 'sem' as const };
    expect(passaFiltrosExtras(f({ omId: null }), fl)).toBe(true);
    expect(passaFiltrosExtras(f({}), fl)).toBe(false);
  });
  it('andamento: não enviadas, não certificadas, sem SIAFI; cancelada não entra', () => {
    expect(passaFiltrosExtras(f({}), { ...SEM_FILTROS, andamento: 'naoEnviada' })).toBe(true);
    expect(passaFiltrosExtras(f({ enviadaEm: '2026-10-16' }), { ...SEM_FILTROS, andamento: 'naoEnviada' })).toBe(false);
    expect(passaFiltrosExtras(f({ certificadaEm: '2026-10-20' }), { ...SEM_FILTROS, andamento: 'naoCertificada' })).toBe(false);
    expect(passaFiltrosExtras(f({ siafiEm: '2026-10-25' }), { ...SEM_FILTROS, andamento: 'semSiafi' })).toBe(false);
    expect(passaFiltrosExtras(f({ isCanceled: true }), { ...SEM_FILTROS, andamento: 'naoEnviada' })).toBe(false);
  });
});

describe('cabeçalho', () => {
  it('conta ativas e canceladas e soma o serviço sem as canceladas', () => {
    const r = resumoCabecalho([f({ value: 100 }), f({ value: 50.5 }), f({ value: 999, isCanceled: true })]);
    expect(r).toEqual({ total: 3, ativas: 2, canceladas: 1, servico: 150.5 });
  });
});
