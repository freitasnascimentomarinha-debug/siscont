/**
 * Planilha mensal "Gráfico de congestionamento": dívida geral mês a mês, e faturamento × dívida por ODS (setor)
 * do ano anterior, do ano corrente e dos dois juntos. Mesmo posicionamento das células do modelo (ODS), para que
 * os gráficos da planilha de vocês continuem apontando para os mesmos intervalos.
 */
import * as XLSX from 'xlsx';
import { BaixaGer, FaturaGer, abertoNaData, fimDoMes, somaMeses, vencidoNaData } from './painelGerencial';

export type CriterioDivida = 'vencido' | 'aberto';
const r2 = (n: number) => Math.round(n * 100) / 100;
const MES3 = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
export const rotuloMes = (ym: string) => `${MES3[Number(ym.slice(5, 7)) - 1]}/${ym.slice(0, 4)}`;

export interface LinhaODS { ods: string; faturamento: number; divida: number }

/** Dívida de uma fatura na data T conforme o critério (vencido = saldo vencido; aberto = vencido + a vencer). */
export const dividaNaData = (f: FaturaGer, T: string, idx: Map<string, BaixaGer[]>, hoje: string, criterio: CriterioDivida) =>
  criterio === 'vencido' ? vencidoNaData(f, T, idx, hoje) : abertoNaData(f, T, idx, hoje);

/** Faturamento (ano da competência, exceto canceladas, emitido até T) e dívida em T, por setor. */
export function quadroPorODS(fs: FaturaGer[], idx: Map<string, BaixaGer[]>, hoje: string, T: string, ano: number, criterio: CriterioDivida): LinhaODS[] {
  const m = new Map<string, LinhaODS>();
  fs.forEach(f => {
    if (f.cancelada || f.ano !== ano || !f.setor) return;
    if (f.emissao && f.emissao.slice(0, 10) > T) return;
    const l = m.get(f.setor) || { ods: f.setor, faturamento: 0, divida: 0 };
    l.faturamento += f.total; l.divida += dividaNaData(f, T, idx, hoje, criterio);
    m.set(f.setor, l);
  });
  return [...m.values()].map(l => ({ ...l, faturamento: r2(l.faturamento), divida: r2(l.divida) }));
}

/** Dívida total na data T das competências indicadas. */
export function dividaTotal(fs: FaturaGer[], idx: Map<string, BaixaGer[]>, hoje: string, T: string, anos: number[], criterio: CriterioDivida): number {
  return r2(fs.reduce((s, f) => (!f.cancelada && anos.includes(f.ano) && (!f.emissao || f.emissao.slice(0, 10) <= T) ? s + dividaNaData(f, T, idx, hoje, criterio) : s), 0));
}

export interface DadosCongestionamento {
  mes: string; // AAAA-MM da posição
  quadroAnterior: LinhaODS[]; quadroAtual: LinhaODS[];
  serie: { mes: string; valor: number | null }[]; // 13 meses terminando em `mes`
  criterio: CriterioDivida;
}

/** Os 13 meses que terminam em `mes`, com o valor guardado (ou o calculado, no último). */
export function serie13(mes: string, guardados: Map<string, number>, atual: number): { mes: string; valor: number | null }[] {
  return Array.from({ length: 13 }, (_, i) => somaMeses(mes, i - 12)).map(m => ({ mes: m, valor: m === mes ? atual : guardados.get(m) ?? null }));
}

const setoresOrdenados = (...qs: LinhaODS[][]) => [...new Set(qs.flat().map(l => l.ods))].sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));

export function planilhaCongestionamento(d: DadosCongestionamento): XLSX.WorkBook {
  const ano = Number(d.mes.slice(0, 4)), ant = ano - 1;
  const ws: XLSX.WorkSheet = {};
  const num = (v: number, f?: string): XLSX.CellObject => ({ t: 'n', v, ...(f ? { f } : {}) });
  const put = (ref: string, c: XLSX.CellObject | string | number) => { ws[ref] = typeof c === 'string' ? { t: 's', v: c } : typeof c === 'number' ? { t: 'n', v: c } : c; };
  const pct = (ref: string, c: string, b: string, v: number) => { ws[ref] = { t: 'n', v: v, f: `IF(${b}=0,0,${c}/${b})`, z: '0.00%' }; };
  put('A1', 'Base Naval da Ilha das Cobras'); put('A2', 'Dívida Geral'); put('B2', ano);
  put('A4', 'Dívidas Geral'); put('B4', 'Valor');
  d.serie.forEach((p, i) => { put(`A${5 + i}`, rotuloMes(p.mes)); if (p.valor != null) ws[`B${5 + i}`] = { t: 'n', v: p.valor, z: '#,##0.00' }; });

  const ods = setoresOrdenados(d.quadroAnterior, d.quadroAtual), n = ods.length;
  const get = (q: LinhaODS[], o: string) => q.find(l => l.ods === o) || { ods: o, faturamento: 0, divida: 0 };
  const t1 = 35, t2 = t1 + n + 6, t3 = t2 + n + 6;
  const bloco = (ini: number, tit: [string, string], rows: { ods: string; b: number; c: number; fb?: string; fc?: string }[]) => {
    put(`A${ini}`, 'ODS'); put(`B${ini}`, tit[0]); put(`C${ini}`, tit[1]); put(`D${ini}`, '% DA DIVIDA');
    rows.forEach((r, i) => {
      const L = ini + 1 + i;
      put(`A${L}`, r.ods);
      ws[`B${L}`] = { t: 'n', v: r.b, z: '#,##0.00', ...(r.fb ? { f: r.fb } : {}) }; ws[`C${L}`] = { t: 'n', v: r.c, z: '#,##0.00', ...(r.fc ? { f: r.fc } : {}) };
      pct(`D${L}`, `C${L}`, `B${L}`, r.b ? r.c / r.b : 0);
    });
    const T = ini + 1 + rows.length, a = ini + 1, z = ini + rows.length;
    const sb = r2(rows.reduce((s, r) => s + r.b, 0)), sc = r2(rows.reduce((s, r) => s + r.c, 0));
    put(`A${T}`, 'TOTAL'); ws[`B${T}`] = { t: 'n', v: sb, f: `SUM(B${a}:B${z})`, z: '#,##0.00' }; ws[`C${T}`] = { t: 'n', v: sc, f: `SUM(C${a}:C${z})`, z: '#,##0.00' };
    pct(`D${T}`, `C${T}`, `B${T}`, sb ? sc / sb : 0);
    return sc;
  };
  bloco(t1, [`FATURAMENTO ${ant}`, `DIVIDAS ${ant}`], ods.map(o => ({ ods: o, b: get(d.quadroAnterior, o).faturamento, c: get(d.quadroAnterior, o).divida })));
  bloco(t2, [`FATURAMENTO ${ano}`, `DIVIDAS ${ano}`], ods.map(o => ({ ods: o, b: get(d.quadroAtual, o).faturamento, c: get(d.quadroAtual, o).divida })));
  bloco(t3, [`FATURAMENTO ${ant}/${ano}`, 'DIVIDA TOTAL'], ods.map((o, i) => {
    const a = get(d.quadroAnterior, o), c = get(d.quadroAtual, o);
    return { ods: o, b: r2(a.faturamento + c.faturamento), c: r2(a.divida + c.divida), fb: `B${t1 + 1 + i}+B${t2 + 1 + i}`, fc: `C${t1 + 1 + i}+C${t2 + 1 + i}` };
  }));
  put(`A${t3 + n + 3}`, `Posição em ${fimDoMes(d.mes).split('-').reverse().join('/')} · dívida = ${d.criterio === 'vencido' ? 'saldo vencido' : 'saldo em aberto (vencido + a vencer)'} · faturas canceladas fora · contestadas fora da dívida`);
  ws['!ref'] = `A1:D${t3 + n + 3}`; ws['!cols'] = [{ wch: 16 }, { wch: 22 }, { wch: 20 }, { wch: 14 }];

  // dívida por ODS (valor e % do total) — quadro da pizza
  const tot = ods.map(o => ({ ods: o, v: r2(get(d.quadroAnterior, o).divida + get(d.quadroAtual, o).divida) }));
  const soma = r2(tot.reduce((s, x) => s + x.v, 0));
  const aoa: (string | number | null)[][] = [['Base Naval da Ilha das Cobras'], [], [], ['ODS', 'VALOR DÍVIDA ODS', '% DÍVIDA ODS'], ...tot.map(x => [x.ods, x.v, soma ? x.v / soma : 0]), ['TOTAL', soma, 1]];
  const ws2 = XLSX.utils.aoa_to_sheet(aoa);
  tot.forEach((_, i) => { const r = 5 + i; ws2[`C${r}`].z = '0.00%'; ws2[`B${r}`].z = '#,##0.00'; });
  ws2[`B${5 + tot.length}`].z = '#,##0.00'; ws2[`C${5 + tot.length}`].z = '0.00%'; ws2['!cols'] = [{ wch: 16 }, { wch: 20 }, { wch: 16 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, `Dívida Geral ${ano}`);
  XLSX.utils.book_append_sheet(wb, ws2, 'Dívida Geral');
  return wb;
}
