import { describe, it, expect } from 'vitest';
import { FaturaHist, OMFat, apurarOnd, calcularOnd, estimativasJaEmitidas } from '../utils/faturamento';
import { LinhaRegime } from '../utils/regimeOnd';
import { filtrarEncerramento, indicadoresEncerramento, linhasEncerramento } from '../utils/encerramento';
import { RELATORIOS_ENC, montarRelatorio } from '../utils/relatoriosEncerramento';

const om = (id: string): OMFat => ({ id, codigo: id.toUpperCase().padStart(5, '4'), nome: `OM ${id}`, tipo: 'TERRA', comandoId: 'c1', setor: 'DGMM', comando: '40030 - DIM', ativo: true });
const servicos = ['AE:Água', 'EL:Eletricidade', 'TL:Telefonia'].map(x => { const [sigla, nome] = x.split(':'); return { sigla, nome, unidade: '-' }; });
const R = (o: Partial<LinhaRegime> & { escopo: 'SERVICO' | 'OM'; sigla: string }): LinhaRegime => ({ anoInicio: 2026, regime: 1, omId: null, criadoEm: '2026-01-01', ...o });
const H = (omId: string, sigla: string, mes: number, valor: number, extra: Partial<FaturaHist> = {}): FaturaHist => ({ id: `${omId}${sigla}${mes}${valor}${Math.random()}`, numero: `${omId}-${sigla}-${String(mes).padStart(2, '0')}-2026-001-0`, omId, sigla, ano: 2026, mes, valor, ...extra });
const janAgo = (omId: string, sigla: string, v = 1000) => [1, 2, 3, 4, 5, 6, 7, 8].map(m => H(omId, sigla, m, v));
const med = (comp: string, sigla: string, omId: string, valor: number) => ({ competencia: comp, sigla, omId, quantidade: valor / 10, valor, estimada: false });

describe('estimativa de outubro (divisor 8, meses sem movimento, duplicidade)', () => {
  const base = (hist: FaturaHist[], extra: object = {}) => ({ competencia: '2026-10', tipo: 'OND' as const, oms: [om('a')], servicos, precos: [], medicoes: [], atracacoes: [], historico: hist, ...extra });

  it('cenário 5: serviço sem histórico suficiente (mês sem fatura e sem a marca) fica BLOQUEADO; nunca presume consumo zero', () => {
    const hist = [1, 2, 3, 4, 5, 6].map(m => H('a', 'AE', m, 800));    // faltam JUL e AGO
    const it = calcularOnd(base(hist))[0];
    expect(it.bloqueio).toMatch(/Faltam as faturas de JUL, AGO\/2026/);
    expect((it.base as any).mesesFaltantes).toEqual([7, 8]);
    expect(it.valor).toBe(1800);      // 3 × (4.800 ÷ 8): o divisor continua 8
  });
  it('meses marcados como "sem movimento" valem zero e liberam a estimativa (3 × média ÷ 8)', () => {
    const hist = [1, 2, 3, 4, 5, 6].map(m => H('a', 'AE', m, 800));
    const it = calcularOnd(base(hist, { semMovimento: [{ omId: 'a', sigla: 'AE', ano: 2026, mes: 7 }, { omId: 'a', sigla: 'AE', ano: 2026, mes: 8 }] }))[0];
    expect(it.bloqueio).toBeUndefined(); expect(it.valor).toBe(1800);
    expect((it.base as any).mesesSemMovimento).toEqual([7, 8]);
  });
  it('média com os 8 meses: R$ 8.600 ÷ 8 = 1.075 × 3 = 3.225 (exemplo da especificação)', () => {
    const v = [1000, 1200, 900, 1100, 1000, 1200, 1000, 1200];
    const it = calcularOnd(base(v.map((x, i) => H('a', 'AE', i + 1, x))))[0];
    expect((it.base as any).mediaMensal).toBe(1075); expect(it.valor).toBe(3225); expect(it.bloqueio).toBeUndefined();
  });
  it('cenário 14: estimativa duplicada — quem já tem fatura de outubro no exercício não entra de novo', () => {
    const hist = [...janAgo('a', 'AE'), H('a', 'AE', 10, 3000, { estimado: true }), ...janAgo('a', 'EL')];
    const d = base(hist);
    expect(calcularOnd(d).map(i => `${i.omId}|${i.sigla}`)).toEqual(['a|EL']);
    expect(estimativasJaEmitidas(d)).toEqual([{ omId: 'a', sigla: 'AE' }]);
  });
  it('cenários 1 a 4: OM só com serviços no regime 1, só no 2, mistos e sem participação', () => {
    const hist = [...janAgo('a', 'AE'), ...janAgo('a', 'EL'), ...janAgo('b', 'AE'), ...janAgo('b', 'EL'), ...janAgo('c', 'AE'), ...janAgo('c', 'EL'), ...janAgo('d', 'AE'), ...janAgo('d', 'EL')];
    const regimesOnd = [R({ escopo: 'SERVICO', sigla: 'AE', regime: 1 }), R({ escopo: 'SERVICO', sigla: 'EL', regime: 1 }),
      R({ escopo: 'OM', sigla: 'AE', omId: 'b', regime: 2 }), R({ escopo: 'OM', sigla: 'EL', omId: 'b', regime: 2 }),     // b: tudo mensal
      R({ escopo: 'OM', sigla: 'EL', omId: 'c', regime: 3 }),                                                           // c: AE estima, EL não participa
      R({ escopo: 'OM', sigla: 'AE', omId: 'd', regime: 3 }), R({ escopo: 'OM', sigla: 'EL', omId: 'd', regime: 3 })];   // d: fora de tudo
    const d = base(hist, { regimesOnd, oms: ['a', 'b', 'c', 'd'].map(om) });
    expect(calcularOnd(d).map(i => `${i.omId}|${i.sigla}`).sort()).toEqual(['a|AE', 'a|EL', 'c|AE']);
  });
});

describe('apuração anual do acerto', () => {
  const oms = [om('a')];
  const estim = (valor: number, extra: Partial<FaturaHist> = {}) => H('a', 'AE', 10, valor, { estimado: true, ...extra });
  const base = (hist: FaturaHist[], medicoes: ReturnType<typeof med>[], extra: object = {}) => ({ competencia: '2027-01', tipo: 'ACERTO' as const, anoOnd: 2026, oms, servicos, precos: [], medicoes, atracacoes: [], historico: hist, ...extra });
  const reais = (o: number, n: number, d: number) => [med('2026-10', 'AE', 'a', o), med('2026-11', 'AE', 'a', n), med('2026-12', 'AE', 'a', d)];

  it('cenário 6: real maior que o estimado → fatura de acerto a pagar (débito complementar de R$ 300)', () => {
    const r = apurarOnd(base([estim(3000)], reais(1200, 1100, 1000)));
    expect(r.itens).toHaveLength(1);
    expect(r.itens[0].valor).toBe(3300); expect(r.itens[0].debito).toBe(3000); expect((r.itens[0].base as any).aPagar).toBe(300);
    expect(r.apuracoes[0]).toMatchObject({ resultado: 'DEBITO', diferenca: 300, estimado: 3000, real: 3300 });
  });
  it('cenário 7: real menor → fatura com crédito da OM de R$ 200 (o estimado bruto é a base do acerto)', () => {
    const r = apurarOnd(base([estim(3000)], reais(900, 1000, 900)));
    expect((r.itens[0].base as any).credito).toBe(200); expect(r.itens[0].valor).toBe(2800); expect(r.itens[0].debito).toBe(2800);
    expect(r.apuracoes[0].resultado).toBe('CREDITO');
  });
  it('cenário 8: real igual → sem fatura e sem crédito; a apuração fica registrada como "sem diferença"', () => {
    const r = apurarOnd(base([estim(3000)], reais(1000, 1000, 1000)));
    expect(r.itens).toEqual([]); expect(r.semDiferenca).toHaveLength(1); expect(r.semDiferenca[0]).toMatchObject({ resultado: 'SEM_DIFERENCA', diferenca: 0 });
  });
  it('exige os três meses: faltando um, a fatura sai BLOQUEADA e não há apuração; "sem movimento" libera', () => {
    const f = apurarOnd(base([estim(3000)], [med('2026-10', 'AE', 'a', 1200), med('2026-11', 'AE', 'a', 1100)]));
    expect(f.itens[0].bloqueio).toMatch(/Faltam os subsídios reais de DEZ\/2026/); expect(f.apuracoes).toEqual([]);
    const ok = apurarOnd(base([estim(3000)], [med('2026-10', 'AE', 'a', 1200), med('2026-11', 'AE', 'a', 1100)], { semMovimento: [{ omId: 'a', sigla: 'AE', ano: 2026, mes: 12 }] }));
    expect(ok.itens[0].bloqueio).toBeUndefined(); expect(ok.itens[0].valor).toBe(2300); expect(ok.apuracoes[0].memoria).toMatchObject({ mesesSemMovimento: [12] });
  });
  it('cenário 15: processar o mesmo acerto de novo — apuração já registrada ou fatura de acerto emitida não repete', () => {
    const apur = { omId: 'a', sigla: 'AE', exercicio: 2026, estimado: 3000, real: 3300, diferenca: 300, resultado: 'DEBITO' as const };
    const a = apurarOnd(base([estim(3000)], reais(1200, 1100, 1000), { apuracoes: [apur] }));
    expect(a.itens).toEqual([]); expect(a.jaApuradas).toHaveLength(1);
    const b = apurarOnd(base([estim(3000), H('a', 'AE', 1, 3300, { acertoDe: estim(3000).numero })], reais(1200, 1100, 1000)));
    expect(b.itens).toEqual([]);
    const cancelada = apurarOnd(base([estim(3000)], reais(1200, 1100, 1000), { apuracoes: [{ ...apur, canceladaEm: '2027-02-01', canceladaMotivo: 'x' }] }));
    expect(cancelada.itens).toHaveLength(1);      // apuração cancelada: pode apurar de novo
  });
  it('cenário 16: correção de subsídio depois de lançado — a apuração usa o valor corrigido', () => {
    const antes = apurarOnd(base([estim(3000)], reais(1200, 1100, 1000)));
    const depois = apurarOnd(base([estim(3000)], reais(1200, 1100, 900)));
    expect(antes.itens[0].valor).toBe(3300); expect(depois.itens[0].valor).toBe(3200);
  });
  it('a estimativa importada (sem marca) de uma OM no regime 1 e sem fatura de nov/dez também é apurada', () => {
    const regimesOnd = [R({ escopo: 'SERVICO', sigla: 'AE', regime: 1 })];
    const r = apurarOnd(base([H('a', 'AE', 10, 3000)], reais(1200, 1100, 1000), { regimesOnd }));
    expect(r.itens).toHaveLength(1);
    const mensal = apurarOnd(base([H('a', 'AE', 10, 3000), H('a', 'AE', 11, 1000)], reais(1200, 1100, 1000), { regimesOnd }));
    expect(mensal.itens).toEqual([]);      // faturou mês a mês: não é estimativa
  });
});

describe('acompanhamento do encerramento e relatórios', () => {
  const oms = [{ id: 'a', codigo: '4444A', nome: 'OM a' }, { id: 'b', codigo: '4444B', nome: 'OM b' }];
  const regimes = [R({ escopo: 'SERVICO', sigla: 'AE', regime: 1 })];
  const historico = [...janAgo('a', 'AE'), H('a', 'AE', 10, 3000, { estimado: true }), ...janAgo('b', 'AE')];
  const entrada = (apuracoes: any[] = [], medicoes: any[] = []) => {
    const d = { competencia: '2027-01', tipo: 'ACERTO' as const, anoOnd: 2026, oms: [om('a'), om('b')], servicos, precos: [], medicoes, atracacoes: [], historico, regimesOnd: regimes, apuracoes };
    return { ano: 2026, oms, servicos: [{ sigla: 'AE', nome: 'Água' }], regimes, historico, apuracao: apurarOnd(d), apuracoes, semMovimento: [] };
  };
  const sit = (ls: ReturnType<typeof linhasEncerramento>, id: string) => ls.find(l => l.omId === id)!.situacao;

  it('situações: pendente de estimativa, aguardando, parcial, pronto, e o resultado da apuração', () => {
    expect(sit(linhasEncerramento(entrada()), 'b')).toBe('Pendente de estimativa');
    expect(sit(linhasEncerramento(entrada()), 'a')).toBe('Aguardando subsídios reais');
    expect(sit(linhasEncerramento(entrada([], [med('2026-10', 'AE', 'a', 1000)])), 'a')).toBe('Subsídios parcialmente lançados');
    const tres = [med('2026-10', 'AE', 'a', 1200), med('2026-11', 'AE', 'a', 1100), med('2026-12', 'AE', 'a', 1000)];
    expect(sit(linhasEncerramento(entrada([], tres)), 'a')).toBe('Pronto para apuração');
    const ap = (resultado: string, dif: number, extra = {}) => [{ omId: 'a', sigla: 'AE', exercicio: 2026, estimado: 3000, real: 3000 + dif, diferenca: dif, resultado, acertoNumero: 'x', ...extra }];
    expect(sit(linhasEncerramento(entrada(ap('DEBITO', 300), tres)), 'a')).toBe('Fatura complementar gerada');
    expect(sit(linhasEncerramento(entrada(ap('CREDITO', -200), tres)), 'a')).toBe('Crédito registrado');
    expect(sit(linhasEncerramento(entrada(ap('SEM_DIFERENCA', 0), tres)), 'a')).toBe('Sem diferença');
    expect(sit(linhasEncerramento(entrada(ap('DEBITO', 300, { canceladaEm: '2027-02-01', canceladaMotivo: 'x' }), tres)), 'a')).toBe('Apuração cancelada');
  });
  it('indicadores e filtros', () => {
    const tres = [med('2026-10', 'AE', 'a', 1200), med('2026-11', 'AE', 'a', 1100), med('2026-12', 'AE', 'a', 1000)];
    const ls = linhasEncerramento(entrada([{ omId: 'a', sigla: 'AE', exercicio: 2026, estimado: 3000, real: 3300, diferenca: 300, resultado: 'DEBITO', acertoNumero: 'x' }], tres));
    const ind = indicadoresEncerramento(ls, []);
    expect(ind).toMatchObject({ omsParticipantes: 2, faturasEstimativas: 1, valorEstimado: 3000, apuracoesConcluidas: 1, debitosComplementares: 300, creditosGerados: 0, subsidiosPendentes: 0 });
    expect(filtrarEncerramento(ls, { situacao: 'Pendente de estimativa' }).map(l => l.omId)).toEqual(['b']);
    expect(filtrarEncerramento(ls, { acerto: 'feito' }).map(l => l.omId)).toEqual(['a']);
  });
  it('os 8 relatórios são montados (cabeçalho e linhas) a partir dos mesmos dados', () => {
    const ls = linhasEncerramento(entrada());
    const ind = indicadoresEncerramento(ls, []);
    RELATORIOS_ENC.forEach(r => {
      const rel = montarRelatorio(r.id, 2026, ls, [], id => id, ind);
      expect(rel.head.length).toBeGreaterThan(1);
      rel.rows.forEach(l => expect(l.length).toBe(rel.head.length));
    });
    expect(montarRelatorio('estimativas', 2026, ls, [], id => id, ind).rows[0][0]).toMatch(/a-AE-10-2026/);
    expect(montarRelatorio('pendentes', 2026, ls, [], id => id, ind).rows[0][3]).toBe('OUT, NOV, DEZ');
  });
});
