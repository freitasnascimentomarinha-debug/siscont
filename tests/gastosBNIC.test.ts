import { describe, expect, it } from 'vitest';
import { RubricaGasto, SaidaGasto, montarGastos, subgrupoDaRubrica, utilidadesDaBase } from '../utils/gastosBNIC';

const R = (numero: number, descricao: string, vigente: number, tipo: 'TC' | 'OG' = 'TC'): RubricaGasto => ({ numero, descricao, vigente, tipo });
let n = 0;
const S = (date: string, value: number, rubricaNumero: number | null, extra: Partial<SaidaGasto> = {}): SaidaGasto =>
  ({ id: `s${++n}`, date, value, client: 'FORNECEDOR A', documentNumber: `NE${n}`, rubricaNumero, categoria: null, ...extra });

describe('grupos das rubricas', () => {
  it('as rubricas reais de 2026 caem nos grupos certos', () => {
    const g = (d: string, tipo: 'TC' | 'OG' = 'TC') => subgrupoDaRubrica({ descricao: d, tipo });
    expect(g('Serviço de Varrição das Ruas do CNIC')).toBe('limpeza');
    expect(g('Coleta de Resíduos Contaminantes (Lâmpadas, Pilhas e Baterias)')).toBe('limpeza');
    expect(g('Serviço de Dedetização e Desratização')).toBe('limpeza');
    expect(g('Manutenção de Telhados')).toBe('infra');
    expect(g('Manutenção e Reparo de Elevadores')).toBe('infra');
    expect(g('CEG - Gás de Rua (MANUTENÇÃO)')).toBe('infra');
    expect(g('Manutenção das Subestações de Energia e Iluminação Pública')).toBe('infra');
    expect(g('Contrato de Agentes de Manobra')).toBe('portuaria');
    expect(g('Manutenção e aquisição de Defensas')).toBe('portuaria');
    expect(g('Manutenção Rede Incêndio do Cais da Portuguesa')).toBe('seguranca');
    expect(g('Material do Grupo de Incêndio – Manutenção Extra MB')).toBe('seguranca');
    expect(g('Manutenção de Sistemas de Controle de acesso e monitoramento')).toBe('seguranca');
    expect(g('Contratação de Seguro de Responsabilidade Civil (RCG)')).toBe('seguranca');
    expect(g('Limpeza Hospitalar')).toBe('hospital');            // hospital vem antes de limpeza
    expect(g('Coleta de Resíduos Hospitalares')).toBe('hospital');
    expect(g('Contratação de Serviços Médicos e Laboratoriais')).toBe('hospital');
    expect(g('Material Hospitalar e Remédios')).toBe('hospital');
    expect(g('Contratos de Tecnologia da Informação')).toBe('tecnologia');
    expect(g('Manutenção das Centrais e do Sistema de Telefonia da BNIC')).toBe('tecnologia');
    expect(g('Manutenção e Operação das Viaturas Compartilhadas')).toBe('tecnologia');
    expect(g('Material Permanente da BNIC', 'OG')).toBe('outros');
    expect(g('Manutenção de Equipamentos de Ar Condicionado Central', 'OG')).toBe('outros'); // OG não depende do texto
  });
});

describe('gastos: previsto, empenhado e saldo', () => {
  const rubricas = [R(12, 'Serviço de Varrição das Ruas', 1000), R(10, 'Coleta de Lixo', 500), R(1, 'Manutenção de Telhados', 300), R(27, 'Manutenção de Instalações do Hospital', 200), R(35, 'Material Permanente da BNIC', 0, 'OG')];
  const saidas = [
    S('2026-02-10', 400, 12), S('2026-03-05', 100, 12), S('2026-03-20', -50, 12),             // varrição: 400 + 100 − 50 (anulação parcial) = 450
    S('2026-03-07', 120, 1, { client: 'Fornecedor B' }), S('2026-05-01', 999, 10),           // maio fora do período
    S('2026-02-15', 700, null, { categoria: 'ENERGIA', client: 'Light' }), S('2026-04-01', 90, null),   // sem rubrica: energia e sem indicação
    S('2026-02-20', 33, 99),                                                                      // rubrica que não existe na taxa → sem indicação
  ];
  const r = montarGastos(rubricas, saidas, { de: '2026-01', ate: '2026-04' });
  it('previsto por grupo e por rubrica; empenhado só do período, com anulação parcial (negativa)', () => {
    const limpeza = r.grupos.find(g => g.id === 'limpeza')!;
    expect(limpeza.previsto).toBe(1500); expect(limpeza.empenhado).toBe(450); expect(limpeza.saldo).toBe(1050); expect(limpeza.execucao).toBe(30);
    expect(limpeza.linhas.map(l => l.numero)).toEqual([10, 12]);                                // em ordem de número
    expect(limpeza.linhas.find(l => l.numero === 10)!.empenhado).toBe(0);                       // o empenho de maio ficou fora do período
    expect(r.grupos.find(g => g.id === 'infra')).toMatchObject({ previsto: 300, empenhado: 120 });
    expect(r.grupos.find(g => g.id === 'hospital')).toMatchObject({ previsto: 200, empenhado: 0, execucao: 0 });
  });
  it('outros gastos sem previsto: execução indefinida', () => {
    expect(r.grupos.find(g => g.id === 'outros')).toMatchObject({ previsto: 0, empenhado: 0, execucao: null });
  });
  it('empenho sem rubrica fica à parte, por categoria, e não entra duas vezes', () => {
    expect(r.semRubrica.map(x => [x.categoria, x.empenhado, x.qtd])).toEqual([['ENERGIA', 700, 1], ['SEM_INDICACAO', 123, 2]]);
    expect(r.totais).toMatchObject({ previsto: 2000, empenhadoRubricas: 570, empenhadoSemRubrica: 823, empenhado: 1393, saldo: 1430, qtdEmpenhos: 7 });
    expect(r.totais.execucao).toBe(28.5);
  });
  it('fornecedores: outro recorte do mesmo dinheiro', () => {
    expect(r.fornecedores.map(f => [f.nome, f.valor, f.qtd])).toEqual([['Light', 700, 1], ['FORNECEDOR A', 573, 5], ['Fornecedor B', 120, 1]]);
    expect(r.fornecedores.find(f => f.nome === 'Light')!.categorias).toEqual(['Energia elétrica']);
    expect(r.fornecedores.reduce((s, f) => s + f.valor, 0)).toBe(r.totais.empenhado);          // mesmo total
  });
  it('mês a mês por grupo', () => {
    expect(r.porMes.map(p => p.mes)).toEqual(['2026-01', '2026-02', '2026-03', '2026-04']);
    expect(r.porMes[1]).toMatchObject({ limpeza: 400, semRubrica: 733 });                       // 700 energia + 33 de rubrica inexistente
    expect(r.porMes[2]).toMatchObject({ limpeza: 50, infra: 120 });                              // 100 − 50
  });
  it('fornecedor com nomes escritos de jeitos diferentes vira um só', () => {
    const x = montarGastos(rubricas, [S('2026-01-10', 10, 12, { client: 'Águas do Rio  S.A.' }), S('2026-01-11', 5, 12, { client: 'AGUAS DO RIO S.A.' })], { de: '2026-01', ate: '2026-01' });
    expect(x.fornecedores).toHaveLength(1); expect(x.fornecedores[0]).toMatchObject({ valor: 15, qtd: 2 });
  });
  it('sem nenhuma saída: tudo zerado, previsto mantido', () => {
    const v = montarGastos(rubricas, [], { de: '2026-01', ate: '2026-12' });
    expect(v.totais).toMatchObject({ previsto: 2000, empenhado: 0, saldo: 2000, execucao: 0, qtdEmpenhos: 0 }); expect(v.fornecedores).toEqual([]);
  });
});

describe('consumo da própria base', () => {
  const med = [
    { competencia: '2026-09', sigla: 'AE', omId: 'bnic', quantidade: 11220.04, valor: 488932.03 }, { competencia: '2026-09', sigla: 'AE', omId: 'x', quantidade: 100, valor: 900000 },
    { competencia: '2026-10', sigla: 'AE', omId: 'bnic', quantidade: 10, valor: 100 }, { competencia: '2026-09', sigla: 'EL', omId: 'x', quantidade: 5, valor: 5000 },
    { competencia: '2025-12', sigla: 'AE', omId: 'bnic', quantidade: 1, valor: 1 },
  ];
  const u = utilidadesDaBase(med, 'bnic', { de: '2026-09', ate: '2026-10' }, [{ sigla: 'AE', nome: 'Água e Esgoto', unidade: 'M³' }, { sigla: 'EL', nome: 'Energia Elétrica' }]);
  it('só o consumo da emissora, no período, e a parcela dela no total medido', () => {
    expect(u).toHaveLength(1);                                                                   // energia: a BNIC não tem medição → não aparece
    expect(u[0]).toMatchObject({ sigla: 'AE', nome: 'Água e Esgoto', valor: 489032.03, unidade: 'M³', totalComplexo: 1389032.03 });
    expect(u[0].pct).toBe(35.2); expect(u[0].porMes['2026-09']).toBe(488932.03);
  });
  it('sem OM emissora definida: nada', () => expect(utilidadesDaBase(med, null, { de: '2026-09', ate: '2026-10' }, [])).toEqual([]));
});

import { condominioPorRubrica } from '../utils/relatorios';
import { chaveFornecedor, grupoDaRubrica } from '../utils/gastosBNIC';

describe('recebido das OM por rubrica (rateio proporcional)', () => {
  const RL = (numero: number, descricao: string, vigente: number, omLiquido: number): RubricaGasto => ({ numero, descricao, tipo: 'TC', vigente, omLiquido });
  const rubricas = [RL(12, 'Varrição', 1000, 600), RL(10, 'Coleta de Lixo', 500, 300), RL(27, 'Instalações do Hospital', 200, 100)];   // pesos 60% / 30% / 10%
  const saidas = [S('2026-03-01', 250, 12), S('2026-03-02', 40, 27)];
  const r = montarGastos(rubricas, saidas, { de: '2026-01', ate: '2026-12' }, { tcRecebida: 5000 });
  it('divide a taxa recebida pela participação de cada rubrica no valor cobrado das OM', () => {
    const l = (n: number) => r.grupos.flatMap(g => g.linhas).find(x => x.numero === n)!;
    expect([l(12).recebido, l(10).recebido, l(27).recebido]).toEqual([3000, 1500, 500]);
    expect([l(12).pesoRateio, l(10).pesoRateio, l(27).pesoRateio]).toEqual([60, 30, 10]);
    expect(l(12).saldoEmConta).toBe(2750); expect(l(27).saldoEmConta).toBe(460);                // recebido − empenhado
  });
  it('soma por grupo e no total; o rateio fecha com o valor recebido', () => {
    expect(r.grupos.find(g => g.id === 'limpeza')).toMatchObject({ recebido: 4500, saldoEmConta: 4250 });
    expect(r.grupos.find(g => g.id === 'hospital')).toMatchObject({ recebido: 500, saldoEmConta: 460 });
    expect(r.totais).toMatchObject({ recebido: 5000, saldoEmConta: 4710, rateioDisponivel: true });
  });
  it('é a mesma conta da aba Rubricas do Fluxo de caixa', () => {
    const fluxo = condominioPorRubrica(rubricas.map(x => ({ ano: 2026, numero: x.numero, descricao: x.descricao, valorAnual: x.omLiquido!, percentual: null })), 5000, new Map([[12, 250], [27, 40]]));
    fluxo.linhas.forEach(f => expect(r.grupos.flatMap(g => g.linhas).find(x => x.numero === f.numero)!.recebido).toBe(f.tcRecebida));
  });
  it('sem rateio no exercício (nada cobrado das OM), o recebido não é distribuído', () => {
    const v = montarGastos(rubricas.map(x => ({ ...x, omLiquido: 0 })), saidas, { de: '2026-01', ate: '2026-12' }, { tcRecebida: 5000 });
    expect(v.totais).toMatchObject({ recebido: 0, rateioDisponivel: false });
  });
});

describe('grupo escolhido à mão e fornecedores juntados', () => {
  it('o grupo escolhido sobrepõe a regra automática (e grupo inválido é ignorado)', () => {
    const r = { numero: 12, descricao: 'Serviço de Varrição', tipo: 'TC' as const };
    expect(grupoDaRubrica(r)).toBe('limpeza');
    expect(grupoDaRubrica(r, { 12: 'infra' })).toBe('infra');
    expect(grupoDaRubrica(r, { 12: 'inexistente' as any })).toBe('limpeza');
    const g = montarGastos([{ ...r, vigente: 100 }], [S('2026-02-01', 30, 12)], { de: '2026-01', ate: '2026-12' }, { grupos: { 12: 'infra' } });
    expect(g.grupos.map(x => [x.id, x.previsto, x.empenhado])).toEqual([['infra', 100, 30]]);
    expect(g.porMes[1]).toMatchObject({ infra: 30 });
  });
  it('fornecedores com nomes diferentes podem ser juntados num só, mantendo os nomes originais', () => {
    const ss = [S('2026-01-10', 100, 12, { client: 'AGUAS DO RIO 4 SPE S.A' }), S('2026-01-11', 50, 12, { client: 'Águas do Rio 4' }), S('2026-01-12', 25, 12, { client: 'CEDAE' })];
    const sem = montarGastos([{ numero: 12, descricao: 'x', tipo: 'TC', vigente: 1 }], ss, { de: '2026-01', ate: '2026-01' });
    expect(sem.fornecedores).toHaveLength(3);
    const com = montarGastos([{ numero: 12, descricao: 'x', tipo: 'TC', vigente: 1 }], ss, { de: '2026-01', ate: '2026-01' }, { uniao: { [chaveFornecedor('Águas do Rio 4')]: 'AGUAS DO RIO 4 SPE S.A' } });
    expect(com.fornecedores).toHaveLength(2);
    expect(com.fornecedores[0]).toMatchObject({ nome: 'AGUAS DO RIO 4 SPE S.A', valor: 150, qtd: 2, variantes: ['Águas do Rio 4'] });
    expect(com.fornecedores.reduce((s, f) => s + f.valor, 0)).toBe(com.totais.empenhado);     // o total não muda
  });
});

describe('quem mais consome', () => {
  const med = [
    { competencia: '2026-09', sigla: 'AE', omId: 'a', quantidade: 10, valor: 500 }, { competencia: '2026-09', sigla: 'AE', omId: 'bnic', quantidade: 5, valor: 300 },
    { competencia: '2026-10', sigla: 'AE', omId: 'a', quantidade: 10, valor: 100 }, { competencia: '2026-09', sigla: 'AE', omId: 'c', quantidade: 1, valor: 50 },
  ];
  it('ranking das OM no período e a posição da BNIC', () => {
    const [u] = utilidadesDaBase(med, 'bnic', { de: '2026-09', ate: '2026-10' }, []);
    expect(u.ranking).toEqual([{ omId: 'a', valor: 600 }, { omId: 'bnic', valor: 300 }, { omId: 'c', valor: 50 }]);
    expect(u.posicao).toBe(2);
  });
});
