/**
 * Painel do Encarregado — regras de cálculo (funções puras, sem tela).
 *
 * Definições (também mostradas na tela, em "Como é calculado"):
 *  - POSIÇÃO (hoje): em aberto, vencido, faixas de atraso, contestado, saldos parados. Mesmas regras do Painel inicial:
 *    em aberto = saldo a pagar das faturas não canceladas e NÃO contestadas; vencido = em aberto com vencimento
 *    anterior a hoje; contestadas ficam à parte (nunca somam em aberto nem vencido).
 *  - PERÍODO (de/até, em meses): faturado = faturas não canceladas com competência no período; recebido = ALTCRED/GRU pela
 *    DATA DO DOCUMENTO (data efetiva do recebimento: inclui adiantamentos e saldos ainda não atribuídos a faturas, e dívidas de
 *    competências anteriores); canceladas = competência no período.
 *  - Inadimplência % = vencido ÷ em aberto × 100.
 *  - Recuperação do estoque vencido: baixas (pagamento ou adiantamento) no período de faturas que JÁ estavam vencidas no início
 *    do período ÷ saldo vencido no início do período.
 *  - Prazo médio de atraso = média dos dias de atraso ponderada pelo saldo vencido.
 *  - Histórico (evolução, variação): o saldo numa data passada é reconstruído pelas datas das baixas; faturas canceladas
 *    ou contestadas HOJE não entram em nenhum mês (o sistema não guarda quando isso aconteceu).
 */
import { FaturaPainel, emAberto, emContestacao, vencida } from './painel';
import { Contestacao, situacaoContestacao } from './fase4';

const r2 = (n: number) => Math.round(n * 100) / 100;
export const diasEntre = (de: string, ate: string) => Math.floor((Date.parse(ate.slice(0, 10)) - Date.parse(de.slice(0, 10))) / 86400000);
const dia = (s?: string | null) => (s || '').slice(0, 10);
export const somaDias = (iso: string, n: number) => new Date(Date.parse(iso.slice(0, 10)) + n * 86400000).toISOString().slice(0, 10);
export const fimDoMes = (ym: string) => { const [a, m] = ym.split('-').map(Number); return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10); };
export const inicioDoMes = (ym: string) => `${ym}-01`;
export const mesDe = (iso: string) => iso.slice(0, 7);
export const somaMeses = (ym: string, n: number) => { const [a, m] = ym.split('-').map(Number); const d = new Date(Date.UTC(a, m - 1 + n, 1)); return d.toISOString().slice(0, 7); };
export const mesesEntre = (de: string, ate: string) => { const out: string[] = []; for (let m = de; m <= ate && out.length < 600; m = somaMeses(m, 1)) out.push(m); return out; };

// ------------------------------------------------------------------ tipos
export interface FaturaGer extends FaturaPainel { omId: string | null; extra: boolean; quitadaExterna: boolean; quitadaEm: string | null; pontos: number }
export interface BaixaGer { invoiceId: string; docId: string; valor: number; data: string; adiantamento: boolean }
/** Dinheiro que entrou: um ALTCRED/GRU, pela data do documento. */
export interface Recebimento { id: string; valor: number; data: string; omId: string | null }
export interface Bloco { valor: number; qtd: number }

export interface Criterios {
  diasAtencao: number; diasCritico: number; diasContestParada: number; diasContestLonga: number;
  crescimentoPct: number; crescimentoMinimo: number; diasSaldoParado: number;
}
export const CRITERIOS_PADRAO: Criterios = {
  diasAtencao: 90, diasCritico: 365, diasContestParada: 15, diasContestLonga: 60, crescimentoPct: 50, crescimentoMinimo: 10000, diasSaldoParado: 60,
};
export function criteriosDe(par: Record<string, string | null | undefined>): Criterios {
  const n = (k: string, p: number) => { const v = Number(String(par[k] ?? '').replace(',', '.')); return Number.isFinite(v) && v > 0 ? v : p; };
  const c = CRITERIOS_PADRAO;
  return {
    diasAtencao: n('painel_dias_atencao', c.diasAtencao), diasCritico: n('painel_dias_critico', c.diasCritico),
    diasContestParada: n('painel_dias_contestacao_parada', c.diasContestParada), diasContestLonga: n('painel_dias_contestacao_longa', c.diasContestLonga),
    crescimentoPct: n('painel_crescimento_pct', c.crescimentoPct), crescimentoMinimo: n('painel_crescimento_minimo', c.crescimentoMinimo),
    diasSaldoParado: n('dias_saldo_parado', c.diasSaldoParado),
  };
}

// ------------------------------------------------------------------ faixas de atraso
export const FAIXAS_ATRASO = ['1–30 dias', '31–90 dias', '91–180 dias', '181–365 dias', 'Mais de 365 dias'] as const;
export const FAIXAS_TODAS = ['A vencer', ...FAIXAS_ATRASO] as const;
export const faixaDeDias = (d: number): (typeof FAIXAS_TODAS)[number] =>
  d <= 0 ? 'A vencer' : d <= 30 ? '1–30 dias' : d <= 90 ? '31–90 dias' : d <= 180 ? '91–180 dias' : d <= 365 ? '181–365 dias' : 'Mais de 365 dias';
export const atrasoDe = (f: { vencimento: string }, hoje: string) => (f.vencimento ? Math.max(0, diasEntre(f.vencimento, hoje)) : 0);
/** Faixa de uma fatura EM ABERTO (contestada e quitada ficam fora). */
export const faixaDaFatura = (f: FaturaPainel, hoje: string) => (vencida(f, hoje) ? faixaDeDias(atrasoDe(f, hoje)) : 'A vencer');

export const bloco = (fs: FaturaPainel[], valor: (f: FaturaPainel) => number = f => f.saldo): Bloco => ({ valor: r2(fs.reduce((s, f) => s + valor(f), 0)), qtd: fs.length });
export const chaveOM = (f: { omId: string | null; cliente: string; comando: string }) => f.omId || `${f.cliente}|${f.comando}`;

// ------------------------------------------------------------------ saldo numa data (histórico)
export function baixasPorFatura(bs: BaixaGer[]): Map<string, BaixaGer[]> {
  const m = new Map<string, BaixaGer[]>();
  bs.forEach(b => { const l = m.get(b.invoiceId); l ? l.push(b) : m.set(b.invoiceId, [b]); });
  return m;
}

/** Saldo da fatura ao fim do dia T, reconstruído pelas datas das baixas. De hoje em diante vale o saldo real. */
export function saldoNaData(f: FaturaGer, T: string, idx: Map<string, BaixaGer[]>, hoje: string): number {
  if (f.cancelada) return 0;
  if (T >= hoje) return f.saldo;
  if (f.emissao && dia(f.emissao) > T) return 0;
  if (f.quitadaExterna) { const q = dia(f.quitadaEm) || dia(f.vencimento); if (!q || q <= T) return 0; }
  const pago = (idx.get(f.id) || []).reduce((s, b) => (dia(b.data) <= T ? s + b.valor : s), 0);
  const s = r2(Math.max(0, f.total - pago));
  return s < 0.01 ? 0 : s;
}
/** Vencido ao fim do dia T (fatura contestada hoje não conta, como no painel). */
export const vencidoNaData = (f: FaturaGer, T: string, idx: Map<string, BaixaGer[]>, hoje: string) =>
  !f.contestada && f.vencimento && dia(f.vencimento) < T ? saldoNaData(f, T, idx, hoje) : 0;
export const abertoNaData = (f: FaturaGer, T: string, idx: Map<string, BaixaGer[]>, hoje: string) => (f.contestada ? 0 : saldoNaData(f, T, idx, hoje));

export interface PontoSerie { mes: string; data: string; vencido: number; emAberto: number }
/** Saldo vencido e em aberto ao fim de cada mês (o mês corrente usa a posição de hoje). */
export function serieInadimplencia(fs: FaturaGer[], idx: Map<string, BaixaGer[]>, hoje: string, ate: string, meses = 12): PontoSerie[] {
  const lista = mesesEntre(somaMeses(ate, -(meses - 1)), ate);
  const base = fs.filter(f => !f.cancelada && f.total > 0);
  return lista.map(mes => {
    const data = fimDoMes(mes) < hoje ? fimDoMes(mes) : hoje;
    let v = 0, a = 0;
    base.forEach(f => { v += vencidoNaData(f, data, idx, hoje); a += abertoNaData(f, data, idx, hoje); });
    return { mes, data, vencido: r2(v), emAberto: r2(a) };
  });
}

// ------------------------------------------------------------------ faturado × recebido
export interface PontoFR { mes: string; faturado: number; recebido: number; diferenca: number; qtdFaturas: number; qtdRecebimentos: number }
export function faturadoRecebido(fs: FaturaGer[], rec: Recebimento[], de: string, ate: string): PontoFR[] {
  const lista = mesesEntre(de, ate);
  const m = new Map(lista.map(x => [x, { mes: x, faturado: 0, recebido: 0, diferenca: 0, qtdFaturas: 0, qtdRecebimentos: 0 }]));
  fs.forEach(f => { if (f.cancelada) return; const p = m.get(`${f.ano}-${String(f.mes).padStart(2, '0')}`); if (p) { p.faturado += f.total; p.qtdFaturas++; } });
  rec.forEach(r => { const p = m.get(mesDe(r.data)); if (p) { p.recebido += r.valor; p.qtdRecebimentos++; } });
  return lista.map(k => { const p = m.get(k)!; p.faturado = r2(p.faturado); p.recebido = r2(p.recebido); p.diferenca = r2(p.faturado - p.recebido); return p; });
}
export type Granularidade = 'mensal' | 'trimestral' | 'anual';
export function agruparFR(serie: PontoFR[], g: Granularidade): PontoFR[] {
  if (g === 'mensal') return serie;
  const chave = (mes: string) => (g === 'anual' ? mes.slice(0, 4) : `${mes.slice(0, 4)} T${Math.ceil(Number(mes.slice(5, 7)) / 3)}`);
  const m = new Map<string, PontoFR>();
  serie.forEach(p => {
    const k = chave(p.mes), a = m.get(k) || { mes: k, faturado: 0, recebido: 0, diferenca: 0, qtdFaturas: 0, qtdRecebimentos: 0 };
    a.faturado = r2(a.faturado + p.faturado); a.recebido = r2(a.recebido + p.recebido); a.diferenca = r2(a.faturado - a.recebido);
    a.qtdFaturas += p.qtdFaturas; a.qtdRecebimentos += p.qtdRecebimentos; m.set(k, a);
  });
  return [...m.values()];
}

// ------------------------------------------------------------------ recuperação do estoque vencido
export interface Recuperacao { elegivel: number; recuperado: number; pct: number | null }
/** Do que JÁ estava vencido na véspera de `inicio`, quanto foi pago entre `inicio` e `fim`. */
export function recuperacao(fs: FaturaGer[], bs: BaixaGer[], idx: Map<string, BaixaGer[]>, inicio: string, fim: string, hoje: string): Recuperacao {
  const vesp = somaDias(inicio, -1);
  const estoque = new Map<string, number>();
  fs.forEach(f => {
    if (f.cancelada || f.contestada || !f.vencimento || dia(f.vencimento) >= inicio) return;
    const s = saldoNaData(f, vesp, idx, hoje);
    if (s > 0.009) estoque.set(f.id, s);
  });
  const elegivel = r2([...estoque.values()].reduce((s, v) => s + v, 0));
  let rec = 0;
  bs.forEach(b => { if (dia(b.data) >= inicio && dia(b.data) <= fim && estoque.has(b.invoiceId)) rec += b.valor; });
  const recuperado = r2(Math.min(rec, elegivel));
  return { elegivel, recuperado, pct: elegivel > 0 ? Math.round((recuperado / elegivel) * 1000) / 10 : null };
}
export interface PontoRecuperacao extends Recuperacao { mes: string }
export function recuperacaoMensal(fs: FaturaGer[], bs: BaixaGer[], idx: Map<string, BaixaGer[]>, de: string, ate: string, hoje: string): PontoRecuperacao[] {
  return mesesEntre(de, ate).filter(m => inicioDoMes(m) <= hoje).map(m => ({ mes: m, ...recuperacao(fs, bs, idx, inicioDoMes(m), fimDoMes(m) < hoje ? fimDoMes(m) : hoje, hoje) }));
}

// ------------------------------------------------------------------ indicadores executivos
export interface Periodo { de: string; ate: string } // meses AAAA-MM
export interface Indicadores {
  faturamento: { faturado: Bloco; emAberto: Bloco; canceladas: Bloco };
  cobranca: { vencido: Bloco; pctInadimplencia: number | null; omInadimplentes: number; faixas: { faixa: string; valor: number; qtd: number }[]; mais90: Bloco; mais365: Bloco; prazoMedio: number };
  recebimentos: { recebido: Bloco; pctDoFaturado: number | null; recuperacao: Recuperacao };
  contestadas: Bloco;
}
export function indicadores(fs: FaturaGer[], bs: BaixaGer[], idx: Map<string, BaixaGer[]>, p: Periodo, hoje: string, c: Criterios, rec: Recebimento[] = []): Indicadores {
  const noPeriodo = (f: FaturaGer) => { const k = `${f.ano}-${String(f.mes).padStart(2, '0')}`; return k >= p.de && k <= p.ate; };
  const doPeriodo = fs.filter(f => !f.cancelada && noPeriodo(f));
  const abertas = fs.filter(emAberto);
  const venc = fs.filter(f => vencida(f, hoje));
  const faixas = FAIXAS_TODAS.map(faixa => { const l = abertas.filter(f => faixaDaFatura(f, hoje) === faixa); return { faixa, ...bloco(l) }; });
  const vencidoTotal = r2(venc.reduce((s, f) => s + f.saldo, 0));
  const abertoTotal = r2(abertas.reduce((s, f) => s + f.saldo, 0));
  const ponderado = vencidoTotal > 0 ? venc.reduce((s, f) => s + atrasoDe(f, hoje) * f.saldo, 0) / vencidoTotal : 0;
  const noPer = rec.filter(r => mesDe(r.data) >= p.de && mesDe(r.data) <= p.ate);
  const liquidado = doPeriodo.reduce((s, f) => s + Math.max(0, f.total - f.saldo), 0);
  const faturadoTotal = doPeriodo.reduce((s, f) => s + f.total, 0);
  return {
    faturamento: { faturado: bloco(doPeriodo, f => f.total), emAberto: bloco(abertas), canceladas: bloco(fs.filter(f => f.cancelada && noPeriodo(f)), f => f.total) },
    cobranca: {
      vencido: bloco(venc), pctInadimplencia: abertoTotal > 0 ? Math.round((vencidoTotal / abertoTotal) * 1000) / 10 : null,
      omInadimplentes: new Set(venc.map(chaveOM)).size, faixas,
      mais90: bloco(venc.filter(f => atrasoDe(f, hoje) > c.diasAtencao)), mais365: bloco(venc.filter(f => atrasoDe(f, hoje) > c.diasCritico)), prazoMedio: Math.round(ponderado),
    },
    recebimentos: {
      recebido: { valor: r2(noPer.reduce((s, r) => s + r.valor, 0)), qtd: noPer.length },
      pctDoFaturado: faturadoTotal > 0 ? Math.round((liquidado / faturadoTotal) * 1000) / 10 : null,
      recuperacao: recuperacao(fs, bs, idx, inicioDoMes(p.de), fimDoMes(p.ate) < hoje ? fimDoMes(p.ate) : hoje, hoje),
    },
    contestadas: bloco(fs.filter(emContestacao)),
  };
}

// ------------------------------------------------------------------ situação das OM
export interface LinhaOM {
  chave: string; omId: string | null; cliente: string; comando: string; setor: string;
  emAberto: number; qtdAberto: number; vencido: number; qtdVencidas: number; pctInad: number | null;
  porFaixa: Record<string, number>; v90: number; v365: number; contestado: number; qtdContestadas: number;
  atrasoMedio: number; ultimaMov: string | null; vencidoAntes: number; variacao: number; variacaoPct: number | null; saldoParado: number;
}
export type CampoOM = 'vencido' | 'qtdVencidas' | 'pctInad' | 'atrasoMedio' | 'variacao' | 'contestado' | 'saldoParado' | 'emAberto' | 'cliente' | 'ultimaMov' | 'v90' | 'v365' | FaixaCampo;
export type FaixaCampo = `faixa:${string}`;
export const ORDENS_OM: { campo: CampoOM; rotulo: string }[] = [
  { campo: 'vencido', rotulo: 'Maior valor vencido' }, { campo: 'qtdVencidas', rotulo: 'Maior quantidade de faturas atrasadas' },
  { campo: 'pctInad', rotulo: 'Maior percentual de inadimplência' }, { campo: 'atrasoMedio', rotulo: 'Maior tempo médio de atraso' },
  { campo: 'variacao', rotulo: 'Maior crescimento da dívida (30 dias)' }, { campo: 'contestado', rotulo: 'Maior valor em contestação' },
  { campo: 'saldoParado', rotulo: 'Maior saldo parado (ALTCRED/GRU)' },
];

export function linhasOM(fs: FaturaGer[], idx: Map<string, BaixaGer[]>, hoje: string, c: Criterios, saldoParadoPorOM: (f: FaturaGer) => number = () => 0): LinhaOM[] {
  const m = new Map<string, FaturaGer[]>();
  fs.forEach(f => { if (f.cancelada) return; const k = chaveOM(f); (m.get(k) || m.set(k, []).get(k)!).push(f); });
  const antes = somaDias(hoje, -30);
  return [...m.entries()].map(([chave, l]) => {
    const abertas = l.filter(emAberto), venc = l.filter(f => vencida(f, hoje)), cont = l.filter(emContestacao);
    const vencido = r2(venc.reduce((s, f) => s + f.saldo, 0)), emAb = r2(abertas.reduce((s, f) => s + f.saldo, 0));
    const porFaixa: Record<string, number> = {};
    abertas.forEach(f => { const fx = faixaDaFatura(f, hoje); porFaixa[fx] = r2((porFaixa[fx] || 0) + f.saldo); });
    let ult: string | null = null;
    l.forEach(f => {
      const e = dia(f.emissao); if (e && e <= hoje && (!ult || e > ult)) ult = e;
      (idx.get(f.id) || []).forEach(b => { const d = dia(b.data); if (d <= hoje && (!ult || d > ult)) ult = d; });
    });
    const venAntes = r2(l.reduce((s, f) => s + vencidoNaData(f, antes, idx, hoje), 0));
    const primeira = l[0];
    return {
      chave, omId: primeira.omId, cliente: primeira.cliente, comando: primeira.comando, setor: primeira.setor,
      emAberto: emAb, qtdAberto: abertas.length, vencido, qtdVencidas: venc.length, pctInad: emAb > 0 ? Math.round((vencido / emAb) * 1000) / 10 : null,
      porFaixa, v90: r2(venc.filter(f => atrasoDe(f, hoje) > c.diasAtencao).reduce((s, f) => s + f.saldo, 0)),
      v365: r2(venc.filter(f => atrasoDe(f, hoje) > c.diasCritico).reduce((s, f) => s + f.saldo, 0)),
      contestado: r2(cont.reduce((s, f) => s + f.saldo, 0)), qtdContestadas: cont.length,
      atrasoMedio: vencido > 0 ? Math.round(venc.reduce((s, f) => s + atrasoDe(f, hoje) * f.saldo, 0) / vencido) : 0,
      ultimaMov: ult, vencidoAntes: venAntes, variacao: r2(vencido - venAntes),
      variacaoPct: venAntes > 0 ? Math.round(((vencido - venAntes) / venAntes) * 1000) / 10 : null,
      saldoParado: r2(saldoParadoPorOM(primeira)),
    };
  });
}
export function ordenarOM(ls: LinhaOM[], campo: CampoOM, asc = false): LinhaOM[] {
  const v = (l: LinhaOM): number | string => {
    if (campo.startsWith('faixa:')) return l.porFaixa[campo.slice(6)] || 0;
    if (campo === 'cliente') return l.cliente; if (campo === 'ultimaMov') return l.ultimaMov || '';
    const x = (l as any)[campo]; return x === null || x === undefined ? -1 : x;
  };
  const dir = asc ? 1 : -1;
  return [...ls].sort((a, b) => { const x = v(a), y = v(b); const c = typeof x === 'number' ? x - (y as number) : String(x).localeCompare(String(y), 'pt-BR'); return dir * c || b.vencido - a.vencido || a.cliente.localeCompare(b.cliente, 'pt-BR'); });
}

export type SituacaoId = 'semVencidos' | 'recentes' | 'criticos' | 'contestacoes' | 'pendencias';
export const SITUACOES: { id: SituacaoId; rotulo: string; cor: string; dica: (c: Criterios) => string }[] = [
  { id: 'semVencidos', rotulo: 'Sem débitos vencidos', cor: '#16a34a', dica: () => 'Nenhuma fatura vencida em aberto.' },
  { id: 'recentes', rotulo: 'Débitos recentes', cor: '#2563eb', dica: c => `Tem fatura vencida, nenhuma há mais de ${c.diasAtencao} dias.` },
  { id: 'criticos', rotulo: 'Débitos críticos', cor: '#dc2626', dica: c => `Tem fatura vencida há mais de ${c.diasAtencao} dias.` },
  { id: 'contestacoes', rotulo: 'Com contestações', cor: '#d97706', dica: () => 'Tem fatura em contestação.' },
  { id: 'pendencias', rotulo: 'Pendências de acompanhamento', cor: '#7c3aed', dica: c => `ALTCRED/GRU com saldo parado há mais de ${c.diasSaldoParado} dias, ou contestação sem movimentação.` },
];
/** Uma OM pode estar em mais de uma situação (não são exclusivas). */
export function situacoesDaOM(l: LinhaOM, c: Criterios, comPendencia = false): Record<SituacaoId, boolean> {
  return {
    semVencidos: l.vencido <= 0, recentes: l.vencido > 0 && l.v90 <= 0, criticos: l.v90 > 0, contestacoes: l.qtdContestadas > 0,
    pendencias: l.saldoParado > 0 || comPendencia,
  };
}

// ------------------------------------------------------------------ contestações
export const FAIXAS_TRAMITACAO = [
  { rotulo: 'Até 7 dias', ate: 7 }, { rotulo: '8–15 dias', ate: 15 }, { rotulo: '16–30 dias', ate: 30 }, { rotulo: '31–60 dias', ate: 60 }, { rotulo: 'Mais de 60 dias', ate: Infinity },
];
export const faixaTramitacao = (d: number) => FAIXAS_TRAMITACAO.find(f => d <= f.ate)!.rotulo;

export interface ContestacaoGer {
  c: Contestacao; fatura: FaturaGer | null; cliente: string; comando: string; valor: number;
  aberta: boolean; diasAberta: number; diasParada: number; prazoVencido: boolean; faixa: string; ultimoMov: string; diasResolucao: number | null; proximoPasso: string;
}
export function analisarContestacoes(cs: Contestacao[], fatura: Map<string, FaturaGer>, hoje: string): ContestacaoGer[] {
  const out: ContestacaoGer[] = [];
  cs.forEach(c => {
    const f = fatura.get(c.invoiceId);
    if (!f) return; // fatura fora do recorte dos filtros
    const s = situacaoContestacao(c, hoje);
    const ult = c.historico.length ? c.historico[c.historico.length - 1].em : c.abertaEm;
    out.push({
      c, fatura: f, cliente: f.cliente, comando: f.comando, valor: f.saldo, aberta: s.aberta, diasAberta: s.diasAberta, diasParada: s.diasParada,
      prazoVencido: s.prazoVencido, faixa: faixaTramitacao(s.diasAberta), ultimoMov: dia(ult),
      diasResolucao: !s.aberta && c.decididaEm ? Math.max(0, diasEntre(c.abertaEm, c.decididaEm)) : null, proximoPasso: s.proximoPasso,
    });
  });
  return out;
}
export function resumoContestacoes(l: ContestacaoGer[], p: Periodo, c: Criterios) {
  const abertas = l.filter(x => x.aberta);
  const resolvidas = l.filter(x => !x.aberta && x.c.decididaEm && mesDe(x.c.decididaEm) >= p.de && mesDe(x.c.decididaEm) <= p.ate);
  const tempos = resolvidas.map(x => x.diasResolucao).filter((d): d is number => d !== null);
  return {
    abertas, resolvidas, valor: r2(abertas.reduce((s, x) => s + x.valor, 0)),
    semMovimento: abertas.filter(x => x.diasParada > c.diasContestParada), longa: abertas.filter(x => x.diasAberta > c.diasContestLonga), prazoVencido: abertas.filter(x => x.prazoVencido),
    tempoMedio: tempos.length ? Math.round((tempos.reduce((s, d) => s + d, 0) / tempos.length) * 10) / 10 : null,
    porFaixa: FAIXAS_TRAMITACAO.map(f => { const x = abertas.filter(a => a.faixa === f.rotulo); return { faixa: f.rotulo, qtd: x.length, valor: r2(x.reduce((s, a) => s + a.valor, 0)), itens: x }; }),
    maisAntigas: [...abertas].sort((a, b) => b.diasAberta - a.diasAberta).slice(0, 10),
  };
}

// ------------------------------------------------------------------ alertas gerenciais
export type Prioridade = 'critico' | 'atencao' | 'info';
export const ROTULO_PRIORIDADE: Record<Prioridade, string> = { critico: 'Crítico', atencao: 'Atenção', info: 'Informativo' };
export interface Alerta {
  id: string; tipo: string; prioridade: Prioridade; om: string; valor: number | null; qtd: number; dias: number | null; ultimaMov: string | null; detalhe: string;
  faturas?: FaturaGer[]; contestacoes?: ContestacaoGer[]; destino?: 'om' | 'contestacoes' | 'parados' | 'geral';
}
const ORDEM_PRIO: Record<Prioridade, number> = { critico: 0, atencao: 1, info: 2 };

export interface EntradaAlertas {
  fs: FaturaGer[]; linhas: LinhaOM[]; hoje: string; c: Criterios; contest: ContestacaoGer[];
  parados: { cliente: string; valor: number; dias: number; ultimo: string }[];
  cobrancas: { faturas: string[]; enviadaEm: string }[];
}
export function gerarAlertas(e: EntradaAlertas): Alerta[] {
  const { fs, linhas, hoje, c } = e;
  const out: Alerta[] = [];
  const nomeOM = (l: FaturaGer[]) => { const t = new Map<string, { n: string; v: number }>(); l.forEach(f => { const k = chaveOM(f); const x = t.get(k) || { n: f.cliente, v: 0 }; x.v += f.saldo; t.set(k, x); }); const o = [...t.values()].sort((a, b) => b.v - a.v); return o.length ? (o.length > 1 ? `${o[0].n} e mais ${o.length - 1} OM` : o[0].n) : '—'; };
  const ultima = (l: FaturaGer[]) => { const ch = new Set(l.map(chaveOM)); return linhas.filter(x => ch.has(x.chave)).reduce<string | null>((m, x) => (x.ultimaMov && (!m || x.ultimaMov > m) ? x.ultimaMov : m), null); };
  const venc = fs.filter(f => vencida(f, hoje));
  const g365 = venc.filter(f => atrasoDe(f, hoje) > c.diasCritico);
  const g90 = venc.filter(f => atrasoDe(f, hoje) > c.diasAtencao && atrasoDe(f, hoje) <= c.diasCritico);
  const grupo = (id: string, tipo: string, prioridade: Prioridade, l: FaturaGer[], detalhe: string) => {
    if (!l.length) return;
    out.push({ id, tipo, prioridade, om: nomeOM(l), valor: r2(l.reduce((s, f) => s + f.saldo, 0)), qtd: l.length, dias: Math.max(...l.map(f => atrasoDe(f, hoje))), ultimaMov: ultima(l), detalhe, faturas: l, destino: 'om' });
  };
  grupo('venc365', `Faturas vencidas há mais de ${c.diasCritico} dias`, 'critico', g365, 'Dívida antiga: priorizar a cobrança.');
  grupo('venc90', `Faturas vencidas há mais de ${c.diasAtencao} dias`, 'atencao', g90, `Entre ${c.diasAtencao + 1} e ${c.diasCritico} dias de atraso.`);

  const maior = [...linhas].filter(l => l.vencido > 0).sort((a, b) => b.vencido - a.vencido)[0];
  if (maior) out.push({ id: 'maior', tipo: 'OM com maior valor vencido', prioridade: 'info', om: maior.cliente, valor: maior.vencido, qtd: maior.qtdVencidas, dias: maior.atrasoMedio, ultimaMov: maior.ultimaMov, detalhe: `Atraso médio de ${maior.atrasoMedio} dias.`, faturas: fs.filter(f => vencida(f, hoje) && chaveOM(f) === maior.chave), destino: 'om' });

  linhas.filter(l => l.variacao >= c.crescimentoMinimo && (l.variacaoPct === null || l.variacaoPct >= c.crescimentoPct))
    .sort((a, b) => b.variacao - a.variacao).slice(0, 3).forEach(l => out.push({
      id: `cresc-${l.chave}`, tipo: 'Crescimento expressivo da inadimplência', prioridade: 'atencao', om: l.cliente, valor: l.variacao, qtd: l.qtdVencidas, dias: l.atrasoMedio, ultimaMov: l.ultimaMov,
      detalhe: `Vencido subiu ${l.variacaoPct === null ? 'de zero' : `${l.variacaoPct}%`} em 30 dias.`, faturas: fs.filter(f => vencida(f, hoje) && chaveOM(f) === l.chave), destino: 'om',
    }));

  const ab = e.contest.filter(x => x.aberta);
  const cont = (id: string, tipo: string, prioridade: Prioridade, l: ContestacaoGer[], dias: (x: ContestacaoGer) => number, detalhe: string) => {
    if (!l.length) return;
    out.push({ id, tipo, prioridade, om: l.length > 1 ? `${l[0].cliente} e mais ${new Set(l.map(x => x.cliente)).size - 1} OM`.replace(' e mais 0 OM', '') : l[0].cliente, valor: r2(l.reduce((s, x) => s + x.valor, 0)), qtd: l.length,
      dias: Math.max(...l.map(dias)), ultimaMov: l.map(x => x.ultimoMov).sort().slice(-1)[0] || null, detalhe, contestacoes: l, destino: 'contestacoes' });
  };
  cont('c-prazo', 'Contestações com prazo do setor vencido', 'critico', ab.filter(x => x.prazoVencido), x => x.diasParada, 'O setor medidor não respondeu no prazo.');
  cont('c-longa', `Contestações em tramitação há mais de ${c.diasContestLonga} dias`, 'critico', ab.filter(x => x.diasAberta > c.diasContestLonga), x => x.diasAberta, 'Tramitação muito longa.');
  cont('c-parada', `Contestações sem movimentação há mais de ${c.diasContestParada} dias`, 'atencao', ab.filter(x => x.diasParada > c.diasContestParada), x => x.diasParada, 'Ninguém registrou andamento.');

  if (e.parados.length) out.push({
    id: 'parados', tipo: `ALTCRED/GRU com saldo parado há mais de ${c.diasSaldoParado} dias`, prioridade: 'atencao',
    om: e.parados.length > 1 ? `${e.parados[0].cliente} e mais ${new Set(e.parados.map(p => p.cliente)).size - 1}`.replace(/ e mais 0$/, '') : e.parados[0].cliente,
    valor: r2(e.parados.reduce((s, p) => s + p.valor, 0)), qtd: e.parados.length, dias: Math.max(...e.parados.map(p => p.dias)), ultimaMov: e.parados.map(p => p.ultimo).sort().slice(-1)[0] || null,
    detalhe: 'Dinheiro recebido ainda não atribuído a faturas.', destino: 'parados',
  });

  if (e.cobrancas.length) {
    const cobradas = new Set(e.cobrancas.flatMap(x => x.faturas));
    grupo('sem-cobranca', 'Vencidas há mais de 30 dias sem cobrança registrada', 'atencao', venc.filter(f => atrasoDe(f, hoje) > 30 && !cobradas.has(f.numero)), 'Nenhuma mensagem de cobrança registrada para a fatura.');
  }
  return out.sort((a, b) => ORDEM_PRIO[a.prioridade] - ORDEM_PRIO[b.prioridade] || (b.valor ?? 0) - (a.valor ?? 0));
}

// ------------------------------------------------------------------ atividade por usuário (trilha de auditoria)
export interface LinhaAtividade { usuario: string; tabela: string; acao: string; qtd: number; ultima: string | null }
export interface AtividadeUsuario {
  usuario: string; faturasEmitidas: number; faturasAlteradas: number; baixas: number; documentos: number; contestacoes: number; lotes: number; saidas: number; total: number; ultima: string | null; semUsuario: boolean;
}
export const SEM_USUARIO = 'sem usuário (importação/script)';
export function agregarAtividade(ls: LinhaAtividade[]): AtividadeUsuario[] {
  const m = new Map<string, AtividadeUsuario>();
  ls.forEach(l => {
    const u = m.get(l.usuario) || { usuario: l.usuario, faturasEmitidas: 0, faturasAlteradas: 0, baixas: 0, documentos: 0, contestacoes: 0, lotes: 0, saidas: 0, total: 0, ultima: null, semUsuario: l.usuario === SEM_USUARIO };
    const q = Number(l.qtd) || 0;
    if (l.tabela === 'invoices') l.acao === 'INSERT' ? (u.faturasEmitidas += q) : (u.faturasAlteradas += q);
    else if (l.tabela === 'payment_allocations') u.baixas += l.acao === 'INSERT' ? q : 0;
    else if (l.tabela === 'received_documents') u.documentos += l.acao === 'INSERT' ? q : 0;
    else if (l.tabela === 'contestacoes') u.contestacoes += q;
    else if (l.tabela === 'lotes_faturamento') u.lotes += l.acao === 'INSERT' ? q : 0;
    else if (l.tabela === 'cash_flow_exits') u.saidas += l.acao === 'INSERT' ? q : 0;
    u.total += q;
    if (l.ultima && (!u.ultima || l.ultima > u.ultima)) u.ultima = l.ultima;
    m.set(l.usuario, u);
  });
  // ordem alfabética (não é ranking); "sem usuário" por último
  return [...m.values()].sort((a, b) => Number(a.semUsuario) - Number(b.semUsuario) || a.usuario.localeCompare(b.usuario, 'pt-BR'));
}
