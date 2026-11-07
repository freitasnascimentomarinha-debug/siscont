import { describe, it, expect } from 'vitest';
import { somarDiasUteis, formatarDataBR } from '../utils/diasUteis';

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
