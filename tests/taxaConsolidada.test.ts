import { describe, expect, it } from 'vitest';
import { calcularTaxaAno, consolidarRubricas } from '../utils/taxaConsolidada';

describe('rubrica consolidada (Fluxo de caixa ← Taxa condominial)', () => {
  const dados = {
    rubricas: [
      { numero: 1, descricao: 'Telhados', destino: 'TC', valorPrevisto: 1000, descontoGeral: 0, criterio: 'LOTACAO', percentualOM: 100, percentualNavios: 0, modoNavios: 'SEPARADO' },
      { numero: 2, descricao: 'Coleta industrial', destino: 'TC', valorPrevisto: 500, descontoGeral: 500, criterio: 'LOTACAO', percentualOM: 100, percentualNavios: 0, modoNavios: 'SEPARADO' },
      { numero: 3, descricao: 'Sem ninguém', destino: 'TC', valorPrevisto: 300, descontoGeral: 0, criterio: 'LOTACAO', percentualOM: 100, percentualNavios: 0, modoNavios: 'SEPARADO' },
      { numero: 9, descricao: 'Só PAR', destino: 'PAR', valorPrevisto: 999, descontoGeral: 0 },
    ],
    lotacoes: [{ omId: 'a', lotacao: 30, dias: 30 }, { omId: 'b', lotacao: 10, dias: 30 }],
    matriz: new Set(['1|a', '1|b', '2|a', '2|b']),
    descontos: [{ id: 'd1', omId: 'a', rubrica: 1, tipo: 'VALOR' as const, valor: 100, justificativa: 'x' }],
    atracacaoAnual: [], classes: [],
    oms: [{ id: 'a', nome: 'OM A', tipo: 'TERRA', ativo: true }, { id: 'b', nome: 'OM B', tipo: 'TERRA', ativo: true }],
  };
  const calc = calcularTaxaAno(dados as any, 2026, []);
  const c = consolidarRubricas(dados as any, calc);
  it('só as rubricas da taxa (sem PAR), em ordem', () => expect(c.map(r => r.numero)).toEqual([1, 2, 3]));
  it('valor final = vigente − descontos das OM (rubrica 1: 1.000 − 100 = 900)', () => {
    expect(c[0]).toMatchObject({ vigente: 1000, descontosOM: 100, final: 900, semParticipante: false });
  });
  it('desconto geral total zera a rubrica; rubrica sem participante não é cobrada', () => {
    expect(c[1].final).toBe(0);
    expect(c[2]).toMatchObject({ vigente: 300, final: 0, semParticipante: true });
  });
  it('soma das rubricas consolidadas = total cobrado das OM', () => {
    expect(c.reduce((s, r) => s + r.final, 0)).toBeCloseTo(calc.resultado.oms.reduce((s, o) => s + o.parcelas.reduce((t, p) => t + p.liquido, 0), 0), 2);
  });
});
