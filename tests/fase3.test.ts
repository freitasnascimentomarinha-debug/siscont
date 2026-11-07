import { describe, it, expect } from 'vitest';
import {
  OMFat, ItemLote, aplicarAdiantamentos, calcularAcerto, calcularMes, calcularOnd, maioresSequenciais, montarNumero, numerar, referencia, diasNoMes, totaisLote,
} from '../utils/faturamento';
import { lerRateio, agruparRateio, lerMapaAtracacao, acharNavio } from '../utils/importMedicoes';
import { detalhamento, DadosFr172, pdfFr172 } from '../utils/fr172';

const om = (id: string, o: Partial<OMFat> = {}): OMFat => ({ id, codigo: id.toUpperCase().padStart(5, '4'), nome: `OM ${id}`, tipo: 'TERRA', comandoId: 'c1', setor: 'DGMM', comando: '40030 - DIM', ativo: true, ...o });
const servicos = ['TC:Taxa Condominial', 'AE:Água e Esgoto', 'EL:Eletricidade', 'DA:Diária de Atracação', 'RB:Rebocador'].map(x => { const [sigla, nome] = x.split(':'); return { sigla, nome, unidade: sigla === 'EL' ? 'KWH' : sigla === 'AE' ? 'M³' : '-' }; });

describe('numeração', () => {
  it('monta OM-SIGLA-MM-AAAA-SEQ-V e continua do maior SEQ da competência, por serviço', () => {
    expect(montarNumero('40030', 'EL', '2026-09', 7)).toBe('40030-EL-09-2026-007-0');
    const m = maioresSequenciais(['40030-EL-09-2026-040-0', '41000-EL-09-2026-012-0', '40030-EL-08-2026-099-0', '40030-AE-09-2026-003-1'], '2026-09');
    expect(m.get('EL')).toBe(40); expect(m.get('AE')).toBe(3);
  });
  it('numera sem lacunas na ordem do lote (extra-MB primeiro)', () => {
    const it = (o: OMFat, sigla: string): ItemLote => ({ chave: o.id + sigla, omId: o.id, om: o, sigla, servico: sigla, unidade: '', quantidade: null, quantidade2: null, valor: 1, acrescimo: 0, debito: 0, base: { regra: '' }, avisos: [] });
    const x = numerar([it(om('b'), 'EL'), it(om('x', { tipo: 'EXTRA_MB', codigo: '00994', setor: 'EXTRA-MB', nome: 'Banco' }), 'EL'), it(om('a'), 'EL'), it(om('a'), 'AE')], ['40001-EL-09-2026-005-0'], '2026-09');
    expect(x.map(i => i.numero)).toEqual(['00994-EL-09-2026-006-0', '4444A-AE-09-2026-001-0', '4444A-EL-09-2026-007-0', '4444B-EL-09-2026-008-0']);
  });
  it('referência e dias do mês', () => {
    expect(referencia('2026-08')).toBe('AGO26');
    expect(diasNoMes('2026-10')).toBe(31); expect(diasNoMes('2028-02')).toBe(29);
  });
});

describe('cálculo do lote mensal', () => {
  const navio = om('n', { tipo: 'NAVIO', nome: 'Navio-Patrulha Mangaratiba' });
  const base = {
    competencia: '2026-08', tipo: 'MENSAL' as const, oms: [om('a'), navio, om('z', { ativo: false, desativadoEm: '2026-07-31' })], servicos,
    precos: [
      { ano: 2026, sigla: 'TC', omId: 'a', valor: 19615.73 }, { ano: 2026, sigla: 'TC', omId: 'z', valor: 100 },
      { ano: 2026, sigla: 'DA', omId: 'n', valor: 95.51 }, { ano: 2026, sigla: 'RB', omId: null, valor: 1000 },
    ],
    medicoes: [
      { competencia: '2026-08', sigla: 'EL', omId: 'a', quantidade: 12799, quantidade2: 40, valor: 10134.19 },
      { competencia: '2026-08', sigla: 'RB', omId: 'n', quantidade: 2, valor: null },
    ],
    atracacoes: [{ competencia: '2026-08', omId: 'n', previsao: false, diasAtracado: 31, diasDocado: 0 }],
    historico: [],
  };
  it('TC pela tabela, DA = diária × dias atracado, EL pelo rateio, RB = quantidade × valor geral; OM desativada antes do mês fica de fora', () => {
    const it = calcularMes(base, '2026-08');
    const v = Object.fromEntries(it.map(i => [`${i.omId}|${i.sigla}`, i.valor]));
    expect(v).toEqual({ 'a|TC': 19615.73, 'n|DA': 2960.81, 'a|EL': 10134.19, 'n|RB': 2000 });
  });
  it('docado não paga diária', () => {
    const it = calcularMes({ ...base, atracacoes: [{ competencia: '2026-08', omId: 'n', previsao: false, diasAtracado: 0, diasDocado: 31 }] }, '2026-08');
    expect(it.some(i => i.sigla === 'DA')).toBe(false);
  });
});

describe('OND e acerto', () => {
  const a = om('a'), x = om('x', { tipo: 'EXTRA_MB', codigo: '00994', setor: 'EXTRA-MB', nome: 'Banco' }), n = om('n', { tipo: 'NAVIO' });
  const hist = [1, 2, 3, 4, 5, 6, 7, 8].map(m => ({ id: `h${m}`, numero: `4000A-EL-0${m}-2026-001-0`, omId: 'a', sigla: 'EL', ano: 2026, mes: m, valor: [12500.80, 11948.17, 14248.04, 11890.76, 7338.30, 9325.42, 9659.88, 10134.19][m - 1] }));
  const dados = {
    competencia: '2026-10', tipo: 'OND' as const, oms: [a, x, n], servicos,
    precos: [{ ano: 2026, sigla: 'TC', omId: 'a', valor: 3339.07 }, { ano: 2026, sigla: 'DA', omId: 'n', valor: 100 }],
    medicoes: [{ competencia: '2026-10', sigla: 'EL', omId: 'x', quantidade: 1191, valor: 925.10 }],
    atracacoes: [10, 11, 12].map(m => ({ competencia: `2026-${m}`, omId: 'n', previsao: true, diasAtracado: 20, diasDocado: 0 })),
    historico: hist,
  };
  it('OND: 3 × média JAN–AGO (÷8), TC = 3 × tabela, DA = diária × dias previstos; extra-MB mensal', () => {
    const it = calcularOnd(dados);
    const v = Object.fromEntries(it.map(i => [`${i.omId}|${i.sigla}`, i.valor]));
    expect(v['a|EL']).toBe(32642.1);      // conferido com o lote OND26 real (40030-EL)
    expect(v['a|TC']).toBe(10017.21);     // 3 × 3.339,07
    expect(v['n|DA']).toBe(6000);         // 100 × 60 dias previstos
    expect(v['x|EL']).toBe(925.1);        // extra-MB: mensal
    expect(it.filter(i => i.omId !== 'x').every(i => i.estimado)).toBe(true);
  });
  it('acerto: real OUT–DEZ − estimado → acréscimo ou débito', () => {
    const estimadas = [
      { id: 'o1', numero: '4000A-EL-10-2026-001-0', omId: 'a', sigla: 'EL', ano: 2026, mes: 10, valor: 30000, estimado: true },
      { id: 'o2', numero: '4000A-TC-10-2026-001-0', omId: 'a', sigla: 'TC', ano: 2026, mes: 10, valor: 10017.21, estimado: true },
    ];
    const med = [10, 11, 12].map(m => ({ competencia: `2026-${m}`, sigla: 'EL', omId: 'a', quantidade: 1, valor: 11000 }));
    const it = calcularAcerto({ ...dados, tipo: 'ACERTO', anoOnd: 2026, historico: estimadas, medicoes: med, precos: [{ ano: 2026, sigla: 'TC', omId: 'a', valor: 3000 }] });
    const el = it.find(i => i.sigla === 'EL')!, tc = it.find(i => i.sigla === 'TC')!;
    expect([el.acrescimo, el.debito, el.acertoDe]).toEqual([3000, 0, '4000A-EL-10-2026-001-0']);
    expect([tc.acrescimo, tc.debito]).toEqual([0, 1017.21]);
  });
});

describe('abatimento de adiantamento', () => {
  it('usa o saldo do mesmo comando, ALTCRED mais antiga primeiro, até o valor da fatura', () => {
    const it = (id: string, valor: number, o = om(id)): ItemLote => ({ chave: id, omId: o.id, om: o, sigla: 'EL', servico: 'EL', unidade: '', quantidade: null, quantidade2: null, valor, acrescimo: 0, debito: 0, base: { regra: '' }, avisos: [] });
    const r = aplicarAdiantamentos([it('a', 300), it('b', 500), it('c', 100, om('c', { comandoId: 'outro' }))], [
      { id: 'd2', numero: 'NOVA', saldo: 1000, data: '2026-09-01', comandoId: 'c1' },
      { id: 'd1', numero: 'VELHA', saldo: 400, data: '2026-02-01', comandoId: 'c1' },
    ]);
    expect(r[0].adiantamentos).toEqual([{ docId: 'd1', numero: 'VELHA', valor: 300 }]);
    expect(r[1].adiantamentos).toEqual([{ docId: 'd1', numero: 'VELHA', valor: 100 }, { docId: 'd2', numero: 'NOVA', valor: 400 }]);
    expect(r[2].adiantamentos).toEqual([]);
    expect(totaisLote(r)).toMatchObject({ servico: 900, adiantamento: 800, final: 100 });
  });
});

describe('importação das divisões', () => {
  it('rateio (DADOS BNIC-41): cabeçalho em duas linhas, várias linhas da mesma OM somadas', () => {
    const m = [
      ['ORGANIZAÇÕES APOIADAS', '', '', 'MEDIDO', '', '', 'VALOR TOTAL (R$)'],
      ['SIGLA', 'CÓDIGO', '', 'DIAS', 'CONSUMO (kWh)', 'Demanda (kW)', ''],
      ['CMS (Prédio CETM)', '44021', '', 30, 24264, 61.77, 17142.64],
      ['CMS (Ed. 08)', '44021', '', 30, 3109, 7.91, 2196.53],
      ['AMRJ', '41000', '', 30, 390262, 993, 275722.01],
      ['TOTAL', '', '', '', 417635, 1062, 295061.18],
    ];
    const l = lerRateio(m);
    expect(l).toHaveLength(3);
    expect(agruparRateio(l).find(g => g.codigo === '44021')).toMatchObject({ consumo: 27373, demanda: 69.68, valor: 19339.17 });
  });
  it('mapa BNIC-35: competência, gerência, 31 dias mesmo com cabeçalho até 30, legenda ignorada', () => {
    const dias = (s: string) => s.split('');
    const m = [
      ['BNIC-35'], ['', '', 'MÊS DE OUTUBRO DE 2026'], ['', '', 'GERÊNCIA:  G6'],
      ['NAVIOS', ...Array.from({ length: 30 }, (_, i) => String(i + 1))],
      ['NPA MANGARATIBA', ...dias('A      AAAAAAAAAAAAAAAAAAAAAAAA'.padEnd(31, ' ').replace(/ /g, '').padEnd(25, 'A')).slice(0, 0), ...'A'.padEnd(7, ' ').split('').map(c => c.trim()), ...Array(24).fill('A')],
      ['S. TUPI', ...Array(31).fill('D')],
      ['LEGENDA:'], ['A-NAVIO ATRACADO'],
    ];
    const mp = lerMapaAtracacao(m);
    expect(mp.competencia).toBe('2026-10'); expect(mp.gerencia).toBe('G6');
    expect(mp.navios.map(n => [n.nome, n.atracado, n.docado, n.dias.length])).toEqual([['NPA MANGARATIBA', 25, 0, 31], ['S. TUPI', 0, 31, 31]]);
  });
  it('acha o navio pelo nome abreviado do mapa', () => {
    const oms = [{ id: '1', nome: 'Navio-Patrulha Mangaratiba', tipo: 'NAVIO' }, { id: '2', nome: 'Submarino Tupi', tipo: 'NAVIO' }, { id: '3', nome: 'Navio Polar Almirante Maximiano', tipo: 'NAVIO' }];
    expect(acharNavio('NPA MANGARATIBA', oms)?.id).toBe('1');
    expect(acharNavio('S. TUPI', oms)?.id).toBe('2');
    expect(acharNavio('ALTE MAXIMIANO', oms)?.id).toBe('3');
    expect(acharNavio('NSS GUILLOBEL', oms)).toBeNull();
  });
});

describe('FR-172', () => {
  const d: DadosFr172 = {
    numero: '40032-DA-08-2026-010-0', emissao: '2026-09-15', limite: '2026-09-29', mesCompetencia: 8, anoCompetencia: 2026,
    omUsuaria: 'Navio-Patrulha Mangaratiba', comimsup: 'Diretoria Industrial da Marinha', sigla: 'DA', servicoOficial: 'Diária de Atracação',
    valorServico: 2960.81, adiantamento: 0, acrescimo: 0, debito: 0, consumo: '31', unidade: 'DIA', base: { diaria: 95.51 },
    altcreds: [], params: { codigo_omps: '40015', instrucao_uno: 'X', encarregado_nome: 'NOME' },
  };
  it('detalhamento da diária e PDF gerado', () => {
    expect(detalhamento(d)).toEqual([['DIÁRIA DE ATRACAÇÃO (R$)', 'R$ 95,51'], ['DIAS ATRACADO', '31'], ['TOTAL (R$)', 'R$ 2.960,81']]);
    const pdf = pdfFr172({ ...d, altcreds: ['G424.2026.AC.00343'], substitui: '40032-DA-08-2026-010-0' });
    expect(pdf.getNumberOfPages()).toBe(1);
    expect(pdf.output('arraybuffer').byteLength).toBeGreaterThan(2000);
  });
  it('detalhamento da energia: consumo e demanda', () => {
    expect(detalhamento({ ...d, sigla: 'EL', consumo: '20.646 / 73 kW', base: {} })).toEqual([['CONSUMO DE ENERGIA ELET. (Kwh)', '20.646'], ['DEMANDA ENERGIA ELET. (Kw)', '73'], ['TOTAL (R$)', 'R$ 2.960,81']]);
  });
});
