/**
 * Painel inicial / Painel do Encarregado: resumos por setor, comando ou OM (cliente) e composição da dívida por tipo de fatura.
 * Funções puras sobre FaturaPainel (faturas uma a uma OU linhas já agrupadas pelo banco, com `qtd`).
 */
import { FaturaPainel, emAberto, emContestacao, vencida } from './painel';

export type Dimensao = 'setor' | 'comando' | 'cliente';
export const ROTULO_DIMENSAO: Record<Dimensao, string> = { setor: 'Setor', comando: 'Comando', cliente: 'OM (cliente)' };

const r2 = (n: number) => Math.round(n * 100) / 100;
const nq = (f: FaturaPainel) => f.qtd ?? 1;

export interface LinhaGrupo {
  nome: string; qtd: number;
  /** valor do cartão clicado (saldo ou faturado, conforme a métrica) */
  valor: number; pct: number;
  faturado: number; pago: number; emAberto: number; vencido: number; aVencer: number; contestado: number;
}

/** Resumo de um conjunto de faturas por setor, comando ou OM, ordenado do maior para o menor valor. */
export function resumoPorDimensao(fs: FaturaPainel[], dim: Dimensao, metrica: 'saldo' | 'total', hoje: string): LinhaGrupo[] {
  const m = new Map<string, LinhaGrupo>();
  fs.forEach(f => {
    if (f.cancelada) return;
    const k = f[dim] || '(sem informação)';
    const g = m.get(k) || { nome: k, qtd: 0, valor: 0, pct: 0, faturado: 0, pago: 0, emAberto: 0, vencido: 0, aVencer: 0, contestado: 0 };
    g.qtd += nq(f); g.valor += metrica === 'saldo' ? f.saldo : f.total; g.faturado += f.total; g.pago += f.pago;
    if (emAberto(f)) { g.emAberto += f.saldo; if (vencida(f, hoje)) g.vencido += f.saldo; else g.aVencer += f.saldo; }
    else if (emContestacao(f)) g.contestado += f.saldo;
    m.set(k, g);
  });
  const lista = [...m.values()].map(g => ({ ...g, valor: r2(g.valor), faturado: r2(g.faturado), pago: r2(g.pago), emAberto: r2(g.emAberto), vencido: r2(g.vencido), aVencer: r2(g.aVencer), contestado: r2(g.contestado) }));
  const soma = lista.reduce((s, g) => s + g.valor, 0);
  return lista.map(g => ({ ...g, pct: soma ? Math.round((g.valor / soma) * 1000) / 10 : 0 })).sort((a, b) => b.valor - a.valor || a.nome.localeCompare(b.nome));
}

export interface LinhaFaturadoDivida { nome: string; faturado: number; divida: number; vencido: number; contestado: number; pctDivida: number; qtd: number }

/** Faturado × dívida (em aberto, sem contestadas) por setor, comando ou OM. `ano` = competência considerada; null = todos os anos. */
export function faturadoXDivida(fs: FaturaPainel[], dim: Dimensao, ano: number | null, hoje: string): LinhaFaturadoDivida[] {
  const m = new Map<string, LinhaFaturadoDivida>();
  fs.forEach(f => {
    if (f.cancelada || (ano !== null && f.ano !== ano)) return;
    const k = f[dim] || '(sem informação)';
    const g = m.get(k) || { nome: k, faturado: 0, divida: 0, vencido: 0, contestado: 0, pctDivida: 0, qtd: 0 };
    g.faturado += f.total; g.qtd += nq(f);
    if (emAberto(f)) { g.divida += f.saldo; if (vencida(f, hoje)) g.vencido += f.saldo; }
    else if (emContestacao(f)) g.contestado += f.saldo;
    m.set(k, g);
  });
  return [...m.values()]
    .map(g => ({ ...g, faturado: r2(g.faturado), divida: r2(g.divida), vencido: r2(g.vencido), contestado: r2(g.contestado), pctDivida: g.faturado ? Math.round((g.divida / g.faturado) * 1000) / 10 : 0 }))
    .sort((a, b) => b.divida - a.divida || b.faturado - a.faturado || a.nome.localeCompare(b.nome));
}

export interface LinhaTipo { tipo: string; vencido: number; aVencer: number; contestado: number; total: number; pct: number; qtd: number }

/** De que tipos de fatura é feita a dívida em aberto (opcionalmente só de um setor, comando ou OM). Contestadas ficam fora do total e vêm à parte. */
export function composicaoPorTipo(fs: FaturaPainel[], hoje: string, dim?: Dimensao, nome?: string, ano: number | null = null): LinhaTipo[] {
  const m = new Map<string, LinhaTipo>();
  fs.forEach(f => {
    if (f.cancelada || (dim && nome !== undefined && (f[dim] || '(sem informação)') !== nome) || (ano !== null && f.ano !== ano)) return;
    if (!emAberto(f) && !emContestacao(f)) return;
    const g = m.get(f.tipo) || { tipo: f.tipo, vencido: 0, aVencer: 0, contestado: 0, total: 0, pct: 0, qtd: 0 };
    // a dívida (total) é só o que está em aberto; o que está em contestação aparece à parte
    if (emContestacao(f)) g.contestado += f.saldo; else { if (vencida(f, hoje)) g.vencido += f.saldo; else g.aVencer += f.saldo; g.total += f.saldo; g.qtd += nq(f); }
    m.set(f.tipo, g);
  });
  const lista = [...m.values()].map(g => ({ ...g, vencido: r2(g.vencido), aVencer: r2(g.aVencer), contestado: r2(g.contestado), total: r2(g.total) }));
  const soma = lista.reduce((s, g) => s + g.total, 0);
  return lista.map(g => ({ ...g, pct: soma ? Math.round((g.total / soma) * 1000) / 10 : 0 })).sort((a, b) => b.total - a.total || b.contestado - a.contestado);
}
