/**
 * Página "DESCRIÇÃO DE MANOBRA" anexada à fatura de rebocador (RB), reproduzindo o documento da Base Naval da Ilha das Cobras
 * (o mesmo que subsidia a fatura): navio, datas, OM solicitante, manobras, tabela com o custo de cada manobra, total e assinaturas.
 */
import jsPDF from 'jspdf';
import { tabelaPdf } from './pdfCabecalho';
import type { DescricaoManobra } from './importManobras';

const brl = (n: number) => `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const br = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.slice(8) + '/' + iso.slice(5, 7) + '/' + iso.slice(2, 4) : iso);

/** Texto das manobras sem o rótulo repetido ("MANOBRAS (089; 288)" → "089; 288"). */
const numerosManobras = (s: string) => s.replace(/^MANOBRAS?\s*/i, '').replace(/^\((.*)\)$/, '$1').trim();

export function desenharDescricaoManobra(doc: jsPDF, dm: DescricaoManobra) {
  const W = doc.internal.pageSize.getWidth(), cx = W / 2;
  doc.setTextColor(0); doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
  doc.text('BASE NAVAL DA ILHA DAS COBRAS', cx, 16, { align: 'center' });
  doc.setFontSize(11); doc.text('DESCRIÇÃO DE MANOBRA', cx, 22, { align: 'center' });
  if (dm.numero) { doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.text(`Nº ${dm.numero}`, W - 14, 16, { align: 'right' }); }
  const datas = [...new Set(dm.linhas.map(l => l.dia))].sort().map(br).join('; ') || dm.datas;
  tabelaPdf(doc, {
    startY: 28, theme: 'grid', showHead: false, styles: { fontSize: 9, cellPadding: 1.8, textColor: 0, lineColor: 0, lineWidth: 0.2 },
    columnStyles: { 0: { cellWidth: 48, fontStyle: 'bold' } }, alternateRowStyles: { fillColor: false as any },
    body: [
      ['NAVIOS MANOBRADOS', dm.navio], ['DATA', datas], ['OM SOLICITANTE', dm.solicitante],
      ['MANOBRAS', numerosManobras(dm.manobras)], ['LOCAL', dm.local],
    ],
  });
  const y0 = ((doc as any).lastAutoTable?.finalY ?? 60) + 5;
  tabelaPdf(doc, {
    startY: y0, theme: 'grid',
    styles: { fontSize: 8.5, cellPadding: 1.8, textColor: 0, lineColor: 0, lineWidth: 0.2, halign: 'center' },
    headStyles: { fillColor: [235, 235, 235], textColor: 0, fontStyle: 'bold', halign: 'center' }, alternateRowStyles: { fillColor: false as any },
    columnStyles: { 3: { halign: 'right' } },
    head: [['NAVIO / MEIO', 'DIA', 'MANOBRA REALIZADA', 'CUSTO', 'QUANTIDADE DE REBOCADORES', 'LOCAL']],
    body: dm.linhas.map(l => [dm.navio, br(l.dia), l.manobra, brl(l.custo), l.rebocadores == null ? '' : String(l.rebocadores), l.local]),
    foot: [[{ content: 'TOTAL', colSpan: 3, styles: { halign: 'center' } }, { content: brl(dm.total), styles: { halign: 'right' } }, '', '']],
    footStyles: { fillColor: [235, 235, 235], textColor: 0, fontStyle: 'bold' },
  });
  let y = ((doc as any).lastAutoTable?.finalY ?? 120) + 22;
  if (y > 250) { doc.addPage(); y = 30; }
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  const e = dm.encarregado, a = dm.agente;
  if (e) { doc.text(e.nome, W * 0.28, y, { align: 'center' }); doc.text(e.posto, W * 0.28, y + 4.5, { align: 'center' }); doc.text(e.cargo, W * 0.28, y + 9, { align: 'center' }); }
  if (a) { doc.text(a.nome, W * 0.72, y, { align: 'center' }); doc.text(a.cargo, W * 0.72, y + 4.5, { align: 'center' }); }
  doc.text(`OM / NAVIO SOLICITANTE: ${dm.solicitante}`, 14, y + 22);
}
