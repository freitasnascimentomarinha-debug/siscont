import { describe, expect, it } from 'vitest';
import { FaturaPainel, doGrupo, faixaIdade, resumoPainel, taxaCondominial } from '../utils/painel';

const f = (p: Partial<FaturaPainel>): FaturaPainel => ({
  id: Math.random().toString(36), numero: 'X', cliente: 'DIM', setor: 'DGMM', comando: '40030', tipo: 'Água e Esgoto',
  ano: 2026, mes: 1, emissao: '2026-02-15', vencimento: '2026-03-17', total: 100, pago: 0, saldo: 100, cancelada: false, contestada: false, ...p,
});
const hoje = '2026-11-07';

describe('painel inicial', () => {
  const fs = [
    f({ ano: 2024, mes: 5, vencimento: '2024-07-15', saldo: 300, total: 300 }),          // vencida ano anterior (> 1 ano)
    f({ ano: 2025, mes: 9, vencimento: '2025-11-14', saldo: 50, total: 80, pago: 30 }),  // vencida ano anterior, parcial
    f({ ano: 2026, mes: 9, vencimento: '2026-10-15', saldo: 200, total: 200 }),          // vencida 2026 (23 dias)
    f({ ano: 2026, mes: 10, vencimento: '2026-12-15', saldo: 400, total: 400, contestada: true }), // contestada: fora do em aberto
    f({ ano: 2026, mes: 10, vencimento: '2026-12-15', saldo: 400, total: 400 }), // a vencer
    f({ ano: 2026, mes: 1, saldo: 0, total: 1000, pago: 1000 }),                          // paga
    f({ ano: 2026, mes: 2, saldo: 0, total: 999, cancelada: true }),                      // cancelada
  ];
  const r = resumoPainel(fs, 2026, hoje);
  it('faturado no ano sem canceladas e % pago', () => {
    expect(r.faturadoAno).toEqual({ valor: 2000, qtd: 4 });
    expect(r.pagoAno).toBe(1000);
    expect(r.percentualPago).toBe(50);
    expect(r.faturadoAnterior).toBe(80);
  });
  it('vencidas: anos anteriores × ano; a vencer; em aberto = vencidas + a vencer (sem as contestadas)', () => {
    expect(r.vencidasAnteriores).toEqual({ valor: 350, qtd: 2 });
    expect(r.vencidasAno).toEqual({ valor: 200, qtd: 1 });
    expect(r.vencidas).toEqual({ valor: 550, qtd: 3 });
    expect(r.aVencer).toEqual({ valor: 400, qtd: 1 });
    expect(r.emAberto).toEqual({ valor: 950, qtd: 4 });
    expect(r.emAberto.valor).toBe(r.vencidas.valor + r.aVencer.valor);
    expect(r.contestadas).toEqual({ valor: 400, qtd: 1 });
    expect(doGrupo(fs, 'EM_ABERTO', 2026, hoje).some(x => x.contestada)).toBe(false);
    expect(doGrupo(fs, 'CONTESTADAS', 2026, hoje)).toHaveLength(1);
    expect(r.anosVencidos.map(a => a.ano)).toEqual([2026, 2025, 2024]);
  });
  it('idade da dívida e grupos do clique', () => {
    expect(faixaIdade(fs[2], hoje)).toBe('1 a 30 dias');
    expect(faixaIdade(fs[0], hoje)).toBe('Mais de 1 ano');
    expect(faixaIdade(fs[3], hoje)).toBe('A vencer');
    expect(r.idade.reduce((s, i) => s + i.valor, 0)).toBe(950);
    expect(doGrupo(fs, 'VENCIDAS_ANTERIORES', 2026, hoje)).toHaveLength(2);
    expect(r.porMes[8]).toMatchObject({ mes: 'SET', faturado: 200, emAberto: 200 });
    expect(r.porCliente[0]).toMatchObject({ nome: 'DIM', vencido: 550, aVencer: 400, total: 950 });
  });
  it('mudar o ano de referência move as vencidas entre "anteriores" e "do ano"', () => {
    const r25 = resumoPainel(fs, 2025, hoje);
    expect(r25.vencidasAnteriores.valor).toBe(300);
    expect(r25.vencidasAno.valor).toBe(250); // 2025 e 2026 (competência >= ano de referência)
  });
});

describe('taxa condominial no painel', () => {
  const nomes = new Map([['a', 'AMRJ'], ['s', 'SecNSNQ']]);
  it('tabela do ano: total mensal, anual e % por OM, ordenado', () => {
    const t = taxaCondominial([{ ano: 2026, sigla: 'TC', omId: 's', valor: 10057.36 }, { ano: 2026, sigla: 'TC', omId: 'a', valor: 101673.7 }, { ano: 2026, sigla: 'DA', omId: 'n', valor: 403.86 }], nomes, 2026);
    expect(t.ano).toBe(2026);
    expect(t.oms.map(o => o.nome)).toEqual(['AMRJ', 'SecNSNQ']);
    expect(t.mensal).toBe(111731.06);
    expect(t.anual).toBe(1340772.72);
    expect(t.oms[0].percentual).toBe(91);
  });
  it('sem tabela do ano: usa a mais recente anterior', () => {
    expect(taxaCondominial([{ ano: 2025, sigla: 'TC', omId: 'a', valor: 10 }], nomes, 2026).ano).toBe(2025);
    expect(taxaCondominial([], nomes, 2026)).toMatchObject({ ano: null, mensal: 0 });
  });
});
