import { describe, expect, it } from 'vitest';
import { modeloHistorico, modeloMapaAtracacao, modeloProposta, modeloRateio } from '../utils/modelos';
import { lerHistorico, lerProposta } from '../utils/taxaCondominialImport';
import { lerMapaAtracacao, lerRateio } from '../utils/importMedicoes';

const aba = (m: ReturnType<typeof modeloProposta>, nome: string) => m.abas.find(a => a.nome === nome)!.linhas as any[][];

describe('planilhas modelo são lidas pelos próprios importadores', () => {
  it('proposta: rubricas (com "Navios" para as diárias), matriz, lotações e descontos', () => {
    const m = modeloProposta(2027);
    const p = lerProposta(m.abas.map(a => ({ nome: a.nome, linhas: a.linhas as any[][] })));
    expect(p.avisos).toEqual([]);
    expect(p.rubricas.map(r => [r.numero, r.destino])).toEqual([[1, 'TC'], [2, 'DA']]);
    expect(p.matriz).toHaveLength(2);
    expect(p.lotacoes.map(l => l.navio)).toEqual([false, false, true]);
    expect(p.descontos.map(d => d.rubrica)).toEqual([1, 3]);
    expect(aba(m, 'Despesas_NOVO')[0]).toContain('VALOR PARA 2027 (R$)');
  });
  it('histórico trienal: uma aba por ano', () => {
    const m = modeloHistorico(2027, ['Corvetas Classe Barroso']);
    expect(m.abas.map(a => a.nome)).toEqual(['2024', '2025', '2026']);
    (m.abas[0].linhas[2] as any[])[2] = 10;
    const h = lerHistorico(m.abas.map(a => ({ nome: a.nome, linhas: a.linhas as any[][] })));
    expect(h.find(x => x.ano === 2024)).toMatchObject({ classe: 'Corvetas Classe Barroso', dias: 10 });
  });
  it('rateio da divisão: vem com as OM e, preenchido, é lido', () => {
    const m = modeloRateio('EL', '2026-10', [{ codigo: '40030', nome: 'DIM' }, { codigo: '81100', nome: 'AMRJ' }], 'Divisão de Energia');
    expect(m.instrucoes[0]).toContain('Divisão de Energia');
    const l = m.abas[0].linhas as any[][];
    l[2][4] = 1500; l[2][6] = 1234.5;
    const r = lerRateio(l);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ sigla: 'EL', codigo: '40030', consumo: 1500, valor: 1234.5 });
  });
  it('mapa de atracação: competência, gerência e navios', () => {
    const m = modeloMapaAtracacao('2026-02', ['Corveta Barroso'], 'G2');
    const l = m.abas[0].linhas as any[][];
    l[3][1] = 'A'; l[3][2] = 'D';
    const r = lerMapaAtracacao(l);
    expect(r.competencia).toBe('2026-02');
    expect(r.gerencia).toBe('G2');
    expect(r.navios[0]).toMatchObject({ nome: 'Corveta Barroso', atracado: 1, docado: 1 });
    expect(r.navios[0].dias).toHaveLength(28);
  });
});

import { modeloSubsidios } from '../utils/modelos';
import { lerSubsidios } from '../utils/taxaCondominialImport';
describe('modelo de subsídios', () => {
  it('vem com as rubricas na aba JUSTIFICATIVAS e é lido de volta', () => {
    const m = modeloSubsidios(2026, [{ numero: 1, descricao: 'Telhados' }, { numero: 2, descricao: 'Marquises' }]);
    const j = m.abas.find(a => a.nome === 'JUSTIFICATIVAS')!.linhas as any[][];
    j[1][2] = 'Contrato vigente';
    const r = lerSubsidios(m.abas.map(a => ({ nome: a.nome, linhas: a.linhas as any[][] })));
    expect(r.justificativas).toEqual([{ rubrica: 1, texto: 'Contrato vigente' }]);
    expect(r.subsidios).toEqual([]); // linha EXEMPLO ignorada
  });
});
