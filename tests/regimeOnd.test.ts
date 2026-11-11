import { describe, it, expect } from 'vitest';
import { LinhaRegime, entraNaEstimativa, impactoDaMudanca, resolverRegime, rotuloRegime } from '../utils/regimeOnd';
import { OMFat, calcularOnd, foraDoOnd, participaDoOnd } from '../utils/faturamento';
import { DadosFr172, pdfFr172 } from '../utils/fr172';

const L = (o: Partial<LinhaRegime> & { escopo: 'SERVICO' | 'OM'; sigla: string; anoInicio: number }): LinhaRegime => ({ regime: 1, omId: null, criadoEm: '2026-01-01', ...o });

describe('regime de fim de exercício: decisão por serviço, exceção por OM e vigência', () => {
  const linhas: LinhaRegime[] = [
    L({ escopo: 'SERVICO', sigla: 'AE', anoInicio: 2026, regime: 1 }),
    L({ escopo: 'OM', sigla: 'AE', omId: 'b', anoInicio: 2026, regime: 3 }),
    L({ escopo: 'SERVICO', sigla: 'VT', anoInicio: 2026, regime: 3 }),
    L({ escopo: 'SERVICO', sigla: 'TC', anoInicio: 2026, regime: 1 }),
  ];
  it('serviço A: todas as OMs participam, exceto a OM B', () => {
    expect(resolverRegime(linhas, 'a', 'AE', 2026)).toMatchObject({ regime: 1, origem: 'SERVICO' });
    expect(resolverRegime(linhas, 'b', 'AE', 2026)).toMatchObject({ regime: 3, origem: 'EXCECAO' });
  });
  it('serviço B: nenhuma OM participa; serviço C: todas participam', () => {
    expect(['a', 'b', 'z'].map(o => resolverRegime(linhas, o, 'VT', 2026).regime)).toEqual([3, 3, 3]);
    expect(['a', 'b', 'z'].map(o => resolverRegime(linhas, o, 'TC', 2026).regime)).toEqual([1, 1, 1]);
  });
  it('serviço sem regra = "não configurado": segue como antes (entra na estimativa se tiver histórico)', () => {
    const e = resolverRegime(linhas, 'a', 'TL', 2026);
    expect(e).toMatchObject({ regime: null, origem: 'NAO_CONFIGURADO' });
    expect(entraNaEstimativa(e)).toBe(true);
    expect(rotuloRegime(null)).toBe('Sem regra');
  });
  it('vigência por exercício: antes do início não vale; a regra nova não recalcula os exercícios anteriores', () => {
    expect(resolverRegime(linhas, 'a', 'AE', 2025).origem).toBe('NAO_CONFIGURADO');
    const nova = [...linhas, L({ escopo: 'SERVICO', sigla: 'AE', anoInicio: 2028, regime: 3, criadoEm: '2027-05-01' })];
    expect(resolverRegime(nova, 'a', 'AE', 2027).regime).toBe(1);
    expect(resolverRegime(nova, 'a', 'AE', 2028).regime).toBe(3);
    expect(resolverRegime(nova, 'a', 'AE', 2026).regime).toBe(1);      // exercício anterior preservado
  });
  it('exceção com "seguir a regra" (regime nulo) volta ao regime do serviço; a linha mais recente vale', () => {
    const l = [...linhas, L({ escopo: 'OM', sigla: 'AE', omId: 'b', anoInicio: 2027, regime: null, criadoEm: '2026-12-01' })];
    expect(resolverRegime(l, 'b', 'AE', 2026).regime).toBe(3);
    expect(resolverRegime(l, 'b', 'AE', 2027)).toMatchObject({ regime: 1, origem: 'SERVICO' });
    const dupla = [L({ escopo: 'SERVICO', sigla: 'EL', anoInicio: 2026, regime: 1, criadoEm: '2026-01-01' }), L({ escopo: 'SERVICO', sigla: 'EL', anoInicio: 2026, regime: 2, criadoEm: '2026-03-01' })];
    expect(resolverRegime(dupla, 'a', 'EL', 2026).regime).toBe(2);
  });
});

describe('impacto da mudança: bloqueia duplicidade e estimativa sem acerto', () => {
  const linhas: LinhaRegime[] = [L({ escopo: 'SERVICO', sigla: 'AE', anoInicio: 2026, regime: 1 })];
  const f = (omId: string, mes: number, extra: object = {}) => ({ omId, sigla: 'AE', ano: 2026, mes, ...extra });
  it('exercício que já passou é recusado (não recalcula o passado)', () => {
    const i = impactoDaMudanca(linhas, { escopo: 'SERVICO', sigla: 'AE', anoInicio: 2025, regime: 3 }, ['a'], [], 2026);
    expect(i.erros[0]).toMatch(/exercícios anteriores não são recalculados/);
  });
  it('sair do regime 1 com estimativa emitida no exercício é bloqueado (precisa do acerto)', () => {
    const i = impactoDaMudanca(linhas, { escopo: 'SERVICO', sigla: 'AE', anoInicio: 2026, regime: 3 }, ['a', 'b'], [f('a', 10, { estimado: true }), f('b', 10)], 2026);
    expect(i.bloqueios.sort()).toEqual(['a', 'b']);     // 'b': fatura de outubro sem nov/dez = estimativa importada
    expect(i.itens[0].bloqueio).toMatch(/estimativa emitida/);
  });
  it('sem estimativa emitida, a mudança é permitida e mostra quantas OMs mudam', () => {
    const i = impactoDaMudanca(linhas, { escopo: 'SERVICO', sigla: 'AE', anoInicio: 2027, regime: 3 }, ['a', 'b'], [f('a', 10)], 2026);
    expect(i.bloqueios).toEqual([]); expect(i.mudam).toBe(2);
  });
  it('passar para regime 1 com faturamento mensal de nov/dez já emitido é bloqueado (duplicidade)', () => {
    const l: LinhaRegime[] = [L({ escopo: 'SERVICO', sigla: 'AE', anoInicio: 2026, regime: 2 })];
    const i = impactoDaMudanca(l, { escopo: 'OM', sigla: 'AE', omId: 'a', anoInicio: 2026, regime: 1 }, ['a'], [f('a', 10), f('a', 11)], 2026);
    expect(i.bloqueios).toEqual(['a']); expect(i.itens[0].bloqueio).toMatch(/duplicidade/);
  });
  it('faturas canceladas e de acerto não contam', () => {
    const l: LinhaRegime[] = [L({ escopo: 'SERVICO', sigla: 'AE', anoInicio: 2026, regime: 2 })];
    const i = impactoDaMudanca(l, { escopo: 'OM', sigla: 'AE', omId: 'a', anoInicio: 2026, regime: 1 }, ['a'], [f('a', 11, { cancelada: true }), f('a', 12, { acertoDe: 'X' })], 2026);
    expect(i.bloqueios).toEqual([]);
  });
});

describe('o lote OND respeita o regime (estimativa) e não muda quando não há regra', () => {
  const om = (id: string): OMFat => ({ id, codigo: id.toUpperCase().padStart(5, '4'), nome: `OM ${id}`, tipo: 'TERRA', comandoId: 'c1', setor: 'DGMM', comando: '40030 - DIM', ativo: true });
  const servicos = ['AE:Água', 'VT:Viatura', 'TL:Telefonia'].map(x => { const [sigla, nome] = x.split(':'); return { sigla, nome, unidade: '-' }; });
  const hist = ['a', 'b'].flatMap(o => ['AE', 'VT', 'TL'].flatMap(s => [1, 2, 3, 4, 5, 6, 7, 8].map(m => ({ id: `${o}${s}${m}`, numero: `n${o}${s}${m}`, omId: o, sigla: s, ano: 2026, mes: m, valor: 800 }))));
  const dados = { competencia: '2026-10', tipo: 'OND' as const, oms: [om('a'), om('b')], servicos, precos: [], medicoes: [], atracacoes: [], historico: hist };
  const chaves = (d: typeof dados & { regimesOnd?: LinhaRegime[] }) => calcularOnd(d).map(i => `${i.omId}|${i.sigla}`).sort();
  it('sem regras: comportamento de antes (todos com histórico entram)', () => {
    expect(chaves(dados)).toEqual(['a|AE', 'a|TL', 'a|VT', 'b|AE', 'b|TL', 'b|VT']);
  });
  it('AE regime 1 com exceção da OM b, VT regime 3, TL sem regra', () => {
    const regimesOnd = [L({ escopo: 'SERVICO', sigla: 'AE', anoInicio: 2026, regime: 1 }), L({ escopo: 'OM', sigla: 'AE', omId: 'b', anoInicio: 2026, regime: 3 }), L({ escopo: 'SERVICO', sigla: 'VT', anoInicio: 2026, regime: 3 })];
    expect(chaves({ ...dados, regimesOnd })).toEqual(['a|AE', 'a|TL', 'b|TL']);
    expect(foraDoOnd({ ...dados, regimesOnd })).toEqual([{ sigla: 'AE', regime: 3, qtd: 1 }, { sigla: 'VT', regime: 3, qtd: 2 }]);
    expect(participaDoOnd({ regimesOnd }, 'b', 'AE', 2026)).toBe(false);
  });
  it('o valor da estimativa continua 3 × média JAN–AGO (÷ 8) para quem participa', () => {
    const regimesOnd = [L({ escopo: 'SERVICO', sigla: 'AE', anoInicio: 2026, regime: 1 })];
    expect(calcularOnd({ ...dados, regimesOnd }).find(i => i.omId === 'a' && i.sigla === 'AE')!.valor).toBe(2400);
  });
  it('regime 2 (mensal normal) também fica fora da estimativa', () => {
    expect(chaves({ ...dados, regimesOnd: [L({ escopo: 'SERVICO', sigla: 'TL', anoInicio: 2026, regime: 2 })] })).not.toContain('a|TL');
  });
});

describe('fórmula do Total a pagar da fatura continua a mesma (layout intacto)', () => {
  const d: DadosFr172 = {
    numero: '40030-EL-10-2026-001-0', emissao: '2026-11-10', limite: '2026-11-24', mesCompetencia: 10, anoCompetencia: 2026,
    omUsuaria: 'OM Teste', comimsup: 'Diretoria Industrial da Marinha', sigla: 'EL', servicoOficial: 'Fornecimento de energia elétrica',
    valorServico: 1000, adiantamento: 100, acrescimo: 50, debito: 200, consumo: '1000', unidade: 'KWH', base: {},
    altcreds: [], params: { codigo_omps: '40015', instrucao_uno: 'X', encarregado_nome: 'NOME' },
  };
  const texto = (x: DadosFr172) => String(pdfFr172(x).output()).replace(/\\/g, '');
  it('as linhas do PDF são as de sempre: 01 serviço, 02 adiantamento, 03 acréscimo, 04 débito, 05 total a pagar (e 06 total da fatura)', () => {
    const t = texto(d);
    ['(+) TOTAL SERVIÇO PRESTADO', '(-) ADIANTAMENTO', '(+) ACERTO ACRÉSCIMO', '(-) ACERTO DÉBITO', 'TOTAL A PAGAR', 'TOTAL FATURA (01'].forEach(r => expect(t).toContain(r));
  });
  it('Total a pagar = máx(0, 01 − 02 + 03 − 04): 1.000 − 100 + 50 − 200 = 750; nunca negativo', () => {
    expect(texto(d)).toContain('R$ 750,00');
    expect(texto({ ...d, valorServico: 100, adiantamento: 500, acrescimo: 0, debito: 0 })).toContain('R$ 0,00');
  });
});
