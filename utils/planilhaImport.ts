// @ts-ignore - pacote xlsx sem tipos completos no build
import * as XLSX from 'xlsx';
import { extrairClasses, extrairLinhasDeFatura, LinhaFatura, Matriz, chave } from './cadastroImport';

/** Opções de leitura econômicas: sem fórmulas, estilos nem HTML (planilhas de 7 MB com abas de 300 colunas). */
export const OPCOES_LEITURA = {
  type: 'array' as const,
  cellFormula: false,
  cellHTML: false,
  cellNF: false,
  cellStyles: false,
  cellText: true,
  cellDates: true,
  dense: true,
};

const MAX_COLUNAS = 40;
const LINHAS_CABECALHO = 40;

const matrizDe = (ws: any, ate?: number): Matriz => {
  const ref = ws['!ref'];
  if (!ref) return [];
  const r = XLSX.utils.decode_range(ref);
  const range = { s: { r: 0, c: 0 }, e: { r: ate !== undefined ? Math.min(ate, r.e.r) : r.e.r, c: Math.min(r.e.c, MAX_COLUNAS - 1) } };
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: null, blankrows: false, range }) as Matriz;
};

const temCabecalho = (m: Matriz, exigidos: string[][]) =>
  m.some(row => {
    const cs = (row || []).map(c => chave(c));
    return exigidos.every(alts => cs.some(c => alts.includes(c)));
  });

export interface LeituraPlanilha {
  linhas: LinhaFatura[];
  pares: { classe: string; navio: string }[];
  abasLidas: string[];
  abasIgnoradas: number;
}

/** Lê um arquivo (ArrayBuffer) e devolve linhas de fatura e pares navio/classe das abas reconhecidas. */
export function lerPlanilhaParaCadastro(buffer: ArrayBuffer, nomeArquivo: string): LeituraPlanilha {
  const wb = XLSX.read(new Uint8Array(buffer), OPCOES_LEITURA);
  const out: LeituraPlanilha = { linhas: [], pares: [], abasLidas: [], abasIgnoradas: 0 };
  for (const nome of wb.SheetNames) {
    const ws = wb.Sheets[nome];
    const topo = matrizDe(ws, LINHAS_CABECALHO);
    const ehFatura = temCabecalho(topo, [['comando'], ['cliente'], ['fatura', 'nfatura']])
      && !topo.some(row => (row || []).some(c => chave(c).includes('altcred')));
    const ehClasse = temCabecalho(topo, [['classenavio'], ['navio']]);
    if (!ehFatura && !ehClasse) { out.abasIgnoradas++; continue; }
    const m = matrizDe(ws);
    const origem = `${nomeArquivo} › ${nome}`;
    const l = ehFatura ? extrairLinhasDeFatura(m, origem) : [];
    const c = ehClasse ? extrairClasses(m) : [];
    if (l.length || c.length) out.abasLidas.push(`${origem} (${l.length ? `${l.length} faturas` : `${c.length} navios`})`);
    out.linhas.push(...l);
    out.pares.push(...c);
  }
  return out;
}
