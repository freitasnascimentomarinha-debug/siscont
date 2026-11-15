import { describe, it, expect } from 'vitest';
import { FaturaPainel, resumoPainel } from '../utils/painel';

const f = (o: Partial<FaturaPainel>): FaturaPainel => ({ id: 'x', numero: 'N', cliente: 'C', setor: 'S', comando: 'K', tipo: 'DA', ano: 2026, mes: 3, emissao: '2026-03-01', vencimento: '2026-04-01',
  total: 100, pago: 0, saldo: 100, cancelada: false, contestada: false, ...o });
const HOJE = '2026-11-15';

describe('painel: linhas agrupadas pelo banco = faturas uma a uma', () => {
  it('dá os mesmos totais, quantidades, faixas e agrupamentos', () => {
    const faturas = [
      f({ id: '1', vencimento: '2026-10-20', total: 100, saldo: 100 }),                 // vencida 1 a 30 dias
      f({ id: '2', vencimento: '2026-10-25', total: 50, saldo: 50 }),                   // vencida 1 a 30 dias (mesmo grupo)
      f({ id: '3', vencimento: '2027-01-10', total: 70, saldo: 70, mes: 4 }),           // a vencer
      f({ id: '4', ano: 2025, vencimento: '2025-03-01', total: 80, saldo: 80 }),        // vencida até 2025 (mais de 1 ano)
      f({ id: '5', total: 300, pago: 300, saldo: 0 }),                                   // paga
      f({ id: '6', contestada: true, total: 40, saldo: 40 }),                            // em contestação
    ];
    const agrupadas: FaturaPainel[] = [
      f({ id: 'g1', qtd: 2, vencidaDb: true, faixaDb: '1 a 30 dias', total: 150, saldo: 150 }),
      f({ id: 'g2', qtd: 1, vencidaDb: false, faixaDb: 'A vencer', total: 70, saldo: 70, mes: 4 }),
      f({ id: 'g3', qtd: 1, ano: 2025, vencidaDb: true, faixaDb: 'Mais de 1 ano', total: 80, saldo: 80 }),
      f({ id: 'g4', qtd: 1, vencidaDb: false, faixaDb: 'A vencer', total: 300, pago: 300, saldo: 0 }),
      f({ id: 'g5', qtd: 1, contestada: true, vencidaDb: false, faixaDb: 'A vencer', total: 40, saldo: 40 }),
    ];
    const a = resumoPainel(faturas, 2026, HOJE), b = resumoPainel(agrupadas, 2026, HOJE);
    expect(b.faturadoAno).toEqual(a.faturadoAno);
    expect(b.vencidas).toEqual(a.vencidas);
    expect(b.vencidasAnteriores).toEqual(a.vencidasAnteriores);
    expect(b.vencidasAno).toEqual(a.vencidasAno);
    expect(b.aVencer).toEqual(a.aVencer);
    expect(b.emAberto).toEqual(a.emAberto);
    expect(b.contestadas).toEqual(a.contestadas);
    expect(b.idade).toEqual(a.idade);
    expect(b.porMes).toEqual(a.porMes);
    expect(b.porCliente).toEqual(a.porCliente);
    expect(b.vencidas.qtd).toBe(3);
  });
});
