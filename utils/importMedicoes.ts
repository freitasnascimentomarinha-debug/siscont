/**
 * Importação do que as divisões enviam todo mês:
 *  - Rateio (aba "DADOS BNIC-41" da planilha de energia, e o equivalente de água): sigla, código da OM,
 *    dias, consumo, demanda (kW) e valor total em R$. A mesma OM pode vir em várias linhas (prédios):
 *    as linhas são somadas e guardadas no detalhe.
 *  - Mapa BNIC-35 (facilidade portuária): por gerência, uma linha por navio com A (atracado) ou D (docado)
 *    em cada dia do mês.
 */
import { chave, limpar } from './cadastroImport';
import { numero } from './faturasImport';

type Celula = string | number | boolean | Date | null | undefined;
type Matriz = Celula[][];

export interface LinhaRateio { sigla: string; codigo: string; dias: number | null; consumo: number | null; demanda: number | null; valor: number | null; linha: number }

const MESES: Record<string, number> = { janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6, julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12 };

/** Lê o rateio: acha a linha com "código" e "consumo"/"valor total" e devolve uma linha por OM/prédio. */
export function lerRateio(m: Matriz): LinhaRateio[] {
  let cab = -1, cols: Record<string, number> = {};
  for (let r = 0; r < Math.min(m.length, 40) && cab < 0; r++) {
    const linha = (m[r] || []).map(c => chave(c));
    const iCod = linha.findIndex(c => c === 'codigo');
    if (iCod < 0) continue;
    // o cabeçalho pode ocupar duas linhas (ex.: "VALOR TOTAL (R$)" na linha de cima)
    const junto = linha.map((c, i) => c || chave((m[r - 1] || [])[i]));
    const acha = (...nomes: string[]) => junto.findIndex(c => nomes.some(n => c.startsWith(n)));
    cols = { sigla: acha('sigla'), codigo: iCod, dias: acha('dias'), consumo: acha('consumo'), demanda: acha('demanda'), valor: acha('valortotal', 'valor') };
    cab = r;
  }
  if (cab < 0) return [];
  const out: LinhaRateio[] = [];
  for (let r = cab + 1; r < m.length; r++) {
    const l = m[r] || [];
    const cod = limpar(l[cols.codigo]).replace(/\D/g, '');
    if (!/^\d{4,5}$/.test(cod)) continue;
    const v = (k: string) => (cols[k] >= 0 ? numero(l[cols[k]]) : null);
    if (v('consumo') === null && v('valor') === null) continue;
    out.push({ sigla: limpar(l[cols.sigla]), codigo: cod.padStart(5, '0'), dias: v('dias'), consumo: v('consumo'), demanda: v('demanda'), valor: v('valor'), linha: r + 1 });
  }
  return out;
}

/** Soma as linhas por código (vários prédios da mesma OM). */
export function agruparRateio(linhas: LinhaRateio[]) {
  const m = new Map<string, { codigo: string; consumo: number; demanda: number; valor: number | null; linhas: LinhaRateio[] }>();
  const r2 = (n: number) => Math.round(n * 100) / 100;
  linhas.forEach(l => {
    const g = m.get(l.codigo) || { codigo: l.codigo, consumo: 0, demanda: 0, valor: null as number | null, linhas: [] };
    g.consumo = r2(g.consumo + (l.consumo || 0)); g.demanda = r2(g.demanda + (l.demanda || 0));
    if (l.valor !== null) g.valor = r2((g.valor || 0) + l.valor);
    g.linhas.push(l);
    m.set(l.codigo, g);
  });
  return [...m.values()];
}

export interface MapaAtracacao { competencia: string | null; gerencia: string; navios: { nome: string; dias: string[]; atracado: number; docado: number }[] }

/** Lê um mapa BNIC-35. Os dias vêm nas colunas logo após o nome do navio (até 31). */
export function lerMapaAtracacao(m: Matriz): MapaAtracacao {
  let competencia: string | null = null, gerencia = '';
  let cab = -1;
  for (let r = 0; r < Math.min(m.length, 20); r++) {
    const texto = (m[r] || []).map(c => limpar(c)).join(' ');
    const mm = texto.match(/M[ÊE]S DE ([A-ZÇÃÉÍÓÚÂÊÔ]+) DE (\d{4})/i);
    if (mm) { const n = MESES[chave(mm[1])]; if (n) competencia = `${mm[2]}-${String(n).padStart(2, '0')}`; }
    const g = texto.match(/GER[ÊE]NCIA:?\s*([A-Z0-9-]+)/i);
    if (g) gerencia = g[1].toUpperCase();
    if (cab < 0 && chave((m[r] || [])[0]) === 'navios') cab = r;
  }
  const ndias = competencia ? new Date(Date.UTC(Number(competencia.slice(0, 4)), Number(competencia.slice(5, 7)), 0)).getUTCDate() : 31;
  const navios: MapaAtracacao['navios'] = [];
  if (cab >= 0) for (let r = cab + 1; r < m.length; r++) {
    const l = m[r] || [];
    const nome = limpar(l[0]);
    if (!nome || /^total|^legenda|navio (atracado|docado)/i.test(nome)) continue;
    const dias = Array.from({ length: ndias }, (_, i) => {
      const c = limpar(l[i + 1]).toUpperCase();
      return c === 'A' || c === 'D' ? c : '';
    });
    navios.push({ nome, dias, atracado: dias.filter(d => d === 'A').length, docado: dias.filter(d => d === 'D').length });
  }
  return { competencia, gerencia, navios };
}

// Abreviações dos mapas (F. = Fragata, NPA = Navio-Patrulha...) que não ajudam a achar o navio
const PREFIXOS = new Set(['f', 'c', 's', 'n', 'npa', 'npao', 'nam', 'npo', 'nhi', 'nho', 'nhoc', 'ndcc', 'ndm', 'napoc', 'rb', 'rbam', 'rban', 'av', 'cv', 'fr', 'sub', 'nae', 'phm', 'ae', 'edcg', 'gte', 'npaoc', 'navio', 'fragata', 'corveta', 'submarino', 'rebocador']);

/** Acha a OM (navio) de um nome do mapa: "NPA MANGARATIBA" → "Navio-Patrulha Mangaratiba". */
export function acharNavio<T extends { id: string; nome: string; tipo: string; ativo?: boolean }>(nome: string, oms: T[]): T | null {
  const EXPANDE: Record<string, string> = { alte: 'almirante', cte: 'comandante', ten: 'tenente', gal: 'general', mal: 'marechal' };
  const toks = limpar(nome).replace(/[–-]\s*\d+$/, '').split(/[\s.]+/).map(t => chave(t)).filter(t => t && !/^\d+$/.test(t)).map(t => EXPANDE[t] ?? t);
  const fortes = toks.filter(t => !PREFIXOS.has(t) && t.length > 2);
  const busca = fortes.length ? fortes : toks;
  if (!busca.length) return null;
  const cand = oms.filter(o => {
    const k = chave(o.nome);
    return busca.every(t => k.includes(t));
  });
  const ordem = (o: T) => (o.tipo === 'NAVIO' ? 0 : 1) + (o.ativo === false ? 2 : 0);
  return cand.sort((a, b) => ordem(a) - ordem(b) || a.nome.length - b.nome.length)[0] ?? null;
}
