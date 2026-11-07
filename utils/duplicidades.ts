/**
 * Possíveis clientes duplicados no cadastro: mesma sigla, nome abreviado (sigla = iniciais do nome), nome cortado
 * (um começa pelo outro), ou nomes parecidos (palavras em comum). Funções puras.
 */
export interface OMDup { id: string; nome: string; sigla?: string | null; codigo: string; tipo: string; ativo: boolean; nomesAlternativos?: string[] }
export interface ParDup { a: OMDup; b: OMDup; pontos: number; motivo: string }

const PARADAS = new Set(['DE', 'DA', 'DO', 'DAS', 'DOS', 'E', 'A', 'O', 'EM', 'NA', 'NO', 'ED', 'EDIFICIO', 'ANDAR']);
const EXPANDE: Record<string, string> = {
  CMDO: 'COMANDO', COM: 'COMANDO', CTE: 'COMANDANTE', ALTE: 'ALMIRANTE', CENT: 'CENTRO', DIR: 'DIRETORIA', HOSP: 'HOSPITAL',
  NAV: 'NAVAL', BAS: 'BASE', BTL: 'BATALHAO', GPT: 'GRUPAMENTO', ESQD: 'ESQUADRAO', SERV: 'SERVICO', DEP: 'DEPOSITO', DPTO: 'DEPARTAMENTO',
};
export const normalizarNome = (s: string) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
/** Palavras significativas (sem o que está entre parênteses, como o edifício). */
export function palavras(nome: string): string[] {
  return normalizarNome(nome).replace(/\(.*?\)/g, ' ').replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/)
    .filter(Boolean).map(p => EXPANDE[p] ?? p).filter(p => !PARADAS.has(p) && !/^ED\d+$/.test(p));
}
const compacto = (nome: string) => palavras(nome).join('');
/** Iniciais das palavras (ex.: Centro de Perícias Médicas da Marinha → CPMM). */
export const iniciais = (nome: string) => palavras(nome).map(p => p[0]).join('');

function comparar(a: OMDup, b: OMDup): { pontos: number; motivo: string } | null {
  const na = compacto(a.nome), nb = compacto(b.nome);
  if (!na || !nb) return null;
  if (na === nb) return { pontos: 100, motivo: 'mesmo nome (diferença só de acento, pontuação ou edifício)' };
  const sa = normalizarNome(a.sigla || '').replace(/[^A-Z0-9]/g, ''), sb = normalizarNome(b.sigla || '').replace(/[^A-Z0-9]/g, '');
  if (sa && sb && sa === sb) return { pontos: 95, motivo: `mesma sigla (${a.sigla})` };
  // sigla de um = nome do outro, ou nome abreviado = iniciais do outro
  const ia = iniciais(a.nome), ib = iniciais(b.nome);
  if ((sa && (sa === nb || sa === ib)) || (sb && (sb === na || sb === ia))) return { pontos: 90, motivo: 'um está pela sigla e o outro pelo nome por extenso' };
  if ((na.length <= 8 && na === ib) || (nb.length <= 8 && nb === ia)) return { pontos: 85, motivo: 'nome abreviado (iniciais do outro)' };
  // nome cortado (planilhas cortam em 50 caracteres) ou acrescido
  if (Math.min(na.length, nb.length) >= 10 && (na.startsWith(nb) || nb.startsWith(na))) {
    // "Arsenal ... – TRANSUNIVERSAL": complemento depois de travessão costuma ser outro cliente (terceiro), não abreviação
    const [curto, longo] = na.length < nb.length ? [a.nome, b.nome] : [b.nome, a.nome];
    const resto = normalizarNome(longo).slice(normalizarNome(curto).replace(/\s*\(.*?\)\s*/g, '').trim().length);
    if (/^\s*[–-]\s*(?!ED\b|ED\.)[A-Z]/.test(resto)) return { pontos: 65, motivo: 'mesmo começo, com complemento (pode ser outro cliente)' };
    return { pontos: 85, motivo: 'um nome é o começo do outro' };
  }
  const pa = new Set(palavras(a.nome)), pb = new Set(palavras(b.nome));
  const comuns = [...pa].filter(p => pb.has(p)).length;
  const uniao = new Set([...pa, ...pb]).size;
  const jac = uniao ? comuns / uniao : 0;
  if (comuns >= 2 && jac >= 0.6) return { pontos: Math.round(jac * 80), motivo: `nomes parecidos (${Math.round(jac * 100)}% das palavras em comum)` };
  // abreviações de palavras: "Dir Ind Marinha" × "Diretoria Industrial da Marinha"
  if (pa.size >= 2 && pa.size === pb.size) {
    const la = [...pa], lb = [...pb];
    if (la.every((p, i) => lb[i].startsWith(p) || p.startsWith(lb[i]))) return { pontos: 80, motivo: 'palavras abreviadas' };
  }
  return null;
}

/** Pares suspeitos, do mais provável para o menos. Navio só é comparado com navio. */
export function paresDuplicados(oms: OMDup[], ignorar: Set<string> = new Set(), minimo = 60): ParDup[] {
  const out: ParDup[] = [];
  for (let i = 0; i < oms.length; i++) {
    for (let j = i + 1; j < oms.length; j++) {
      const a = oms[i], b = oms[j];
      if ((a.tipo === 'NAVIO') !== (b.tipo === 'NAVIO')) continue;
      if (ignorar.has(chavePar(a.id, b.id))) continue;
      const c = comparar(a, b);
      if (c && c.pontos >= minimo) out.push({ a, b, ...c });
    }
  }
  return out.sort((x, y) => y.pontos - x.pontos || Number(x.a.ativo && x.b.ativo) - Number(y.a.ativo && y.b.ativo) || x.a.nome.localeCompare(y.a.nome));
}
export const chavePar = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** Sugestão de qual manter: a ativa; depois a com mais faturas; depois a com código próprio/nome mais completo. */
export function sugerirManter(a: OMDup, b: OMDup, faturas: Map<string, number>): 'a' | 'b' {
  if (a.ativo !== b.ativo) return a.ativo ? 'a' : 'b';
  const fa = faturas.get(a.id) || 0, fb = faturas.get(b.id) || 0;
  if (fa !== fb) return fa > fb ? 'a' : 'b';
  return a.nome.length >= b.nome.length ? 'a' : 'b';
}

export interface GrupoDup { membros: OMDup[]; pontos: number; motivos: string[]; pares: ParDup[] }
/** Junta os pares em grupos (A~B e B~C → {A, B, C}) para unificar de uma vez. */
export function gruposDuplicados(pares: ParDup[], limiarUniao = 85): GrupoDup[] {
  const pai = new Map<string, string>();
  const raiz = (x: string): string => { const p = pai.get(x) ?? x; if (p === x) return x; const r = raiz(p); pai.set(x, r); return r; };
  const om = new Map<string, OMDup>();
  // pares fortes formam grupos; pares fracos aparecem sozinhos (o usuário decide um a um)
  pares.filter(p => p.pontos >= limiarUniao).forEach(p => { om.set(p.a.id, p.a); om.set(p.b.id, p.b); const ra = raiz(p.a.id), rb = raiz(p.b.id); if (ra !== rb) pai.set(ra, rb); });
  const grupos = new Map<string, GrupoDup>();
  pares.forEach(p => {
    const forte = p.pontos >= limiarUniao;
    if (!forte && raiz(p.a.id) === raiz(p.b.id) && om.has(p.a.id) && om.has(p.b.id)) { const g = grupos.get(raiz(p.a.id)); if (g) g.pares.push(p); return; }
    const r = forte ? raiz(p.a.id) : `fraco:${p.a.id}|${p.b.id}`;
    if (!forte) { grupos.set(r, { membros: [p.a, p.b], pontos: p.pontos, motivos: [p.motivo], pares: [p] }); return; }
    const g = grupos.get(r) || { membros: [], pontos: 0, motivos: [], pares: [] };
    g.pares.push(p); g.pontos = Math.max(g.pontos, p.pontos);
    if (!g.motivos.includes(p.motivo)) g.motivos.push(p.motivo);
    grupos.set(r, g);
  });
  grupos.forEach((g, r) => { if (r.startsWith('fraco:')) return; g.membros = [...om.values()].filter(o => raiz(o.id) === r).sort((x, y) => Number(y.ativo) - Number(x.ativo) || x.nome.localeCompare(y.nome)); });
  return [...grupos.values()].sort((a, b) => b.pontos - a.pontos || b.membros.length - a.membros.length);
}
