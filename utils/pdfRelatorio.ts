/** Gerador de PDF de relatório (cabeçalho oficial, quadro de indicadores, tabelas e paginação). Usado pelos gastos e pela taxa condominial. */
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { cabecalhoCompacto } from './pdfCabecalho';

export interface TabelaPdf {
  titulo: string; head: string[]; body: (string | number)[][];
  /** linha de total, no fim */
  total?: (string | number)[];
  /** colunas alinhadas à direita (valores) */
  direita?: number[];
  /** linhas em destaque (índices do body), por exemplo as linhas de grupo */
  destaque?: number[];
  larguras?: number[];
}
export interface RelatorioPdf {
  titulo: string; linhas: string[]; cartoes?: [string, string][]; tabelas: TabelaPdf[]; rodape?: string;
  orientacao?: 'p' | 'l'; arquivo: string;
}

const BRASAO = 'MARINHA DO BRASIL · BASE NAVAL DA ILHA DAS COBRAS · DIVISÃO DE CONTABILIDADE';

export function pdfRelatorio(r: RelatorioPdf): jsPDF {
  const doc = new jsPDF(r.orientacao || 'p');
  const larg = doc.internal.pageSize.getWidth();
  const util = larg - 28;
  const y0 = cabecalhoCompacto(doc);
  doc.setFontSize(14); const tit = doc.splitTextToSize(r.titulo, util); doc.text(tit, 14, y0 + 6);
  let y = y0 + 6 + 6 * tit.length - 2;
  doc.setFontSize(8);
  r.linhas.forEach(l => { const p = doc.splitTextToSize(l, util); doc.text(p, 14, y); y += 4 * p.length; });
  if (r.cartoes?.length) {
    // quadro de indicadores: pares rótulo / valor em duas colunas de pares
    const pares: string[][] = [];
    for (let i = 0; i < r.cartoes.length; i += 2) pares.push([r.cartoes[i][0], r.cartoes[i][1], r.cartoes[i + 1]?.[0] ?? '', r.cartoes[i + 1]?.[1] ?? '']);
    autoTable(doc, { startY: y + 1, body: pares, theme: 'grid', tableWidth: util, margin: { left: 14, right: 14 }, styles: { fontSize: 8, cellPadding: 1.5 },
      columnStyles: { 0: { fillColor: [241, 245, 249], cellWidth: util * 0.27 }, 1: { halign: 'right', fontStyle: 'bold', cellWidth: util * 0.23 }, 2: { fillColor: [241, 245, 249], cellWidth: util * 0.27 }, 3: { halign: 'right', fontStyle: 'bold', cellWidth: util * 0.23 } } });
    y = (doc as any).lastAutoTable.finalY + 4;
  }
  r.tabelas.forEach(t => {
    const dir = new Set(t.direita || []);
    const destaque = new Set(t.destaque || []);
    autoTable(doc, {
      startY: y + 1, head: [[{ content: t.titulo, colSpan: t.head.length, styles: { fillColor: [15, 23, 42], halign: 'left' } }], t.head], body: t.body,
      foot: t.total ? [t.total] : undefined, theme: 'grid', tableWidth: util, margin: { left: 14, right: 14 }, styles: { fontSize: 7.5, cellPadding: 1.4 }, headStyles: { fillColor: [51, 65, 85] }, footStyles: { fillColor: [226, 232, 240], textColor: [15, 23, 42], fontStyle: 'bold' },
      columnStyles: Object.fromEntries(t.head.map((_, i) => [i, { ...(dir.has(i) ? { halign: 'right' } : {}), ...(t.larguras?.[i] ? { cellWidth: t.larguras[i] } : {}) }])),
      didParseCell: (d: any) => {
        if (d.section === 'head' && d.row.index === 1 && dir.has(d.column.index)) d.cell.styles.halign = 'right';
        if (d.section === 'foot' && dir.has(d.column.index)) d.cell.styles.halign = 'right';
        if (d.section === 'body' && destaque.has(d.row.index)) { d.cell.styles.fillColor = [241, 245, 249]; d.cell.styles.fontStyle = 'bold'; }
      },
    });
    y = (doc as any).lastAutoTable.finalY + 5;
  });
  if (r.rodape) { doc.setFontSize(7); doc.setTextColor(100); const p = doc.splitTextToSize(r.rodape, util); doc.text(p, 14, Math.min(y + 2, doc.internal.pageSize.getHeight() - 14)); doc.setTextColor(0); }
  // paginação
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) { doc.setPage(i); doc.setFontSize(7); doc.setTextColor(120); doc.text(`Página ${i} de ${n}`, larguraDireita(doc), doc.internal.pageSize.getHeight() - 6, { align: 'right' }); doc.setTextColor(0); }
  return doc;
}
const larguraDireita = (doc: jsPDF) => doc.internal.pageSize.getWidth() - 14;

/** Gera e baixa o PDF. */
export function baixarRelatorio(r: RelatorioPdf) { const d = pdfRelatorio(r); d.save(r.arquivo); return d; }
