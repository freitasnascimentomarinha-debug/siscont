/**
 * Cabeçalho institucional padrão dos PDFs do sistema (modelo das faturas FR-172):
 * brasão à esquerda e três linhas centralizadas em negrito.
 */
import type jsPDF from 'jspdf';
import { BRASAO_MARINHA_PNG, BRASAO_PROPORCAO } from './brasaoMarinha';

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

/** Versão compacta para relatórios (brasão 15 mm, texto 8,5 pt): ocupa até y = 22 mm e devolve 22. */
export function cabecalhoCompacto(doc: jsPDF, margem = 14): number {
  cabecalhoInstitucional(doc, 5, { margem, altBrasao: 15, tam: 8.5 });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
  return 22;
}
