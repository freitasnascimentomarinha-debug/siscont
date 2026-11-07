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
  /** desativados no cadastro que estão na lista trienal: ainda em operação, devem ser reativados */
  desativadosNaLista: { navio: NavioCad; lista: NavioLista }[];
  /** desativados no cadastro e fora da lista trienal: desativados de verdade */
  desativadosForaDaLista: NavioCad[];
}

export function compararNavios(lista: NavioLista[], oms: NavioCad[], classes: ClasseCad[]): Comparacao {
  const navios = oms.filter(o => o.tipo === 'NAVIO');
  const comApelidos = navios.flatMap(o => [o, ...(o.nomesAlternativos || []).map(a => ({ ...o, nome: a }))]);
  const classeDe = (nome: string) => acharPorNome(nome, classes);
  const nomeClasse = new Map(classes.map(c => [c.id, c.nome]));
  const vistos = new Set<string>();
  const r: Comparacao = { classesNovas: [], naviosNovos: [], classeDiferente: [], conferem: [], foraDaLista: [], desativadosNaLista: [], desativadosForaDaLista: [] };
  [...new Set(lista.map(l => l.classe))].forEach(c => { if (!classeDe(c)) r.classesNovas.push(c); });
  lista.filter(l => l.navio).forEach(l => {
    const om = acharPorNome(l.navio!, comApelidos) || acharNavio(l.navio!, comApelidos);
    if (!om || vistos.has(om.id)) { if (!om) r.naviosNovos.push(l); return; }
    vistos.add(om.id);
    if (!om.ativo) r.desativadosNaLista.push({ navio: om, lista: l });
    const cl = classeDe(l.classe) || null;
    if (cl && om.classeId === cl.id) r.conferem.push({ navio: om, lista: l });
    else r.classeDiferente.push({ navio: om, lista: l, classeAtual: om.classeId ? nomeClasse.get(om.classeId) ?? null : null, classeLista: cl });
  });
  r.foraDaLista = navios.filter(o => o.ativo && !vistos.has(o.id));
  r.desativadosForaDaLista = navios.filter(o => !o.ativo && !vistos.has(o.id));
  return r;
}

/** Quantidade de navios por classe e ano, da aba MEDIA TRIENAL (colunas "QTDE NAVIOS 2022" etc.). */
export interface QtdTrienal { classe: string; porAno: Record<string, number> }
export function lerQtdTrienal(abas: { nome: string; linhas: any[][] }[]): QtdTrienal[] {
  const a = abas.find(x => /^MEDIA TRIENAL/.test(normalizar(x.nome)));
  if (!a) return [];
  const h = a.linhas.findIndex(l => l.some(c => normalizar(c) === 'CLASSE NAVIO'));
  if (h < 0) return [];
  const cab = a.linhas[h].map(normalizar);
  const cC = cab.indexOf('CLASSE NAVIO');
  const anos = cab.map((c, i) => ({ i, m: /^QTDE NAVIOS (\d{4})/.exec(c) })).filter(x => x.m).map(x => ({ i: x.i, ano: x.m![1] }));
  const out: QtdTrienal[] = [];
  for (const l of a.linhas.slice(h + 1)) {
    const classe = String(l[cC] ?? '').trim();
    if (!classe || normalizar(classe) === 'TOTAL') continue;
    out.push({ classe, porAno: Object.fromEntries(anos.map(x => [x.ano, Number(l[x.i]) || 0])) });
  }
  return out;
}

export interface ResumoClasse {
  classe: string; classeId: string | null;
  naLista: number; trienal: Record<string, number> | null;
  ativos: number; desativados: number; reativar: number;
}
/** Por classe: navios na lista hoje, quantidade nos anos da média trienal e no cadastro (ativos/desativados/a reativar). */
export function resumoPorClasse(lista: NavioLista[], qtd: QtdTrienal[], cmp: Comparacao, oms: NavioCad[], classes: ClasseCad[]): ResumoClasse[] {
  const reativarIds = new Set(cmp.desativadosNaLista.map(x => x.navio.id));
  const mapa = new Map<string, ResumoClasse>();
  const pegar = (nome: string): ResumoClasse => {
    const cl = acharPorNome(nome, classes);
    const chave = cl ? cl.id : 'N:' + normalizar(nome);
    let r = mapa.get(chave);
    if (!r) {
      const navios = cl ? oms.filter(o => o.tipo === 'NAVIO' && o.classeId === cl.id) : [];
      r = { classe: cl?.nome ?? nome, classeId: cl?.id ?? null, naLista: 0, trienal: null,
        ativos: navios.filter(o => o.ativo).length, desativados: navios.filter(o => !o.ativo).length,
        reativar: navios.filter(o => reativarIds.has(o.id)).length };
      mapa.set(chave, r);
    }
    return r;
  };
  lista.forEach(l => { const r = pegar(l.classe); if (l.navio) r.naLista++; });
  qtd.forEach(q => { const r = pegar(q.classe); r.trienal = { ...(r.trienal || {}), ...q.porAno }; });
  return [...mapa.values()].sort((a, b) => a.classe.localeCompare(b.classe, 'pt-BR'));
}
