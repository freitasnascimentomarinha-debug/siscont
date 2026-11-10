import { describe, expect, it } from 'vitest';
import { descreverBase, textoConsumo, unidade2 } from '../utils/faturamento';

describe('consumo e base de cálculo legíveis', () => {
  it('nunca mostra NaN e usa a unidade certa da segunda quantidade', () => {
    expect(textoConsumo({ sigla: 'AE', unidade: 'M³', quantidade: 1500, quantidade2: NaN })).toBe('1.500 M³');
    expect(textoConsumo({ sigla: 'AE', unidade: 'M³', quantidade: 1500, quantidade2: null })).toBe('1.500 M³');
    expect(textoConsumo({ sigla: 'EL', unidade: 'KWH', quantidade: 52000, quantidade2: 120 })).toBe('52.000 KWH / 120 kW');
    expect(textoConsumo({ sigla: 'VT', unidade: 'R$', quantidade: null, quantidade2: 340 })).toBe('340 km');
    expect(textoConsumo({ sigla: 'TC', unidade: 'R$', quantidade: null, quantidade2: null })).toBe('-');
    expect(unidade2('TL')).toBe('min');
  });
  it('descreve a base do acerto em frases', () => {
    const linhas = descreverBase({ regra: 'x', estimado: 100000, real: 80000, diferenca: -20000, credito: 20000, aPagar: 0, porMes: { '2026-10': 30000, '2026-11': 25000 }, faturaEstimada: '65701-AE-10-2026-001-0', creditos: [{ valor: 1 }] }, 'AE');
    expect(linhas).toContain('Estimado já faturado: R$ 100.000,00');
    expect(linhas).toContain('Consumo real: R$ 80.000,00');
    expect(linhas).toContain('Crédito da OM: R$ 20.000,00');
    expect(linhas.some(l => l.startsWith('Consumo real por mês: 10/2026 R$ 30.000,00'))).toBe(true);
    expect(linhas.join('|')).not.toMatch(/[{}"]/);
  });
});
