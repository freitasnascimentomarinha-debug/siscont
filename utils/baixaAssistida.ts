/**
 * Baixa assistida (Fase 2.3): propõe como usar o saldo de uma ALTCRED/GRU nas faturas do cliente.
 *
 * Ordem: 1) faturas citadas na destinação ou na observação do solicitante; 2) faturas das OM indicadas na
 * destinação; 3) sem destinação, faturas das OM do comando pagador (ou da mesma UG). Dentro de cada grupo,
 * as mais antigas primeiro (vencimento, depois número). Nunca passa do saldo da ALTCRED nem do saldo da
 * fatura. A sobra pode ser enviada para adiantamento.
 */
import type { Destinacao } from '../types';

export interface FaturaCandidata {
  id: string; numero: string; omId?: string | null; ug: string; cliente: string; comandoId?: string | null;
  vencimento: string; saldo: number; contestada?: boolean; tipo?: string;
}
export interface DocParaBaixa {
  saldo: number; ug?: string; ugClienteCodigo?: string | null; comandoId?: string | null;
  destinacao?: Destinacao[]; faturasCitadas?: string[];
}
export interface ItemProposta {
  faturaId: string; numero: string; cliente: string; vencimento: string; saldoFatura: number;
  valor: number; grupo: 'CITADA' | 'OM_DESTINADA' | 'COMANDO'; foraDestinacao: boolean; contestada: boolean;
  /** número que o cliente citou na ALTCRED quando só a sequência da fatura diverge (ex.: citou -008-0 e a fatura é -010-0) */
  citadaComo?: string;
}
export interface Proposta { itens: ItemProposta[]; usado: number; sobra: number; temDestinacao: boolean }

const r2 = (n: number) => Math.round(n * 100) / 100;
const norm = (s: string) => (s || '').trim().toUpperCase();

export function proporBaixa(doc: DocParaBaixa, faturas: FaturaCandidata[], opcoes: { incluirContestadas?: boolean } = {}): Proposta {
  const dest = doc.destinacao || [];
  const citadas = new Set([...dest.filter(d => d.tipo === 'FATURA').map(d => norm(d.valor)), ...(doc.faturasCitadas || []).map(norm)]);
  const omsDest = new Set(dest.filter(d => d.tipo === 'OM').map(d => d.valor));
  const temDestinacao = citadas.size > 0 || omsDest.size > 0;
  const ugs = new Set([doc.ug, doc.ugClienteCodigo].filter(Boolean) as string[]);

  const abertas = faturas.filter(f => f.saldo > 0.005 && (opcoes.incluirContestadas || !f.contestada));
  // OM costuma citar a fatura com a sequência errada (ex.: TC com a sequência da fatura de água): sem o número exato entre as
  // faturas em aberto, vale a do mesmo cliente, serviço e mês (UG-SERVIÇO-MM-AAAA), se for uma só
  const semVersao = (n: string) => norm(n).replace(/-\d{3}-\d$/, '');
  const exatas = new Set(faturas.map(f => norm(f.numero)));
  const aproximadas = new Map<string, string>();   // prefixo → número citado
  citadas.forEach(c => { if (!exatas.has(c) && /-\d{3}-\d$/.test(c)) aproximadas.set(semVersao(c), c); });
  const unicaPorPrefixo = new Map<string, number>();
  abertas.forEach(f => { const k = semVersao(f.numero); if (aproximadas.has(k)) unicaPorPrefixo.set(k, (unicaPorPrefixo.get(k) || 0) + 1); });
  const citadaComo = (f: FaturaCandidata) => { const k = semVersao(f.numero); return !citadas.has(norm(f.numero)) && unicaPorPrefixo.get(k) === 1 ? aproximadas.get(k) : undefined; };
  const grupo = (f: FaturaCandidata): ItemProposta['grupo'] | null => {
    if (citadas.has(norm(f.numero)) || citadaComo(f)) return 'CITADA';
    if (f.omId && omsDest.has(f.omId)) return 'OM_DESTINADA';
    if ((doc.comandoId && f.comandoId === doc.comandoId) || ugs.has(f.ug)) return 'COMANDO';
    return null;
  };
  const peso = { CITADA: 0, OM_DESTINADA: 1, COMANDO: 2 };
  const cand = abertas
    .map(f => ({ f, g: grupo(f) }))
    .filter(x => x.g) as { f: FaturaCandidata; g: ItemProposta['grupo'] }[];
  cand.sort((a, b) => peso[a.g] - peso[b.g] || a.f.vencimento.localeCompare(b.f.vencimento) || a.f.numero.localeCompare(b.f.numero));

  let resta = r2(doc.saldo);
  const itens = cand.map(({ f, g }) => {
    const foraDestinacao = temDestinacao && g === 'COMANDO';
    // com destinação, só sugere valor nas faturas destinadas; as demais aparecem zeradas para o usuário decidir
    const valor = foraDestinacao ? 0 : r2(Math.max(0, Math.min(resta, f.saldo)));
    resta = r2(resta - valor);
    return { faturaId: f.id, numero: f.numero, cliente: f.cliente, vencimento: f.vencimento, saldoFatura: r2(f.saldo), valor, grupo: g, foraDestinacao, contestada: !!f.contestada, ...(citadaComo(f) ? { citadaComo: citadaComo(f) } : {}) };
  });
  const usado = r2(itens.reduce((s, i) => s + i.valor, 0));
  return { itens, usado, sobra: r2(doc.saldo - usado), temDestinacao };
}

/** Confere os valores editados pelo usuário antes de gravar. */
export function validarBaixa(itens: Pick<ItemProposta, 'numero' | 'valor' | 'saldoFatura'>[], saldoDoc: number): string[] {
  const erros: string[] = [];
  itens.forEach(i => {
    if (i.valor < 0) erros.push(`${i.numero}: valor negativo.`);
    if (i.valor > i.saldoFatura + 0.005) erros.push(`${i.numero}: R$ ${i.valor.toFixed(2)} passa do saldo da fatura (R$ ${i.saldoFatura.toFixed(2)}).`);
  });
  const total = r2(itens.reduce((s, i) => s + (i.valor > 0 ? i.valor : 0), 0));
  if (total > saldoDoc + 0.005) erros.push(`Total de R$ ${total.toFixed(2)} passa do saldo do documento (R$ ${saldoDoc.toFixed(2)}).`);
  return erros;
}
