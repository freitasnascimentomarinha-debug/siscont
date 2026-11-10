/**
 * Exportação do Painel inicial: Excel completo (resumo, gráficos nativos com os dados ao lado, tabelas e lista das faturas
 * em aberto) e PDF (indicadores, gráficos e tabelas). Usa exatamente os números da tela (resumoPainel / taxaCondominial).
 */
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { FaturaPainel, FAIXAS_IDADE, resumoPainel, taxaCondominial, vencida } from './painel';
import { GraficoPainel } from './graficosPainel';
import { GraficoXl, injetarGraficos } from './xlsxGraficos';
import { desenharGrafico } from './pdfGraficos';
import { cabecalhoCompacto } from './pdfCabecalho';

export interface EntradaPainelInicial {
  ano: number; hoje: string; geradoEm: string;
  r: ReturnType<typeof resumoPainel>; tc: ReturnType<typeof taxaCondominial>;
  filtros: string[]; abertas: FaturaPainel[]; contestadas: FaturaPainel[];
}

export const COR_PI = { faturado: '#2a78d6', pago: '#eb6834', vencido: '#d03b3b', aVencer: '#0ca30c', anterior: '#8f1d1d' };
const RAMPA_IDADE = ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#104281'];
const corIdade = (faixa: string) => (faixa === 'A vencer' ? COR_PI.aVencer : RAMPA_IDADE[FAIXAS_IDADE.indexOf(faixa as any) - 1] || '#2a78d6');
const brl = (n: number) => `R$ ${(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const br = (iso?: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—');
const col = (n: number) => { let s = ''; for (let i = n + 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };
const FMT_BRL = '#,##0.00';

/** Os gráficos da tela, como dados (os mesmos para o Excel e para o PDF). */
export function graficosPainelInicial(e: EntradaPainelInicial): GraficoPainel[] {
  const { r, ano, tc } = e;
  const nomeCurto = (n: string) => (n.length > 34 ? `${n.slice(0, 33)}…` : n);
  const v = (l: number[]) => l.map(x => Math.round(x * 100) / 100);
  return [
    { id: 'mes', titulo: `Faturado por mês — ${ano}`, categorias: r.porMes.map(m => m.mes), series: [
      { nome: 'Faturado', valores: v(r.porMes.map(m => m.faturado)), cor: COR_PI.faturado, tipo: 'bar' },
      { nome: 'Já pago', valores: v(r.porMes.map(m => m.pago)), cor: COR_PI.pago, tipo: 'bar' }] },
    { id: 'idade', titulo: 'Idade da dívida (em aberto por tempo de atraso)', categorias: r.idade.map(i => i.faixa), coresPontos: r.idade.map(i => corIdade(i.faixa)),
      series: [{ nome: 'Em aberto', valores: v(r.idade.map(i => i.valor)), cor: COR_PI.faturado, tipo: 'bar' }] },
    { id: 'comp', titulo: 'De que é feito o em aberto', categorias: [`Vencidas até ${ano - 1}`, `Vencidas de ${ano}`, 'A vencer'], coresPontos: [COR_PI.anterior, COR_PI.vencido, COR_PI.aVencer],
      series: [{ nome: 'Em aberto', valores: v([r.vencidasAnteriores.valor, r.vencidasAno.valor, r.aVencer.valor]), cor: COR_PI.vencido, tipo: 'bar' }] },
    { id: 'dev', titulo: 'Maiores devedores (10 maiores valores em aberto)', horizontal: true, empilhado: true, categorias: r.porCliente.slice(0, 10).map(c => nomeCurto(c.nome)), series: [
      { nome: 'Vencido', valores: v(r.porCliente.slice(0, 10).map(c => c.vencido)), cor: COR_PI.vencido, tipo: 'bar' },
      { nome: 'A vencer', valores: v(r.porCliente.slice(0, 10).map(c => c.aVencer)), cor: COR_PI.aVencer, tipo: 'bar' }] },
    { id: 'tipo', titulo: 'Em aberto por serviço', horizontal: true, empilhado: true, categorias: r.porTipo.slice(0, 8).map(c => nomeCurto(c.nome)), series: [
      { nome: 'Vencido', valores: v(r.porTipo.slice(0, 8).map(c => c.vencido)), cor: COR_PI.vencido, tipo: 'bar' },
      { nome: 'A vencer', valores: v(r.porTipo.slice(0, 8).map(c => c.aVencer)), cor: COR_PI.aVencer, tipo: 'bar' }] },
    { id: 'setor', titulo: 'Em aberto por setor', horizontal: true, empilhado: true, categorias: r.porSetor.slice(0, 10).map(c => nomeCurto(c.nome)), series: [
      { nome: 'Vencido', valores: v(r.porSetor.slice(0, 10).map(c => c.vencido)), cor: COR_PI.vencido, tipo: 'bar' },
      { nome: 'A vencer', valores: v(r.porSetor.slice(0, 10).map(c => c.aVencer)), cor: COR_PI.aVencer, tipo: 'bar' }] },
    ...(tc.oms.length ? [{ id: 'tc', titulo: `Taxa condominial ${tc.ano} — valor mensal por OM (15 maiores)`, horizontal: true, categorias: tc.oms.slice(0, 15).map(o => nomeCurto(o.nome)),
      series: [{ nome: 'Mensal', valores: v(tc.oms.slice(0, 15).map(o => o.mensal)), cor: COR_PI.faturado, tipo: 'bar' as const }] }] : []),
  ];
}

/** Indicadores do painel (os cartões da tela). */
export function linhasIndicadoresPI(e: EntradaPainelInicial): { rotulo: string; valor: number; qtd: number | null; extra?: string }[] {
  const { r, ano, tc } = e;
  return [
    { rotulo: `Faturado em ${ano}`, valor: r.faturadoAno.valor, qtd: r.faturadoAno.qtd, extra: r.faturadoAnterior ? `${ano - 1}: ${brl(r.faturadoAnterior)}` : undefined },
    { rotulo: `Já pago do faturado em ${ano}`, valor: r.pagoAno, qtd: null, extra: `${r.percentualPago.toLocaleString('pt-BR')}% do faturado` },
    { rotulo: `Vencidas até ${ano - 1}`, valor: r.vencidasAnteriores.valor, qtd: r.vencidasAnteriores.qtd },
    { rotulo: `Vencidas de ${ano}`, valor: r.vencidasAno.valor, qtd: r.vencidasAno.qtd },
    { rotulo: 'Total de vencidas', valor: r.vencidas.valor, qtd: r.vencidas.qtd },
    { rotulo: 'A vencer', valor: r.aVencer.valor, qtd: r.aVencer.qtd },
    { rotulo: 'Total em aberto (sem contestadas)', valor: r.emAberto.valor, qtd: r.emAberto.qtd },
    { rotulo: 'Em contestação (fora do em aberto)', valor: r.contestadas.valor, qtd: r.contestadas.qtd },
    ...(tc.ano ? [{ rotulo: `Taxa condominial ${tc.ano} (mensal)`, valor: tc.mensal, qtd: tc.oms.length, extra: `anual ${brl(tc.anual)} · ${tc.oms.length} OM` }] : []),
  ];
}

const cabecalhoTexto = (e: EntradaPainelInicial) => [
  `Posição em ${br(e.hoje)} · exercício de referência ${e.ano} · gerado em ${e.geradoEm}`,
  `Recorte: ${e.filtros.length ? e.filtros.join('; ') : 'todos os setores, comandos, clientes e serviços'}`,
];

// ------------------------------------------------------------------ Excel
export async function excelPainelInicial(e: EntradaPainelInicial): Promise<Uint8Array> {
  const { r, tc } = e;
  const wb = XLSX.utils.book_new();
  const fmtCol = (ws: XLSX.WorkSheet, c: number, de: number, ate: number, z: string) => { for (let i = de; i <= ate; i++) { const cell = ws[`${col(c)}${i + 1}`]; if (cell && cell.t === 'n') cell.z = z; } };
  const aba = (nome: string, ws: XLSX.WorkSheet, larguras: number[]) => { ws['!cols'] = larguras.map(wch => ({ wch })); XLSX.utils.book_append_sheet(wb, ws, nome); };

  // 1. Resumo
  const ind = linhasIndicadoresPI(e);
  const wsR = XLSX.utils.aoa_to_sheet([
    ['SISCONT — Painel inicial'], ...cabecalhoTexto(e).map(t => [t]), [],
    ['Indicador', 'Valor (R$)', 'Faturas / OM', 'Detalhe'],
    ...ind.map(l => [l.rotulo, l.valor, l.qtd, l.extra || '']),
    [], ['Composição do em aberto'], ['Faixa', 'Valor (R$)', '% do em aberto', 'Faturas'],
    ...[[`Vencidas até ${e.ano - 1}`, r.vencidasAnteriores], [`Vencidas de ${e.ano}`, r.vencidasAno], ['A vencer', r.aVencer]].map(([n, b]: any) => [n, b.valor, r.emAberto.valor ? Math.round((b.valor / r.emAberto.valor) * 1000) / 10 : 0, b.qtd]),
  ]);
  fmtCol(wsR, 1, 5, 5 + ind.length, FMT_BRL);
  const iniComp = 5 + ind.length + 3; fmtCol(wsR, 1, iniComp, iniComp + 2, FMT_BRL); fmtCol(wsR, 2, iniComp, iniComp + 2, '0.0"%"');
  aba('Resumo', wsR, [44, 20, 16, 60]);

  // 2. Gráficos: tabela à esquerda, gráfico ao lado
  const gs = graficosPainelInicial(e);
  const aoa: (string | number | null)[][] = [];
  const xl: GraficoXl[] = [];
  const BLOCO = 26;
  gs.forEach((g, k) => {
    const ini = k * BLOCO;
    while (aoa.length < ini) aoa.push([]);
    aoa.push([g.titulo]);
    aoa.push(['', ...g.series.map(s => s.nome)]);
    g.categorias.forEach((c, i) => aoa.push([c, ...g.series.map(s => s.valores[i])]));
    const a = ini + 3, z = ini + 2 + g.categorias.length;
    const rng = (c: number) => `'Gráficos'!$${col(c)}$${a}:$${col(c)}$${z}`;
    xl.push({
      titulo: g.titulo, de: { col: 5, row: ini }, ate: { col: 15, row: ini + BLOCO - 2 }, formato: '#,##0', horizontal: g.horizontal, empilhado: g.empilhado,
      series: g.series.map((s, i) => ({ nome: s.nome, cat: rng(0), val: rng(i + 1), cor: s.cor, tipo: s.tipo, coresPontos: g.coresPontos })),
    });
  });
  const wsG = XLSX.utils.aoa_to_sheet(aoa);
  gs.forEach((g, k) => g.series.forEach((_, i) => fmtCol(wsG, i + 1, k * BLOCO + 2, k * BLOCO + 2 + g.categorias.length, FMT_BRL)));
  wsG['!cols'] = [{ wch: 36 }, { wch: 16 }, { wch: 16 }, { wch: 4 }, { wch: 4 }];
  XLSX.utils.book_append_sheet(wb, wsG, 'Gráficos');

  // 3. Tabelas completas
  const wsM = XLSX.utils.aoa_to_sheet([['Mês', 'Faturado (R$)', 'Já pago (R$)', 'Em aberto (R$)', 'Faturas'], ...r.porMes.map(m => [m.mes, m.faturado, m.pago, m.emAberto, m.qtd])]);
  [1, 2, 3].forEach(c => fmtCol(wsM, c, 1, 12, FMT_BRL)); aba('Faturado por mês', wsM, [10, 18, 18, 18, 10]);
  const ranking = (nome: string, titulo: string, lista: { nome: string; vencido: number; aVencer: number; total: number; qtd: number }[]) => {
    const ws = XLSX.utils.aoa_to_sheet([[titulo, 'Vencido (R$)', 'A vencer (R$)', 'Total em aberto (R$)', 'Faturas'], ...lista.map(l => [l.nome, l.vencido, l.aVencer, l.total, l.qtd])]);
    [1, 2, 3].forEach(c => fmtCol(ws, c, 1, lista.length, FMT_BRL)); aba(nome, ws, [60, 18, 18, 22, 10]);
  };
  ranking('Devedores', 'Cliente / OM', r.porCliente);
  ranking('Por serviço', 'Serviço', r.porTipo);
  ranking('Por setor', 'Setor', r.porSetor);
  const wsI = XLSX.utils.aoa_to_sheet([['Faixa de atraso', 'Valor (R$)', 'Faturas'], ...r.idade.map(i => [i.faixa, i.valor, i.qtd])]);
  fmtCol(wsI, 1, 1, r.idade.length, FMT_BRL); aba('Idade da dívida', wsI, [24, 18, 10]);
  if (tc.oms.length) {
    const wsT = XLSX.utils.aoa_to_sheet([[`Taxa condominial ${tc.ano}`, 'Mensal (R$)', 'Anual (R$)', '% do total'], ...tc.oms.map(o => [o.nome, o.mensal, o.anual, o.percentual]), ['TOTAL', tc.mensal, tc.anual, 100]]);
    [1, 2].forEach(c => fmtCol(wsT, c, 1, tc.oms.length + 1, FMT_BRL)); fmtCol(wsT, 3, 1, tc.oms.length + 1, '0.0"%"'); aba('Taxa condominial', wsT, [60, 16, 16, 12]);
  }

  // 4. Todas as faturas em aberto e as contestadas
  const linhasFat = (l: FaturaPainel[]) => l.map(f => [f.numero, f.cliente, f.setor, f.comando, f.tipo, `${String(f.mes).padStart(2, '0')}/${f.ano}`, br(f.emissao), br(f.vencimento), f.total, f.pago, f.saldo, vencida(f, e.hoje) ? 'vencida' : f.contestada ? 'em contestação' : 'a vencer']);
  const cabFat = ['Fatura', 'Cliente', 'Setor', 'Comando', 'Serviço', 'Competência', 'Emissão', 'Vencimento', 'Valor (R$)', 'Pago (R$)', 'Saldo (R$)', 'Situação'];
  const faturas = (nome: string, l: FaturaPainel[]) => {
    const ws = XLSX.utils.aoa_to_sheet([cabFat, ...linhasFat(l)]);
    [8, 9, 10].forEach(c => fmtCol(ws, c, 1, l.length, FMT_BRL)); ws['!autofilter'] = { ref: `A1:L${l.length + 1}` }; ws['!freeze'] = { xSplit: 0, ySplit: 1 } as any;
    aba(nome, ws, [26, 50, 14, 40, 10, 12, 12, 12, 16, 16, 16, 14]);
  };
  faturas('Faturas em aberto', [...e.abertas].sort((a, b) => (a.vencimento || '9999').localeCompare(b.vencimento || '9999') || b.saldo - a.saldo));
  if (e.contestadas.length) faturas('Em contestação', e.contestadas);

  const bruto = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return injetarGraficos(bruto, 'Gráficos', xl);
}

// ------------------------------------------------------------------ PDF
/** Monta o PDF sem salvar (o teste usa esta; a tela usa pdfPainelInicial, que também baixa o arquivo). */
export function montarPdfPainelInicial(e: EntradaPainelInicial): jsPDF {
  const { r, tc } = e;
  const doc = new jsPDF('p');
  const y0 = cabecalhoCompacto(doc);
  doc.setFontSize(14); doc.text(`Painel inicial — faturamento ${e.ano}`, 14, y0 + 7);
  doc.setFontSize(8);
  let y = y0 + 12;
  cabecalhoTexto(e).forEach(l => { const p = doc.splitTextToSize(l, 182); doc.text(p, 14, y); y += 4 * p.length; });

  const tabela = (titulo: string, head: string[], body: (string | number)[][], largura: number[]) => {
    autoTable(doc, { startY: y + 1, head: [[{ content: titulo, colSpan: head.length, styles: { fillColor: [15, 23, 42], halign: 'left' } }], head], body,
      styles: { fontSize: 8, cellPadding: 1.5 }, headStyles: { fillColor: [51, 65, 85] }, theme: 'grid',
      columnStyles: Object.fromEntries(largura.map((w, i) => [i, { cellWidth: w, ...(i > 0 ? { halign: 'right' as const } : {}) }])) });
    y = (doc as any).lastAutoTable.finalY + 5;
  };

  tabela('Indicadores', ['Indicador', 'Valor', 'Faturas / OM'], linhasIndicadoresPI(e).map(l => [`${l.rotulo}${l.extra ? ` (${l.extra})` : ''}`, brl(l.valor), l.qtd ?? '']), [106, 46, 30]);
  tabela('Idade da dívida', ['Faixa', 'Valor', 'Faturas'], r.idade.map(i => [i.faixa, brl(i.valor), i.qtd]), [96, 56, 30]);

  // gráficos: 2 colunas × 3 linhas por página
  const gs = graficosPainelInicial(e);
  for (let p = 0; p < gs.length; p += 6) {
    doc.addPage(); doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(15, 23, 42); doc.text(p === 0 ? 'Gráficos' : 'Gráficos (continuação)', 14, 16);
    gs.slice(p, p + 6).forEach((g, i) => desenharGrafico(doc, g, 14 + (i % 2) * 93, 22 + Math.floor(i / 2) * 83, 89, 79));
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(100);
    doc.text('Em aberto exclui faturas em contestação. Vermelho = vencido · verde = a vencer. Os mesmos números do Painel inicial (respeitam os filtros ativos).', 14, 288, { maxWidth: 182 });
    doc.setTextColor(0);
  }

  doc.addPage(); y = 16;
  const lista = (titulo: string, rot: string, l: typeof r.porSetor, max = 15) =>
    l.length && tabela(titulo, [rot, 'Vencido', 'A vencer', 'Total'], l.slice(0, max).map(s => [s.nome, brl(s.vencido), brl(s.aVencer), brl(s.total)]), [78, 34, 34, 36]);
  lista('Em aberto por setor', 'Setor', r.porSetor);
  lista('Maiores devedores', 'Cliente / OM', r.porCliente, 20);
  lista('Em aberto por serviço', 'Serviço', r.porTipo);
  if (tc.oms.length) tabela(`Taxa condominial ${tc.ano} — total mensal ${brl(tc.mensal)} · anual ${brl(tc.anual)}`, ['OM', 'Mensal', '% do total'], tc.oms.slice(0, 25).map(o => [o.nome, brl(o.mensal), `${o.percentual.toLocaleString('pt-BR')}%`]), [110, 40, 32]);
  doc.setFontSize(7); doc.setTextColor(100);
  doc.text('O Excel traz todas as OM, todas as faturas em aberto e os gráficos editáveis.', 14, Math.min(y + 2, 288), { maxWidth: 182 });
  return doc;
}

export function pdfPainelInicial(e: EntradaPainelInicial): jsPDF {
  const doc = montarPdfPainelInicial(e);
  doc.save(`painel_inicial_${e.ano}_${e.hoje}.pdf`);
  return doc;
}
