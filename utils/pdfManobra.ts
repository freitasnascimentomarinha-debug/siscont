/**
 * Página "DESCRIÇÃO DE MANOBRA" anexada à fatura de rebocador (RB), reproduzindo o ORIGINAL da Base Naval da Ilha das Cobras
 * (a folha do arquivo .xls que subsidia o valor): brasão, título sublinhado, quadros NAVIOS MANOBRADOS / DATA / OM SOLICITANTE /
 * MANOBRAS (em vermelho) / LOCAL, tabela com linhas em branco até o TOTAL, assinaturas (imagens do próprio arquivo) e rodapé.
 * As medidas foram tiradas da folha impressa (px a 80 dpi → mm).
 */
import jsPDF from 'jspdf';
import type { DescricaoManobra } from './importManobras';

const K = 25.4 / 80;                       // px (80 dpi) → mm
const mm = (px: number) => px * K;
const brl = (n: number) => `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dia = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.slice(8) + '/' + iso.slice(5, 7) + '/' + iso.slice(2, 4) : iso);
/** "MANOBRAS (089; 288)" → "MANOBRAS (089; 288)" (como no original); só o rótulo sozinho vira "MANOBRAS". */
const textoManobras = (s: string) => (s || '').trim();

function figura(doc: jsPDF, url: string | undefined, x: number, y: number, w: number, h: number) {
  if (!url) return;
  try { doc.addImage(url, url.startsWith('data:image/png') ? 'PNG' : 'JPEG', x, y, w, h); } catch { /* imagem inválida: segue sem ela */ }
}

/** Imagem dentro de uma caixa, mantendo a proporção e alinhada à esquerda/centro. */
function figuraNaCaixa(doc: jsPDF, url: string | undefined, x: number, y: number, w: number, h: number, proporcao: number, centro = false) {
  if (!url) return;
  let iw = w, ih = w / proporcao;
  if (ih > h) { ih = h; iw = h * proporcao; }
  figura(doc, url, centro ? x + (w - iw) / 2 : x, y + (h - ih), iw, ih);
}

export function desenharDescricaoManobra(doc: jsPDF, dm: DescricaoManobra) {
  const L = mm(50), R = mm(528), COL1 = mm(162);                    // moldura e coluna dos rótulos
  const tcols = [50, 162, 212, 322, 397, 453, 528].map(mm);         // colunas da tabela
  doc.setTextColor(0); doc.setDrawColor(0); doc.setLineWidth(0.25);
  const t = (txt: string, x: number, y: number, tam: number, neg = false, al: 'left' | 'center' | 'right' = 'left') => {
    doc.setFont('helvetica', neg ? 'bold' : 'normal'); doc.setFontSize(tam); doc.text(txt, x, y, { align: al });
  };

  // cabeçalho: brasão (do próprio arquivo, na proporção da folha) e título sublinhado
  figura(doc, dm.imagens?.brasao, mm(48), mm(20), mm(47), mm(20));
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
  const cx = (L + R) / 2;
  t('BASE NAVAL DA ILHA DAS COBRAS', cx, mm(37), 9, true, 'center');
  const wt = doc.getTextWidth('BASE NAVAL DA ILHA DAS COBRAS'); doc.setLineWidth(0.2); doc.line(cx - wt / 2, mm(38.6), cx + wt / 2, mm(38.6)); doc.setLineWidth(0.25);
  t('DESCRIÇÃO DE MANOBRA', cx, mm(53), 9, false, 'center');

  // quadros de identificação
  const datas = /\d\/\d/.test(dm.datas) ? dm.datas : [...new Set(dm.linhas.map(l => l.dia))].sort().map(dia).join('; ');
  const quadro = (y0: number, y1: number, rotulo: string, valor: string, o: { neg?: boolean; amarelo?: boolean; vermelho?: boolean; embaixo?: boolean } = {}) => {
    const ya = mm(y0), yb = mm(y1);
    if (o.amarelo) { doc.setFillColor(255, 255, 0); doc.rect(COL1, ya, R - COL1, yb - ya, 'F'); }
    doc.rect(L, ya, R - L, yb - ya); doc.line(COL1, ya, COL1, yb);
    const base = o.embaixo ? yb - 1.2 : (ya + yb) / 2 + 1.1;
    t(rotulo, L + 0.6, base, 7.5);
    if (o.vermelho) doc.setTextColor(255, 0, 0);
    t(valor, (COL1 + R) / 2, base, o.vermelho ? 7.5 : 7.5, !!o.neg, 'center');
    doc.setTextColor(0);
  };
  quadro(66, 83, 'NAVIOS MANOBRADOS', dm.navio, { neg: true });
  doc.setLineWidth(0.25);
  quadro(83, 99, 'DATA', datas, { amarelo: true });
  quadro(105, 138, 'OM SOLICITANTE', dm.solicitante, { neg: true });
  quadro(146, 184, 'MANOBRAS', textoManobras(dm.manobras), { neg: true, amarelo: true, vermelho: true, embaixo: true });
  quadro(184, 200, 'LOCAL', dm.local, { neg: true });

  // tabela
  const hY0 = mm(208), hY1 = mm(224);
  tcols.slice(0, -1).forEach((x, i) => doc.rect(x, hY0, tcols[i + 1] - x, hY1 - hY0));
  const cab = ['NAVIO / MEIO', 'DIA', 'MANOBRA REALIZADA', 'CUSTO', 'QUANTIDADE DE\nREBOCADORES', 'LOCAL'];
  cab.forEach((c, i) => {
    const xc = (tcols[i] + tcols[i + 1]) / 2;
    if (c.includes('\n')) { const [a, b] = c.split('\n'); t(a, xc, hY0 + 2.1, 4.8, false, 'center'); t(b, xc, hY0 + 4.1, 4.8, false, 'center'); }
    else t(c, xc, (hY0 + hY1) / 2 + 0.9, 6, false, 'center');
  });
  let y = mm(229);
  const RH = mm(18.65);
  const celula = (i: number, yy: number, h: number) => doc.rect(tcols[i], yy, tcols[i + 1] - tcols[i], h);
  const rodar = (conteudo: string[] | null) => {
    let h = RH, quebra: string[] = [];
    if (conteudo) {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(5.5);
      quebra = doc.splitTextToSize(conteudo[2], tcols[3] - tcols[2] - 2) as string[];
      h = Math.max(RH, quebra.length * 2.3 + 2.2);
    }
    for (let i = 0; i < 6; i++) celula(i, y, h);
    if (conteudo) {
      const yc = y + h / 2 + 0.8;
      t(conteudo[0], (tcols[0] + tcols[1]) / 2, yc, 5.5, true, 'center');
      t(conteudo[1], (tcols[1] + tcols[2]) / 2, yc, 5.5, false, 'center');
      const yy0 = y + (h - quebra.length * 2.3) / 2 + 1.8;
      quebra.forEach((ln, k) => t(ln, (tcols[2] + tcols[3]) / 2, yy0 + k * 2.3, 5.5, quebra.length > 1, 'center'));
      t(conteudo[3], (tcols[3] + tcols[4]) / 2, yc, 5.5, false, 'center');
      t(conteudo[4], (tcols[4] + tcols[5]) / 2, yc, 5.5, false, 'center');
      t(conteudo[5], (tcols[5] + tcols[6]) / 2, yc, 5.5, true, 'center');
    }
    y += h;
  };
  dm.linhas.forEach(l => rodar([dm.navio, dia(l.dia), l.manobra, brl(l.custo), l.rebocadores == null ? '' : String(l.rebocadores), l.local]));
  // espaço em branco até o TOTAL, como na folha (mínimo de linhas para a folha não ficar curta)
  for (let k = 0; k < Math.max(dm.linhasEmBranco, Math.max(0, 14 - dm.linhas.length)); k++) rodar(null);
  const TH = mm(21);
  for (let i = 0; i < 6; i++) celula(i, y, TH);
  t('TOTAL', (tcols[0] + tcols[1]) / 2, y + TH / 2 + 1.4, 7, false, 'center');
  t(brl(dm.total), tcols[3] + 0.4, y + TH / 2 + 1.4, 7, true);
  y += TH;

  // assinaturas (imagens do próprio arquivo) e identificação
  const yAss = y + 1;
  const e = dm.encarregado, a = dm.agente;
  const xe0 = L, xe1 = mm(212), xa0 = mm(322), xa1 = mm(472);
  figuraNaCaixa(doc, dm.imagens?.encarregado, xe0, yAss, mm(172), mm(30), 962 / 167);
  figuraNaCaixa(doc, dm.imagens?.agente, xa0 + mm(36), yAss, mm(100), mm(30), 751 / 263, true);
  const yl = yAss + mm(30);
  doc.setLineWidth(0.2); doc.line(xe0, yl, xe1, yl); doc.line(xa0, yl, xa1, yl); doc.setLineWidth(0.25);
  if (e) { t(e.nome, (xe0 + xe1) / 2, yl + 2.6, 5, false, 'center'); t(e.posto, (xe0 + xe1) / 2, yl + 5.2, 5, false, 'center'); t(e.cargo, (xe0 + xe1) / 2, yl + 7.8, 5, false, 'center'); }
  if (a) { t(a.nome, (xa0 + xa1) / 2, yl + 2.6, 5, false, 'center'); t(a.cargo, (xa0 + xa1) / 2, yl + 5.2, 4.2, false, 'center'); }
  t(`OM / NAVIO SOLICITANTE: ${dm.rodapeSolicitante || dm.navio || dm.solicitante}`, L, yl + mm(41), 7.5);
  t('DATA / HORA MSG DE SOLICITAÇÃO:', L, yl + mm(56), 7.5);
}
