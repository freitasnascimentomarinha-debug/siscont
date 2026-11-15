import { describe, it, expect } from 'vitest';
import { FaturaPainel } from '../utils/painel';
import { composicaoPorTipo, faturadoXDivida, resumoPorDimensao } from '../utils/painelAgrupar';

const f = (o: Partial<FaturaPainel>): FaturaPainel => ({ id: 'x', numero: 'N', cliente: 'OM A', setor: 'S1', comando: 'K1', tipo: 'DA', ano: 2026, mes: 3, emissao: '2026-03-01', vencimento: '2026-04-01',
  total: 100, pago: 0, saldo: 100, cancelada: false, contestada: false, ...o });
const HOJE = '2026-11-15';
const dados = [
  f({ id: '1', cliente: 'OM A', setor: 'S1', comando: 'K1', tipo: 'DA', total: 100, saldo: 100 }),                                   // vencida
  f({ id: '2', cliente: 'OM A', setor: 'S1', comando: 'K1', tipo: 'AE', total: 200, saldo: 50, pago: 150, vencimento: '2027-01-01' }),   // a vencer
  f({ id: '3', cliente: 'OM B', setor: 'S2', comando: 'K1', tipo: 'DA', total: 400, saldo: 400 }),                                   // vencida
  f({ id: '4', cliente: 'OM B', setor: 'S2', comando: 'K1', tipo: 'DA', total: 80, saldo: 80, contestada: true }),                   // contestada
  f({ id: '5', cliente: 'OM B', setor: 'S2', comando: 'K1', tipo: 'DA', total: 60, saldo: 0, pago: 60 }),                            // paga
  f({ id: '6', cliente: 'OM C', setor: 'S1', comando: 'K2', tipo: 'DA', total: 999, saldo: 999, cancelada: true }),                  // cancelada: ignorada
  f({ id: '7', cliente: 'OM C', setor: 'S1', comando: 'K2', tipo: 'DA', ano: 2025, total: 30, saldo: 30 }),                          // vencida de 2025
];

describe('resumoPorDimensao', () => {
  it('soma saldo por comando e ignora canceladas', () => {
    const r = resumoPorDimensao(dados, 'comando', 'saldo', HOJE);
    expect(r.map(x => [x.nome, x.valor, x.qtd])).toEqual([['K1', 630, 5], ['K2', 30, 1]]);
    expect(r[0].vencido).toBe(500); expect(r[0].aVencer).toBe(50); expect(r[0].contestado).toBe(80);
    expect(r[0].pct + r[1].pct).toBeCloseTo(100, 0);
  });
  it('métrica faturado usa o total das faturas', () => {
    const r = resumoPorDimensao(dados, 'cliente', 'total', HOJE);
    expect(r.find(x => x.nome === 'OM B')!.valor).toBe(540);
  });
  it('linha já agrupada pelo banco conta pelo seu qtd', () => {
    const r = resumoPorDimensao([f({ qtd: 7, total: 700, saldo: 700 })], 'setor', 'saldo', HOJE);
    expect(r[0].qtd).toBe(7);
  });
});

describe('faturadoXDivida', () => {
  it('compara faturado e dívida (sem contestadas) do ano de referência', () => {
    const r = faturadoXDivida(dados, 'cliente', 2026, HOJE);
    const b = r.find(x => x.nome === 'OM B')!;
    expect(b).toMatchObject({ faturado: 540, divida: 400, contestado: 80, vencido: 400 });
    expect(b.pctDivida).toBeCloseTo(74.1, 1);
    expect(r.find(x => x.nome === 'OM C')).toBeUndefined();   // só tinha uma fatura de 2025 e uma cancelada
  });
  it('todos os anos inclui 2025', () => {
    expect(faturadoXDivida(dados, 'cliente', null, HOJE).find(x => x.nome === 'OM C')!.divida).toBe(30);
  });
});

describe('composicaoPorTipo', () => {
  it('divide a dívida por tipo, separando vencida, a vencer e contestada', () => {
    const r = composicaoPorTipo(dados, HOJE);
    expect(r.map(x => [x.tipo, x.total])).toEqual([['DA', 530], ['AE', 50]]);   // 100 + 400 + 30 (2025); a contestada (80) fica fora do total
    expect(r[0]).toMatchObject({ vencido: 530, aVencer: 0, contestado: 80 });
  });
  it('filtra por OM, comando ou setor', () => {
    const r = composicaoPorTipo(dados, HOJE, 'cliente', 'OM A');
    expect(r.map(x => [x.tipo, x.total, x.pct])).toEqual([['DA', 100, 66.7], ['AE', 50, 33.3]]);
  });
});
