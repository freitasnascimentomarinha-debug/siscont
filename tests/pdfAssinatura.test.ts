import { describe, expect, it } from 'vitest';
import jsPDF from 'jspdf';
import { cabecalhoCompacto, finalizarPdf, tabelaPdf, tituloRelatorio } from '../utils/pdfCabecalho';

/** Monta uma "tela" de relatório (tabela + texto depois da tabela) e devolve o y do texto final e o da assinatura. */
function montar(linhas: number) {
  const doc = new jsPDF();
  const chamadas: { t: string; y: number; pagina: number }[] = [];
  cabecalhoCompacto(doc);
  const orig = (doc as any).text.bind(doc);
  (doc as any).text = (t: any, x: number, y: number, o?: any) => { chamadas.push({ t: String(Array.isArray(t) ? t[0] : t), y, pagina: doc.getCurrentPageInfo().pageNumber }); return orig(t, x, y, o); };
  const y = tituloRelatorio(doc, 'Tela', 'Posição em 10/11/2026');
  tabelaPdf(doc, { startY: y, head: [['a', 'b']], body: Array.from({ length: linhas }, (_, i) => [`l${i}`, 'v']) });
  doc.setFontSize(9); doc.text('Saldo a pagar: R$ 1,00', 14, (doc as any).lastAutoTable.finalY + 8);
  finalizarPdf(doc);
  const saldo = chamadas.find(c => c.t.startsWith('Saldo a pagar'))!;
  const sig = chamadas.find(c => c.t.startsWith('Encarregado'))!;
  return { saldo, sig, paginas: doc.getNumberOfPages() };
}

describe('assinatura no fim do relatório', () => {
  it.each([5, 30, 45, 52, 70, 100, 140])('com %i linhas a assinatura fica abaixo do último texto (nunca em cima dos dados)', n => {
    const { saldo, sig } = montar(n);
    expect(sig.pagina).toBeGreaterThanOrEqual(saldo.pagina);
    if (sig.pagina === saldo.pagina) expect(sig.y).toBeGreaterThan(saldo.y + 4);
  });
});
