import { describe, it, expect } from 'vitest';
import { dataBR, dataBROuTraco, hojeISO } from '../utils/datas';

describe('datas sem fuso', () => {
  it('mostra o dia certo, sem perder 1 dia (independe do fuso do computador)', () => {
    expect(dataBR('2026-10-15')).toBe('15/10/2026');
    expect(dataBR('2026-01-01')).toBe('01/01/2026');
    expect(dataBR('2026-10-15T00:00:00+00:00')).toBe('15/10/2026');
  });
  it('vazio ou inválido', () => {
    expect(dataBR(null)).toBe(''); expect(dataBR('')).toBe(''); expect(dataBR('lixo')).toBe('');
    expect(dataBROuTraco(undefined)).toBe('—');
  });
  it('hojeISO usa o calendário local', () => {
    expect(hojeISO(new Date(2026, 9, 5, 23, 30))).toBe('2026-10-05');
  });
});
