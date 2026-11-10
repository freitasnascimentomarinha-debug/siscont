import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import { FaturaPainel, resumoPainel, taxaCondominial } from '../utils/painel';
import { excelPainelInicial, graficosPainelInicial, linhasIndicadoresPI, montarPdfPainelInicial, EntradaPainelInicial } from '../utils/exportPainelInicial';

const f = (n: number, extra: Partial<FaturaPainel>): FaturaPainel => ({
  id: `f${n}`, numero: `40030-TC-0${(n % 9) + 1}-2026-00${n}-0`, cliente: `OM ${n % 4} com um nome bem comprido para testar o corte do rótulo no gráfico`, setor: n % 2 ? 'DGMM' : 'COMOPNAV', comando: 'Cmd',
  tipo: n % 3 ? 'TC' : 'EL', ano: 2026, mes: (n % 9) + 1, emissao: '2026-01-15', vencimento: n % 2 ? '2026-03-01' : '2027-01-01', total: 1000 + n, pago: n % 5 ? 0 : 300, saldo: n % 5 ? 1000 + n : 700 + n, cancelada: false, contestada: n === 7, ...extra,
});
const fs = Array.from({ length: 30 }, (_, i) => f(i + 1, {}));
const hoje = '2026-11-10';
const entrada = (): EntradaPainelInicial => {
  const r = resumoPainel(fs, 2026, hoje);
  const tc = taxaCondominial([{ ano: 2026, sigla: 'TC', omId: 'a', valor: 5000 }, { ano: 2026, sigla: 'TC', omId: 'b', valor: 2500.5 }], new Map([['a', 'Arsenal'], ['b', 'DIM']]), 2026);
  return { ano: 2026, hoje, geradoEm: '10/11/2026 10:00', r, tc, filtros: ['Setor todos exceto EXTRA-MB'], abertas: fs.filter(x => x.saldo > 0 && !x.contestada), contestadas: fs.filter(x => x.contestada) };
};

describe('exportação do Painel inicial', () => {
  it('os gráficos usam os números do painel', () => {
    const e = entrada(), gs = graficosPainelInicial(e);
    expect(gs.map(g => g.id)).toEqual(['mes', 'idade', 'comp', 'dev', 'tipo', 'setor', 'tc']);
    const mes = gs[0].series[0].valores.reduce((s, x) => s + x, 0);
    expect(Math.round(mes * 100) / 100).toBe(e.r.faturadoAno.valor);
    expect(gs[2].series[0].valores.reduce((s, x) => s + x, 0)).toBeCloseTo(e.r.emAberto.valor, 2);
    expect(gs[3].horizontal && gs[3].empilhado).toBe(true);
    expect(gs[3].categorias.every(c => c.length <= 34)).toBe(true);
    expect(linhasIndicadoresPI(e).find(l => l.rotulo === 'Total em aberto (sem contestadas)')!.valor).toBe(e.r.emAberto.valor);
  });
  it('o Excel traz abas completas e 7 gráficos nativos (barras horizontais e empilhadas incluídas)', async () => {
    const bytes = await excelPainelInicial(entrada());
    const zip = await JSZip.loadAsync(bytes);
    expect(Object.keys(zip.files).filter(n => /^xl\/charts\/chart\d+\.xml$/.test(n))).toHaveLength(7);
    const c4 = await zip.file('xl/charts/chart4.xml')!.async('string');
    expect(c4).toContain('<c:barDir val="bar"/>'); expect(c4).toContain('<c:grouping val="stacked"/>'); expect(c4).toContain('<c:overlap val="100"/>');
    const c1 = await zip.file('xl/charts/chart1.xml')!.async('string');
    expect(c1).toContain('<c:barDir val="col"/>'); expect(c1).toContain('<c:grouping val="clustered"/>');
    const wb = XLSX.read(bytes, { type: 'array' });
    expect(wb.SheetNames).toEqual(['Resumo', 'Gráficos', 'Faturado por mês', 'Devedores', 'Por serviço', 'Por setor', 'Idade da dívida', 'Taxa condominial', 'Faturas em aberto', 'Em contestação']);
    const emAberto = XLSX.utils.sheet_to_json<any>(wb.Sheets['Faturas em aberto']);
    expect(emAberto).toHaveLength(29);
    expect(emAberto.reduce((s, l) => s + l['Saldo (R$)'], 0)).toBeCloseTo(entrada().r.emAberto.valor, 2);
    const resumo = XLSX.utils.sheet_to_json<any>(wb.Sheets['Resumo'], { header: 1 });
    expect(JSON.stringify(resumo)).toContain('Total em aberto');
  });
  it('o PDF é gerado com várias páginas (indicadores, gráficos e tabelas)', () => {
    const doc = montarPdfPainelInicial(entrada());   // monta sem salvar: não grava arquivo na pasta do projeto
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(3);
  });
  it('sem taxa condominial publicada, não gera o gráfico nem a aba da TC', async () => {
    const e = { ...entrada(), tc: taxaCondominial([], new Map(), 2026) };
    expect(graficosPainelInicial(e).some(g => g.id === 'tc')).toBe(false);
    expect(XLSX.read(await excelPainelInicial(e), { type: 'array' }).SheetNames).not.toContain('Taxa condominial');
  });
});
