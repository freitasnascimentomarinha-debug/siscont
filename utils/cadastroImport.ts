/**
 * Importação do cadastro de clientes a partir das planilhas da Divisão de
 * Contabilidade (Pagamento 2026, Faturamento, Faturas em aberto, Histórico
 * Trienal). Funções puras: recebem linhas (matriz de células) e devolvem a
 * proposta de cadastro + relatório de saneamento. Nada é gravado aqui.
 */
import type { TipoOM } from '../types';

export type Celula = string | number | boolean | Date | null | undefined;
export type Matriz = Celula[][];

export interface LinhaFatura {
  setor: string | null;
  comando: string | null;
  cliente: string;
  fatura: string;
  origem: string; // "arquivo › aba"
}

export interface AvisoSaneamento {
  tipo:
    | 'GRAFIA_UNIFICADA' | 'MESMO_CODIGO_VARIOS_CLIENTES' | 'SETOR_DESCONHECIDO' | 'COMANDO_SEM_CODIGO'
    | 'FATURA_FORA_DO_PADRAO' | 'CODIGO_COMPLETADO' | 'SEM_FATURA_RECENTE' | 'COMANDO_VARIOS_NOMES'
    | 'NAVIO_SEM_OM' | 'NAVIO_AMBIGUO' | 'OM_MUDOU_DE_COMANDO' | 'CODIGO_CORRIGIDO' | 'SETOR_CONVERTIDO' | 'USA_CODIGO_DO_COMANDO';
  mensagem: string;
  exemplos?: string[];
}

export interface PropostaSetor { sigla: string; conhecido: boolean }
export interface PropostaComando { chave: string; codigo: string | null; nome: string; setor: string | null; variantes: string[] }
export interface PropostaOM {
  chave: string;
  codigo: string;
  nome: string;
  tipo: TipoOM;
  setor: string | null;
  comandoChave: string | null;
  qtdFaturas: number;
  ultimaCompetencia: number; // AAAAMM (0 se desconhecida)
  variantes: string[];
  classe: string | null;
  /** false = não tem código próprio: usa o do comando (OM/navio) ou o da BNIC, 40015 (extra-MB). */
  codigoProprio: boolean;
}
export interface PropostaClasse { nome: string; navios: string[] }

export interface PropostaCadastro {
  setores: PropostaSetor[];
  comandos: PropostaComando[];
  oms: PropostaOM[];
  classes: PropostaClasse[];
  avisos: AvisoSaneamento[];
  estatisticas: { linhasLidas: number; abasLidas: string[]; competenciaMaisRecente: number };
}

/** Código da BNIC (OMPS-E), usado nas faturas de clientes extra-MB sem código próprio. */
export const CODIGO_BNIC = '40015';

export const SETORES_CONHECIDOS = ['COMOPNAV', 'DGMM', 'SGM', 'DGPM', 'DGN', 'DGDNTM', 'CGCFN', 'SecNSNQ', 'CCEM-RIO', 'CM', 'EXTRA-MB'];

// ------------------------------------------------------------------ texto
export const limpar = (v: Celula): string =>
  String(v ?? '').replace(/ /g, ' ').replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();

/** Chave de comparação: minúsculas, sem acento, só letras e números. */
export const chave = (v: Celula): string =>
  limpar(v).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Similaridade de Dice por bigramas (0 a 1). */
export function similaridade(a: string, b: string): number {
  const x = chave(a), y = chave(b);
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return 0;
  const bi = (s: string) => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) m.set(s.slice(i, i + 2), (m.get(s.slice(i, i + 2)) || 0) + 1);
    return m;
  };
  const A = bi(x), B = bi(y);
  let inter = 0;
  A.forEach((n, k) => { inter += Math.min(n, B.get(k) || 0); });
  return (2 * inter) / (x.length - 1 + y.length - 1);
}

const FATURA_PADRAO = /^(\d{4,6})-([A-Z]{2})-(\d{2})-(\d{4})-(\d{3})-(\d)$/;
const FATURA_PREFIXO = /^(\d{4,6})-([A-Z]{2})-/;

export function lerFatura(n: string): { codigo: string; sigla: string; competencia: number; padrao: boolean; completado: boolean } | null {
  const t = limpar(n).toUpperCase();
  const m = t.match(FATURA_PADRAO);
  const p = m || t.match(FATURA_PREFIXO);
  if (!p) return null;
  let codigo = p[1];
  let completado = false;
  if (codigo.length === 4) { codigo = '0' + codigo; completado = true; }
  const competencia = m ? Number(m[4]) * 100 + Number(m[3]) : 0;
  return { codigo, sigla: p[2], competencia, padrao: !!m, completado };
}

/**
 * Siglas antigas ou usadas por engano na coluna Setor (informado pela Divisão de Contabilidade):
 * CON = COMOPNAV; CCSM e CCSM-RIO passaram a CCEM-RIO; AMAZUL é o cliente Amazônia Azul (não é setor:
 * a linha é ignorada e vale o setor das demais faturas do cliente).
 */
export const SETORES_ALIAS: Record<string, string | null> = {
  CON: 'COMOPNAV',
  CCSM: 'CCEM-RIO',
  'CCSM-RIO': 'CCEM-RIO',
  CCEM: 'CCEM-RIO',
  AMAZUL: null,
};

export function normalizarSetor(v: Celula): { sigla: string | null; conhecido: boolean; convertidoDe?: string } {
  const t = limpar(v);
  if (!t) return { sigla: null, conhecido: true };
  if (/extra/i.test(t)) return { sigla: 'EXTRA-MB', conhecido: true };
  const up = t.toUpperCase();
  if (up in SETORES_ALIAS) return { sigla: SETORES_ALIAS[up], conhecido: true, convertidoDe: up };
  const k = SETORES_CONHECIDOS.find(s => s.toUpperCase() === up);
  return k ? { sigla: k, conhecido: true } : { sigla: up, conhecido: false };
}

export function lerComando(v: Celula): { codigo: string | null; nome: string } | null {
  const t = limpar(v);
  if (!t || /^extra/i.test(t)) return null;
  // valor que é número de fatura ou sigla de setor não é comando (coluna deslocada na planilha)
  if (FATURA_PREFIXO.test(t.toUpperCase()) || /^[A-Z]{2}-\d{2}-\d{4}/.test(t) || SETORES_CONHECIDOS.some(s => s.toUpperCase() === t.toUpperCase()) || t.toUpperCase() in SETORES_ALIAS) return null;
  const m = t.match(/^(\d{4,6})\s*-?\s*(.+)$/);
  if (m) return { codigo: m[1], nome: limpar(m[2].replace(/^-\s*/, '')) };
  return { codigo: null, nome: t };
}

const NAVIO_RE = /^(navio|fragata|corveta|submarino|aviso|avipa|rebocador|n\.?\s?pa\b|npa|napoc|nap\b|ndcc|ndm|nam\b|edcg|nt\b|nho|nhi|nhof|npo|nss|nae|nda|chata|dique|embarca|cv\b|f\.\s|s\.\s|corv|ex-s)/i;
export const pareceNavio = (nome: string) => NAVIO_RE.test(limpar(nome)) || /\bnavio\b/i.test(nome);

const PREPOSICOES = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'a', 'o']);
/** Iniciais das palavras significativas: "Diretoria Industrial da Marinha" → "DIM". */
export const iniciais = (nome: string) =>
  limpar(nome).normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[\s-]+/)
    .filter(w => w && !PREPOSICOES.has(w.toLowerCase()) && /^[A-Za-z]/.test(w)).map(w => w[0].toUpperCase()).join('');

/**
 * Mesmo cliente escrito com a sigla no final: "Diretoria Industrial da Marinha - DIM",
 * "Empresa Gerencial de Projetos Navais(EMGEPRON)". Vale para sigla entre parênteses ou, após " - ",
 * para sigla igual às iniciais do nome (assim "AMRJ - SKM", empresa faturada no código do AMRJ, não casa).
 */
export function mesmaEntidadeComSigla(a: string, b: string): boolean {
  const separar = (n: string): { base: string; sigla: string | null; parenteses: boolean } => {
    const t = limpar(n);
    const p = t.match(/^(.*?)\s*\(([A-Za-z0-9ºª.\- ]{2,12})\)\.?$/);
    if (p) return { base: p[1], sigla: p[2].replace(/[\s.]/g, '').toUpperCase(), parenteses: true };
    const h = t.match(/^(.*\S)\s+-\s+([A-Za-z0-9ºª]{2,10})$/);
    if (h) return { base: h[1], sigla: h[2].toUpperCase(), parenteses: false };
    return { base: t, sigla: null, parenteses: false };
  };
  const x = separar(a), y = separar(b);
  if (!x.sigla && !y.sigla) return false;
  if (chave(x.base) !== chave(y.base)) return false;
  if (x.sigla && y.sigla) return x.sigla === y.sigla;
  const s = (x.sigla || y.sigla)!, par = x.sigla ? x.parenteses : y.parenteses;
  return par || s === iniciais(x.base);
}

/** Órgãos que mudaram de nome: a grafia antiga é unificada com a nova. */
const RENOMEADOS: [RegExp, string][] = [
  [/comunica[cç][aã]o social/i, 'Comunicação Estratégica'],
];
export const nomeAtual = (nome: string) => RENOMEADOS.reduce((n, [re, novo]) => n.replace(re, novo), nome);

/** "Arsenal de Marinha do Rio de Janeiro - SKM" × "Arsenal de Marinha do Rio de Janeiro": clientes diferentes. */
export function ehSufixado(a: string, b: string): boolean {
  const x = chave(a), y = chave(b);
  if (x === y) return false;
  const [curto, longo] = x.length < y.length ? [x, y] : [y, x];
  return longo.startsWith(curto) && longo.length - curto.length >= 2;
}

/** "AMRJ - BGL1" × "AMRJ - SKM": mesma base, complementos diferentes → clientes diferentes. */
export function complementosDiferentes(a: string, b: string): boolean {
  const pa = limpar(a).split(' - '), pb = limpar(b).split(' - ');
  if (pa.length >= 2 && pb.length >= 2 && similaridade(pa[pa.length - 1], pb[pb.length - 1]) < 0.6) return true;
  // Prefixo longo em comum e finais diferentes: "CMS EX-CETM" × "CMS EX-CAM" (prédios faturados à parte)
  const x = chave(a), y = chave(b);
  let i = 0;
  while (i < x.length && i < y.length && x[i] === y[i]) i++;
  const rx = x.slice(i), ry = y.slice(i);
  return i >= 0.75 * Math.min(x.length, y.length) && rx.length >= 2 && ry.length >= 2 && similaridade(rx, ry) < 0.5;
}

/** Dois nomes do mesmo navio escritos de formas diferentes ("NHo Taurus" × "Navio Hidroceanográfico Taurus"). */
export function mesmoNavio(a: string, b: string): boolean {
  if (!pareceNavio(a) || !pareceNavio(b)) return false;
  const ultimo = (s: string) => chave(limpar(s).split(' ').filter(Boolean).pop());
  const ua = ultimo(a), ub = ultimo(b);
  return ua.length >= 4 && ua === ub;
}

// ------------------------------------------------------- leitura de abas
const achaCabecalho = (m: Matriz, nomes: string[][], max = 40): { linha: number; col: number[] } | null => {
  for (let i = 0; i < Math.min(max, m.length); i++) {
    const row = (m[i] || []).map(c => chave(c));
    const col = nomes.map(alternativas => row.findIndex(c => alternativas.includes(c)));
    if (col.every(c => c >= 0)) return { linha: i, col };
  }
  return null;
};

/** Extrai linhas de fatura de uma aba (cabeçalho com Comando, Cliente e Fatura; Setor opcional). */
export function extrairLinhasDeFatura(matriz: Matriz, origem: string): LinhaFatura[] {
  const h = achaCabecalho(matriz, [['comando'], ['cliente'], ['fatura', 'nfatura']]);
  if (!h) return [];
  const header = (matriz[h.linha] || []).map(c => chave(c));
  // Abas de pagamento (LANÇAMENTOS, ALTCRED, AUDITORIA...) usam "COMANDO" para o setor e "CLIENTE" para o
  // comando: não servem para o cadastro de OM.
  if (header.some(c => c.includes('altcred'))) return [];
  const colSetor = header.findIndex(c => c === 'setor');
  const [cCmd, cCli, cFat] = h.col;
  const out: LinhaFatura[] = [];
  let ultimoCmd: string | null = null, ultimoCli: string | null = null, ultimoSetor: string | null = null;
  for (let i = h.linha + 1; i < matriz.length; i++) {
    const r = matriz[i] || [];
    const fatura = limpar(r[cFat]);
    const cmd = limpar(r[cCmd]) || null;
    const cli = limpar(r[cCli]) || null;
    const set = colSetor >= 0 ? limpar(r[colSetor]) || null : null;
    // extratos por comando só preenchem comando/cliente na primeira linha do grupo
    if (cmd && !/total$/i.test(cmd)) ultimoCmd = cmd;
    if (cli && !/total$/i.test(cli)) ultimoCli = cli;
    if (set) ultimoSetor = set;
    if (!fatura || !FATURA_PREFIXO.test(fatura.toUpperCase())) continue;
    const cliente = cli || ultimoCli;
    if (!cliente) continue;
    out.push({ setor: set || (colSetor >= 0 ? null : ultimoSetor), comando: cmd || ultimoCmd, cliente, fatura, origem });
  }
  return out;
}

/** Extrai navio → classe do Histórico Trienal (abas com "CLASSE NAVIO" e "NAVIO"). */
export function extrairClasses(matriz: Matriz): { classe: string; navio: string }[] {
  const h = achaCabecalho(matriz, [['classenavio'], ['navio']], 10);
  if (!h) return [];
  const [cClasse, cNavio] = h.col;
  const out: { classe: string; navio: string }[] = [];
  let classe = '';
  for (let i = h.linha + 1; i < matriz.length; i++) {
    const r = matriz[i] || [];
    const c = limpar(r[cClasse]);
    const n = limpar(r[cNavio]);
    if (/^total/i.test(c) || /^total/i.test(n)) continue;
    if (c) classe = c;
    if (n && classe && !/extra\s*mb/i.test(n)) out.push({ classe, navio: n });
  }
  return out;
}

// ------------------------------------------------------------- análise
interface Ocorrencia { nome: string; competencia: number; ordem: number }

const escolheNome = (ocs: Ocorrencia[]): string => {
  const cont = new Map<string, { n: number; rec: number; ordem: number }>();
  ocs.forEach(o => {
    const c = cont.get(o.nome) || { n: 0, rec: 0, ordem: 0 };
    c.n++; c.rec = Math.max(c.rec, o.competencia); c.ordem = Math.max(c.ordem, o.ordem);
    cont.set(o.nome, c);
  });
  let lista = [...cont.entries()];
  // Preferências de exibição: nome sem a sigla repetida no final ("… - DIM") e sem tudo em maiúsculas
  const semSigla = lista.filter(([n]) => !lista.some(([m]) => m !== n && m.length < n.length && mesmaEntidadeComSigla(m, n)));
  if (semSigla.length) lista = semSigla;
  const caixaMista = lista.filter(([n]) => n !== n.toUpperCase());
  if (caixaMista.length) lista = caixaMista;
  // grafia usada nas faturas mais recentes, se aparecer ao menos 3 vezes (acompanha mudanças de nome);
  // senão, a mais frequente
  const recente = [...lista].sort((a, b) => b[1].rec - a[1].rec || b[1].n - a[1].n)[0];
  if (recente[1].n >= 3 && recente[1].rec > 0) return recente[0];
  return lista.sort((a, b) => b[1].n - a[1].n || b[1].rec - a[1].rec || b[1].ordem - a[1].ordem)[0][0];
};

const fmtComp = (c: number) => (c ? `${String(c % 100).padStart(2, '0')}/${Math.floor(c / 100)}` : '—');

export interface OpcoesAnalise {
  limiarSimilaridade?: number; // padrão 0,88
  mesesSemFatura?: number; // padrão 12
}

export function analisarCadastro(
  linhas: LinhaFatura[],
  pares: { classe: string; navio: string }[] = [],
  abasLidas: string[] = [],
  opcoes: OpcoesAnalise = {}
): PropostaCadastro {
  const limiar = opcoes.limiarSimilaridade ?? 0.88;
  const mesesSem = opcoes.mesesSemFatura ?? 12;
  const avisos: AvisoSaneamento[] = [];
  const foraPadrao: string[] = [], completados = new Set<string>(), setoresDesc = new Map<string, Set<string>>();
  const convertidos = new Map<string, number>();

  // 1. Comandos (por código; sem código por chave do nome)
  type CmdAcc = { codigo: string | null; ocs: Ocorrencia[]; setores: Map<string, number> };
  const cmds = new Map<string, CmdAcc>();
  const cmdKeyOf = (c: { codigo: string | null; nome: string }) => (c.codigo ? `#${c.codigo}` : `@${chave(c.nome)}`);

  // 2. OM brutas por (código, chave do nome)
  type OmAcc = { codigo: string; ocs: Ocorrencia[]; setores: Ocorrencia[]; comandos: { key: string; competencia: number; ordem: number }[]; codigos: Map<string, number> };
  const oms = new Map<string, OmAcc>();
  let maxComp = 0;

  linhas.forEach((l, ordem) => {
    const f = lerFatura(l.fatura);
    if (!f) return;
    if (!f.padrao) foraPadrao.push(`${l.fatura} (${l.origem})`);
    if (f.completado) completados.add(`${l.fatura} → ${f.codigo}`);
    maxComp = Math.max(maxComp, f.competencia);

    const st = normalizarSetor(l.setor);
    if (st.convertidoDe) convertidos.set(st.convertidoDe, (convertidos.get(st.convertidoDe) || 0) + 1);
    if (st.sigla && !st.conhecido) {
      const s = setoresDesc.get(st.sigla) || new Set<string>();
      s.add(l.origem); setoresDesc.set(st.sigla, s);
    }

    const cmd = lerComando(l.comando);
    let cmdKey: string | null = null;
    if (cmd && st.sigla !== 'EXTRA-MB') {
      cmdKey = cmdKeyOf(cmd);
      const acc = cmds.get(cmdKey) || { codigo: cmd.codigo, ocs: [], setores: new Map() };
      acc.ocs.push({ nome: cmd.nome, competencia: f.competencia, ordem });
      if (st.sigla) acc.setores.set(st.sigla, (acc.setores.get(st.sigla) || 0) + 1);
      cmds.set(cmdKey, acc);
    }

    const nome = limpar(l.cliente).replace(/^\d{4,6}\s*-?\s*(?=\D)/, '');
    // Extra-MB: o código da fatura nem sempre identifica o cliente (aluguel sai com o código da BNIC, 40015)
    const k = st.sigla === 'EXTRA-MB' ? `X|${chave(nome)}` : `${f.codigo}|${chave(nome)}`;
    const acc = oms.get(k) || { codigo: f.codigo, ocs: [], setores: [], comandos: [], codigos: new Map() };
    acc.codigos.set(f.codigo, (acc.codigos.get(f.codigo) || 0) + 1);
    acc.ocs.push({ nome, competencia: f.competencia, ordem });
    if (st.sigla) acc.setores.push({ nome: st.sigla, competencia: f.competencia, ordem });
    if (cmdKey) acc.comandos.push({ key: cmdKey, competencia: f.competencia, ordem });
    oms.set(k, acc);
  });

  oms.forEach(o => { o.codigo = [...o.codigos.entries()].sort((a, b) => b[1] - a[1])[0][0]; });

  // Comandos sem código que correspondem a um comando com código → redireciona
  const redirect = new Map<string, string>();
  const comCodigo = [...cmds.entries()].filter(([, c]) => c.codigo);
  const semCodigo: string[] = [];
  cmds.forEach((c, key) => {
    if (c.codigo) return;
    const nome = escolheNome(c.ocs);
    let melhor: { key: string; s: number } | null = null;
    comCodigo.forEach(([k2, c2]) => {
      const s = Math.max(...[...new Set(c2.ocs.map(o => o.nome))].map(n => {
        const a = chave(n), b = chave(nome);
        return a.includes(b) || b.includes(a) ? 0.99 : similaridade(n, nome);
      }));
      if (s >= limiar && (!melhor || s > melhor.s)) melhor = { key: k2, s };
    });
    if (melhor) redirect.set(key, (melhor as { key: string }).key);
    else semCodigo.push(nome);
  });
  if (semCodigo.length) avisos.push({ tipo: 'COMANDO_SEM_CODIGO', mensagem: `${semCodigo.length} comando(s) aparecem sem código e não foram associados a um comando com código. Serão criados sem código; revise após a importação.`, exemplos: semCodigo.slice(0, 8) });

  const comandos: PropostaComando[] = [];
  const variosNomes: string[] = [];
  cmds.forEach((c, key) => {
    if (redirect.has(key)) {
      const alvo = cmds.get(redirect.get(key)!)!;
      alvo.ocs.push(...c.ocs);
      c.setores.forEach((n, s) => alvo.setores.set(s, (alvo.setores.get(s) || 0) + n));
    }
  });
  cmds.forEach((c, key) => {
    if (redirect.has(key)) return;
    const nome = escolheNome(c.ocs);
    const variantes = [...new Set(c.ocs.map(o => o.nome))].filter(n => n !== nome);
    if (c.codigo && variantes.length) variosNomes.push(`${c.codigo}: "${nome}" (também: ${variantes.slice(0, 3).map(v => `"${v}"`).join(', ')})`);
    const setor = [...c.setores.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    comandos.push({ chave: key, codigo: c.codigo, nome, setor, variantes });
  });
  if (variosNomes.length) avisos.push({ tipo: 'COMANDO_VARIOS_NOMES', mensagem: `${variosNomes.length} comando(s) escritos de formas diferentes; foi adotada a grafia mais usada.`, exemplos: variosNomes.slice(0, 8) });

  // 3. Unifica grafias da mesma OM (mesmo código, nomes muito parecidos)
  const porCodigo = new Map<string, OmAcc[]>();
  oms.forEach(o => { const l = porCodigo.get(o.codigo) || []; l.push(o); porCodigo.set(o.codigo, l); });
  const unificadas: string[] = [], variosClientes: string[] = [];
  const grupos: OmAcc[] = [];
  porCodigo.forEach(lista => {
    const ordenada = [...lista].sort((a, b) => b.ocs.length - a.ocs.length);
    const finais: OmAcc[] = [];
    ordenada.forEach(o => {
      const nomeO = escolheNome(o.ocs);
      const alvo = finais.find(f => {
        const nf = escolheNome(f.ocs);
        if (mesmaEntidadeComSigla(nf, nomeO) || chave(nomeAtual(nf)) === chave(nomeAtual(nomeO))) return true;
        if (ehSufixado(nf, nomeO) || complementosDiferentes(nf, nomeO)) return false;
        return similaridade(nf, nomeO) >= limiar || mesmoNavio(nf, nomeO);
      });
      if (alvo) {
        unificadas.push(`${o.codigo}: "${nomeO}" → "${escolheNome(alvo.ocs)}"`);
        alvo.ocs.push(...o.ocs); alvo.setores.push(...o.setores); alvo.comandos.push(...o.comandos);
        o.codigos.forEach((n, c) => alvo.codigos.set(c, (alvo.codigos.get(c) || 0) + n));
      } else finais.push(o);
    });
    if (finais.length > 1) variosClientes.push(`${finais[0].codigo}: ${finais.map(f => `"${escolheNome(f.ocs)}"`).join(', ')}`);
    grupos.push(...finais);
  });
  if (unificadas.length) avisos.push({ tipo: 'GRAFIA_UNIFICADA', mensagem: `${unificadas.length} grafia(s) do mesmo cliente foram unificadas (mesmo código, nome quase igual).`, exemplos: unificadas.slice(0, 10) });

  // 4. Monta OM finais
  const resolveCmd = (k: string) => redirect.get(k) || k;
  const mudouComando: string[] = [];
  const limiteRecente = maxComp ? (() => { let y = Math.floor(maxComp / 100), m = maxComp % 100 - mesesSem; while (m <= 0) { m += 12; y--; } return y * 100 + m; })() : 0;
  let omsProp: PropostaOM[] = grupos.map(g => {
    const nome = escolheNome(g.ocs);
    const recentes = [...g.setores].sort((a, b) => b.competencia - a.competencia || b.ordem - a.ordem);
    const setor = recentes[0]?.nome ?? null;
    const cmdsOrd = [...g.comandos].sort((a, b) => b.competencia - a.competencia || b.ordem - a.ordem).map(c => resolveCmd(c.key));
    const comandoChave = setor === 'EXTRA-MB' ? null : (cmdsOrd[0] ?? null);
    const distintos = [...new Set(cmdsOrd)];
    if (distintos.length > 1) {
      const nomes = distintos.map(k => comandos.find(c => c.chave === k)?.nome || k);
      mudouComando.push(`${g.codigo} ${nome}: ${nomes.slice(0, 3).join(' → ')}`);
    }
    const ultima = Math.max(0, ...g.ocs.map(o => o.competencia));
    const tipo: TipoOM = setor === 'EXTRA-MB' ? 'EXTRA_MB' : pareceNavio(nome) ? 'NAVIO' : 'TERRA';
    return {
      chave: `${g.codigo}|${chave(nome)}`, codigo: g.codigo, nome, tipo, setor, comandoChave,
      qtdFaturas: g.ocs.length, ultimaCompetencia: ultima,
      variantes: [...new Set(g.ocs.map(o => o.nome))].filter(n => n !== nome), classe: null, codigoProprio: true,
    };
  });

  // Mesmo cliente com poucas faturas num código e muitas em outro → código digitado errado:
  // as faturas são somadas ao cliente com o código correto (ex.: Batalhão Naval 01050 → 31050).
  const corrigidos: string[] = [];
  const removidos = new Set<PropostaOM>();
  [...omsProp].sort((a, b) => a.qtdFaturas - b.qtdFaturas).forEach(o => {
    if (o.qtdFaturas > 3 || removidos.has(o)) return;
    const principal = omsProp
      .filter(x => x !== o && !removidos.has(x) && x.codigo !== o.codigo && x.qtdFaturas >= Math.max(5, o.qtdFaturas * 5) && similaridade(x.nome, o.nome) >= limiar)
      .sort((a, b) => b.qtdFaturas - a.qtdFaturas)[0];
    if (!principal) return;
    corrigidos.push(`${o.codigo} → ${principal.codigo}: "${o.nome}" (${o.qtdFaturas} fatura${o.qtdFaturas > 1 ? 's' : ''} somada${o.qtdFaturas > 1 ? 's' : ''} às ${principal.qtdFaturas} de "${principal.nome}")`);
    principal.qtdFaturas += o.qtdFaturas;
    principal.ultimaCompetencia = Math.max(principal.ultimaCompetencia, o.ultimaCompetencia);
    if (o.nome !== principal.nome && !principal.variantes.includes(o.nome)) principal.variantes.push(o.nome);
    removidos.add(o);
  });
  omsProp = omsProp.filter(o => !removidos.has(o)).sort((a, b) => a.codigo.localeCompare(b.codigo) || a.nome.localeCompare(b.nome, 'pt-BR'));
  if (corrigidos.length) avisos.push({ tipo: 'CODIGO_CORRIGIDO', mensagem: `${corrigidos.length} cliente(s) com o código digitado errado em poucas faturas foram corrigidos para o código usado nas demais. Vale corrigir também as faturas de origem.`, exemplos: corrigidos.slice(0, 12) });

  // OM/navio sem código próprio usa o código do comando; extra-MB sem código usa o da BNIC (40015)
  const cmdPorChave = new Map(comandos.map(c => [c.chave, c]));
  const emprestados: string[] = [];
  omsProp.forEach(o => {
    if (o.tipo === 'EXTRA_MB') {
      o.codigoProprio = o.codigo !== CODIGO_BNIC;
    } else {
      const c = o.comandoChave ? cmdPorChave.get(o.comandoChave) : undefined;
      const mesmoNome = c ? (similaridade(c.nome, o.nome) >= 0.7 || chave(o.nome).includes(chave(c.nome)) || chave(c.nome).includes(chave(o.nome))) : false;
      o.codigoProprio = !(c?.codigo && c.codigo === o.codigo && !mesmoNome);
    }
    if (!o.codigoProprio) emprestados.push(`${o.codigo} ${o.nome}${o.tipo === 'EXTRA_MB' ? ' (código da BNIC)' : ' (código do comando)'}`);
  });
  if (emprestados.length) avisos.push({ tipo: 'USA_CODIGO_DO_COMANDO', mensagem: `${emprestados.length} cliente(s) sem código próprio: usam o código do comando (OM e navios) ou o da BNIC, ${CODIGO_BNIC} (extra-MB). Serão cadastrados assim.`, exemplos: emprestados.slice(0, 12) });

  // Mesmo código com mais de um cliente que tenha código PRÓPRIO = conflito real a conferir
  const porCod = new Map<string, PropostaOM[]>();
  omsProp.filter(o => o.codigoProprio).forEach(o => { const l = porCod.get(o.codigo) || []; l.push(o); porCod.set(o.codigo, l); });
  const conflitos = [...porCod.entries()].filter(([, l]) => l.length > 1).map(([c, l]) => `${c}: ${l.map(o => `"${o.nome}"`).join(', ')}`);
  if (conflitos.length) avisos.push({ tipo: 'MESMO_CODIGO_VARIOS_CLIENTES', mensagem: `${conflitos.length} código(s) usados por mais de um cliente que parece ter código próprio. Confira se são grafias do mesmo cliente ou se algum deles usa o código do comando.`, exemplos: conflitos.slice(0, 10) });

  const semRecente = omsProp.filter(o => limiteRecente && o.ultimaCompetencia && o.ultimaCompetencia < limiteRecente)
    .map(o => `${o.codigo} ${o.nome} (última: ${fmtComp(o.ultimaCompetencia)})`);
  if (mudouComando.length) avisos.push({ tipo: 'OM_MUDOU_DE_COMANDO', mensagem: `${mudouComando.length} OM aparecem sob mais de um comando ao longo do tempo; foi adotado o mais recente.`, exemplos: mudouComando.slice(0, 8) });
  if (semRecente.length) avisos.push({ tipo: 'SEM_FATURA_RECENTE', mensagem: `${semRecente.length} OM sem fatura nos últimos ${mesesSem} meses (antes de ${fmtComp(limiteRecente)}). Podem ser navios/OM desativados — é possível importá-las já desativadas.`, exemplos: semRecente.slice(0, 10) });

  // 5. Classes de navio (Histórico Trienal) e associação às OM navio
  const classesMap = new Map<string, Set<string>>();
  pares.forEach(p => {
    const s = classesMap.get(p.classe) || new Set<string>();
    s.add(p.navio); classesMap.set(p.classe, s);
  });
  const naviosOM = omsProp.filter(o => o.tipo === 'NAVIO');
  const semOM: string[] = [], ambiguos: string[] = [];
  classesMap.forEach((navios, classe) => {
    navios.forEach(n => {
      const kn = chave(n);
      if (kn.length < 3) return;
      const cands = naviosOM.filter(o => chave(o.nome).endsWith(kn) || chave(o.nome).includes(kn));
      if (cands.length === 0) semOM.push(`${n} (${classe})`);
      else {
        const exatos = cands.filter(o => chave(o.nome).endsWith(kn));
        const escolhidos = exatos.length ? exatos : cands;
        if (escolhidos.length > 1) ambiguos.push(`${n}: ${escolhidos.map(o => `${o.codigo} ${o.nome}`).join(' / ')}`);
        escolhidos.forEach(o => { if (!o.classe) o.classe = classe; });
      }
    });
  });
  if (semOM.length) avisos.push({ tipo: 'NAVIO_SEM_OM', mensagem: `${semOM.length} navio(s) do Histórico Trienal sem cliente correspondente nas faturas (classe criada, navio não associado).`, exemplos: semOM.slice(0, 10) });
  if (ambiguos.length) avisos.push({ tipo: 'NAVIO_AMBIGUO', mensagem: `${ambiguos.length} navio(s) do histórico casaram com mais de um cliente; a classe foi aplicada a todos — confira.`, exemplos: ambiguos.slice(0, 8) });

  if (foraPadrao.length) avisos.push({ tipo: 'FATURA_FORA_DO_PADRAO', mensagem: `${foraPadrao.length} número(s) de fatura fora do padrão OM-SS-MM-AAAA-SEQ-V (o código da OM foi aproveitado).`, exemplos: [...new Set(foraPadrao)].slice(0, 8) });
  if (completados.size) avisos.push({ tipo: 'CODIGO_COMPLETADO', mensagem: `${completados.size} número(s) de fatura com código de 4 dígitos; foi completado com zero à esquerda.`, exemplos: [...completados].slice(0, 8) });
  if (convertidos.size) avisos.push({ tipo: 'SETOR_CONVERTIDO', mensagem: 'Siglas antigas de setor convertidas: CON → COMOPNAV; CCSM e CCSM-RIO → CCEM-RIO; AMAZUL (é o cliente Amazônia Azul, não setor) ignorada.', exemplos: [...convertidos.entries()].map(([s, n]) => `${s}: ${n} linha(s)`) });
  setoresDesc.forEach((origens, sigla) => avisos.push({ tipo: 'SETOR_DESCONHECIDO', mensagem: `Setor "${sigla}" não está na lista de setores conhecidos; será criado. Confira se é sigla antiga de outro setor.`, exemplos: [...origens].slice(0, 5) }));

  const setoresUsados = new Set<string>([...omsProp.map(o => o.setor), ...comandos.map(c => c.setor)].filter(Boolean) as string[]);
  return {
    setores: [...setoresUsados].sort().map(s => ({ sigla: s, conhecido: SETORES_CONHECIDOS.includes(s) })),
    comandos: comandos.sort((a, b) => (a.codigo || 'zz').localeCompare(b.codigo || 'zz') || a.nome.localeCompare(b.nome, 'pt-BR')),
    oms: omsProp,
    classes: [...classesMap.entries()].map(([nome, n]) => ({ nome, navios: [...n] })).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
    avisos,
    estatisticas: { linhasLidas: linhas.length, abasLidas, competenciaMaisRecente: maxComp },
  };
}

export const formatarCompetencia = fmtComp;

/** Último dia do mês seguinte à competência AAAAMM (data de desativação sugerida). */
export function fimDoMesSeguinte(competencia: number): string {
  let y = Math.floor(competencia / 100), m = (competencia % 100) + 1;
  if (m > 12) { m = 1; y++; }
  const d = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// ------------------------------------------------------- plano de gravação
export interface Existentes {
  setores: { id: string; sigla: string }[];
  comandos: { id: string; codigo?: string | null; nome: string }[];
  classes: { id: string; nome: string }[];
  oms: { id: string; codigo: string; nome: string; classeId?: string | null; tipo?: string }[];
}

export interface OpcoesImportacao {
  /** Chaves das OM marcadas para importar. */
  selecionadas: Set<string>;
  /** Importar já desativadas as OM sem fatura há mais de N meses. */
  desativarSemFaturaRecente: boolean;
  mesesSemFatura?: number;
}

export interface PlanoImportacao {
  setores: string[];
  comandos: PropostaComando[];
  classes: string[];
  oms: (PropostaOM & { ativo: boolean; desativadoEm: string | null; motivo: string | null })[];
  classesEmOMExistentes: { omId: string; classe: string }[];
  ignorados: { omsExistentes: number; comandosExistentes: number; setoresExistentes: number; classesExistentes: number; naoSelecionadas: number };
}

export function planejarImportacao(p: PropostaCadastro, ex: Existentes, op: OpcoesImportacao): PlanoImportacao {
  const meses = op.mesesSemFatura ?? 12;
  const comp = p.estatisticas.competenciaMaisRecente;
  let limite = 0;
  if (comp) { let y = Math.floor(comp / 100), m = (comp % 100) - meses; while (m <= 0) { m += 12; y--; } limite = y * 100 + m; }

  const setoresEx = new Set(ex.setores.map(s => s.sigla.toUpperCase()));
  const cmdEx = new Set(ex.comandos.map(c => (c.codigo ? `#${c.codigo}` : `@${chave(c.nome)}`)));
  const classesEx = new Set(ex.classes.map(c => chave(c.nome)));
  const omEx = new Map(ex.oms.map(o => [`${o.codigo}|${chave(o.nome)}`, o]));
  const omExPorNome = new Map(ex.oms.map(o => [chave(o.nome), o]));

  const selecionadas = p.oms.filter(o => op.selecionadas.has(o.chave));
  const usadosCmd = new Set(selecionadas.map(o => o.comandoChave).filter(Boolean) as string[]);
  const comandos = p.comandos.filter(c => usadosCmd.has(c.chave) && !cmdEx.has(c.chave));
  const usadosSet = new Set<string>([
    ...selecionadas.map(o => o.setor), ...comandos.map(c => c.setor),
  ].filter(Boolean) as string[]);

  const oms: PlanoImportacao['oms'] = [];
  const classesEmOMExistentes: PlanoImportacao['classesEmOMExistentes'] = [];
  let omsExistentes = 0;
  selecionadas.forEach(o => {
    const existente = omEx.get(`${o.codigo}|${chave(o.nome)}`) || (o.tipo === 'EXTRA_MB' ? omExPorNome.get(chave(o.nome)) : undefined);
    if (existente) {
      omsExistentes++;
      if (o.classe && !existente.classeId && existente.tipo === 'NAVIO') classesEmOMExistentes.push({ omId: existente.id, classe: o.classe });
      return;
    }
    const antiga = op.desativarSemFaturaRecente && limite && o.ultimaCompetencia && o.ultimaCompetencia < limite;
    oms.push({
      ...o,
      ativo: !antiga,
      desativadoEm: antiga ? fimDoMesSeguinte(o.ultimaCompetencia) : null,
      motivo: antiga ? `Importação: sem fatura desde ${fmtComp(o.ultimaCompetencia)}` : null,
    });
  });

  const classesUsadas = new Set<string>([...oms.map(o => o.classe), ...classesEmOMExistentes.map(c => c.classe), ...p.classes.map(c => c.nome)].filter(Boolean) as string[]);
  const classes = [...classesUsadas].filter(c => !classesEx.has(chave(c)));

  return {
    setores: [...usadosSet].filter(s => !setoresEx.has(s.toUpperCase())).sort(),
    comandos,
    classes,
    oms,
    classesEmOMExistentes,
    ignorados: {
      omsExistentes,
      comandosExistentes: p.comandos.filter(c => usadosCmd.has(c.chave) && cmdEx.has(c.chave)).length,
      setoresExistentes: [...usadosSet].filter(s => setoresEx.has(s.toUpperCase())).length,
      classesExistentes: [...classesUsadas].filter(c => classesEx.has(chave(c))).length,
      naoSelecionadas: p.oms.length - selecionadas.length,
    },
  };
}
