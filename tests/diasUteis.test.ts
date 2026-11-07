import { describe, it, expect } from 'vitest';
import { somarDiasUteis, datasDaFatura, proximoDiaUtil, formatarDataBR } from '../utils/diasUteis';

describe('dias úteis', () => {
  it('emissão 15/09/2026 (terça) + 10 dias úteis = 29/09/2026', () => {
    expect(somarDiasUteis('2026-09-15', 10)).toBe('2026-09-29');
  });
  it('pula feriados: 15/10/2026 + 10 com 12/10 fora do intervalo e 02/11 dentro', () => {
    expect(somarDiasUteis('2026-10-15', 10)).toBe('2026-10-29');
    expect(somarDiasUteis('2026-10-23', 10, ['2026-11-02'])).toBe('2026-11-09');
  });
  it('emissão numa sexta conta a partir da segunda', () => {
    expect(somarDiasUteis('2026-05-15', 1)).toBe('2026-05-18');
  });
  it('formata em dd/mm/aaaa', () => {
    expect(formatarDataBR('2026-09-29')).toBe('29/09/2026');
  });
});

describe('certificação × vencimento', () => {
  const fer = ['2026-10-12', '2026-11-02', '2026-11-15', '2026-11-20'];
  it('certificação = emissão + 10 dias úteis; vencimento = emissão + 30 corridos', () => {
    expect(datasDaFatura('2026-09-15', { feriados: fer })).toEqual({ certificacao: '2026-09-29', vencimento: '2026-10-15' });
  });
  it('vencimento em fim de semana/feriado vai para o próximo dia útil', () => {
    // 02/10 + 30 = 01/11 (domingo) → 02/11 é Finados → 03/11
    expect(datasDaFatura('2026-10-02', { feriados: fer }).vencimento).toBe('2026-11-03');
    expect(proximoDiaUtil('2026-11-07', fer)).toBe('2026-11-09');
  });
  it('OND vence na data de certificação', () => {
    const d = datasDaFatura('2026-11-15', { ond: true, feriados: fer });
    expect(d.vencimento).toBe(d.certificacao);
  });
  it('prazos configuráveis', () => {
    expect(datasDaFatura('2026-09-15', { prazoVencimento: 45 }).vencimento).toBe('2026-10-30');
  });
});
