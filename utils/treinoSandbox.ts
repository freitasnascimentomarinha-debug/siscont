/**
 * Modo treinamento: o perfil "Treinamento" vê todos os dados reais, mas tudo o que ele lança vai para uma cópia de teste guardada
 * no próprio navegador (nada chega ao banco). Este arquivo é o "motor" dessa cópia: lê a consulta (formato PostgREST do Supabase),
 * aplica as escritas de teste e mistura o que foi lançado de teste com os dados reais nas leituras.
 */

export type Linha = Record<string, any>;
export interface TabelaTreino { linhas: Record<string, Linha>; apagadas: string[] }
export interface EstadoTreino { v: 1; tabelas: Record<string, TabelaTreino> }
export const estadoVazio = (): EstadoTreino => ({ v: 1, tabelas: {} });

/** Colunas que identificam a linha quando não há `id` (as mesmas dos "on_conflict" do sistema). */
const CHAVES_PADRAO: Record<string, string[]> = {
  propostas_tc: ['ano'], rubricas: ['ano', 'numero'], parametros: ['chave'], divida_mensal: ['mes'],
  lotacoes_tc: ['ano', 'om_id'], matriz_tc: ['ano'], atracacao_anual: ['ano'], oms_nao_duplicadas: ['par'], medicoes: ['competencia', 'sigla', 'om_id'], atracacoes: ['competencia', 'om_id'],
};

export interface Filtro { coluna: string; op: string; valor: string }
export interface Consulta { filtros: Filtro[]; ordem: { coluna: string; asc: boolean }[]; limite?: number; offset?: number; conflito?: string[] }

const RESERVADOS = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns']);

/** Lê os parâmetros da URL (?coluna=eq.valor&order=id.asc&limit=1000&offset=0). */
export function lerConsulta(p: URLSearchParams): Consulta {
  const filtros: Filtro[] = [];
  p.forEach((v, k) => {
    if (RESERVADOS.has(k)) return;
    const i = v.indexOf('.');
    filtros.push({ coluna: k, op: i < 0 ? 'eq' : v.slice(0, i), valor: i < 0 ? v : v.slice(i + 1) });
  });
  const ordem = (p.get('order') || '').split(',').filter(Boolean).map(x => { const [coluna, dir] = x.split('.'); return { coluna, asc: dir !== 'desc' }; });
  const num = (k: string) => (p.get(k) != null ? Number(p.get(k)) : undefined);
  return { filtros, ordem, limite: num('limit'), offset: num('offset'), conflito: p.get('on_conflict')?.split(',').filter(Boolean) };
}

/** "a,b" ou ("a b","c") → lista (respeita aspas). */
function lista(v: string): string[] {
  const t = v.trim().replace(/^\(/, '').replace(/\)$/, '');
  const out: string[] = []; let cur = ''; let asp = false;
  for (const ch of t) {
    if (ch === '"') { asp = !asp; continue; }
    if (ch === ',' && !asp) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur !== '' || t === '') out.push(cur);
  return out.filter((x, i) => !(x === '' && out.length === 1 && i === 0));
}

const mesmo = (a: any, b: string) => (a === null || a === undefined ? false : typeof a === 'number' && b.trim() !== '' && !Number.isNaN(Number(b)) ? a === Number(b) : String(a) === b);
const cmp = (a: any, b: string) => (typeof a === 'number' && !Number.isNaN(Number(b)) ? a - Number(b) : String(a).localeCompare(b));

export function linhaCasa(l: Linha, filtros: Filtro[]): boolean {
  return filtros.every(f => {
    if (f.coluna === 'or' || f.coluna === 'and') return true;      // combinações: não simulamos (deixa passar)
    const x = l[f.coluna];
    let op = f.op, valor = f.valor, negar = false;
    if (op === 'not') { negar = true; const i = valor.indexOf('.'); op = valor.slice(0, i); valor = valor.slice(i + 1); }
    let r: boolean;
    switch (op) {
      case 'eq': r = mesmo(x, valor); break;
      case 'neq': r = !mesmo(x, valor); break;
      case 'gt': r = x != null && cmp(x, valor) > 0; break;
      case 'gte': r = x != null && cmp(x, valor) >= 0; break;
      case 'lt': r = x != null && cmp(x, valor) < 0; break;
      case 'lte': r = x != null && cmp(x, valor) <= 0; break;
      case 'in': r = lista(valor).some(v => mesmo(x, v)); break;
      case 'is': r = valor === 'null' ? x === null || x === undefined : valor === 'true' ? x === true : valor === 'false' ? x === false : true; break;
      case 'like': case 'ilike': {
        const re = new RegExp('^' + valor.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/%/g, '.*') + '$', op === 'ilike' ? 'i' : '');
        r = x != null && re.test(String(x)); break;
      }
      case 'cs': {
        const alvo = valor.startsWith('{') ? lista(valor.slice(1, -1)) : (() => { try { return JSON.parse(valor); } catch { return []; } })();
        r = Array.isArray(x) && Array.isArray(alvo) ? alvo.every((a: any) => x.some((y: any) => JSON.stringify(y) === JSON.stringify(a) || String(y) === String(a))) : true; break;
      }
      default: r = true;
    }
    return negar ? !r : r;
  });
}

export const chaveDe = (tabela: string, l: Linha, conflito?: string[]): string => {
  const cols = conflito?.length ? conflito : CHAVES_PADRAO[tabela] || ['id'];
  return JSON.stringify(cols.map(c => l[c] ?? null));
};

const tabelaDe = (e: EstadoTreino, t: string): TabelaTreino => (e.tabelas[t] ||= { linhas: {}, apagadas: [] });
export const temAlteracoes = (e: EstadoTreino, t: string) => { const x = e.tabelas[t]; return !!x && (Object.keys(x.linhas).length > 0 || x.apagadas.length > 0); };
export const totalDeTeste = (e: EstadoTreino) => Object.values(e.tabelas).reduce((s, t) => s + Object.keys(t.linhas).length + t.apagadas.length, 0);

const uuid = () => (globalThis.crypto && 'randomUUID' in globalThis.crypto ? globalThis.crypto.randomUUID() : `t-${Date.now()}-${Math.random().toString(16).slice(2)}`);

/** Incluir ou atualizar (upsert) linhas de teste. Devolve as linhas como ficaram. */
export function gravarTeste(e: EstadoTreino, tabela: string, novas: Linha[], conflito?: string[], base: (l: Linha) => Linha | undefined = () => undefined): Linha[] {
  const t = tabelaDe(e, tabela);
  return novas.map(n => {
    const semChave = !conflito?.length && !CHAVES_PADRAO[tabela] && (n.id === undefined || n.id === null);
    const linha: Linha = semChave ? { ...n, id: uuid() } : { ...n };
    const k = chaveDe(tabela, linha, conflito);
    const antiga = t.linhas[k] ?? base(linha);
    const final = { ...(antiga || {}), ...linha };
    if (!('created_at' in final)) final.created_at = new Date().toISOString();
    t.linhas[k] = final;
    t.apagadas = t.apagadas.filter(x => x !== k);
    return final;
  });
}

export function apagarTeste(e: EstadoTreino, tabela: string, linhas: Linha[], conflito?: string[]) {
  const t = tabelaDe(e, tabela);
  linhas.forEach(l => { const k = chaveDe(tabela, l, conflito); delete t.linhas[k]; if (!t.apagadas.includes(k)) t.apagadas.push(k); });
}

/**
 * Mistura as linhas de teste com as reais: tira as apagadas, troca as alteradas e põe as novas.
 * `ultimaPagina`: as linhas novas só entram na última página lida (a leitura é feita em páginas de 1.000).
 */
export function misturarLeitura(e: EstadoTreino, tabela: string, reais: Linha[], c: Consulta, ultimaPagina: boolean): Linha[] {
  const t = e.tabelas[tabela];
  if (!t || (!Object.keys(t.linhas).length && !t.apagadas.length)) return reais;
  const apagadas = new Set(t.apagadas);
  const mexidas = t.linhas;
  const base = reais.filter(l => { const k = chaveDe(tabela, l, c.conflito); return !apagadas.has(k) && !(k in mexidas); });
  const extras = ultimaPagina ? Object.values(mexidas).filter(l => linhaCasa(l, c.filtros)) : [];
  const todas = [...base, ...extras];
  if (c.ordem.length) {
    todas.sort((a, b) => {
      for (const o of c.ordem) {
        const x = a[o.coluna], y = b[o.coluna];
        if (x === y) continue;
        if (x == null) return o.asc ? 1 : -1;
        if (y == null) return o.asc ? -1 : 1;
        const r = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'pt-BR');
        if (r) return o.asc ? r : -r;
      }
      return 0;
    });
  }
  return todas;
}

/** Linhas (reais + de teste) que uma escrita por filtro (update/delete) atinge. */
export function alvosDaEscrita(e: EstadoTreino, tabela: string, reais: Linha[], c: Consulta): Linha[] {
  const t = e.tabelas[tabela];
  const base = reais.map(l => (t?.linhas[chaveDe(tabela, l, c.conflito)] ?? l)).filter(l => !t?.apagadas.includes(chaveDe(tabela, l, c.conflito)));
  const vistos = new Set(base.map(l => chaveDe(tabela, l, c.conflito)));
  const novas = t ? Object.entries(t.linhas).filter(([k]) => !vistos.has(k)).map(([, l]) => l) : [];
  return [...base, ...novas].filter(l => linhaCasa(l, c.filtros));
}

// ------------------------------------------------------------------ o que o modo treinamento deixa passar
/** Funções do banco que só leem: continuam funcionando. As demais não são simuladas (mexem em muitos dados de uma vez). */
export const RPC_SOMENTE_LEITURA = new Set(['om_tem_movimento', 'atividade_usuarios']);
export const MENSAGEM_NAO_SIMULADO = 'Modo treinamento: esta ação não é simulada (ela alteraria muitos dados de uma vez). Nada foi gravado.';

export type Destino =
  | { tipo: 'passar' }                                           // vai direto ao servidor (leitura, login, renovar sessão)
  | { tipo: 'tabela'; tabela: string }                           // tabela do banco: leitura mistura, escrita vai para o teste
  | { tipo: 'bloquear'; motivo: string };

export function classificar(metodo: string, caminho: string): Destino {
  const m = metodo.toUpperCase();
  if (caminho.startsWith('/auth/v1/')) return caminho.startsWith('/auth/v1/admin') ? { tipo: 'bloquear', motivo: MENSAGEM_NAO_SIMULADO } : { tipo: 'passar' };
  const rpc = caminho.match(/^\/rest\/v1\/rpc\/(\w+)/);
  if (rpc) return RPC_SOMENTE_LEITURA.has(rpc[1]) ? { tipo: 'passar' } : { tipo: 'bloquear', motivo: MENSAGEM_NAO_SIMULADO };
  const t = caminho.match(/^\/rest\/v1\/(\w+)\/?$/);
  if (t) return { tipo: 'tabela', tabela: t[1] };
  if (caminho.startsWith('/storage/v1/') || caminho.startsWith('/functions/v1/')) return m === 'GET' || m === 'HEAD' || /\/sign\//.test(caminho) ? { tipo: 'passar' } : { tipo: 'bloquear', motivo: MENSAGEM_NAO_SIMULADO };
  return m === 'GET' || m === 'HEAD' ? { tipo: 'passar' } : { tipo: 'bloquear', motivo: MENSAGEM_NAO_SIMULADO };
}
