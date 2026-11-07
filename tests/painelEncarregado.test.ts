import { describe, it, expect } from 'vitest';
import { FaturaAberta, dividaPorCondomino, faturasDaFaixa, faturasDaOM, filtrarDivida, totalPorFaixa } from '../utils/relatorios';

const f = (id: string, cliente: string, venc: string, saldo: number, omId: string | null = null): FaturaAberta =>
  ({ id, numero: id, setor: 'DGMM', comando: 'Com X', cliente, omId, tipo: 'TC', ano: 2026, mes: 1, vencimento: venc, saldo });
const hoje = '2026-11-10';
const fs = [f('1', 'Alfa', '2026-12-01', 100, 'a'), f('2', 'Alfa', '2026-10-01', 200, 'a'), f('3', 'Beta', '2025-01-01', 500, 'b'), f('4', 'Gama', '2026-12-31', 50)];

describe('painel do Encarregado', () => {
  it('faturas por faixa de atraso e total por faixa', () => {
    expect(faturasDaFaixa(fs, 'A vencer', hoje).map(x => x.id)).toEqual(['1', '4']);
    expect(faturasDaFaixa(fs, '31–90 dias', hoje).map(x => x.id)).toEqual(['2']);
    expect(faturasDaFaixa(fs, 'Mais de 1 ano', hoje).map(x => x.id)).toEqual(['3']);
    const t = totalPorFaixa(fs, hoje);
    expect(t.find(x => x.faixa === 'A vencer')).toMatchObject({ valor: 150, qtd: 2 });
    expect(t.reduce((s, x) => s + x.valor, 0)).toBe(850);
  });
  it('abre as faturas de uma OM pela mesma chave da tabela', () => {
    const l = dividaPorCondomino(fs, hoje);
    expect(faturasDaOM(fs, l.find(x => x.cliente === 'Alfa')!.chave).map(x => x.id)).toEqual(['1', '2']);
    expect(faturasDaOM(fs, l.find(x => x.cliente === 'Gama')!.chave).map(x => x.id)).toEqual(['4']);
  });
  it('filtra e ordena a tabela de dívida', () => {
    const l = dividaPorCondomino(fs, hoje);
    const base = { busca: '', soVencidas: false, campo: 'total' as const, asc: false };
    expect(filtrarDivida(l, base).map(x => x.cliente)).toEqual(['Beta', 'Alfa', 'Gama']);
    expect(filtrarDivida(l, { ...base, asc: true }).map(x => x.cliente)).toEqual(['Gama', 'Alfa', 'Beta']);
    expect(filtrarDivida(l, { ...base, soVencidas: true }).map(x => x.cliente)).toEqual(['Beta', 'Alfa']);
    expect(filtrarDivida(l, { ...base, busca: 'ALF' }).map(x => x.cliente)).toEqual(['Alfa']);
    expect(filtrarDivida(l, { ...base, campo: 'cliente', asc: true }).map(x => x.cliente)).toEqual(['Alfa', 'Beta', 'Gama']);
    expect(filtrarDivida(l, { ...base, campo: 'maisAntiga', asc: true }).map(x => x.cliente)[0]).toBe('Beta');
  });
});
