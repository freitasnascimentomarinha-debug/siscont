import { describe, it, expect } from 'vitest';
import { anosDosLotes, filtrarLotes, linhasPrevia, pendencias, resumoDoMes } from '../utils/resumoFaturamento';

const base = {
  comp: '2026-10',
  servicos: [{ sigla: 'TC', nome: 'Taxa Condominial' }, { sigla: 'DA', nome: 'Diária' }, { sigla: 'EL', nome: 'Energia' }, { sigla: 'AE', nome: 'Água' }, { sigla: 'AL', nome: 'Aluguel' }],
  omsTC: ['a', 'b', 'c'], medicoes: [], atracacoesRealizadas: [], precos: [], nomeOM: (id: string) => `OM ${id}`, lotes: [], faturasDaCompetencia: 0,
};
const st = (itens: any[], id: string) => itens.find(i => i.id === id)?.status;

describe('quadro de pendências do mês', () => {
  it('tudo vazio: preços, atracação e medições pendentes; só serviços medidos pedem medição', () => {
    const r = resumoDoMes(base);
    expect(['preco-TC', 'preco-DA', 'atracacao', 'medicao-EL', 'medicao-AE'].map(i => st(r, i))).toEqual(['pendente', 'pendente', 'pendente', 'pendente', 'pendente']);
    expect(r.some(i => i.id === 'medicao-AL')).toBe(false);
    expect(pendencias(r)).toBe(5);
    expect(st(r, 'lote')).toBe('info');
  });
  it('preço parcial vira aviso; completo, ok; navio com atracação sem diária é apontado', () => {
    const r = resumoDoMes({ ...base, precos: [{ sigla: 'TC', omId: 'a' }, { sigla: 'TC', omId: 'b' }, { sigla: 'DA', omId: 'n1' }], atracacoesRealizadas: [{ omId: 'n1' }, { omId: 'n2' }] });
    expect(st(r, 'preco-TC')).toBe('aviso');
    expect(st(r, 'preco-DA')).toBe('aviso');
    expect(r.find(i => i.id === 'preco-DA')!.detalhe).toContain('OM n2');
    expect(st(resumoDoMes({ ...base, precos: ['a', 'b', 'c'].map(o => ({ sigla: 'TC', omId: o })) }), 'preco-TC')).toBe('ok');
  });
  it('medição e atracação lançadas ficam ok; lote já emitido ou faturas existentes são informados', () => {
    const r = resumoDoMes({ ...base, medicoes: [{ sigla: 'EL', omId: 'a' }, { sigla: 'EL', omId: 'a' }], atracacoesRealizadas: [{ omId: 'n1' }], faturasDaCompetencia: 7 });
    expect(st(r, 'medicao-EL')).toBe('ok'); expect(r.find(i => i.id === 'medicao-EL')!.detalhe).toContain('1 OM');
    expect(st(r, 'atracacao')).toBe('ok');
    expect(st(r, 'lote')).toBe('aviso');
    expect(st(resumoDoMes({ ...base, lotes: [{ competencia: '2026-10', tipo: 'MENSAL', qtd: 9 }], faturasDaCompetencia: 9 }), 'lote')).toBe('info');
  });
});

describe('resumo: setor responsável por serviço (cadastrado, não fixo no código)', () => {
  it('mostra o responsável cadastrado; sem cadastro avisa; o rótulo do mapa não cita setor', () => {
    const resp = (s: string) => ({ EL: 'Divisão de Eletricidade', DA: 'Gerência Portuária' } as Record<string, string>)[s] ?? null;
    const r = resumoDoMes({ ...base, responsavel: resp });
    expect(r.find(i => i.id === 'medicao-EL')!.detalhe).toContain('Responsável: Divisão de Eletricidade.');
    expect(r.find(i => i.id === 'medicao-AE')!.detalhe).toContain('Responsável não cadastrado.');
    expect(r.find(i => i.id === 'atracacao')!.detalhe).toContain('Responsável: Gerência Portuária.');
    expect(r.find(i => i.id === 'atracacao')!.rotulo).not.toMatch(/BNIC/i);
  });
});

describe('lotes emitidos: filtros', () => {
  const l = (competencia: string, tipo: string) => ({ id: competencia + tipo, competencia, tipo, qtd: 1, total: 1 });
  const lotes = [l('2025-10', 'MENSAL'), l('2026-09', 'MENSAL'), l('2026-10', 'OND'), l('2026-03', 'CORRECAO')];
  it('por ano, tipo e busca (inclusive a referência OUT26), mais recente primeiro', () => {
    expect(filtrarLotes(lotes, { ano: 'TODOS', tipo: 'TODOS', busca: '' }).map(x => x.competencia)).toEqual(['2026-10', '2026-09', '2026-03', '2025-10']);
    expect(filtrarLotes(lotes, { ano: '2026', tipo: 'TODOS', busca: '' })).toHaveLength(3);
    expect(filtrarLotes(lotes, { ano: 'TODOS', tipo: 'MENSAL', busca: '' })).toHaveLength(2);
    expect(filtrarLotes(lotes, { ano: 'TODOS', tipo: 'TODOS', busca: 'out26' }).map(x => x.tipo)).toEqual(['OND']);
    expect(anosDosLotes(lotes)).toEqual(['2026', '2025']);
  });
});

describe('prévia do lote para Excel', () => {
  it('uma linha por fatura, com abatimento e valor a pagar', () => {
    const item: any = { numero: '40030-TC-10-2026-001-0', om: { codigo: '40030', nome: 'DIM' }, servico: 'Taxa Condominial', quantidade: null, unidade: '-', valor: 1000, acrescimo: 0, debito: 0, avisos: ['x'], adiantamentos: [{ docId: '1', numero: 'AC', valor: 300 }] };
    const l = linhasPrevia([item]);
    expect(l[0][0]).toBe('Número');
    expect(l[1]).toEqual(['40030-TC-10-2026-001-0', '40030', 'DIM', 'Taxa Condominial', '', '-', 1000, 300, 0, 0, 700, 'x']);
  });
});
