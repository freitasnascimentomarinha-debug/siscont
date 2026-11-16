import type { jsPDF } from 'jspdf';

/** Arquivo anexado à contestação da fatura, já baixado. */
export interface ArquivoAnexo { nome: string; tipo?: string; bytes: ArrayBuffer }

const ehPdf = (a: ArquivoAnexo) => /pdf/i.test(a.tipo || '') || /\.pdf$/i.test(a.nome);
const ehImagem = (a: ArquivoAnexo) => /^image\/(png|jpe?g)/i.test(a.tipo || '') || /\.(png|jpe?g)$/i.test(a.nome);

function paraBase64(bytes: ArrayBuffer): string {
  const u = new Uint8Array(bytes); let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Desenha uma imagem numa página A4 nova, ajustada à folha, com o nome do anexo no rodapé. */
function paginaComImagem(doc: jsPDF, dataUrl: string, formato: 'PNG' | 'JPEG', legenda: string) {
  doc.addPage();
  const L = doc.internal.pageSize.getWidth(), A = doc.internal.pageSize.getHeight(), m = 10, rodape = 8;
  const p = doc.getImageProperties(dataUrl);
  const k = Math.min((L - 2 * m) / p.width, (A - 2 * m - rodape) / p.height);
  const w = p.width * k, h = p.height * k;
  doc.addImage(dataUrl, formato, (L - w) / 2, m, w, h);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(110);
  doc.text(legenda, m, A - 5);
  doc.setTextColor(0);
}

async function paginasDoPdf(bytes: ArrayBuffer): Promise<string[]> {
  const pdfjs: any = await import('pdfjs-dist');
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    const worker: any = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  }
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(bytes.slice(0)) }).promise;
  const out: string[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const pg = await pdf.getPage(n);
    const vp = pg.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    await pg.render({ canvasContext: ctx, viewport: vp }).promise;
    out.push(canvas.toDataURL('image/jpeg', 0.85));
  }
  return out;
}

/**
 * Acrescenta ao PDF da fatura, em páginas seguintes, os arquivos anexados à contestação: PDF (cada página) e imagem PNG/JPG.
 * Outros tipos (e-mail, Word...) não cabem no PDF: ficam numa página final que os lista. Devolve os nomes não incorporados.
 */
export async function acrescentarAnexos(doc: jsPDF, anexos: ArquivoAnexo[]): Promise<string[]> {
  const fora: string[] = [];
  for (const a of anexos) {
    try {
      if (ehPdf(a)) {
        const pgs = await paginasDoPdf(a.bytes);
        pgs.forEach((u, i) => paginaComImagem(doc, u, 'JPEG', `Anexo da contestação: ${a.nome} — página ${i + 1} de ${pgs.length}`));
      } else if (ehImagem(a)) {
        const png = /png/i.test(a.tipo || '') || /\.png$/i.test(a.nome);
        paginaComImagem(doc, `data:image/${png ? 'png' : 'jpeg'};base64,${paraBase64(a.bytes)}`, png ? 'PNG' : 'JPEG', `Anexo da contestação: ${a.nome}`);
      } else fora.push(a.nome);
    } catch { fora.push(a.nome); }
  }
  if (fora.length) {
    doc.addPage();
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text('Anexos da contestação não incorporados a este PDF', 15, 20);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    doc.text('Estes arquivos estão anexados no SISCONT (Contestações) e devem ser impressos à parte:', 15, 28);
    fora.forEach((n, i) => doc.text(`• ${n}`, 18, 36 + i * 5.5));
  }
  return fora;
}
