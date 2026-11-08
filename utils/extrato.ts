/**
 * Extrato de conciliação por cliente/comando (Fase 2.5): os 4 quadros enviados às OM —
 * Saldo ALTCRED · Adiantamentos utilizados · Faturas pagas (por data de situação) · Faturas em aberto.
 */
export interface DocExtrato {
  id: string; numero: string; comando: string; cliente: string; data: string; valor: number; saldo: number;
  sobraAdiantamento?: boolean; operacao: string;
}
export interface FaturaExtrato { id: string; numero: string; setor: string; cliente: string; saldo: number; cancelada?: boolean; vencimento?: string; contestada?: boolean }
export interface BaixaExtrato { documentId: string; invoiceId: string; valor: number; adiantamento: boolean }
/** Dados mínimos de QUALQUER fatura (inclusive de outras OM), para mostrar a quem a ALTCRED pagou. */
export interface InfoFatura { numero: string; cliente?: string; cancelada?: boolean }

export interface LinhaUso { data: string; cliente: string; altcred: string; fatura: string; clienteFatura: string; valor: number; outraOM: boolean; outroPagador: boolean }
export interface Extrato {
  saldoAltcred: { comando: string; cliente: string; numero: string; valor: number; saldo: number }[];
  adiantamentos: LinhaUso[];
  pagas: LinhaUso[];
  abertas: { setor: string; cliente: string; fatura: string; vencimento: string; atraso: number; contestada: boolean; saldo: number }[];
  /** A conta da conciliação: recebido − usado (nas faturas da OM e nas de outras OM) = saldo das ALTCRED. */
  resumo: {
    recebido: number; usadoProprias: number; usadoOutras: number; saldoCalculado: number; saldoInformado: number; diferenca: number;
    pagoPorOutros: number;
  };
  totais: { valorAltcred: number; saldoAltcred: number; adiantamentos: number; pagas: number; abertas: number; vencido: number; aVencer: number; contestado: number };
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const soma = <T,>(l: T[], f: (x: T) => number) => r2(l.reduce((s, x) => s + f(x), 0));
const diasEntre = (a: string, b: string) => Math.round((Date.parse(b.slice(0, 10)) - Date.parse(a.slice(0, 10))) / 86400000);

export interface OpcoesExtrato {
  /**
   * Pagamentos e adiantamentos pelas FATURAS do escopo (de qualquer pagador/UG) E pelos usos das ALTCRED do escopo
   * (em qualquer fatura). Ex.: o RT DGMM (UG 40001) paga faturas do Arsenal e o Arsenal paga faturas de clientes
   * extra-MB: as duas coisas aparecem no extrato do Arsenal, com o pagador e o cliente da fatura.
   * `todosDocs` traz os documentos de todos os pagadores (para mostrar número, data e pagador).
   */
  porFaturasDoEscopo?: boolean;
  todosDocs?: DocExtrato[];
  /** data de hoje (AAAA-MM-DD) para o atraso das faturas em aberto */
  hoje?: string;
}

/** Monta os quadros com os documentos e faturas já filtrados para o cliente/comando escolhido. */
export function montarExtrato(docs: DocExtrato[], faturas: FaturaExtrato[], baixas: BaixaExtrato[], todasFaturas?: Map<string, InfoFatura>, opcoes: OpcoesExtrato = {}): Extrato {
  const docPorId = new Map((opcoes.porFaturasDoEscopo && opcoes.todosDocs ? opcoes.todosDocs : docs).map(d => [d.id, d]));
  const faturaPorId = new Map(faturas.map(f => [f.id, f]));
  const info = (id: string): InfoFatura => todasFaturas?.get(id) ?? (faturaPorId.has(id) ? { numero: faturaPorId.get(id)!.numero, cliente: faturaPorId.get(id)!.cliente, cancelada: faturaPorId.get(id)!.cancelada } : { numero: '(fatura excluída)' });
  const faturasEscopo = new Set(faturas.map(f => f.id));
  const docsEscopo = new Set(docs.map(d => d.id));
  // baixa em fatura cancelada não consome a ALTCRED (o valor volta para ela): fica fora dos quadros e da conta
  const valida = (b: BaixaExtrato) => docPorId.has(b.documentId) && !info(b.invoiceId).cancelada;
  const doEscopo = baixas.filter(b => valida(b) && (docsEscopo.has(b.documentId) || (!!opcoes.porFaturasDoEscopo && faturasEscopo.has(b.invoiceId))));

  const saldoAltcred = docs.map(d => ({ comando: d.comando, cliente: d.cliente, numero: d.numero, valor: r2(d.valor), saldo: r2(d.saldo) }))
    .sort((a, b) => a.cliente.localeCompare(b.cliente) || a.numero.localeCompare(b.numero));

  const uso = (b: BaixaExtrato): LinhaUso => {
    const d = docPorId.get(b.documentId)!; const f = info(b.invoiceId);
    return { data: d.data, cliente: d.cliente, altcred: d.numero, fatura: f.numero, clienteFatura: f.cliente || '', valor: r2(b.valor), outraOM: !faturasEscopo.has(b.invoiceId), outroPagador: !docsEscopo.has(b.documentId) };
  };
  const adiantamentos = doEscopo.filter(b => b.adiantamento).map(uso).sort((a, b) => a.altcred.localeCompare(b.altcred) || a.fatura.localeCompare(b.fatura));
  const pagas = doEscopo.filter(b => !b.adiantamento).map(uso);
  // sobra da ALTCRED de pagamento enviada para adiantamento aparece como linha "ADIANTAMENTO"
  docs.filter(d => d.sobraAdiantamento && d.operacao !== 'ADIANTAMENTO').forEach(d => {
    const pago = soma(baixas.filter(b => b.documentId === d.id && !b.adiantamento && valida(b)), b => b.valor);
    const sobra = r2(d.valor - pago);
    if (sobra > 0.005) pagas.push({ data: d.data, cliente: d.cliente, altcred: d.numero, fatura: 'ADIANTAMENTO', clienteFatura: '', valor: sobra, outraOM: false, outroPagador: false });
  });
  pagas.sort((a, b) => a.data.localeCompare(b.data) || a.altcred.localeCompare(b.altcred)
    || Number(a.fatura === 'ADIANTAMENTO') - Number(b.fatura === 'ADIANTAMENTO') || a.fatura.localeCompare(b.fatura));

  const abertas = faturas.filter(f => !f.cancelada && f.saldo > 0.005)
    .map(f => ({ setor: f.setor, cliente: f.cliente, fatura: f.numero, vencimento: f.vencimento || '', contestada: !!f.contestada, saldo: r2(f.saldo),
      atraso: opcoes.hoje && f.vencimento && f.vencimento < opcoes.hoje ? diasEntre(f.vencimento, opcoes.hoje) : 0 }))
    .sort((a, b) => a.setor.localeCompare(b.setor) || a.cliente.localeCompare(b.cliente) || a.fatura.localeCompare(b.fatura));

  // conta da conciliação (só com as ALTCRED do escopo)
  const dosDocs = baixas.filter(b => docsEscopo.has(b.documentId) && valida(b));
  const recebido = soma(docs, d => d.valor);
  const usadoProprias = soma(dosDocs.filter(b => faturasEscopo.has(b.invoiceId)), b => b.valor);
  const usadoOutras = soma(dosDocs.filter(b => !faturasEscopo.has(b.invoiceId)), b => b.valor);
  const saldoCalculado = r2(recebido - usadoProprias - usadoOutras);
  const saldoInformado = soma(docs, d => d.saldo);
  const pagoPorOutros = soma(baixas.filter(b => valida(b) && faturasEscopo.has(b.invoiceId) && !docsEscopo.has(b.documentId)), b => b.valor);

  return {
    saldoAltcred, adiantamentos, pagas, abertas,
    resumo: { recebido, usadoProprias, usadoOutras, saldoCalculado, saldoInformado, diferenca: r2(saldoInformado - saldoCalculado), pagoPorOutros },
    totais: {
      valorAltcred: soma(saldoAltcred, x => x.valor), saldoAltcred: soma(saldoAltcred, x => x.saldo),
      adiantamentos: soma(adiantamentos, x => x.valor), pagas: soma(pagas, x => x.valor), abertas: soma(abertas, x => x.saldo),
      vencido: soma(abertas.filter(x => x.atraso > 0), x => x.saldo), aVencer: soma(abertas.filter(x => x.atraso === 0), x => x.saldo),
      contestado: soma(abertas.filter(x => x.contestada), x => x.saldo),
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
