/**
 * Aba "LISTA DE NAVIOS" (e "DIARIAS") do Histórico Trienal × cadastro de navios e classes.
 * Funções puras: a tela aplica as correções escolhidas.
 */
import { normalizar, acharPorNome } from './taxaCondominialImport';
import { acharNavio } from './importMedicoes';

export interface NavioLista { classe: string; navio: string | null; comsup?: string | null; lotacao?: number | null; diaria?: number | null }

export function lerListaNavios(abas: { nome: string; linhas: any[][] }[]): NavioLista[] {
  const out: NavioLista[] = [];
  const lista = abas.find(a => /^LISTA DE NAVIOS/.test(normalizar(a.nome)));
  const diarias = abas.find(a => /^DIARIAS?$/.test(normalizar(a.nome)));
  const ler = (a: { linhas: any[][] } | undefined, extra: boolean) => {
    if (!a) return;
    const h = a.linhas.findIndex(l => l.some(c => normalizar(c) === 'CLASSE NAVIO'));
    if (h < 0) return;
    const cab = a.linhas[h].map(normalizar);
    const cC = cab.indexOf('CLASSE NAVIO'), cN = cab.indexOf('NAVIO'), cCs = cab.indexOf('COMSUP'), cL = cab.findIndex(c => /^LOTACAO/.test(c)), cD = cab.findIndex(c => /^DIARIA/.test(c));
    let classe = '';
    for (const l of a.linhas.slice(h + 1)) {
      const c = String(l[cC] ?? '').trim(), n = String(l[cN] ?? '').trim();
      if (c) classe = c.replace(/^\((.*)\)$/, '$1');
      if (!classe || (!c && !n)) continue;
      const item: NavioLista = { classe, navio: n || null };
      if (extra) { item.comsup = cCs >= 0 ? String(l[cCs] ?? '').trim() || null : null; item.lotacao = cL >= 0 && l[cL] !== '' && l[cL] != null ? Number(l[cL]) : null; item.diaria = cD >= 0 && l[cD] !== '' && l[cD] != null ? Number(l[cD]) : null; }
      // a mesma linha nas duas abas: completa com lotação/diária
      const ja = out.find(x => x.navio && n && normalizar(x.navio) === normalizar(n));
      if (ja) { if (extra) Object.assign(ja, { comsup: item.comsup ?? ja.comsup, lotacao: item.lotacao ?? ja.lotacao, diaria: item.diaria ?? ja.diaria }); continue; }
      if (!n && out.some(x => normalizar(x.classe) === normalizar(classe))) continue;
      out.push(item);
    }
  };
  ler(lista, false); ler(diarias, true);
  return out;
}

export interface NavioCad { id: string; nome: string; tipo: string; ativo: boolean; classeId?: string | null; nomesAlternativos?: string[] }
export interface ClasseCad { id: string; nome: string; ativo: boolean }
export interface Comparacao {
  classesNovas: string[];
  naviosNovos: NavioLista[];
  classeDiferente: { navio: NavioCad; lista: NavioLista; classeAtual: string | null; classeLista: ClasseCad | null }[];
  conferem: { navio: NavioCad; lista: NavioLista }[];
  foraDaLista: NavioCad[];
}

export function compararNavios(lista: NavioLista[], oms: NavioCad[], classes: ClasseCad[]): Comparacao {
  const navios = oms.filter(o => o.tipo === 'NAVIO');
  const comApelidos = navios.flatMap(o => [o, ...(o.nomesAlternativos || []).map(a => ({ ...o, nome: a }))]);
  const classeDe = (nome: string) => acharPorNome(nome, classes);
  const nomeClasse = new Map(classes.map(c => [c.id, c.nome]));
  const vistos = new Set<string>();
  const r: Comparacao = { classesNovas: [], naviosNovos: [], classeDiferente: [], conferem: [], foraDaLista: [] };
  [...new Set(lista.map(l => l.classe))].forEach(c => { if (!classeDe(c)) r.classesNovas.push(c); });
  lista.filter(l => l.navio).forEach(l => {
    const om = acharPorNome(l.navio!, comApelidos) || acharNavio(l.navio!, comApelidos);
    if (!om || vistos.has(om.id)) { if (!om) r.naviosNovos.push(l); return; }
    vistos.add(om.id);
    const cl = classeDe(l.classe) || null;
    if (cl && om.classeId === cl.id) r.conferem.push({ navio: om, lista: l });
    else r.classeDiferente.push({ navio: om, lista: l, classeAtual: om.classeId ? nomeClasse.get(om.classeId) ?? null : null, classeLista: cl });
  });
  r.foraDaLista = navios.filter(o => o.ativo && !vistos.has(o.id));
  return r;
}
