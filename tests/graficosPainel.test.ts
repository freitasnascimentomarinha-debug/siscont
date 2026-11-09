import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import { CRITERIOS_PADRAO, FaturaGer, baixasPorFatura, linhasOM } from '../utils/painelGerencial';
import { graficosDoPainel } from '../utils/graficosPainel';
import { escala } from '../utils/pdfGraficos';
import { excelPainel } from '../utils/excelPainel';
import { pdfPainel } from '../utils/pdfPainel';

const mk = (i: number): FaturaGer => ({ id: 'f' + i, numero: 'n' + i, cliente: 'OM ' + (i % 3), setor: 'DGMM', comando: 'k', tipo: 'EL', ano: 2026, mes: 1 + (i % 6), emissao: `2026-0${1 + (i % 6)}-05`, vencimento: `2026-0${2 + (i % 6)}-05`, total: 10000, pago: 0, saldo: 10000, cancelada: false, contestada: false, omId: 'o' + (i % 3), extra: false, quitadaExterna: false, quitadaEm: null, pontos: 0 });
const fs = Array.from({ length: 12 }, (_, i) => mk(i));
const bs = [{ invoiceId: 'f1', docId: 'd', valor: 4000, data: '2026-04-10', adiantamento: false }];
const idx = baixasPorFatura(bs);
const e: any = { hoje: '2026-09-09', periodo: { de: '2026-01', ate: '2026-09' }, fs, bs, idx, recebimentos: [{ id: 'r', valor: 5000, data: '2026-05-02', omId: 'o1' }], alertas: [], contest: [], criterios: CRITERIOS_PADRAO, parados: [], adiantamentos: [], filtros: [], atualizadoEm: 'agora' };
e.linhas = linhasOM(fs, idx, e.hoje, CRITERIOS_PADRAO, () => 0);

describe('Painel: PDF e Excel com gráficos', () => {
  it('quatro gráficos, com a mesma base da tela', () => {
    const g = graficosDoPainel(e);
    expect(g.map(x => x.id)).toEqual(['fr', 'inad', 'idade', 'rec']);
    expect(g[0].categorias).toHaveLength(9); expect(g[0].series[0].valores.reduce((s, v) => s + v, 0)).toBe(120000);
    expect(g[2].coresPontos).toHaveLength(g[2].categorias.length);
    expect(g[3].series[1].secundario).toBe(true);
  });
  it('escala bonita', () => { expect(escala(0, 118000)).toMatchObject({ min: 0, max: 150000, passo: 50000 }); expect(escala(-3, 10).min).toBeLessThan(0); });
  it('PDF: indicadores, página de gráficos e tabelas', () => { const d = pdfPainel(e); expect(d.getNumberOfPages()).toBeGreaterThanOrEqual(3); });
  it('Excel: abas, valores numéricos e 4 gráficos nativos ligados à aba Gráficos', async () => {
    const bytes = await excelPainel(e);
    const wb = XLSX.read(bytes, { type: 'array' });
    expect(wb.SheetNames).toEqual(['Indicadores', 'Gráficos', 'Pontos de atenção', 'OM com vencido']);
    expect(typeof wb.Sheets['Indicadores'].B6.v).toBe('number');
    const zip = await JSZip.loadAsync(bytes);
    const charts = Object.keys(zip.files).filter(n => /^xl\/charts\/chart\d+\.xml$/.test(n));
    expect(charts).toHaveLength(4);
    const c1 = await zip.file('xl/charts/chart1.xml')!.async('string');
    expect(c1).toContain("'Gráficos'!$B$3:$B$11"); expect(c1).toContain('<c:barChart>'); expect(c1).toContain('<c:lineChart>');
    expect(await zip.file('xl/charts/chart4.xml')!.async('string')).toContain('<c:axPos val="r"/>'); // eixo secundário (%)
    expect(await zip.file('[Content_Types].xml')!.async('string')).toContain('drawingml.chart+xml');
  });
});
