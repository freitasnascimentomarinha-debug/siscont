import { describe, it, expect } from 'vitest';
import { escolherAbaRateio } from '../utils/importMedicoes';

describe('escolherAbaRateio', () => {
  const linhas: Record<string, number> = { 'PLANILHA BASE': 0, 'Edifícios BNIC - Estimados': 0, 'DADOS DA LIGHT': 0, 'RATEIO DISCRIMINADO': 26, 'DADOS BNIC-41': 32 };
  const nomes = Object.keys(linhas);
  it('prefere a aba "DADOS BNIC-41", mesmo que "DADOS DA LIGHT" venha antes na planilha', () => {
    expect(escolherAbaRateio(nomes, n => linhas[n])).toBe('DADOS BNIC-41');
  });
  it('sem a aba do BNIC-41, usa uma aba "DADOS…" que tenha rateio (nunca a da conta da distribuidora, sem linhas)', () => {
    const sem = ['DADOS DA LIGHT', 'DADOS DO RATEIO', 'OUTRA'];
    expect(escolherAbaRateio(sem, n => ({ 'DADOS DA LIGHT': 0, 'DADOS DO RATEIO': 5, OUTRA: 9 } as Record<string, number>)[n])).toBe('DADOS DO RATEIO');
  });
  it('sem "DADOS…", usa a primeira aba com rateio; e na falta de tudo, a primeira', () => {
    expect(escolherAbaRateio(['A', 'B'], n => (n === 'B' ? 3 : 0))).toBe('B');
    expect(escolherAbaRateio(['A', 'B'], () => 0)).toBe('A');
  });
});
