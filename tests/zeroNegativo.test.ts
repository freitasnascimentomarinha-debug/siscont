import { describe, expect, it } from 'vitest';
import { instalarSemZeroNegativo } from '../utils/zeroNegativo';
import { saldoDisponivelDoc } from '../utils/baixas';

describe('sem "-0,00" na tela', () => {
  instalarSemZeroNegativo();
  const f = { minimumFractionDigits: 2, maximumFractionDigits: 2 };
  it('zero negativo e resíduo de ponto flutuante viram 0,00', () => {
    expect((-0).toLocaleString('pt-BR', f)).toBe('0,00');
    expect((-0.0000000000036).toLocaleString('pt-BR', f)).toBe('0,00');
    expect((-0.004).toLocaleString('pt-BR', f)).toBe('0,00');
    expect((-0.4).toLocaleString('pt-BR', { style: 'percent' })).toMatch(/40/);
  });
  it('valores realmente negativos mantêm o sinal e os positivos não mudam', () => {
    expect((-0.01).toLocaleString('pt-BR', f)).toBe('-0,01');
    expect((-1234.5).toLocaleString('pt-BR', f)).toBe('-1.234,50');
    expect((1234.5).toLocaleString('pt-BR', f)).toBe('1.234,50');
    expect((0).toLocaleString('pt-BR', f)).toBe('0,00');
    expect((12).toLocaleString('pt-BR')).toBe('12');
  });
  it('saldo disponível nunca devolve -0', () => {
    expect(Object.is(saldoDisponivelDoc({ operation: 'PAGAMENTO', totalValue: 7856.94 }, 7856.94000000001), -0)).toBe(false);
    expect(saldoDisponivelDoc({ operation: 'PAGAMENTO', totalValue: 100 }, 100)).toBe(0);
  });
});
