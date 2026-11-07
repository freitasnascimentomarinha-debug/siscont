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
export interface RubricaLida {
  numero: number; descricao: string; contaContabil: string | null; valorPrevisto: number; gastoAnterior: number | null;
  /** coluna DESCONTOS (soma dos descontos por OM + desconto geral) e VALOR RUBRICA ATUALIZADO da planilha, para conferência */
  descontoPlanilha: number | null; atualizadoPlanilha: number | null;
  /** DA = rubrica que custeia as diárias de atracação dos navios ("Navios"); TC = taxa condominial */
  destino: 'TC' | 'DA';
}

export function lerDespesas(linhas: Linhas): RubricaLida[] {
  const h = linhas.findIndex(l => l.some(c => /N[ºO°]? ?DE ORDEM/.test(normalizar(c))) && l.some(c => normalizar(c) === 'DESPESAS'));
  if (h < 0) throw new Error('Aba de despesas sem o cabeçalho "Nº DE ORDEM" / "DESPESAS".');
  const cab = linhas[h].map(normalizar);
  const col = (re: RegExp) => cab.findIndex(c => re.test(c));
  const cOrdem = col(/DE ORDEM/), cConta = col(/^CONTA CONTABIL/), cDesc = cab.indexOf('DESPESAS');
  const cValor = col(/^VALOR PARA/);
  const cGasto = col(/^VALOR \d{4}/) >= 0 ? col(/^VALOR \d{4}/) : col(/TOTAL VALORES GASTOS/);
  const cDescontos = cab.indexOf('DESCONTOS'), cAtualizado = col(/^VALOR RUBRICA ATUALIZADO/);
  if (cValor < 0) throw new Error('Aba de despesas sem a coluna "VALOR PARA <ano>".');
  const out: RubricaLida[] = [];
  for (const l of linhas.slice(h + 1)) {
    const n = num(l[cOrdem]);
    if (n === null || !Number.isInteger(n) || n <= 0 || n > 999) continue;
    const descricao = String(l[cDesc] ?? '').trim();
    if (!descricao) continue;
    out.push({
      numero: n, descricao, contaContabil: cConta >= 0 ? String(l[cConta] ?? '').trim() || null : null, valorPrevisto: num(l[cValor]) ?? 0,
      gastoAnterior: cGasto >= 0 ? num(l[cGasto]) : null,
      descontoPlanilha: cDescontos >= 0 ? num(l[cDescontos]) : null, atualizadoPlanilha: cAtualizado >= 0 ? num(l[cAtualizado]) : null,
      destino: /\bNAVIOS?\b/i.test(descricao) ? 'DA' : 'TC',
    });
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

/** Linha "NAVIOS" da Matriz_NOVO: rubricas de que o grupo dos navios participa. */
export function lerMatrizNavios(linhas: Linhas): number[] {
  let h = -1, c0 = -1;
  for (let i = 0; i < Math.min(linhas.length, 30) && h < 0; i++) {
    const l = linhas[i];
    for (let j = 0; j < l.length - 1; j++) if (num(l[j]) === 1 && num(l[j + 1]) === 2) { h = i; c0 = j; break; }
  }
  if (h < 0) return [];
  const numeros: { col: number; n: number }[] = [];
  for (let j = c0; j < linhas[h].length; j++) { const n = num(linhas[h][j]); if (n === null || !Number.isInteger(n)) break; numeros.push({ col: j, n }); }
  const l = linhas.slice(h + 1).find(x => /^NAVIOS?$/.test(normalizar(String(x.slice(0, c0).reverse().find(c => String(c ?? '').trim()) ?? ''))));
  return l ? numeros.filter(x => /^X$/i.test(String(l[x.col] ?? '').trim())).map(x => x.n) : [];
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

// ------------------------------------------------------------------ Descontos por OM e rubrica (aba PROPOSTA CONDOMINIO)
export interface DescontoLido { nome: string; rubrica: number; valor: number }

/** Bloco à direita da aba (colunas 1, 2, 3...): desconto anual em R$ de cada OM em cada rubrica; para no SUB-TOTAL. */
export function lerDescontosOM(linhas: Linhas): DescontoLido[] {
  let h = -1, c0 = -1;
  for (let i = 0; i < Math.min(linhas.length, 30) && h < 0; i++) {
    const l = linhas[i];
    if (normalizar(l[0]) !== 'OM') continue;
    for (let j = 1; j < l.length - 1; j++) if (num(l[j]) === 1 && num(l[j + 1]) === 2) { h = i; c0 = j; break; }
  }
  if (h < 0) throw new Error('Aba sem o cabeçalho "OM" com a numeração das rubricas (1, 2, 3...).');
  const numeros: { col: number; n: number }[] = [];
  for (let j = c0; j < linhas[h].length; j++) { const n = num(linhas[h][j]); if (n === null || !Number.isInteger(n)) break; numeros.push({ col: j, n }); }
  const out: DescontoLido[] = [];
  for (const l of linhas.slice(h + 1)) {
    const nome = String(l[0] ?? '').trim();
    if (!nome) continue;
    if (/^SUB-?\s?TOTAL|^TOTAL|^NAVIOS?$/.test(normalizar(nome))) break;
    numeros.forEach(x => { const v = num(l[x.col]); if (v && v > 0.004) out.push({ nome, rubrica: x.n, valor: Math.round(v * 100) / 100 }); });
  }
  return out;
}

// ------------------------------------------------------------------ extratos e valores fechados (conferência)
export interface LinhaExtrato { numero: number; descricao: string; bruto: number; desconto: number; liquido: number }
export interface ExtratoLido { aba: string; nome: string; linhas: LinhaExtrato[]; totalAnual: number | null; diaria: number | null }

/** Aba "EXTRATO DEMONSTRATIVO" de um cliente (ou a aba NAVIOS): valor de cada rubrica, desconto e valor atualizado. */
export function lerExtrato(aba: string, linhas: Linhas): ExtratoLido | null {
  const h = linhas.findIndex(l => l.some(c => /DE ORDEM/.test(normalizar(c))) && l.some(c => /^DESPESAS/.test(normalizar(c))));
  if (h < 0) return null;
  const cab = linhas[h].map(normalizar);
  const cOrd = cab.findIndex(c => /DE ORDEM/.test(c)), cDesp = cab.findIndex(c => /^DESPESAS/.test(c));
  const cBruto = cab.findIndex(c => /^VALOR ANUAL APROVADO/.test(c));
  const cDesc = cab.findIndex(c => /^VALOR DESCONTO/.test(c)), cLiq = cab.findIndex(c => /^VALOR ATUALIZADO/.test(c));
  if (cBruto < 0) return null;
  const nomeCab = String(linhas[h][cDesp] ?? '').replace(/^\s*DESPESAS\s*[–-]\s*/i, '').trim();
  const out: LinhaExtrato[] = [];
  let totalAnual: number | null = null, diaria: number | null = null;
  for (const l of linhas.slice(h + 1)) {
    const rot = normalizar(l[cOrd]);
    if (/^TOTAL ANO/.test(rot)) { totalAnual = num(l[cBruto]); continue; }
    if (/^TOTAL DIARIA/.test(rot)) { diaria = num(l[cBruto]); continue; }
    // nº de ordem tem de ser número (o "12" de "TOTAL MÊS (ANO / 12)" não conta)
    if (typeof l[cOrd] === 'string' && /[A-Za-z]/.test(l[cOrd])) continue;
    const n = num(l[cOrd]);
    if (n === null || !Number.isInteger(n) || n < 1 || n > 99) continue;
    const bruto = num(l[cBruto]) ?? 0, desconto = cDesc >= 0 ? num(l[cDesc]) ?? 0 : 0;
    out.push({ numero: n, descricao: String(l[cDesp] ?? '').trim(), bruto, desconto, liquido: cLiq >= 0 ? num(l[cLiq]) ?? bruto - desconto : bruto - desconto });
  }
  return { aba, nome: nomeCab || aba.replace(/_/g, ' '), linhas: out, totalAnual, diaria };
}

/** Valor "fechado" de cada OM na aba PROPOSTA CONDOMINIO (Anexo B): taxa anterior, proposta, descontos e proposta atualizada. */
export interface FechadoLido { tipo?: 'TC' | 'DA'; nome: string; anteriorAnual: number | null; anteriorMensal: number | null; proposta: number | null; descontos: number | null; atualizada: number | null; mensal: number | null }
/** Bloco NAVIOS da aba PROPOSTA CONDOMINIO: diária anterior, diária proposta e valor estimado por mês de cada navio. */
export function lerDiariasFechadas(linhas: Linhas): FechadoLido[] {
  const h = linhas.findIndex(l => /^NAVIOS?$/.test(normalizar(l[0])) && l.some(c => /^PROPOSTA DIARIA/.test(normalizar(c))));
  if (h < 0) return [];
  const cab = linhas[h].map(normalizar);
  const cAnt = cab.findIndex(c => /^DIARIA \d{4}/.test(c)), cProp = cab.findIndex(c => /^PROPOSTA DIARIA/.test(c)), cMes = cab.findIndex(c => /^VALOR ESTIMADO MES/.test(c));
  const out: FechadoLido[] = [];
  for (const l of linhas.slice(h + 1)) {
    const nome = String(l[0] ?? '').trim();
    if (!nome) continue;
    if (/^SUB-?\s?TOTAL|^TOTAL|^DIARIA A SER/.test(normalizar(nome))) break;
    const diaria = num(l[cProp]);
    if (diaria === null) continue;
    out.push({ tipo: 'DA', nome, anteriorAnual: null, anteriorMensal: cAnt >= 0 ? num(l[cAnt]) : null, proposta: diaria, descontos: null, atualizada: diaria, mensal: cMes >= 0 ? num(l[cMes]) : null });
  }
  return out;
}

export function lerValoresFechados(linhas: Linhas): FechadoLido[] {
  const h = linhas.findIndex(l => normalizar(l[0]) === 'OM' && l.some(c => /^PROPOSTA ATUALIZADA/.test(normalizar(c))));
  if (h < 0) return [];
  const cab = linhas[h].map(normalizar);
  const cAnt = cab.findIndex(c => /^TAXA \d{4}/.test(c)), cProp = cab.findIndex(c => /^PROPOSTA \d{4}/.test(c));
  const cDesc = cab.findIndex(c => /^DESCONTOS/.test(c)), cAtu = cab.findIndex(c => /^PROPOSTA ATUALIZADA/.test(c));
  const out: FechadoLido[] = [];
  for (const l of linhas.slice(h + 1)) {
    const nome = String(l[0] ?? '').trim();
    if (!nome) continue;
    if (/^SUB-?\s?TOTAL|^TOTAL|^NAVIOS?$/.test(normalizar(nome))) break;
    out.push({
      nome, anteriorAnual: cAnt >= 0 ? num(l[cAnt]) : null, anteriorMensal: cAnt >= 0 ? num(l[cAnt + 1]) : null,
      proposta: cProp >= 0 ? num(l[cProp]) : null, descontos: cDesc >= 0 ? num(l[cDesc]) : null,
      atualizada: cAtu >= 0 ? num(l[cAtu]) : null, mensal: cAtu >= 0 ? num(l[cAtu + 1]) : null,
    });
  }
  return out;
}

/** Lê o arquivo da proposta inteiro (abas reconhecidas pelo nome). */
export function lerProposta(abas: { nome: string; linhas: Linhas }[]) {
  const achar = (re: RegExp) => abas.find(a => re.test(normalizar(a.nome)));
  const desp = achar(/^DESPESAS/), mat = achar(/^MATRIZ/), rat = achar(/^RATEIO/) || achar(/^\(1\)$/), prop = achar(/^PROPOSTA CONDOMINIO/);
  const avisos: string[] = [];
  if (!desp) avisos.push('Aba "Despesas" não encontrada: rubricas não importadas.');
  if (!mat) avisos.push('Aba "Matriz" não encontrada: participação OM × rubrica não importada.');
  if (!rat) avisos.push('Aba "RATEIO" ou "(1)" não encontrada: lotações não importadas.');
  const tentar = <T,>(f: () => T[], aba: string): T[] => { try { return f(); } catch (e: any) { avisos.push(`Aba "${aba}": ${e?.message || 'não foi possível ler'}`); return []; } };
  return {
    rubricas: desp ? tentar(() => lerDespesas(desp.linhas), desp.nome) : [],
    matriz: mat ? tentar(() => lerMatriz(mat.linhas), mat.nome) : [],
    matrizNavios: mat ? lerMatrizNavios(mat.linhas) : [],
    lotacoes: rat ? tentar(() => lerLotacoes(rat.linhas), rat.nome) : [],
    descontos: prop ? tentar(() => lerDescontosOM(prop.linhas), prop.nome) : [],
    fechados: prop ? [...lerValoresFechados(prop.linhas).map(f => ({ ...f, tipo: 'TC' as const })), ...lerDiariasFechadas(prop.linhas)] : [],
    // aba NAVIOS: parcela de cada rubrica paga pelos navios (soma = rubrica "Navios")
    navios: (() => { const a = achar(/^NAVIOS$/); const e = a ? lerExtrato(a.nome, a.linhas) : null; return e ? e.linhas.filter(l => l.bruto > 0).map(l => ({ numero: l.numero, valor: l.bruto })) : []; })(),
    // abas "EXTRATO DEMONSTRATIVO" de cada cliente (exceto NAVIOS e simulações terminadas em _2)
    extratos: abas.filter(a => !/^NAVIOS$/.test(normalizar(a.nome)) && !/_\d+$/.test(a.nome.trim())).map(a => lerExtrato(a.nome, a.linhas)).filter((e): e is ExtratoLido => !!e && e.linhas.length > 0),
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
  const compacto = (t: string) => normalizar(t).replace(/[^A-Z0-9]/g, '');
  const tiraParen = (t: string) => normalizar(t.replace(/\(.*?\)/g, ''));
  return lista.find(x => normalizar(x.nome) === n)
    || lista.find(x => compacto(x.nome) === compacto(nome))
    || (semParen.length >= 3 ? lista.filter(x => tiraParen(x.nome) === semParen).length === 1 ? lista.find(x => tiraParen(x.nome) === semParen) : undefined : undefined)
    || lista.find(x => normalizar(x.nome) === semParen || (x.sigla && normalizar(x.sigla) === semParen))
    || (n.length >= 12 ? lista.find(x => normalizar(x.nome).startsWith(n) || n.startsWith(normalizar(x.nome))) : undefined)
    // nome curto de aba ("CCSM", "DGDNTM-RIO"): começo do nome, desde que só um cliente combine
    || (() => { const c = compacto(nome); if (c.length < 3) return undefined; const m = lista.filter(x => compacto(x.nome).startsWith(c)); return m.length === 1 ? m[0] : undefined; })();
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

// ------------------------------------------------------------------ subsídios (planilha modelo)
export interface SubsidioLido { rubrica: number; descricao: string; documento: string | null; valor: number; observacao: string | null }
export function lerSubsidios(abas: { nome: string; linhas: Linhas }[]): { subsidios: SubsidioLido[]; justificativas: { rubrica: number; texto: string }[]; avisos: string[] } {
  const avisos: string[] = [], subsidios: SubsidioLido[] = [], justificativas: { rubrica: number; texto: string }[] = [];
  for (const a of abas) {
    const h = a.linhas.findIndex(l => l.some(c => normalizar(c) === 'RUBRICA'));
    if (h < 0) continue;
    const cab = a.linhas[h].map(normalizar);
    const c = (re: RegExp) => cab.findIndex(x => re.test(x));
    const cRub = cab.indexOf('RUBRICA'), cJust = c(/^JUSTIFICATIVA/), cDesc = c(/^DESCRICAO/), cDoc = c(/^DOCUMENTO/), cVal = c(/^VALOR/), cObs = c(/^OBSERVAC/);
    a.linhas.slice(h + 1).forEach((l, i) => {
      const n = num(l[cRub]);
      if (n === null || !Number.isInteger(n)) return;
      if (cJust >= 0) { const t = String(l[cJust] ?? '').trim(); if (t) justificativas.push({ rubrica: n, texto: t }); return; }
      const descricao = String(l[cDesc] ?? '').trim();
      if (!descricao) return;
      if (/^EXEMPLO/i.test(descricao)) return;
      const valor = num(l[cVal]);
      if (valor === null) { avisos.push(`${a.nome}, linha ${h + i + 2}: sem valor.`); return; }
      subsidios.push({ rubrica: n, descricao, documento: cDoc >= 0 ? String(l[cDoc] ?? '').trim() || null : null, valor: Math.round(valor * 100) / 100, observacao: cObs >= 0 ? String(l[cObs] ?? '').trim() || null : null });
    });
  }
  if (!subsidios.length && !justificativas.length) avisos.push('Nenhum subsídio nem justificativa encontrado (use a planilha modelo).');
  return { subsidios, justificativas, avisos };
}
