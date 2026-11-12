/**
 * "DESCRIÇÃO DE MANOBRA" da Base Naval da Ilha das Cobras (um arquivo por navio/meio, numerado "NN-AAAA"):
 * subsídio da fatura de REBOCADOR (RB) e, ao mesmo tempo, anexo (página 2) do PDF da fatura.
 *  - NAVIOS MANOBRADOS, DATA(S), OM SOLICITANTE, MANOBRAS (nºs das manobras), LOCAL
 *  - tabela: NAVIO / MEIO | DIA | MANOBRA REALIZADA | CUSTO | QUANTIDADE DE REBOCADORES | LOCAL (o custo da linha já é o total)
 *  - TOTAL; assinaturas do Encarregado da Divisão Marítima e da Agente de Manobras
 * O nº do documento vem do nome do arquivo ("65-2026 NPA MANGARATIBA.xls" → 65-2026). Os arquivos trazem ~65 mil linhas vazias: lê-se só o início.
 */
import { lerImagensXls, classificarImagensManobra, ImagensManobra } from './xlsImagens';
type Celula = string | number | boolean | Date | null | undefined;
type Matriz = Celula[][];

export interface LinhaManobra { dia: string; manobra: string; custo: number; rebocadores: number | null; local: string }
export interface DescricaoManobra {
  arquivo: string; numero: string; navio: string; solicitante: string; datas: string; manobras: string; local: string;
  linhas: LinhaManobra[]; total: number; totalArquivo: number | null;
  encarregado: { nome: string; posto: string; cargo: string } | null; agente: { nome: string; cargo: string } | null;
  mes: string | null;       // AAAA-MM das datas (null se há mais de um mês)
  /** linhas em branco da tabela do original (a folha tem espaço fixo até o TOTAL) */
  linhasEmBranco: number;
  /** texto do rodapé "OM / NAVIO SOLICITANTE: ..." como está no original */
  rodapeSolicitante?: string;
  /** brasão e assinaturas embutidos no arquivo original (data URL) */
  imagens?: ImagensManobra;
  avisos: string[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const txt = (c: Celula): string => (c == null ? '' : c instanceof Date ? '' : String(c).replace(/\s+/g, ' ').trim());

/** "R$ 1,880.26" (planilha em inglês), "R$ 1.880,26" (português) ou número. */
export function valorMoeda(c: Celula): number | null {
  if (typeof c === 'number') return Number.isFinite(c) ? r2(c) : null;
  let s = txt(c).replace(/R\$|\s/g, '');
  if (!/\d/.test(s)) return null;
  const ponto = s.lastIndexOf('.'), virgula = s.lastIndexOf(',');
  if (virgula > ponto) s = s.replace(/\./g, '').replace(',', '.'); else s = s.replace(/,/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? r2(n) : null;
}

const dd = (n: number) => String(n).padStart(2, '0');
/** "02/10/26", "02/10/2026" ou Date → "AAAA-MM-DD". */
export function dataIso(c: Celula): string | null {
  // data do Excel sem formatação lida como número de série (dias desde 30/12/1899)
  if (typeof c === 'number' && c > 30000 && c < 80000) { const d = new Date(Math.round((c - 25569) * 86400000)); return `${d.getUTCFullYear()}-${dd(d.getUTCMonth() + 1)}-${dd(d.getUTCDate())}`; }
  if (c instanceof Date) return `${c.getFullYear()}-${dd(c.getMonth() + 1)}-${dd(c.getDate())}`;
  const m = txt(c).match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!m) return null;
  const a = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  return `${a}-${dd(Number(m[2]))}-${dd(Number(m[1]))}`;
}

export const numeroDoArquivo = (nome: string): string => nome.match(/^\s*(\d{1,4})\s*-\s*(\d{4})/)?.slice(1, 3).join('-') ?? '';

/** É uma "Descrição de Manobra"? (título e cabeçalho da tabela) */
export function ehDescricaoManobra(m: Matriz): boolean {
  const t = m.slice(0, 25).flatMap(l => (l || []).map(txt));
  return t.some(x => /^DESCRI[ÇC][ÃA]O DE MANOBRA/i.test(x)) && t.some(x => /^MANOBRA REALIZADA/i.test(x));
}

export function lerDescricaoManobra(arquivo: string, matriz: Matriz, bytes?: ArrayBuffer | Uint8Array): DescricaoManobra | null {
  if (!ehDescricaoManobra(matriz)) return null;
  const linhas0 = matriz.slice(0, 90).map(l => (l || []).filter(c => txt(c) !== '' || c instanceof Date));
  const campo = (rotulo: RegExp) => { const l = linhas0.find(r => r.length && rotulo.test(txt(r[0]))); return l ? l.slice(1).map(txt).filter(Boolean).join(' ') : ''; };
  const avisos: string[] = [];
  const iCab = linhas0.findIndex(r => r.length && /^NAVIO \/ MEIO/i.test(txt(r[0])));
  const lin: LinhaManobra[] = [];
  let totalArquivo: number | null = null, iFim = linhas0.length;
  for (let i = iCab + 1; i < linhas0.length; i++) {
    const r = linhas0[i];
    if (!r.length) continue;
    if (/^TOTAL$/i.test(txt(r[0]))) { totalArquivo = valorMoeda(r[1]); iFim = i; break; }
    // texto da manobra que quebra em duas linhas ("1/3 MANOBRAS DE" + "CHATAS DA PORTA BATEL"): sem custo, junta à anterior
    const custo = valorMoeda(r[3]);
    if (custo == null) { if (lin.length && r.length <= 2) lin[lin.length - 1].manobra += ' ' + r.map(txt).join(' '); continue; }
    lin.push({ dia: dataIso(r[1]) ?? txt(r[1]), manobra: txt(r[2]), custo, rebocadores: valorMoeda(r[4]), local: txt(r[5]) });
  }
  // linhas em branco: a tabela do original vai da linha seguinte ao cabeçalho (+1 de espaço) até o TOTAL
  const iCabRaw = matriz.findIndex(l => (l || []).some(c => /^NAVIO \/ MEIO/i.test(txt(c))));
  const iTotRaw = matriz.findIndex((l, k) => k > iCabRaw && (l || []).some(c => /^TOTAL$/i.test(txt(c))));
  const linhasEmBranco = iCabRaw >= 0 && iTotRaw > iCabRaw ? Math.max(0, iTotRaw - (iCabRaw + 2) - lin.length) : 0;
  const total = r2(lin.reduce((s, l) => s + l.custo, 0));
  if (!lin.length) { avisos.push('Nenhuma linha de manobra com custo.'); }
  if (totalArquivo != null && Math.abs(totalArquivo - total) > 0.005) avisos.push(`O TOTAL do arquivo (${totalArquivo.toFixed(2)}) difere da soma das linhas (${total.toFixed(2)}).`);
  if (totalArquivo == null) avisos.push('O arquivo não tem a linha TOTAL.');
  const rodapeSolicitante = matriz.flatMap(l => (l || []).map(txt)).map(x => x.match(/^OM \/ NAVIO SOLICITANTE:\s*(.+)$/i)?.[1]).find(Boolean);
  const numero = numeroDoArquivo(arquivo);
  if (!numero) avisos.push('Não consegui ler o número do documento no nome do arquivo (esperado: "65-2026 NOME.xls").');
  const meses = [...new Set(lin.map(l => l.dia.slice(0, 7)).filter(s => /^\d{4}-\d{2}$/.test(s)))];
  if (meses.length > 1) avisos.push(`As manobras são de mais de um mês (${meses.join(', ')}).`);
  if (lin.some(l => !/^\d{4}-\d{2}-\d{2}$/.test(l.dia))) avisos.push('Há linha com data que não consegui ler.');
  // assinaturas (depois do TOTAL): nomes, postos e cargos em linhas seguidas
  const resto = linhas0.slice(iFim + 1).filter(r => r.length).map(r => r.map(txt).filter(Boolean));
  const iNome = resto.findIndex(r => r.length >= 2 && !/^OM \/ NAVIO/i.test(r[0]));
  const assin = iNome >= 0 ? resto.slice(iNome, iNome + 3) : [];
  const encarregado = assin.length >= 3 ? { nome: assin[0][0], posto: assin[1][0], cargo: assin[2][0] } : null;
  const agente = assin.length >= 2 ? { nome: assin[0][1] ?? '', cargo: assin[1][1] ?? '' } : null;
  return {
    arquivo, numero, navio: campo(/^NAVIOS MANOBRADOS/i), solicitante: campo(/^OM SOLICITANTE/i), datas: campo(/^DATA$/i), manobras: campo(/^MANOBRAS?$/i),
    local: campo(/^LOCAL$/i), linhas: lin, total, totalArquivo, encarregado, agente, mes: meses.length === 1 ? meses[0] : null, avisos, linhasEmBranco, rodapeSolicitante,
    ...(bytes ? { imagens: classificarImagensManobra(lerImagensXls(bytes)) } : {}),
  };
}
