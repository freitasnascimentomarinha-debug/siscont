import { describe, expect, it } from 'vitest';
import { montarGastos, utilidadesDaBase } from '../utils/gastosBNIC';
import { pdfRelatorio } from '../utils/pdfRelatorio';
import { relatorioGastos, relatorioTaxa } from '../utils/relatoriosPdf';

const texto = (r: ReturnType<typeof relatorioGastos>) => { const d = pdfRelatorio(r); return { d, s: d.output() }; };

describe('PDF dos gastos da BNIC', () => {
  const rubricas = [{ numero: 12, descricao: 'Serviço de Varrição das Ruas', tipo: 'TC' as const, vigente: 1000, omLiquido: 800 }, { numero: 27, descricao: 'Manutenção de Instalações do Hospital', tipo: 'TC' as const, vigente: 200, omLiquido: 200 }];
  const saidas = [
    { id: 'a', date: '2026-03-10', value: 400, client: 'Limpeza Urbana Ltda', documentNumber: '2026NE000001', rubricaNumero: 12, categoria: null },
    { id: 'b', date: '2026-05-05', value: 90, client: 'LIGHT', documentNumber: '2026NE000002', rubricaNumero: null, categoria: 'ENERGIA' },
  ];
  const periodo = { de: '2026-01', ate: '2026-12' };
  const gastos = montarGastos(rubricas, saidas, periodo, { tcRecebida: 500 });
  const util = utilidadesDaBase([{ competencia: '2026-09', sigla: 'AE', omId: 'bnic', quantidade: 100, valor: 5000 }, { competencia: '2026-09', sigla: 'AE', omId: 'x', quantidade: 300, valor: 15000 }], 'bnic', periodo, [{ sigla: 'AE', nome: 'Água e Esgoto', unidade: 'M³' }]);
  const rel = relatorioGastos({ ano: 2026, periodo, hoje: '2026-11-09', statusProposta: 'APROVADA', gastos, utilidades: util, tcRecebida: 500, quota: { anual: 300, mensal: 25, percentual: 25 }, aRatear: 1000 });

  it('monta cartões e tabelas com os números da página', () => {
    expect(rel.arquivo).toBe('gastos_bnic_2026_2026-01_2026-12.pdf');
    const c = Object.fromEntries(rel.cartoes!);
    expect(c['Previsto em 2026']).toBe('R$ 1.200,00'); expect(c['Empenhado (01/2026 a 12/2026)']).toBe('R$ 490,00'); expect(c['Recebido das OM (TC)']).toBe('R$ 500,00');
    expect(c['Consumo medido da base']).toBe('R$ 5.000,00'); expect(c['Parte da BNIC no rateio (ano)']).toBe('R$ 300,00');
    const t0 = rel.tabelas[0];
    expect(t0.body.find(l => String(l[0]).includes('12 · Serviço de Varrição'))).toEqual(['   12 · Serviço de Varrição das Ruas', 'R$ 1.000,00', 'R$ 400,00', '40%', 'R$ 400,00', 'R$ 0,00']); // recebido: 500 × 800 ÷ (800 + 200)
    expect(t0.total![0]).toBe('Total das rubricas');
    expect(rel.tabelas.map(t => t.titulo.split(' (')[0].split(' —')[0])).toEqual(['Previsto, empenhado e recebido por grupo', 'Empenhos sem rubrica', 'Consumo da própria base', 'Empenhos por fornecedor']);
  });
  it('gera o PDF com cabeçalho, tabelas e paginação', () => {
    const { d, s } = texto(rel);
    expect(d.getNumberOfPages()).toBeGreaterThanOrEqual(1);
    expect(s).toContain('MARINHA DO BRASIL'); expect(s).toContain('Gastos da BNIC'); expect(s).toContain('Previsto, empenhado e recebido por grupo'); expect(s).toContain('Página 1 de');
    expect(s).toContain('Limpeza Urbana Ltda');
  });
  it('sem empenhos nem consumo, as tabelas vazias não aparecem', () => {
    const v = relatorioGastos({ ano: 2026, periodo, hoje: '2026-11-09', gastos: montarGastos(rubricas, [], periodo), utilidades: [], tcRecebida: 0, quota: null, aRatear: 0 });
    expect(v.tabelas).toHaveLength(1);
  });
});

describe('PDF da taxa condominial e das diárias', () => {
  const oms = [
    { nome: 'AMRJ', lotacao: 300, dias: 30, anual: 1200, mensal: 100, percentual: 75, bruto: 1300, descontos: 100, anteriorMensal: 80, variacao: 25 },
    { nome: 'DIM', lotacao: 100, dias: 30, anual: 400, mensal: 33.33, percentual: 25, bruto: 400, descontos: 0, anteriorMensal: null, variacao: null },
  ];
  const base = { ano: 2026, status: 'APROVADA', hoje: '2026-11-09', cartoes: [['Total rateado', 'R$ 1.600,00']] as [string, string][], oms, descontos: [{ om: 'AMRJ', rubrica: '12 – Varrição', tipo: 'VALOR', valor: 100, justificativa: 'Serviço de pessoal civil' }],
    rubricas: [{ numero: 12, descricao: 'Varrição', previsto: 1700, descontoGeral: 100, vigente: 1600 }] };
  it('taxa: Anexo B com totais, rubricas e descontos', () => {
    const r = relatorioTaxa({ ...base, modo: 'TC' });
    expect(r.arquivo).toBe('taxa_condominial_2026.pdf'); expect(r.orientacao).toBe('l');
    expect(r.tabelas.map(t => t.titulo)).toEqual(['Anexo B — comparativo 2025 × 2026 por OM', 'Rubricas da taxa condominial', 'Descontos por OM']);
    expect(r.tabelas[0].total).toEqual(['Total', '', 'R$ 1.700,00', 'R$ 100,00', 'R$ 1.600,00', 'R$ 133,33', '', '']);
    expect(r.tabelas[0].body[0]).toEqual(['AMRJ', 'R$ 80,00', 'R$ 1.300,00', 'R$ 100,00', 'R$ 1.200,00', 'R$ 100,00', '75%', '25%']);
    expect(r.tabelas[0].body[1][1]).toBe('-');
    expect(texto(r as any).s).toContain('Anexo B');
  });
  it('diárias: um valor por navio, com aviso de classe sem histórico', () => {
    const r = relatorioTaxa({ ...base, modo: 'DA', custoMilitarDia: 2.7288, oms: oms.map(o => ({ ...o, diaria: 50, semHistorico: o.nome === 'DIM' })) });
    expect(r.arquivo).toBe('diarias_atracacao_2026.pdf'); expect(r.tabelas).toHaveLength(2);
    expect(r.tabelas[0].body[1][0]).toBe('DIM *'); expect(r.linhas.join(' ')).toContain('2,7288');
  });
});
