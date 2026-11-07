/**
 * Fase 5 — cobrança, relatórios gerenciais e fluxo de caixa (regras puras).
 */
const r2 = (n: number) => Math.round(n * 100) / 100;
const diasEntre = (a: string, b: string) => Math.round((Date.parse(b.slice(0, 10)) - Date.parse(a.slice(0, 10))) / 86400000);

export interface FaturaAberta {
  id: string; numero: string; setor: string; comando: string; cliente: string; omId?: string | null; tipo: string;
  ano: number; mes: number; vencimento: string; saldo: number; contestada?: boolean;
}

// ------------------------------------------------------------------ 5.1 quadro de faturas em aberto
export interface Pivo { linhas: string[]; colunas: string[]; valores: Record<string, Record<string, number>>; totLinha: Record<string, number>; totColuna: Record<string, number>; total: number }

export function pivo(fs: FaturaAberta[], linha: (f: FaturaAberta) => string, coluna: (f: FaturaAberta) => string): Pivo {
  const valores: Pivo['valores'] = {}, totLinha: Record<string, number> = {}, totColuna: Record<string, number> = {};
  let total = 0;
  fs.forEach(f => {
    const l = linha(f) || '—', c = coluna(f) || '—';
    (valores[l] ||= {})[c] = r2((valores[l][c] || 0) + f.saldo);
    totLinha[l] = r2((totLinha[l] || 0) + f.saldo); totColuna[c] = r2((totColuna[c] || 0) + f.saldo); total = r2(total + f.saldo);
  });
  return { linhas: Object.keys(valores).sort(), colunas: Object.keys(totColuna).sort(), valores, totLinha, totColuna, total };
}

/** Blocos do "Quadro Resumo Faturas em Aberto": vencidas por exercício, vencidas total, a vencer e total. */
export function quadroAberto(fs: FaturaAberta[], hoje: string) {
  const vencidas = fs.filter(f => f.vencimento < hoje), aVencer = fs.filter(f => f.vencimento >= hoje);
  const anos = [...new Set(vencidas.map(f => f.ano))].sort();
  return {
    porExercicio: anos.map(a => ({ ano: a, faturas: vencidas.filter(f => f.ano === a) })),
    vencidas, aVencer, todas: fs,
  };
}

// ------------------------------------------------------------------ 5.3 idade da dívida
export const FAIXAS = [
  { rotulo: 'A vencer', de: -Infinity, ate: 0 }, { rotulo: '1–30 dias', de: 1, ate: 30 }, { rotulo: '31–90 dias', de: 31, ate: 90 },
  { rotulo: '91–180 dias', de: 91, ate: 180 }, { rotulo: '181–365 dias', de: 181, ate: 365 }, { rotulo: 'Mais de 1 ano', de: 366, ate: Infinity },
];
export const diasAtraso = (vencimento: string, hoje: string) => diasEntre(vencimento, hoje);
export const faixaDe = (dias: number) => FAIXAS.find(f => dias >= f.de && dias <= f.ate)!.rotulo;

export interface LinhaDivida { chave: string; cliente: string; comando: string; setor: string; total: number; porFaixa: Record<string, number>; maisAntiga: string; qtd: number; contestado: number }
export function dividaPorCondomino(fs: FaturaAberta[], hoje: string): LinhaDivida[] {
  const m = new Map<string, LinhaDivida>();
  fs.forEach(f => {
    const k = f.omId || `${f.cliente}|${f.comando}`;
    const l = m.get(k) || { chave: k, cliente: f.cliente, comando: f.comando, setor: f.setor, total: 0, porFaixa: {}, maisAntiga: f.vencimento, qtd: 0, contestado: 0 };
    const fx = faixaDe(diasAtraso(f.vencimento, hoje));
    l.total = r2(l.total + f.saldo); l.porFaixa[fx] = r2((l.porFaixa[fx] || 0) + f.saldo); l.qtd++;
    if (f.contestada) l.contestado = r2(l.contestado + f.saldo);
    if (f.vencimento < l.maisAntiga) l.maisAntiga = f.vencimento;
    m.set(k, l);
  });
  return [...m.values()].sort((a, b) => b.total - a.total);
}

// ------------------------------------------------------------------ 5.2 cobrança
export function mensagemCobranca(cmd: { nome: string; indicativo?: string | null }, fs: FaturaAberta[], hoje: string) {
  const ord = [...fs].sort((a, b) => a.vencimento.localeCompare(b.vencimento));
  const br = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/');
  const brl = (n: number) => `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const total = r2(ord.reduce((s, f) => s + f.saldo, 0));
  return [
    `PARA: ${cmd.indicativo || `[indicativo de ${cmd.nome}]`}`,
    'DE: BNIC',
    'BT',
    'COBRANÇA DE FATURAS EM ATRASO',
    `ALFA - INFORMO QUE AS FATURAS DE SERVIÇOS DE APOIO ABAIXO, EMITIDAS POR ESTA BASE PARA OM SUBORDINADAS A ESSE COMANDO, ENCONTRAM-SE PENDENTES DE CERTIFICAÇÃO/PAGAMENTO NO SIPLAD (POSIÇÃO EM ${br(hoje)}):`,
    ...ord.map((f, k) => `${String(k + 1).padStart(2, '0')}) ${f.numero} - ${f.cliente} - ${f.tipo.toUpperCase()} - ${brl(f.saldo)} - DATA-LIMITE ${br(f.vencimento)} (${diasAtraso(f.vencimento, hoje)} DIAS)${f.contestada ? ' - EM CONTESTAÇÃO' : ''}`),
    `BRAVO - TOTAL EM ATRASO: ${brl(total)}.`,
    'CHARLIE - SOLICITO PROVIDÊNCIAS PARA A CERTIFICAÇÃO E O ENVIO DA ALTCRED CORRESPONDENTE, INDICANDO NA OBSERVAÇÃO OS NÚMEROS DAS FATURAS, OU A INFORMAÇÃO DE EVENTUAL CONTESTAÇÃO.',
    'BT',
  ].join('\n');
}

// ------------------------------------------------------------------ 5.4 / 5A.4 condomínio por rubrica
export interface Rubrica { ano: number; numero: number; descricao: string; contaContabil?: string | null; valorAnual: number; percentual?: number | null }
export interface LinhaRubrica { numero: number; descricao: string; valorVigente: number; percentual: number; tcRecebida: number; empenhado: number; saldoEmConta: number; aReceber: number; execucao: number }

/** %RUB: o informado ou a participação da rubrica no total do ano. */
export function percentuais(rs: Rubrica[]): Map<number, number> {
  const total = rs.reduce((s, r) => s + r.valorAnual, 0);
  return new Map(rs.map(r => [r.numero, r.percentual != null ? r.percentual : total ? (r.valorAnual / total) * 100 : 0]));
}

export function condominioPorRubrica(rs: Rubrica[], tcRecebidaTotal: number, empenhadoPorRubrica: Map<number, number>): { linhas: LinhaRubrica[]; total: LinhaRubrica } {
  const pct = percentuais(rs);
  const linhas = [...rs].sort((a, b) => a.numero - b.numero).map(r => {
    const p = pct.get(r.numero) || 0;
    const tc = r2(tcRecebidaTotal * p / 100), emp = r2(empenhadoPorRubrica.get(r.numero) || 0);
    return { numero: r.numero, descricao: r.descricao, valorVigente: r2(r.valorAnual), percentual: Math.round(p * 100) / 100, tcRecebida: tc, empenhado: emp, saldoEmConta: r2(tc - emp), aReceber: r2(r.valorAnual - tc), execucao: r.valorAnual ? Math.round((emp / r.valorAnual) * 10000) / 100 : 0 };
  });
  const soma = (k: keyof LinhaRubrica) => r2(linhas.reduce((s, l) => s + (l[k] as number), 0));
  const vv = soma('valorVigente'), emp = soma('empenhado');
  return { linhas, total: { numero: 0, descricao: 'TOTAL', valorVigente: vv, percentual: soma('percentual'), tcRecebida: soma('tcRecebida'), empenhado: emp, saldoEmConta: soma('saldoEmConta'), aReceber: soma('aReceber'), execucao: vv ? Math.round((emp / vv) * 10000) / 100 : 0 } };
}

// ------------------------------------------------------------------ 5A.5 disponível R.901.16
export type Categoria = 'ENERGIA' | 'AGUA' | 'TELEFONIA' | 'CONDOMINIO' | 'SEM_INDICACAO';
export const CATEGORIAS: { id: Categoria; rotulo: string }[] = [
  { id: 'ENERGIA', rotulo: 'Energia' }, { id: 'AGUA', rotulo: 'Água e esgoto' }, { id: 'TELEFONIA', rotulo: 'Telefonia' },
  { id: 'CONDOMINIO', rotulo: 'Condomínio/diária/viatura' }, { id: 'SEM_INDICACAO', rotulo: 'Sem indicação' },
];
export const categoriaDoServico = (sigla: string): Categoria => (sigla === 'EL' ? 'ENERGIA' : sigla === 'AE' ? 'AGUA' : sigla === 'TL' ? 'TELEFONIA' : 'CONDOMINIO');
export const categoriaDaSaida = (s: { categoria?: string | null; rubricaNumero?: number | null }): Categoria =>
  s.rubricaNumero ? 'CONDOMINIO' : s.categoria === 'ENERGIA' || s.categoria === 'AGUA' || s.categoria === 'TELEFONIA' || s.categoria === 'CONDOMINIO' ? s.categoria : 'SEM_INDICACAO';

/** Entradas (ALTCRED/GRU) por categoria, pelas faturas que pagaram; o que não foi usado fica "sem indicação". */
export function entradasPorCategoria(docs: { id: string; valor: number }[], baixas: { documentId: string; amount: number; sigla: string }[]) {
  const out: Record<Categoria, number> = { ENERGIA: 0, AGUA: 0, TELEFONIA: 0, CONDOMINIO: 0, SEM_INDICACAO: 0 };
  const usado = new Map<string, number>();
  const ids = new Set(docs.map(d => d.id));
  baixas.filter(b => ids.has(b.documentId)).forEach(b => {
    const c = categoriaDoServico(b.sigla);
    out[c] = r2(out[c] + b.amount);
    usado.set(b.documentId, (usado.get(b.documentId) || 0) + b.amount);
  });
  docs.forEach(d => { out.SEM_INDICACAO = r2(out.SEM_INDICACAO + Math.max(0, d.valor - (usado.get(d.id) || 0))); });
  return out;
}

// ------------------------------------------------------------------ 5A.3 saldo mensal
export interface Mov { data: string; tipo: 'ENTRADA' | 'SAIDA'; valor: number }
export interface LinhaMensal { mes: string; saldoAnterior: number; entradas: number; saidas: number; saldo: number }

/** Saldo mês a mês com transporte: o saldo final de um mês é o anterior do seguinte (inclusive na virada do ano). */
export function saldoMensal(movs: Mov[], de?: string, ate?: string): LinhaMensal[] {
  if (!movs.length) return [];
  const meses = [...new Set(movs.map(m => m.data.slice(0, 7)))].sort();
  const ini = de || meses[0], fim = ate || meses[meses.length - 1];
  const lista: string[] = [];
  for (let y = Number(ini.slice(0, 4)), m = Number(ini.slice(5, 7)); `${y}-${String(m).padStart(2, '0')}` <= fim; m === 12 ? (y++, m = 1) : m++) lista.push(`${y}-${String(m).padStart(2, '0')}`);
  let saldo = r2(movs.filter(m => m.data.slice(0, 7) < ini).reduce((s, m) => s + (m.tipo === 'ENTRADA' ? m.valor : -m.valor), 0));
  return lista.map(mes => {
    const doMes = movs.filter(m => m.data.slice(0, 7) === mes);
    const e = r2(doMes.filter(m => m.tipo === 'ENTRADA').reduce((s, m) => s + m.valor, 0));
    const sa = r2(doMes.filter(m => m.tipo === 'SAIDA').reduce((s, m) => s + m.valor, 0));
    const l = { mes, saldoAnterior: saldo, entradas: e, saidas: sa, saldo: r2(saldo + e - sa) };
    saldo = l.saldo;
    return l;
  });
}

// ------------------------------------------------------------------ notas de empenho
/** 740015000012026NE000122 = UG (6) + gestão (5) + ano (4) + "NE" + número (6). */
export const RE_NE = /^(\d{6})(\d{5})(\d{4})NE(\d{6})$/;
export function lerNE(numero: string) {
  const m = numero.trim().toUpperCase().replace(/\s/g, '').match(RE_NE);
  return m ? { ug: m[1], gestao: m[2], ano: Number(m[3]), numero: m[4] } : null;
}

/** Classifica a rubrica digitada na planilha ("14", "Água e Esgoto"...). */
export function classificarRubrica(texto: string): { rubricaNumero: number | null; categoria: 'ENERGIA' | 'AGUA' | 'TELEFONIA' | 'CONDOMINIO' | 'OUTROS' | null } {
  const t = (texto || '').trim();
  if (!t) return { rubricaNumero: null, categoria: null };
  if (/^\d{1,2}$/.test(t)) return { rubricaNumero: Number(t), categoria: 'CONDOMINIO' };
  const k = t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  if (/agua|esgoto/.test(k)) return { rubricaNumero: null, categoria: 'AGUA' };
  if (/energia|eletric/.test(k)) return { rubricaNumero: null, categoria: 'ENERGIA' };
  if (/telef/.test(k)) return { rubricaNumero: null, categoria: 'TELEFONIA' };
  if (/condom|diaria|viatura|rebocador/.test(k)) return { rubricaNumero: null, categoria: 'CONDOMINIO' };
  return { rubricaNumero: null, categoria: 'OUTROS' };
}
