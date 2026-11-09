/** Desenho vetorial de gráficos (barras, linhas e eixo secundário) em jsPDF, a partir de GraficoPainel. */
import type jsPDF from 'jspdf';
import type { GraficoPainel } from './graficosPainel';

const rgb = (hex: string): [number, number, number] => { const n = parseInt(hex.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
export const compactoPdf = (n: number) => {
  const a = Math.abs(n), s = n < 0 ? '−' : '';
  return a >= 1e6 ? `${s}${(a / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi` : a >= 1e3 ? `${s}${(a / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} mil` : `${s}${a.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`;
};
/** Escala "bonita": limites e passo em que cabem os valores. */
export function escala(min: number, max: number, divisoes = 4): { min: number; max: number; passo: number } {
  const lo = Math.min(0, min), hi = Math.max(0, max);
  if (hi === lo) return { min: 0, max: 1, passo: 1 / divisoes };
  const bruto = (hi - lo) / divisoes, pot = Math.pow(10, Math.floor(Math.log10(bruto)));
  const passo = [1, 2, 2.5, 5, 10].map(f => f * pot).find(p => p >= bruto)!;
  return { min: Math.floor(lo / passo) * passo, max: Math.ceil(hi / passo) * passo, passo };
}

export function desenharGrafico(doc: jsPDF, g: GraficoPainel, x: number, y: number, w: number, h: number) {
  doc.setDrawColor(203, 213, 225); doc.setLineWidth(0.2); doc.rect(x, y, w, h);
  doc.setTextColor(15, 23, 42); doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.text(g.titulo, x + 2, y + 4.5, { maxWidth: w - 4 });
  const n = g.categorias.length;
  if (!n) { doc.setFont('helvetica', 'normal'); doc.setTextColor(100); doc.text('Sem dados no período.', x + w / 2, y + h / 2, { align: 'center' }); return; }
  const prim = g.series.filter(s => !s.secundario), sec = g.series.filter(s => s.secundario);
  const todos = (ss: typeof prim) => ss.flatMap(s => s.valores);
  const eP = escala(Math.min(...todos(prim)), Math.max(...todos(prim)));
  const eS = sec.length ? escala(Math.min(...todos(sec)), Math.max(...todos(sec))) : null;
  const px = x + 14, pw = w - 14 - (eS ? 10 : 3), py = y + 8, ph = h - 8 - 14; // plot
  const yv = (v: number, e = eP) => py + ph - ((v - e.min) / (e.max - e.min)) * ph;
  // grade e eixo primário
  doc.setFont('helvetica', 'normal'); doc.setFontSize(6); doc.setTextColor(100, 116, 139);
  for (let v = eP.min; v <= eP.max + eP.passo / 2; v += eP.passo) {
    const yy = yv(v); doc.setDrawColor(226, 232, 240); doc.line(px, yy, px + pw, yy); doc.text(compactoPdf(v), px - 1.5, yy + 1, { align: 'right' });
  }
  if (eS) for (let v = eS.min; v <= eS.max + eS.passo / 2; v += eS.passo) doc.text(`${compactoPdf(v)}${g.sufixoSec || ''}`, px + pw + 1.5, yv(v, eS) + 1);
  doc.setDrawColor(148, 163, 184); doc.line(px, yv(0), px + pw, yv(0));
  // barras
  const barras = prim.filter(s => s.tipo === 'bar'), faixa = pw / n, largBarra = Math.min(9, (faixa * 0.7) / Math.max(1, barras.length));
  barras.forEach((s, k) => s.valores.forEach((v, i) => {
    const bx = px + faixa * i + (faixa - largBarra * barras.length) / 2 + largBarra * k, y0 = yv(0), y1 = yv(v);
    const c = rgb(s.cor && g.coresPontos && barras.length === 1 ? g.coresPontos[i] || s.cor : s.cor); doc.setFillColor(...c);
    doc.rect(bx, Math.min(y0, y1), largBarra, Math.max(0.1, Math.abs(y0 - y1)), 'F');
  }));
  // linhas
  g.series.filter(s => s.tipo === 'line').forEach(s => {
    const e = s.secundario && eS ? eS : eP; doc.setDrawColor(...rgb(s.cor)); doc.setFillColor(...rgb(s.cor)); doc.setLineWidth(0.5);
    s.valores.forEach((v, i) => { const cx = px + faixa * (i + 0.5), cy = yv(v, e); if (i) doc.line(px + faixa * (i - 0.5), yv(s.valores[i - 1], e), cx, cy); });
    s.valores.forEach((v, i) => doc.circle(px + faixa * (i + 0.5), yv(v, e), 0.6, 'F'));
    doc.setLineWidth(0.2);
  });
  // categorias (pula rótulos se forem muitos)
  doc.setFontSize(6); doc.setTextColor(100, 116, 139);
  const passoRot = n > 14 ? 2 : 1, curtos = g.categorias.some(c => c.length > 9);
  g.categorias.forEach((c, i) => { if (i % passoRot === 0) doc.text(curtos ? doc.splitTextToSize(c, faixa - 0.5) : c, px + faixa * (i + 0.5), py + ph + 3.5, { align: 'center' }); });
  // legenda
  let lx = x + 3; const ly = y + h - 2.5; doc.setFontSize(6.5);
  g.series.forEach(s => {
    doc.setFillColor(...rgb(s.cor)); doc.rect(lx, ly - 2, 2.5, 2.5, 'F'); doc.setTextColor(51, 65, 85); doc.text(s.nome, lx + 3.5, ly);
    lx += 3.5 + doc.getTextWidth(s.nome) + 4;
  });
  doc.setTextColor(0); doc.setDrawColor(0);
}
