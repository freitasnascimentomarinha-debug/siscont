/**
 * Fase 6 — leitura das planilhas anuais:
 *  - "Proposta" da taxa condominial: abas Despesas_NOVO (rubricas), Matriz_NOVO (OM × rubrica) e
 *    RATEIO MODELO TÉCNICO / (1) (lotação e lotação anterior por OM).
 *  - "Histórico trienal": uma aba por ano (2025, 2023_2...) com os dias atracados por navio/classe.
 * Funções puras: recebem as linhas (array de arrays) e devolvem dados; a ligação com o cadastro é feita na tela.
 */
// @ts-ignore - pacote xlsx sem tipos completos no build
import * as XLSX from 'xlsx';

type Linhas = any[][];

/** Lê todas as abas limitando o intervalo (planilhas convertidas do ODS chegam com "A1:AMG1048576"). */
export function lerAbas(buf: ArrayBuffer | Uint8Array, maxLinhas = 1500, maxColunas = 80): { nome: string; linhas: Linhas }[] {
  const wb = XLSX.read(buf instanceof Uint8Array ? buf : new Uint8Array(buf), { type: 'array', cellFormula: false, cellHTML: false, cellNF: false, cellStyles: false, dense: true });
  return wb.SheetNames.map((nome: string) => {
    const ws = wb.Sheets[nome];
    if (!ws['!ref']) return { nome, linhas: [] };
    const r = XLSX.utils.decode_range(ws['!ref']);
    const range = { s: { r: 0, c: 0 }, e: { r: Math.min(r.e.r, maxLinhas - 1), c: Math.min(r.e.c, maxColunas - 1) } };
    return { nome, linhas: XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '', blankrows: false, range }) as Linhas };
  });
}

export const normalizar = (s: any) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
const num = (v: any): number | null => {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return v;
  const s = String(v).trim();
  if (!s || s === '-') return null;
  const t = /,\d{1,2}$/.test(s) || /\d\.\d{3},/.test(s) ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  const n = Number(t.replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
};

// ------------------------------------------------------------------ Despesas (rubricas)
export interface RubricaLida { numero: number; descricao: string; contaContabil: string | null; valorPrevisto: number; gastoAnterior: number | null }

export function lerDespesas(linhas: Linhas): RubricaLida[] {
  const h = linhas.findIndex(l => l.some(c => /N[ºO°]? ?DE ORDEM/.test(normalizar(c))) && l.some(c => normalizar(c) === 'DESPESAS'));
  if (h < 0) throw new Error('Aba de despesas sem o cabeçalho "Nº DE ORDEM" / "DESPESAS".');
  const cab = linhas[h].map(normalizar);
  const col = (re: RegExp) => cab.findIndex(c => re.test(c));
  const cOrdem = col(/DE ORDEM/), cConta = col(/^CONTA CONTABIL/), cDesc = cab.indexOf('DESPESAS');
  const cValor = col(/^VALOR PARA/);
  const cGasto = col(/^VALOR \d{4}/) >= 0 ? col(/^VALOR \d{4}/) : col(/TOTAL VALORES GASTOS/);
  if (cValor < 0) throw new Error('Aba de despesas sem a coluna "VALOR PARA <ano>".');
  const out: RubricaLida[] = [];
  for (const l of linhas.slice(h + 1)) {
    const n = num(l[cOrdem]);
    if (n === null || !Number.isInteger(n) || n <= 0 || n > 999) continue;
    const descricao = String(l[cDesc] ?? '').trim();
    if (!descricao) continue;
    out.push({ numero: n, descricao, contaContabil: cConta >= 0 ? String(l[cConta] ?? '').trim() || null : null, valorPrevisto: num(l[cValor]) ?? 0, gastoAnterior: cGasto >= 0 ? num(l[cGasto]) : null });
  }
  return out;
}

// ------------------------------------------------------------------ Matriz OM × rubrica
export interface LinhaMatriz { nome: string; rubricas: number[] }

export function lerMatriz(linhas: Linhas): LinhaMatriz[] {
  // linha de cabeçalho: sequência 1, 2, 3... em colunas consecutivas
  let h = -1, c0 = -1;
  for (let i = 0; i < Math.min(linhas.length, 30) && h < 0; i++) {
    const l = linhas[i];
    for (let j = 0; j < l.length - 1; j++) if (num(l[j]) === 1 && num(l[j + 1]) === 2) { h = i; c0 = j; break; }
  }
  if (h < 0) throw new Error('Matriz sem a linha de numeração das rubricas (1, 2, 3...).');
  const numeros: { col: number; n: number }[] = [];
  for (let j = c0; j < linhas[h].length; j++) { const n = num(linhas[h][j]); if (n === null || !Number.isInteger(n)) break; numeros.push({ col: j, n }); }
  const out: LinhaMatriz[] = [];
  for (const l of linhas.slice(h + 1)) {
    const nome = String(l.slice(0, c0).reverse().find(c => String(c ?? '').trim()) ?? '').trim();
    const rubricas = numeros.filter(x => /^X$/i.test(String(l[x.col] ?? '').trim())).map(x => x.n);
    // a linha "NAVIOS" da matriz é só referência: os navios entram na rubrica "Navios" (ver importação)
    if (nome && rubricas.length && !/^TOTAL|^NAVIOS?$/.test(normalizar(nome))) out.push({ nome, rubricas });
  }
  return out;
}

// ------------------------------------------------------------------ Lotação (aba de rateio)
export interface LotacaoLida { nome: string; lotacao: number; lotacaoAnterior: number | null; dias: number | null; navio: boolean }

export function lerLotacoes(linhas: Linhas): LotacaoLida[] {
  const h = linhas.findIndex(l => l.some(c => normalizar(c) === 'DIAS'));
  if (h < 0) throw new Error('Aba de rateio sem a linha "LOTAÇÃO / DIAS".');
  const out: LotacaoLida[] = [];
  let navio = false;
  for (const l of linhas.slice(h + 1)) {
    const nome = String(l[0] ?? '').trim();
    const n = normalizar(nome);
    if (!nome) continue;
    if (/^TOTAL/.test(n)) break;
    if (/^(SUB ?TOTAL|COLUNA|VALOR A SER)/.test(n)) continue;
    if (/^(OM DE TERRA|NAVIOS?)$/.test(n)) { navio = n.startsWith('NAVIO'); continue; }
    const lot = num(l[1]);
    if (lot === null) continue;
    out.push({ nome, lotacao: lot, lotacaoAnterior: num(l[2]), dias: num(l[3]), navio });
  }
  return out;
}

/** Lê o arquivo da proposta inteiro (abas reconhecidas pelo nome). */
export function lerProposta(abas: { nome: string; linhas: Linhas }[]) {
  const achar = (re: RegExp) => abas.find(a => re.test(normalizar(a.nome)));
  const desp = achar(/^DESPESAS/), mat = achar(/^MATRIZ/), rat = achar(/^RATEIO/) || achar(/^\(1\)$/);
  const avisos: string[] = [];
  if (!desp) avisos.push('Aba "Despesas" não encontrada: rubricas não importadas.');
  if (!mat) avisos.push('Aba "Matriz" não encontrada: participação OM × rubrica não importada.');
  if (!rat) avisos.push('Aba "RATEIO" ou "(1)" não encontrada: lotações não importadas.');
  const tentar = <T,>(f: () => T[], aba: string): T[] => { try { return f(); } catch (e: any) { avisos.push(`Aba "${aba}": ${e?.message || 'não foi possível ler'}`); return []; } };
  return {
    rubricas: desp ? tentar(() => lerDespesas(desp.linhas), desp.nome) : [],
    matriz: mat ? tentar(() => lerMatriz(mat.linhas), mat.nome) : [],
    lotacoes: rat ? tentar(() => lerLotacoes(rat.linhas), rat.nome) : [],
    avisos,
  };
}

// ------------------------------------------------------------------ Histórico trienal
export interface HistoricoClasse { ano: number; classe: string; dias: number; navios: number | null; aba: string }

export function lerHistorico(abas: { nome: string; linhas: Linhas }[]): HistoricoClasse[] {
  const MESES = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
  const porAno = new Map<number, { aba: string; detalhada: boolean; dados: Map<string, { dias: number; navios: number }> }>();
  for (const a of abas) {
    const m = /^(\d{4})/.exec(a.nome.trim());
    if (!m) continue;
    const ano = Number(m[1]);
    const h = a.linhas.findIndex(l => l.some(c => normalizar(c) === 'CLASSE NAVIO'));
    if (h < 0) continue;
    const cab = a.linhas[h].map(normalizar);
    const cClasse = cab.indexOf('CLASSE NAVIO'), cNavio = cab.indexOf('NAVIO'), cTotal = cab.indexOf('TOTAL');
    const cMeses = MESES.map(x => cab.indexOf(x));
    const dados = new Map<string, { dias: number; navios: number }>();
    let classe = '';
    for (const l of a.linhas.slice(h + 1)) {
      const c = String(l[cClasse] ?? '').trim();
      if (/^TOTAL/.test(normalizar(c))) break;
      if (c) classe = c;
      if (!classe) continue;
      const total = cTotal >= 0 && num(l[cTotal]) !== null ? num(l[cTotal])! : cMeses.reduce((s, j) => s + (j >= 0 ? num(l[j]) ?? 0 : 0), 0);
      const navio = cNavio >= 0 ? String(l[cNavio] ?? '').trim() : '';
      if (!c && !navio) continue;
      const d = dados.get(classe) || { dias: 0, navios: 0 };
      d.dias += total;
      if (navio && total > 0) d.navios += 1;
      dados.set(classe, d);
    }
    const atual = porAno.get(ano);
    const detalhada = cNavio >= 0;
    // havendo duas abas do mesmo ano (ex.: "2023" e "2023_2"), vale a detalhada por navio; empate → a última
    if (!atual || detalhada || !atual.detalhada) porAno.set(ano, { aba: a.nome, detalhada, dados });
  }
  const out: HistoricoClasse[] = [];
  porAno.forEach((v, ano) => v.dados.forEach((d, classe) => out.push({ ano, classe, dias: d.dias, navios: v.detalhada ? d.navios : null, aba: v.aba })));
  return out.sort((a, b) => a.ano - b.ano || a.classe.localeCompare(b.classe));
}

/** Liga um nome lido da planilha a um item do cadastro (nome exato, prefixo — a planilha corta em 50 caracteres — ou sigla). */
export function acharPorNome<T extends { id: string; nome: string; sigla?: string | null }>(nome: string, lista: T[]): T | undefined {
  const n = normalizar(nome), semParen = normalizar(nome.replace(/\(.*?\)/g, ''));
  return lista.find(x => normalizar(x.nome) === n)
    || lista.find(x => normalizar(x.nome) === semParen || (x.sigla && normalizar(x.sigla) === semParen))
    || (n.length >= 12 ? lista.find(x => normalizar(x.nome).startsWith(n) || n.startsWith(normalizar(x.nome))) : undefined);
}

/** Liga cada nome de OM/navio da planilha ao cadastro. Nome de navio vem como "CLASSE – NAVIO": usa a parte após o travessão. */
export function ligarOMs<T extends { id: string; nome: string; sigla?: string | null; tipo: string; ativo?: boolean }>(
  nomes: { nome: string; navio: boolean }[], oms: T[], achaNavio: (nome: string, oms: T[]) => T | null,
): Map<string, string | null> {
  const m = new Map<string, string | null>();
  for (const { nome, navio } of nomes) {
    if (m.has(nome)) continue;
    let om = acharPorNome(nome, oms);
    if (!om && navio) {
      const partes = nome.split(/\s[–-]\s/);
      om = achaNavio(partes[partes.length - 1], oms.filter(o => o.tipo === 'NAVIO')) ?? achaNavio(nome, oms.filter(o => o.tipo === 'NAVIO')) ?? undefined;
    }
    m.set(nome, om?.id ?? null);
  }
  return m;
}
