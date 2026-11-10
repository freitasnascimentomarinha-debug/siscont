/**
 * Cabeçalho institucional padrão dos PDFs do sistema (modelo das faturas FR-172):
 * brasão à esquerda e três linhas centralizadas em negrito.
 */
import type jsPDF from 'jspdf';
import autoTable, { UserOptions } from 'jspdf-autotable';
import { BRASAO_MARINHA_PNG, BRASAO_PROPORCAO } from './brasaoMarinha';
import { BRASAO_MB_PNG, BRASAO_MB_PROPORCAO } from './brasaoMB';

export const LINHAS_CABECALHO = ['MARINHA DO BRASIL', 'BASE NAVAL DA ILHA DAS COBRAS', 'DEPARTAMENTO DE INTENDÊNCIA'];

/** Desenha brasão + cabeçalho a partir de `y` (mm) e devolve o `y` logo abaixo (mm). */
export function cabecalhoInstitucional(doc: jsPDF, y = 6, opts: { margem?: number; linhas?: string[]; altBrasao?: number; tam?: number } = {}): number {
  const W = doc.internal.pageSize.getWidth();
  const margem = opts.margem ?? 10;
  const alt = opts.altBrasao ?? 24;
  const tam = opts.tam ?? 10.5;
  try { doc.addImage(BRASAO_MARINHA_PNG, 'PNG', margem, y, alt * BRASAO_PROPORCAO, alt); } catch { /* sem brasão não impede o PDF */ }
  const linhas = opts.linhas ?? LINHAS_CABECALHO;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(tam); doc.setTextColor(0);
  const passo = tam * 0.45;
  let yy = y + alt / 2 - ((linhas.length - 1) * passo) / 2 + 1;
  linhas.forEach(l => { doc.text(l, W / 2, yy, { align: 'center' }); yy += passo; });
  return y + alt + 3;
}

// ------------------------------------------------------------------ relatórios (padrão único)
/** Cores dos relatórios: faixa de título, cabeçalho de coluna, linha de total, listra e destaque (RGB). */
export const TEMA = {
  faixa: [11, 42, 74] as [number, number, number], cab: [38, 84, 124] as [number, number, number],
  total: [214, 226, 240] as [number, number, number], total2: [196, 210, 228] as [number, number, number],
  zebra: [244, 247, 251] as [number, number, number], linha: [198, 208, 220] as [number, number, number],
  texto: [22, 28, 38] as [number, number, number], destaque: [255, 236, 179] as [number, number, number],
  vencido: [185, 28, 28] as [number, number, number], credito: [21, 128, 61] as [number, number, number], nota: [120, 53, 15] as [number, number, number],
};

/**
 * Registra, página por página, até onde chegou o que foi desenhado (texto, retângulos, linhas, imagens...). A assinatura vai
 * logo abaixo disso, então nunca cai em cima de dados, mesmo com notas e textos depois da última tabela.
 */
function rastrear(doc: any) {
  if (doc.__rastro) return;
  doc.__rastro = {} as Record<number, number>;
  const reg = (y: number) => {
    if (!Number.isFinite(y)) return;
    const p = doc.internal.getCurrentPageInfo().pageNumber;
    if (y > (doc.__rastro[p] || 0)) doc.__rastro[p] = y;
  };
  const embrulhar = (nome: string, fundo: (a: any[]) => number) => {
    const orig = doc[nome]?.bind(doc);
    if (!orig) return;
    doc[nome] = (...a: any[]) => { try { reg(fundo(a)); } catch { /* o rastro nunca atrapalha o PDF */ } return orig(...a); };
  };
  embrulhar('text', a => {
    const [t, , y, o] = a;
    const n = Array.isArray(t) ? t.length : o?.maxWidth ? doc.splitTextToSize(String(t), o.maxWidth).length : 1;
    return y + (n - 1) * (doc.getFontSize() * doc.getLineHeightFactor()) / doc.internal.scaleFactor + 1;
  });
  embrulhar('rect', a => a[1] + (a[3] || 0));
  embrulhar('roundedRect', a => a[1] + (a[3] || 0));
  embrulhar('line', a => Math.max(a[1], a[3]));
  embrulhar('addImage', a => (typeof a[0] === 'object' ? a[0].y + (a[0].h || 0) : a[3] + (a[5] || 0)));
  embrulhar('circle', a => a[1] + (a[2] || 0));
  embrulhar('triangle', a => Math.max(a[1], a[3], a[5]));
}

/**
 * Cabeçalho dos relatórios: brasão da Marinha do Brasil à esquerda, brasão da Base Naval à direita, as três linhas
 * institucionais ao centro e um filete. Devolve o `y` onde o conteúdo começa (26 mm).
 */
export function cabecalhoCompacto(doc: jsPDF, margem = 14): number {
  rastrear(doc);
  const W = doc.internal.pageSize.getWidth();
  const alt = 17, y = 5;
  try { doc.addImage(BRASAO_MARINHA_PNG, 'PNG', W - margem - alt * BRASAO_PROPORCAO, y, alt * BRASAO_PROPORCAO, alt); } catch { /* sem brasão não impede o PDF */ }
  if (BRASAO_MB_PNG) { try { doc.addImage(BRASAO_MB_PNG, 'PNG', margem, y, alt * BRASAO_MB_PROPORCAO, alt); } catch { /* idem */ } }
  doc.setTextColor(...TEMA.faixa); doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
  LINHAS_CABECALHO.forEach((l, i) => doc.text(l, W / 2, y + 5 + i * 4.8, { align: 'center' }));
  doc.setDrawColor(...TEMA.faixa); doc.setLineWidth(0.6); doc.line(margem, y + alt + 2, W - margem, y + alt + 2);
  doc.setLineWidth(0.25); doc.setDrawColor(0); doc.setTextColor(0); doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
  return 26;
}

/** Título do relatório + linha de posição (sem filtros). Devolve o `y` abaixo. */
export function tituloRelatorio(doc: jsPDF, titulo: string, posicao?: string, y = 26, margem = 14): number {
  const W = doc.internal.pageSize.getWidth();
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(...TEMA.faixa);
  const ls = doc.splitTextToSize(titulo, W - 2 * margem); doc.text(ls, margem, y + 4); y += 4 + 5.2 * (ls.length - 1);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(60);
  if (posicao) { doc.text(posicao, margem, y + 5.5); y += 5.5; }
  doc.setTextColor(0);
  return y + 5;
}

/** Tabela no padrão dos relatórios (cores, grade fina, listras, fonte 8): as opções do chamador prevalecem. */
export function tabelaPdf(doc: jsPDF, o: UserOptions) {
  const mescla = (a: any, b: any) => ({ ...a, ...b });
  autoTable(doc, {
    theme: 'grid', margin: { left: 14, right: 14 }, ...o,
    styles: mescla({ fontSize: 8, cellPadding: 1.6, textColor: TEMA.texto, lineColor: TEMA.linha, lineWidth: 0.1 }, o.styles),
    headStyles: mescla({ fillColor: TEMA.faixa, textColor: 255, fontStyle: 'bold' }, o.headStyles),
    footStyles: mescla({ fillColor: TEMA.total, textColor: TEMA.faixa, fontStyle: 'bold' }, o.footStyles),
    alternateRowStyles: mescla({ fillColor: TEMA.zebra }, o.alternateRowStyles),
    // coluna de valores alinhada à direita: o cabeçalho e o total acompanham
    didParseCell: (d: any) => {
      const cs: any = (o.columnStyles as any)?.[d.column.index];
      if (cs?.halign === 'right' && d.section !== 'body' && d.cell.colSpan === 1) d.cell.styles.halign = 'right';
      (o.didParseCell as any)?.(d);
    },
  });
}

/** y logo abaixo da última tabela desenhada (ou `padrao`). */
export const fimDaTabela = (doc: jsPDF, padrao = 30): number => ((doc as any).lastAutoTable?.finalY ?? padrao);

const dataHoraBR = () => new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

/**
 * Fecha o relatório: bloco de assinatura ("ASSINADO DIGITALMENTE") no fim e, em todas as páginas, rodapé com a data
 * de geração e "Página x de y". `yFim`: onde terminou o conteúdo da última página (padrão: fim da última tabela).
 */
export function finalizarPdf(doc: jsPDF, opts: { yFim?: number; assinar?: boolean } = {}): jsPDF {
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
  if (opts.assinar !== false) {
    const ultima = doc.getNumberOfPages();
    const t = (doc as any).lastAutoTable;
    const rastro: number | undefined = (doc as any).__rastro?.[ultima];
    let y = (rastro ?? opts.yFim ?? (t && t.pageNumber === ultima ? t.finalY : 30)) + 9;
    if (y > H - 23) { doc.addPage(); y = 40; (doc as any).__assinaturaSozinha = true; }
    doc.setPage(doc.getNumberOfPages());
    const cx = W / 2;
    doc.setDrawColor(0); doc.setLineWidth(0.3); doc.line(cx - 40, y, cx + 40, y);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(0);
    doc.text('Encarregado da Divisão de Contabilidade', cx, y + 4.5, { align: 'center' });
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5);
    doc.rect(cx - 30, y + 6.5, 60, 6); doc.text('ASSINADO DIGITALMENTE', cx, y + 10.8, { align: 'center' });
  }
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    doc.setDrawColor(...TEMA.linha); doc.setLineWidth(0.2); doc.line(14, H - 9.5, W - 14, H - 9.5);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(90);
    doc.text(`Gerado em ${dataHoraBR()}`, 14, H - 5.5); doc.text(`Página ${i} de ${n}`, W - 14, H - 5.5, { align: 'right' });
  }
  doc.setTextColor(0); doc.setDrawColor(0); doc.setLineWidth(0.25);
  return doc;
}

/** Fecha (assinatura, rodapé) e baixa o PDF. */
export function salvarPdf(doc: jsPDF, nome: string, opts: { yFim?: number; assinar?: boolean } = {}): jsPDF {
  finalizarPdf(doc, opts); doc.save(nome); return doc;
}
