import { Invoice, PaymentAllocation, ReceivedDocument, ServicoCatalogo } from '../types';
import { db } from './db';
import { cadastroService } from './cadastroService';
import { ehAdiantamento } from '../utils/baixas';
import { lerFatura } from '../utils/cadastroImport';
import { DadosFr172, pdfFr172, zipFr172 } from '../utils/fr172';

export interface ContextoFr172 { servicos: ServicoCatalogo[]; params: Record<string, string>; docs: Map<string, ReceivedDocument>; baixas: Map<string, PaymentAllocation[]> }

export async function carregarContextoFr172(): Promise<ContextoFr172> {
  const [servicos, parametros, docs, baixas] = await Promise.all([
    cadastroService.listServicos().catch(() => [] as ServicoCatalogo[]), cadastroService.listParametros().catch(() => []),
    db.getDocuments(), db.getAllocations(),
  ]);
  const porFatura = new Map<string, PaymentAllocation[]>();
  baixas.forEach(b => { const l = porFatura.get(b.invoiceId); if (l) l.push(b); else porFatura.set(b.invoiceId, [b]); });
  return { servicos, params: Object.fromEntries(parametros.map(p => [p.chave, p.valor])), docs: new Map(docs.map(d => [d.id, d])), baixas: porFatura };
}

export function dadosFr172(inv: Invoice, ctx: ContextoFr172): DadosFr172 {
  const sigla = (inv.serviceAcronym || lerFatura(inv.invoiceNumber)?.sigla || '').toUpperCase();
  const sv = ctx.servicos.find(s => s.acronym.toUpperCase() === sigla);
  const bx = ctx.baixas.get(inv.id) || [];
  const adiant = bx.filter(b => ehAdiantamento(b, ctx.docs.get(b.documentId)));
  const comimsup = (inv.command || '').replace(/^\d{4,5}\s*-\s*/, '').trim();
  return {
    numero: inv.invoiceNumber, emissao: inv.issueDate, limite: inv.dataLimiteCertificacao || inv.dueDate, vencimento: inv.dueDate, mesCompetencia: inv.monthCompetence, anoCompetencia: inv.yearCompetence,
    omUsuaria: inv.client, comimsup: comimsup && comimsup.toLowerCase() !== inv.client.toLowerCase() && !/extra/i.test(comimsup) ? comimsup : null, sigla,
    servicoOficial: sv?.nomeOficial || sv?.name || inv.type, emitidaDeAcordoCom: sv?.emitidaDeAcordoCom, setorResponsavel: sv?.setorResponsavel, telefoneSetor: sv?.telefoneSetor,
    valorServico: inv.value, adiantamento: Math.round(adiant.reduce((s, b) => s + b.amount, 0) * 100) / 100,
    acrescimo: inv.adjustmentAddition || 0, debito: inv.adjustmentDeduction || 0, consumo: inv.consumption, unidade: inv.unitMeasure,
    base: (inv.baseCalculo as any) ?? null, altcreds: [...new Set(adiant.map(b => ctx.docs.get(b.documentId)?.documentNumber).filter(Boolean) as string[])],
    pagamentos: bx.filter(b => !ehAdiantamento(b, ctx.docs.get(b.documentId)))
      .map(b => { const doc = ctx.docs.get(b.documentId); return { data: doc?.date || b.date, documento: doc?.documentNumber || '(documento)', tipo: String(doc?.documentType || 'ALTCRED'), valor: Math.round(b.amount * 100) / 100 }; }).sort((a, b) => a.data.localeCompare(b.data)),
    quitadaEm: inv.quitadaEm, quitacaoExterna: inv.quitacaoExterna,
    substitui: inv.substitui, acertoDe: inv.acertoDe, estimado: inv.estimado, observacao: inv.observation, params: ctx.params,
  };
}

export async function baixarPdfFr172(inv: Invoice, ctx?: ContextoFr172) {
  const c = ctx ?? await carregarContextoFr172();
  pdfFr172(dadosFr172(inv, c)).save(`${inv.invoiceNumber}.pdf`);
}

/** `unico`: um ZIP só, sem pastas (usado no OND). Sem isso: pastas por comando. Sempre em ordem de tipo e numeração. */
export async function baixarZipFr172(invs: Invoice[], nome: string, ctx?: ContextoFr172, opcoes: { unico?: boolean } = {}) {
  const c = ctx ?? await carregarContextoFr172();
  const blob = await zipFr172(invs.map(i => ({ ...dadosFr172(i, c), pasta: i.command || 'Sem comando' })), opcoes);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `${nome}.zip`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
