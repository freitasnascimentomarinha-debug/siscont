/**
 * Crédito da OM (livro de créditos, script 033). Funções puras.
 *
 * O crédito pertence à OM: o crédito gerado pelo acerto de um serviço pode abater a fatura de QUALQUER serviço da mesma OM.
 * O livro só recebe linhas novas (nunca altera nem apaga): entrada de acerto, saldo de abertura, utilização numa fatura (linha 04),
 * devolução (ALTCRED/GRU) e estorno. Toda saída aponta para o crédito de origem; a utilização segue a ordem FIFO (o mais antigo primeiro).
 * O saldo do crédito de origem = valor da entrada + tudo o que aponta para ela (saídas negativas, estornos positivos).
 */
import type { ItemLote } from './faturamento';

const r2 = (n: number) => Math.round(n * 100) / 100;
export type TipoMovCredito = 'ENTRADA_ACERTO' | 'ABERTURA' | 'UTILIZACAO' | 'DEVOLUCAO' | 'ESTORNO';

export interface MovCredito {
  id: string; omId: string; data: string; tipo: TipoMovCredito; valor: number;
  servicoOrigem?: string | null; exercicioOrigem?: number | null; origemNumero?: string | null; origemChave?: string | null;
  destinoNumero?: string | null; destinoId?: string | null; creditoRef?: string | null; estornoDe?: string | null;
  documento?: string | null; observacao?: string | null; loteId?: string | null;
  saldoAnterior?: number | null; saldoPosterior?: number | null; criadoPorNome?: string | null; criadoEm?: string | null;
}
export const ROTULO_MOV: Record<TipoMovCredito, string> = {
  ENTRADA_ACERTO: 'Crédito de acerto', ABERTURA: 'Saldo de abertura', UTILIZACAO: 'Utilizado em fatura', DEVOLUCAO: 'Devolvido (ALTCRED/GRU)', ESTORNO: 'Estorno',
};
export const ehEntrada = (m: Pick<MovCredito, 'tipo'>) => m.tipo === 'ENTRADA_ACERTO' || m.tipo === 'ABERTURA';

/** Número sem a versão final ("-0", "-1"): a retificação mantém o mesmo crédito. */
export const chaveAcerto = (numero: string) => String(numero || '').replace(/-\d$/, '');

const ordem = (a: MovCredito, b: MovCredito) => a.data.localeCompare(b.data) || String(a.criadoEm || '').localeCompare(String(b.criadoEm || '')) || a.id.localeCompare(b.id);

export interface CreditoAberto {
  id: string; omId: string; tipo: 'ENTRADA_ACERTO' | 'ABERTURA'; /** texto que identifica a origem na fatura ("90401-AE-01-2026-001-0" ou "ABERTURA G424...") */ numero: string;
  servico: string; exercicio: number | null; data: string; valor: number; saldo: number;
}

/** Créditos de cada OM com o que ainda resta, do mais antigo para o mais novo (ordem FIFO). Só os com saldo, a menos que `todos`. */
export function creditosDaOm(movs: MovCredito[], omId?: string, todos = false): CreditoAberto[] {
  const restante = new Map<string, number>();
  movs.forEach(m => { if (m.creditoRef) restante.set(m.creditoRef, r2((restante.get(m.creditoRef) || 0) + m.valor)); });
  return movs.filter(m => ehEntrada(m) && (!omId || m.omId === omId)).sort(ordem).map(m => ({
    id: m.id, omId: m.omId, tipo: m.tipo as 'ENTRADA_ACERTO' | 'ABERTURA',
    numero: m.tipo === 'ENTRADA_ACERTO' ? (m.origemNumero || m.origemChave || '') : `ABERTURA${m.documento ? ` ${m.documento}` : ''}`,
    servico: (m.servicoOrigem || '').toUpperCase(), exercicio: m.exercicioOrigem ?? null, data: m.data, valor: r2(m.valor), saldo: Math.max(0, r2(m.valor + (restante.get(m.id) || 0))),
  })).filter(c => todos || c.saldo > 0.005);
}

/** Saldo de crédito de cada OM (soma de todo o livro). */
export function saldoPorOm(movs: MovCredito[]): Map<string, number> {
  const m = new Map<string, number>();
  movs.forEach(x => m.set(x.omId, r2((m.get(x.omId) || 0) + x.valor)));
  return m;
}
export const saldoDaOm = (movs: MovCredito[], omId: string) => saldoPorOm(movs).get(omId) || 0;

export interface PedacoCredito { entradaId: string; numero: string; valor: number }
/** Quanto sai de cada crédito (FIFO) para cobrir `valor`; sem saldo suficiente devolve só o que há. */
export function planejarUso(abertos: CreditoAberto[], valor: number): PedacoCredito[] {
  let resta = r2(valor); const out: PedacoCredito[] = [];
  for (const c of abertos) {
    if (resta <= 0.004) break;
    if (c.saldo <= 0.004) continue;
    const v = r2(Math.min(c.saldo, resta));
    out.push({ entradaId: c.id, numero: c.numero, valor: v }); resta = r2(resta - v);
  }
  return out;
}

/**
 * Abate o crédito da OM nas faturas do lote (qualquer serviço da OM; crédito mais antigo primeiro), pela linha 04 (débito).
 * Só mexe em fatura com valor a pagar; não se aplica a estimativa nem a acerto. O que sobrar continua com a OM.
 */
export function aplicarCreditosOm(itens: ItemLote[], abertos: CreditoAberto[]): ItemLote[] {
  const saldo = new Map(abertos.map(c => [c.id, c.saldo]));
  const ordenados = [...abertos].sort((a, b) => a.data.localeCompare(b.data) || a.id.localeCompare(b.id));
  return itens.map(i => {
    const limpo = { ...i, creditos: [] as NonNullable<ItemLote['creditos']> };
    if (i.estimado || i.acertoDe) return limpo;
    let resta = r2(i.valor + i.acrescimo - i.debito);
    if (resta <= 0) return limpo;
    ordenados.forEach(c => {
      if (resta <= 0 || c.omId !== i.omId) return;
      const s = saldo.get(c.id) || 0;
      if (s <= 0) return;
      const v = r2(Math.min(s, resta));
      limpo.creditos.push({ chave: c.id, numero: c.numero, valor: v });
      saldo.set(c.id, r2(s - v)); resta = r2(resta - v);
    });
    const usado = r2(limpo.creditos.reduce((s, x) => s + x.valor, 0));
    return usado ? { ...limpo, debito: r2(i.debito + usado), base: { ...i.base, creditos: limpo.creditos, creditoCompensado: usado } } : limpo;
  });
}

export interface LinhaExtrato extends MovCredito { saldoApos: number }
/** Extrato de uma OM, em ordem, com o saldo depois de cada movimento (recalculado do livro). */
export function extratoDaOm(movs: MovCredito[], omId: string): LinhaExtrato[] {
  let s = 0;
  return movs.filter(m => m.omId === omId).sort(ordem).map(m => { s = r2(s + m.valor); return { ...m, saldoApos: s }; });
}

/** Movimentos que ainda podem ser estornados à mão (devolução e saldo de abertura que não foram estornados). */
export function estornaveisManuais(movs: MovCredito[], omId: string): MovCredito[] {
  const jaEstornados = new Set(movs.filter(m => m.tipo === 'ESTORNO').map(m => m.estornoDe));
  return movs.filter(m => m.omId === omId && (m.tipo === 'DEVOLUCAO' || m.tipo === 'ABERTURA') && !jaEstornados.has(m.id));
}

export const resumoCreditosOm = (movs: MovCredito[]) => {
  const abertos = creditosDaOm(movs);
  const saldo = [...saldoPorOm(movs).values()].reduce((s, v) => s + v, 0);
  const soma = (f: (m: MovCredito) => boolean) => r2(movs.filter(f).reduce((s, m) => s + m.valor, 0));
  return {
    saldo: r2(saldo), oms: new Set(abertos.map(c => c.omId)).size, abertos: abertos.length,
    entradas: soma(m => ehEntrada(m)), utilizado: r2(-soma(m => m.tipo === 'UTILIZACAO')), devolvido: r2(-soma(m => m.tipo === 'DEVOLUCAO')),
  };
};
