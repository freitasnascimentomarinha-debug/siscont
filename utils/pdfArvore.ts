/**
 * PDF no formato da árvore do Mapa Analítico (Setor › Comando › OM › faturas e créditos).
 * Usado pelo Mapa Analítico e pela mensagem de cobrança.
 */
import jsPDF from 'jspdf';
import { CAB_PDF_ARVORE, MapaAnalitico, NivelPdf, linhasArvorePdf } from './mapaAnalitico';
import { dataBR } from './datas';
import { TEMA, cabecalhoCompacto, fimDaTabela, finalizarPdf, tabelaPdf, tituloRelatorio } from './pdfCabecalho';

const brl = (n: number) => `R$ ${(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const vazio = (n: number) => (n > 0.005 ? brl(n) : '—');

export interface OpcoesPdfArvore {
  titulo: string;
  /** linhas pequenas abaixo do título (posição, regra do crédito, filtros, destinatário...) */
  linhas: string[];
  rotuloTotal?: string;
  /** observação pequena depois da tabela (regras do crédito etc.) */
  nota?: string;
}

function notaFinal(doc: jsPDF, nota: string | undefined, larg: number): number {
  const y = fimDaTabela(doc);
  if (!nota) return y;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(70);
  const p = doc.splitTextToSize(nota, larg); doc.text(p, 14, y + 5); doc.setTextColor(0);
  return y + 5 + 3.2 * p.length;
}

export function pdfArvore(mapa: MapaAnalitico, o: OpcoesPdfArvore): jsPDF {
  const doc = new jsPDF('l');
  cabecalhoCompacto(doc);
  let y = tituloRelatorio(doc, o.titulo, o.linhas[0], 26) - 2;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
  o.linhas.slice(1).forEach(l => { const partes = doc.splitTextToSize(l, 268); doc.text(partes, 14, y + 1); y += 4.2 * partes.length; });
  const linhas = linhasArvorePdf(mapa, brl, dataBR);
  const niveis: NivelPdf[] = linhas.map(l => l.nivel);
  const recuo: Record<NivelPdf, number> = { setor: 2, comando: 6, cliente: 10, fatura: 15, credito: 15 };
  const t = mapa.total;
  tabelaPdf(doc, {
    startY: y + 1, head: [CAB_PDF_ARVORE], body: linhas.map(l => l.celulas),
    foot: [[o.rotuloTotal || 'TOTAL A PAGAR (LÍQUIDO)', String(t.qtd), vazio(t.vencido), vazio(t.aVencer), vazio(t.divida), vazio(t.credito), brl(t.liquido)]],
    styles: { fontSize: 8, cellPadding: { top: 1.1, bottom: 1.1, left: 2, right: 2 } }, alternateRowStyles: { fillColor: [255, 255, 255] }, footStyles: { fillColor: TEMA.faixa, textColor: 255, fontStyle: 'bold' },
    columnStyles: { 0: { cellWidth: 118 }, 1: { halign: 'right', cellWidth: 14 }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' } },
    didParseCell: (d: any) => {
      if (d.section !== 'body') { if (d.column.index >= 1) d.cell.styles.halign = 'right'; return; }
      const n = niveis[d.row.index];
      if (d.column.index === 0) d.cell.styles.cellPadding = { top: 1, bottom: 1, left: recuo[n], right: 2 };
      if (n === 'setor') { d.cell.styles.fillColor = TEMA.total2; d.cell.styles.fontStyle = 'bold'; }
      else if (n === 'comando') { d.cell.styles.fillColor = TEMA.total; d.cell.styles.fontStyle = 'bold'; }
      else if (n === 'cliente') d.cell.styles.fontStyle = 'bold';
      else if (n === 'fatura') { d.cell.styles.textColor = TEMA.texto; d.cell.styles.fontSize = 7.5; }
      else if (n === 'credito') { d.cell.styles.textColor = TEMA.credito; d.cell.styles.fontSize = 7.5; }
    },
  });
  finalizarPdf(doc, { yFim: notaFinal(doc, o.nota, 268) });
  return doc;
}

/**
 * PDF ENXUTO da cobrança: uma coluna de valor só. Em cada OM: as faturas vencidas (vencimento, dias de atraso, valor)
 * e, em destaque, o VALOR A PAGAR PELA OM = soma das faturas. O crédito (ALTCRED/GRU com saldo) NÃO é abatido:
 * só reduz a dívida quando for atribuído (baixado) às faturas; aparece apenas como observação.
 */
export function pdfCobrancaEnxuto(mapa: MapaAnalitico, o: OpcoesPdfArvore): jsPDF {
  const doc = new jsPDF('p');
  cabecalhoCompacto(doc);
  let y = tituloRelatorio(doc, o.titulo, undefined, 26);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
  o.linhas.forEach(l => { const partes = doc.splitTextToSize(l, 182); doc.text(partes, 14, y); y += 4.2 * partes.length; });
  y += 1;
  // quadro com o valor a pagar
  const t = mapa.total;
  doc.setFillColor(...TEMA.faixa); doc.roundedRect(14, y, 182, 12, 2, 2, 'F');
  doc.setTextColor(255, 255, 255); doc.setFontSize(11);
  doc.text(o.rotuloTotal || 'VALOR A PAGAR', 18, y + 7.8); doc.text(brl(t.divida), 192, y + 7.8, { align: 'right' });
  doc.setTextColor(0, 0, 0);
  y += 16;

  type Tipo = 'setor' | 'comando' | 'om' | 'fatura' | 'credito' | 'apagar';
  const body: any[][] = []; const tipos: Tipo[] = [];
  const push = (tp: Tipo, c: any[]) => { body.push(c); tipos.push(tp); };
  const umSetor = mapa.setores.length === 1;
  mapa.setores.forEach(s => {
    if (!umSetor) push('setor', [`Setor ${s.nome}`, '', '', brl(s.divida)]);
    s.filhos.forEach(c => {
      push('comando', [`Comando ${c.nome}`, '', '', brl(c.divida)]);
      c.filhos.forEach(x => {
        push('om', [x.nome, '', '', '']);
        (x.faturas || []).forEach(f => push('fatura', [`${f.numero} · ${f.tipo}${f.contestada ? ' · em contestação' : ''}`, dataBR(f.vencimento), f.atraso ? `${f.atraso} dias` : '—', brl(f.saldo)]));
        push('apagar', ['VALOR A PAGAR PELA OM', '', '', brl(x.divida)]);
        // crédito: só informativo (não abate enquanto não for atribuído às faturas)
        if (x.credito > 0.005) push('credito', [{ colSpan: 4, content: `Obs.: a OM tem ${brl(x.credito)} de crédito (${(x.creditos || []).map(cr => cr.numero).join(', ')}) ainda não atribuído às faturas; não foi abatido. Para usá-lo, indique as faturas a pagar.` }]);
      });
    });
  });
  const recuo: Record<Tipo, number> = { setor: 2, comando: 2, om: 4, fatura: 9, credito: 9, apagar: 9 };
  tabelaPdf(doc, {
    startY: y, head: [['Comando › OM › fatura', 'Vencimento', 'Atraso', 'Valor']], body,
    foot: [[o.rotuloTotal || 'VALOR A PAGAR', '', '', brl(t.divida)]],
    styles: { fontSize: 8.5, cellPadding: { top: 1.3, bottom: 1.3, left: 2, right: 2 } }, alternateRowStyles: { fillColor: [255, 255, 255] },
    footStyles: { fillColor: TEMA.faixa, textColor: 255, fontStyle: 'bold', fontSize: 9.5 },
    columnStyles: { 0: { cellWidth: 112 }, 1: { halign: 'center', cellWidth: 24 }, 2: { halign: 'right', cellWidth: 18 }, 3: { halign: 'right' } },
    didParseCell: (d: any) => {
      if (d.section !== 'body') { if (d.column.index === 3) d.cell.styles.halign = 'right'; return; }
      const tp = tipos[d.row.index];
      if (d.column.index === 0) d.cell.styles.cellPadding = { top: 1.2, bottom: 1.2, left: recuo[tp], right: 2 };
      if (tp === 'setor') { d.cell.styles.fillColor = TEMA.total2; d.cell.styles.fontStyle = 'bold'; }
      else if (tp === 'comando') { d.cell.styles.fillColor = TEMA.total; d.cell.styles.fontStyle = 'bold'; }
      else if (tp === 'om') { d.cell.styles.fontStyle = 'bold'; d.cell.styles.fillColor = TEMA.zebra; }
      else if (tp === 'fatura') d.cell.styles.textColor = TEMA.texto;
      else if (tp === 'credito') { d.cell.styles.textColor = TEMA.credito; d.cell.styles.fontStyle = 'italic'; d.cell.styles.fontSize = 7.5; }
      else if (tp === 'apagar') { d.cell.styles.fontStyle = 'bold'; d.cell.styles.fillColor = TEMA.destaque; d.cell.styles.textColor = TEMA.texto; }
    },
  });
  finalizarPdf(doc, { yFim: notaFinal(doc, o.nota, 182) });
  return doc;
}
