/** Gerador de PDF de relatório (cabeçalho oficial, quadro de indicadores, tabelas e paginação). Usado pelos gastos e pela taxa condominial. */
import jsPDF from 'jspdf';
import { TEMA, cabecalhoCompacto, finalizarPdf, tabelaPdf, tituloRelatorio } from './pdfCabecalho';

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
  /** larguras de coluna que passam da página são reduzidas na mesma proporção */
  const escala = (l: number[]) => { const s = l.reduce((a, b) => a + (b || 0), 0); return s > util ? util / s : 1; };
  cabecalhoCompacto(doc);
  let y = tituloRelatorio(doc, r.titulo, r.linhas[0], 26) - 3;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
  r.linhas.slice(1).forEach(l => { const p = doc.splitTextToSize(l, util); doc.text(p, 14, y + 2); y += 4.2 * p.length; });
  if (r.cartoes?.length) {
    // quadro de indicadores: pares rótulo / valor em duas colunas de pares
    const pares: string[][] = [];
    for (let i = 0; i < r.cartoes.length; i += 2) pares.push([r.cartoes[i][0], r.cartoes[i][1], r.cartoes[i + 1]?.[0] ?? '', r.cartoes[i + 1]?.[1] ?? '']);
    tabelaPdf(doc, { startY: y + 1, body: pares, tableWidth: util, styles: { fontSize: 8.5, cellPadding: 1.8 }, alternateRowStyles: { fillColor: [255, 255, 255] },
      columnStyles: { 0: { fillColor: TEMA.zebra, cellWidth: util * 0.27 }, 1: { halign: 'right', fontStyle: 'bold', cellWidth: util * 0.23 }, 2: { fillColor: TEMA.zebra, cellWidth: util * 0.27 }, 3: { halign: 'right', fontStyle: 'bold', cellWidth: util * 0.23 } } });
    y = (doc as any).lastAutoTable.finalY + 4;
  }
  r.tabelas.forEach(t => {
    const dir = new Set(t.direita || []);
    const destaque = new Set(t.destaque || []);
    tabelaPdf(doc, {
      startY: y + 1, head: [[{ content: t.titulo, colSpan: t.head.length, styles: { fillColor: TEMA.faixa, halign: 'left' } }], t.head], body: t.body,
      foot: t.total ? [t.total] : undefined, tableWidth: util, styles: { fontSize: 8, cellPadding: 1.6 }, headStyles: { fillColor: TEMA.cab },
      columnStyles: Object.fromEntries(t.head.map((_, i) => [i, { ...(dir.has(i) ? { halign: 'right' } : {}), ...(t.larguras?.[i] ? { cellWidth: t.larguras[i] * escala(t.larguras) } : {}) }])),
      didParseCell: (d: any) => {
        if (d.section === 'head' && d.row.index === 1 && dir.has(d.column.index)) d.cell.styles.halign = 'right';
        if (d.section === 'foot' && dir.has(d.column.index)) d.cell.styles.halign = 'right';
        if (d.section === 'body' && destaque.has(d.row.index)) { d.cell.styles.fillColor = TEMA.total; d.cell.styles.fontStyle = 'bold'; }
      },
    });
    y = (doc as any).lastAutoTable.finalY + 5;
  });
  let yFim = (doc as any).lastAutoTable?.finalY ?? y;
  if (r.rodape) { doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(70); const p = doc.splitTextToSize(r.rodape, util); doc.text(p, 14, Math.min(y + 2, doc.internal.pageSize.getHeight() - 14)); doc.setTextColor(0); yFim = y + 2 + 3.2 * p.length; }
  finalizarPdf(doc, { yFim });
  return doc;
}

/** Gera e baixa o PDF. */
export function baixarRelatorio(r: RelatorioPdf) { const d = pdfRelatorio(r); d.save(r.arquivo); return d; }
