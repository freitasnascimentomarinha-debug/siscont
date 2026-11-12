/**
 * Imagens embutidas em uma planilha .xls (BIFF8): lê o "MsoDrawingGroup" (as figuras) e os "MsoDrawing" da planilha (onde cada figura está).
 * Serve para a "Descrição de Manobra": o arquivo traz o brasão e as assinaturas, que precisam sair no anexo como no original.
 * Só lê JPEG e PNG; qualquer falha devolve lista vazia (o anexo sai sem as imagens).
 */
import * as XLSX from 'xlsx';

export interface ImagemXls { dataUrl: string; col1: number; row1: number; col2: number; row2: number; ordem: number; larg?: number; alt?: number }

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

function paraBase64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

function tamanhoPng(b: Uint8Array): [number, number] | null { return b.length > 24 ? [((b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19]) >>> 0, ((b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23]) >>> 0] : null; }
function tamanhoJpeg(b: Uint8Array): [number, number] | null {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xFF) { i++; continue; }
    const m = b[i + 1];
    if (m === 0xC0 || m === 0xC2) return [(b[i + 7] << 8) | b[i + 8], (b[i + 5] << 8) | b[i + 6]];
    i += 2 + ((b[i + 2] << 8) | b[i + 3]);
  }
  return null;
}

/** Percorre os registros Escher (containers têm versão 0xF); `cb` recebe cada registro folha. */
function escher(b: Uint8Array, ini: number, fim: number, cb: (tipo: number, inst: number, d: Uint8Array) => void, aoEntrar?: (tipo: number) => void, aoSair?: (tipo: number) => void) {
  let o = ini;
  while (o + 8 <= fim) {
    const ver = u16(b, o) & 0xF, inst = u16(b, o) >> 4, tipo = u16(b, o + 2), len = u32(b, o + 4);
    const dIni = o + 8, dFim = Math.min(fim, dIni + len);
    if (ver === 0xF) { aoEntrar?.(tipo); escher(b, dIni, dFim, cb, aoEntrar, aoSair); aoSair?.(tipo); }
    else cb(tipo, inst, b.subarray(dIni, dFim));
    o = dIni + len;
  }
}

/** Registros BIFF do fluxo Workbook, juntando os "Continue" (0x3C) ao registro anterior. */
function registrosBiff(w: Uint8Array): { id: number; d: Uint8Array }[] {
  const out: { id: number; d: Uint8Array }[] = [];
  let o = 0;
  while (o + 4 <= w.length) {
    const id = u16(w, o), len = u16(w, o + 2);
    const d = w.subarray(o + 4, o + 4 + len);
    if (id === 0x3C && out.length) { const ant = out[out.length - 1]; const j = new Uint8Array(ant.d.length + d.length); j.set(ant.d); j.set(d, ant.d.length); ant.d = j; }
    else out.push({ id, d });
    o += 4 + len;
  }
  return out;
}

export function lerImagensXls(dados: ArrayBuffer | Uint8Array): ImagemXls[] {
  try {
    const bytes = dados instanceof Uint8Array ? dados : new Uint8Array(dados);
    const cfb = (XLSX as any).CFB.read(bytes, { type: 'array' });
    const ent = (XLSX as any).CFB.find(cfb, '/Workbook') || (XLSX as any).CFB.find(cfb, '/Book');
    if (!ent?.content) return [];
    const w = ent.content instanceof Uint8Array ? ent.content : Uint8Array.from(ent.content as number[]);
    const regs = registrosBiff(w);

    // 1) figuras do arquivo, na ordem (índice 1 = primeira)
    const figuras: { mime: string; dados: Uint8Array }[] = [];
    regs.filter(r => r.id === 0xEB).forEach(r => escher(r.d, 0, r.d.length, (tipo, _inst, d) => {
      if (tipo !== 0xF007) return;                       // BSE
      const cbNome = d[33], ini = 36 + cbNome;
      if (d.length <= ini + 8) { figuras.push({ mime: '', dados: new Uint8Array(0) }); return; }
      const bVer = u16(d, ini), binst = bVer >> 4, btipo = u16(d, ini + 2);
      const ehJpeg = btipo === 0xF01D, ehPng = btipo === 0xF01E;
      if (!ehJpeg && !ehPng) { figuras.push({ mime: '', dados: new Uint8Array(0) }); return; }
      const doisUid = binst === 0x46B || binst === 0x6E3 || binst === 0x6E1;
      const corpo = d.subarray(ini + 8 + 16 + (doisUid ? 16 : 0) + 1);
      figuras.push({ mime: ehJpeg ? 'image/jpeg' : 'image/png', dados: corpo });
    }, undefined, undefined));
    if (!figuras.length) return [];

    // 2) onde cada figura está (âncora) na planilha
    const res: ImagemXls[] = [];
    let ordem = 0;
    regs.filter(r => r.id === 0xEC).forEach(r => {
      let atual: { pib: number; a?: number[] } | null = null;
      const fecha = () => {
        if (atual && atual.pib > 0 && atual.a && figuras[atual.pib - 1]?.mime) {
          const f = figuras[atual.pib - 1], t = f.mime === 'image/png' ? tamanhoPng(f.dados) : tamanhoJpeg(f.dados);
          res.push({ dataUrl: `data:${f.mime};base64,${paraBase64(f.dados)}`, col1: atual.a[1], row1: atual.a[3], col2: atual.a[5], row2: atual.a[7], ordem: ordem++, larg: t?.[0], alt: t?.[1] });
        }
        atual = null;
      };
      escher(r.d, 0, r.d.length, (tipo, inst, d) => {
        if (!atual) return;
        if (tipo === 0xF00B) {                          // propriedades: 6 bytes cada; 0x0104 = índice da figura
          for (let k = 0; k < inst; k++) { const id = u16(d, k * 6) & 0x3FFF; if (id === 0x0104) atual.pib = u32(d, k * 6 + 2); }
        } else if (tipo === 0xF010 && d.length >= 18) {   // âncora: flag, col1, dx1, row1, dy1, col2, dx2, row2, dy2
          atual.a = Array.from({ length: 9 }, (_, k) => u16(d, k * 2));
        }
      }, tipo => { if (tipo === 0xF004) { fecha(); atual = { pib: 0 }; } }, tipo => { if (tipo === 0xF004) fecha(); });
    });
    return res;
  } catch { return []; }
}

export interface ImagensManobra { brasao?: string; encarregado?: string; agente?: string }

/**
 * Qual imagem é qual: o brasão fica no alto; as assinaturas ficam embaixo — a da esquerda é do encarregado e a da direita, da agente.
 * Quando há duas na mesma posição (a antiga ficou por baixo), vale a última desenhada (a que aparece).
 */
export function classificarImagensManobra(imgs: ImagemXls[]): ImagensManobra {
  if (!imgs.length) return {};
  const maxRow = Math.max(...imgs.map(i => i.row1));
  const topo = imgs.filter(i => i.row1 <= Math.min(6, maxRow / 4));
  const baixo = imgs.filter(i => !topo.includes(i));
  const ultima = (l: ImagemXls[]) => [...l].sort((a, b) => a.ordem - b.ordem).pop();
  const out: ImagensManobra = {};
  const b = ultima(topo); if (b) out.brasao = b.dataUrl;
  if (baixo.length) {
    const cols = baixo.map(i => i.col1), meio = (Math.min(...cols) + Math.max(...cols)) / 2;
    const esq = baixo.filter(i => i.col1 <= meio), dir = baixo.filter(i => i.col1 > meio);
    const e = ultima(esq.length === baixo.length ? esq : esq), d = ultima(dir);
    if (e) out.encarregado = e.dataUrl;
    if (d) out.agente = d.dataUrl;
  }
  return out;
}
