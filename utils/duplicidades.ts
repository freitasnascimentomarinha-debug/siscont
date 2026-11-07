/**
 * Possíveis clientes duplicados no cadastro: mesma sigla, nome abreviado (sigla = iniciais do nome), nome cortado
 * (um começa pelo outro), ou nomes parecidos (palavras em comum). Funções puras.
 */
import { partesDoNome } from './emissora';

export interface OMDup { id: string; nome: string; sigla?: string | null; codigo: string; tipo: string; ativo: boolean; nomesAlternativos?: string[]; motivoDesativacao?: string | null }
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

/** Tudo o que a comparação usa, calculado uma vez por OM (com milhares de OM a página não trava). */
interface Prep { om: OMDup; nome: string; compacto: string; sigla: string; iniciais: string; pal: string[]; set: Set<string>; alternativos: Set<string>; resp: string; compl: string; edificio: string | null }
function preparar(o: OMDup): Prep {
  const pal = palavras(o.nome);
  const pt = partesDoNome(o.nome);
  return {
    resp: compacto(pt.responsavel), compl: compacto(pt.complemento || ''), edificio: pt.edificio,
    om: o, nome: normalizarNome(o.nome), compacto: pal.join(''), sigla: normalizarNome(o.sigla || '').replace(/[^A-Z0-9]/g, ''),
    iniciais: pal.map(p => p[0]).join(''), pal: [...new Set(pal)], set: new Set(pal),
    alternativos: new Set((o.nomesAlternativos || []).map(compacto).filter(Boolean)),
  };
}

function comparar(A: Prep, B: Prep): { pontos: number; motivo: string } | null {
  const a = A.om, b = B.om;
  const na = A.compacto, nb = B.compacto;
  if (!na || !nb) return null;
  // "Arsenal - BGL1" × "Arsenal" ou × "Arsenal - SKM": o complemento é quem consome (outro cliente, mesmo responsável)
  if (A.resp && A.resp === B.resp && A.compl !== B.compl && !(A.compl && B.compl && (A.compl.startsWith(B.compl) || B.compl.startsWith(A.compl)))) return null;
  // edifícios diferentes (Ed.16 × Ed.32): pontos de consumo diferentes
  if (A.edificio && B.edificio && A.edificio !== B.edificio) return null;
  if (na === nb) return A.edificio !== B.edificio
    ? { pontos: 75, motivo: `mesmo nome, só um indica o edifício (Ed.${A.edificio || B.edificio}) — confira se é o mesmo ponto de consumo` }
    : { pontos: 100, motivo: 'mesmo nome (diferença só de acento ou pontuação)' };
  const sa = A.sigla, sb = B.sigla;
  if (sa && sb && sa === sb) return { pontos: 95, motivo: `mesma sigla (${a.sigla})` };
  // sigla de um = nome do outro, ou nome abreviado = iniciais do outro
  const ia = A.iniciais, ib = B.iniciais;
  if ((sa && (sa === nb || sa === ib)) || (sb && (sb === na || sb === ia))) return { pontos: 90, motivo: 'um está pela sigla e o outro pelo nome por extenso' };
  if ((na.length <= 8 && na === ib) || (nb.length <= 8 && nb === ia)) return { pontos: 85, motivo: 'nome abreviado (iniciais do outro)' };
  // nome cortado (planilhas cortam em 50 caracteres) ou acrescido
  if (Math.min(na.length, nb.length) >= 10 && (na.startsWith(nb) || nb.startsWith(na))) {
    // "Arsenal ... – TRANSUNIVERSAL": complemento depois de travessão costuma ser outro cliente (terceiro), não abreviação
    const [curto, longo] = na.length < nb.length ? [A.nome, B.nome] : [B.nome, A.nome];
    const resto = longo.slice(curto.replace(/\s*\(.*?\)\s*/g, '').trim().length);
    if (/^\s*[–-]\s*(?!ED\b|ED\.)[A-Z]/.test(resto)) return null;
    // "Diretoria ... da Marinha" × "Diretoria ... da Marinha ILHA FISCAL": o curto é um nome completo e o longo acrescenta
    // palavras inteiras (complemento sem travessão) → outro cliente. Nome cortado termina no meio de uma palavra
    // ("... EDCG Cl") ou tem o tamanho do corte das planilhas (~50 caracteres).
    const [pc, pl] = A.pal.length < B.pal.length ? [A.pal, B.pal] : [B.pal, A.pal];
    const palavrasInteiras = pc.length < pl.length && pc.every((p, i) => p === pl[i]);
    const extra = pl.slice(pc.length).join('');          // "ILHAFISCAL" é complemento; "RJ" é só um acréscimo
    const tam = normalizarNome(curto).trim().length;
    const cortadoNaPlanilha = tam >= 45 && tam <= 52;
    if (palavrasInteiras && extra.length >= 5 && !cortadoNaPlanilha) return null;
    return { pontos: 85, motivo: 'um nome é o começo do outro' };
  }
  let comuns = 0;
  for (const p of A.set) if (B.set.has(p)) comuns++;
  const uniao = A.set.size + B.set.size - comuns;
  const jac = uniao ? comuns / uniao : 0;
  if (comuns >= 2 && jac >= 0.6) return { pontos: Math.round(jac * 80), motivo: `nomes parecidos (${Math.round(jac * 100)}% das palavras em comum)` };
  // abreviações de palavras: "Dir Ind Marinha" × "Diretoria Industrial da Marinha"
  if (A.set.size >= 2 && A.set.size === B.set.size) {
    const la = A.pal, lb = B.pal;
    if (la.every((p, i) => lb[i].startsWith(p) || p.startsWith(lb[i]))) return { pontos: 80, motivo: 'palavras abreviadas' };
  }
  return null;
}

/**
 * Já unificadas: a desativada tem o nome guardado como nome alternativo da outra (o que a unificação faz).
 * Esse par não volta a aparecer.
 */
function jaUnificadas(A: Prep, B: Prep) {
  // desativada pela unificação (motivo "Unificada com ..."): já resolvida, mesmo quando os nomes são iguais
  const unificada = (o: OMDup) => !o.ativo && /^unificada com/i.test(o.motivoDesativacao || '');
  if (unificada(A.om) || unificada(B.om)) return true;
  return (!B.om.ativo && A.alternativos.has(B.compacto)) || (!A.om.ativo && B.alternativos.has(A.compacto));
}

/** Pares suspeitos, do mais provável para o menos. Navio só é comparado com navio; duas desativadas não são comparadas. */
export function paresDuplicados(oms: OMDup[], ignorar: Set<string> = new Set(), minimo = 60): ParDup[] {
  const out: ParDup[] = [];
  const preps = oms.map(preparar);
  for (let i = 0; i < preps.length; i++) {
    const A = preps[i];
    for (let j = i + 1; j < preps.length; j++) {
      const B = preps[j], a = A.om, b = B.om;
      if ((a.tipo === 'NAVIO') !== (b.tipo === 'NAVIO')) continue;
      if (!a.ativo && !b.ativo) continue;
      const c = comparar(A, B);
      if (!c || c.pontos < minimo) continue;
      if (ignorar.has(chavePar(a.id, b.id)) || jaUnificadas(A, B)) continue;
      out.push({ a, b, ...c });
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

// ------------------------------------------------------------------ cliente com complemento × comando do responsável
export interface OMComando extends OMDup { comandoId?: string | null }
export interface SugestaoComando { om: OMComando; responsavel: string; complemento: string; comandoId: string; origem: string }
/**
 * "Arsenal de Marinha do Rio de Janeiro - BGL1": a fatura é da BGL1 (extra-MB ou OM), mas o comando responsável é o do
 * Arsenal; "DPHDM - ILHA FISCAL": a Ilha Fiscal é da Diretoria. Sugere o comando da parte antes do " - " quando o
 * cliente está sem comando ou com outro comando.
 */
export function sugerirComandoPorComplemento(oms: OMComando[], comandos: { id: string; nome: string; sigla?: string | null; codigo?: string | null }[]): SugestaoComando[] {
  const k = (t: string) => compacto(t);
  const base = new Map<string, OMComando>();
  oms.filter(o => o.comandoId && !partesDoNome(o.nome).complemento).forEach(o => {
    [o.nome, o.sigla || '', ...(o.nomesAlternativos || [])].map(k).filter(Boolean).forEach(c => { if (!base.has(c) || (o.ativo && !base.get(c)!.ativo)) base.set(c, o); });
  });
  const cmd = new Map<string, { id: string; nome: string }>();
  comandos.forEach(c => [c.nome, c.sigla || ''].map(k).filter(Boolean).forEach(x => cmd.set(x, c)));
  const out: SugestaoComando[] = [];
  oms.filter(o => o.ativo).forEach(o => {
    const pt = partesDoNome(o.nome);
    if (!pt.complemento) return;
    const r = k(pt.responsavel);
    const om = base.get(r);
    const alvo = om?.comandoId ? { id: om.comandoId, origem: `comando de ${om.nome}` } : cmd.get(r) ? { id: cmd.get(r)!.id, origem: `comando ${cmd.get(r)!.nome}` } : null;
    if (!alvo || alvo.id === o.comandoId) return;
    out.push({ om: o, responsavel: pt.responsavel, complemento: pt.complemento, comandoId: alvo.id, origem: alvo.origem });
  });
  return out.sort((a, b) => a.om.nome.localeCompare(b.om.nome));
}
