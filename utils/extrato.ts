/**
 * Extrato de conciliação por cliente/comando (Fase 2.5): os 4 quadros enviados às OM —
 * Saldo ALTCRED · Adiantamentos utilizados · Faturas pagas (por data de situação) · Faturas em aberto.
 */
export interface DocExtrato {
  id: string; numero: string; comando: string; cliente: string; data: string; valor: number; saldo: number;
  sobraAdiantamento?: boolean; operacao: string;
}
export interface FaturaExtrato { id: string; numero: string; setor: string; cliente: string; saldo: number; cancelada?: boolean }
export interface BaixaExtrato { documentId: string; invoiceId: string; valor: number; adiantamento: boolean }

export interface Extrato {
  saldoAltcred: { comando: string; cliente: string; numero: string; valor: number; saldo: number }[];
  adiantamentos: { cliente: string; altcred: string; fatura: string; valor: number }[];
  pagas: { data: string; cliente: string; altcred: string; fatura: string; valor: number }[];
  abertas: { setor: string; cliente: string; fatura: string; saldo: number }[];
  totais: { valorAltcred: number; saldoAltcred: number; adiantamentos: number; pagas: number; abertas: number };
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const soma = <T,>(l: T[], f: (x: T) => number) => r2(l.reduce((s, x) => s + f(x), 0));

/** Monta os quadros com os documentos e faturas já filtrados para o cliente/comando escolhido. */
export function montarExtrato(docs: DocExtrato[], faturas: FaturaExtrato[], baixas: BaixaExtrato[], todasFaturas?: Map<string, { numero: string }>): Extrato {
  const docPorId = new Map(docs.map(d => [d.id, d]));
  const numFatura = (id: string) => todasFaturas?.get(id)?.numero ?? faturas.find(f => f.id === id)?.numero ?? '(fatura excluída)';
  const doEscopo = baixas.filter(b => docPorId.has(b.documentId));

  const saldoAltcred = docs.map(d => ({ comando: d.comando, cliente: d.cliente, numero: d.numero, valor: r2(d.valor), saldo: r2(d.saldo) }))
    .sort((a, b) => a.cliente.localeCompare(b.cliente) || a.numero.localeCompare(b.numero));

  const adiantamentos = doEscopo.filter(b => b.adiantamento).map(b => {
    const d = docPorId.get(b.documentId)!;
    return { cliente: d.cliente, altcred: d.numero, fatura: numFatura(b.invoiceId), valor: r2(b.valor) };
  }).sort((a, b) => a.altcred.localeCompare(b.altcred) || a.fatura.localeCompare(b.fatura));

  const pagas = doEscopo.filter(b => !b.adiantamento).map(b => {
    const d = docPorId.get(b.documentId)!;
    return { data: d.data, cliente: d.cliente, altcred: d.numero, fatura: numFatura(b.invoiceId), valor: r2(b.valor) };
  });
  // sobra da ALTCRED de pagamento enviada para adiantamento aparece como linha "ADIANTAMENTO"
  docs.filter(d => d.sobraAdiantamento && d.operacao !== 'ADIANTAMENTO').forEach(d => {
    const pago = soma(doEscopo.filter(b => b.documentId === d.id && !b.adiantamento), b => b.valor);
    const sobra = r2(d.valor - pago);
    if (sobra > 0.005) pagas.push({ data: d.data, cliente: d.cliente, altcred: d.numero, fatura: 'ADIANTAMENTO', valor: sobra });
  });
  pagas.sort((a, b) => a.data.localeCompare(b.data) || a.altcred.localeCompare(b.altcred)
    || Number(a.fatura === 'ADIANTAMENTO') - Number(b.fatura === 'ADIANTAMENTO') || a.fatura.localeCompare(b.fatura));

  const abertas = faturas.filter(f => !f.cancelada && f.saldo > 0.005)
    .map(f => ({ setor: f.setor, cliente: f.cliente, fatura: f.numero, saldo: r2(f.saldo) }))
    .sort((a, b) => a.setor.localeCompare(b.setor) || a.cliente.localeCompare(b.cliente) || a.fatura.localeCompare(b.fatura));

  return {
    saldoAltcred, adiantamentos, pagas, abertas,
    totais: {
      valorAltcred: soma(saldoAltcred, x => x.valor), saldoAltcred: soma(saldoAltcred, x => x.saldo),
      adiantamentos: soma(adiantamentos, x => x.valor), pagas: soma(pagas, x => x.valor), abertas: soma(abertas, x => x.saldo),
    },
  };
}

/** Linhas com subtotal ao mudar a chave (como nas tabelas dinâmicas da planilha). */
export function comSubtotais<T extends Record<string, any>>(linhas: T[], chave: keyof T, campoValor: keyof T, rotulo: (k: string) => string) {
  const out: (T & { _subtotal?: boolean })[] = [];
  let atual: string | null = null, acc = 0;
  const fechar = () => { if (atual !== null) out.push({ ...({} as T), [chave]: rotulo(atual), [campoValor]: r2(acc), _subtotal: true }); };
  linhas.forEach(l => {
    const k = String(l[chave]);
    if (k !== atual) { fechar(); atual = k; acc = 0; }
    out.push(l); acc += Number(l[campoValor]) || 0;
  });
  fechar();
  return out;
}
