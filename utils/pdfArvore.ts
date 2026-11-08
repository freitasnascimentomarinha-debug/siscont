/**
 * PDF no formato da árvore do Mapa Analítico (Setor › Comando › OM › faturas e créditos).
 * Usado pelo Mapa Analítico e pela mensagem de cobrança.
 */
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { CAB_PDF_ARVORE, MapaAnalitico, NivelPdf, linhasArvorePdf } from './mapaAnalitico';
import { dataBR } from './datas';

const brl = (n: number) => `R$ ${(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const vazio = (n: number) => (n > 0.005 ? brl(n) : '—');

export interface OpcoesPdfArvore {
  titulo: string;
  /** linhas pequenas abaixo do título (posição, regra do crédito, filtros, destinatário...) */
  linhas: string[];
  rotuloTotal?: string;
}

export function pdfArvore(mapa: MapaAnalitico, o: OpcoesPdfArvore): jsPDF {
  const doc = new jsPDF('l');
  doc.setFontSize(9); doc.text('MARINHA DO BRASIL · BASE NAVAL DA ILHA DAS COBRAS · DIVISÃO DE CONTABILIDADE', 14, 11);
  doc.setFontSize(13); doc.text(o.titulo, 14, 18);
  doc.setFontSize(8);
  let y = 23;
  o.linhas.forEach(l => { const partes = doc.splitTextToSize(l, 268); doc.text(partes, 14, y); y += 4.5 * partes.length; });
  const linhas = linhasArvorePdf(mapa, brl, dataBR);
  const niveis: NivelPdf[] = linhas.map(l => l.nivel);
  const recuo: Record<NivelPdf, number> = { setor: 2, comando: 6, cliente: 10, fatura: 15, credito: 15 };
  const t = mapa.total;
  autoTable(doc, {
    startY: y + 1, head: [CAB_PDF_ARVORE], body: linhas.map(l => l.celulas),
    foot: [[o.rotuloTotal || 'TOTAL A PAGAR (LÍQUIDO)', String(t.qtd), vazio(t.vencido), vazio(t.aVencer), vazio(t.divida), vazio(t.credito), brl(t.liquido)]],
    styles: { fontSize: 7, cellPadding: { top: 1, bottom: 1, left: 2, right: 2 } }, headStyles: { fillColor: [15, 23, 42] }, footStyles: { fillColor: [30, 41, 59], fontStyle: 'bold' },
    columnStyles: { 0: { cellWidth: 118 }, 1: { halign: 'right', cellWidth: 14 }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' } },
    didParseCell: (d: any) => {
      if (d.section !== 'body') { if (d.column.index >= 1) d.cell.styles.halign = 'right'; return; }
      const n = niveis[d.row.index];
      if (d.column.index === 0) d.cell.styles.cellPadding = { top: 1, bottom: 1, left: recuo[n], right: 2 };
      if (n === 'setor') { d.cell.styles.fillColor = [226, 232, 240]; d.cell.styles.fontStyle = 'bold'; }
      else if (n === 'comando') { d.cell.styles.fillColor = [241, 245, 249]; d.cell.styles.fontStyle = 'bold'; }
      else if (n === 'cliente') d.cell.styles.fontStyle = 'bold';
      else if (n === 'fatura') { d.cell.styles.textColor = [71, 85, 105]; d.cell.styles.fontSize = 6.5; }
      else if (n === 'credito') { d.cell.styles.textColor = [21, 128, 61]; d.cell.styles.fontSize = 6.5; }
    },
  });
  return doc;
}
