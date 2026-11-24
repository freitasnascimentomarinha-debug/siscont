import { v4 as uuidv4 } from 'uuid';
import { citarCorrecao } from '../utils/normas';
import { supabase } from './supabase';
import { db } from './db';
import { Invoice, PaymentAllocation, ReceivedDocument } from '../types';
import { AnexoContestacao, Contestacao, Decisao, calcularCorrecao, evento, proximaVersao, Correcao } from '../utils/fase4';
import { ehAdiantamento } from '../utils/baixas';
import { ContextoFaturamento, emitirLote } from './faturamentoService';
import { ItemLote, OMFat, numerar } from '../utils/faturamento';
import { lerFatura } from '../utils/cadastroImport';
import { estornarPorCancelamentoDeFatura } from './creditosOmService';

export class Fase4NaoInstaladaError extends Error {
  constructor() { super('Falta executar o script supabase/migrations/008_contestacao_fase4.sql no Supabase.'); }
}
const checar = (error: any) => {
  if (!error) return;
  if (/contestacoes|taxas_poupanca|cancelamento_motivo|substituida_por|cancelada_em|CORRECAO/.test(error.message || '')) throw new Fase4NaoInstaladaError();
  throw new Error(error.message);
};
const hoje = () => new Date().toISOString().slice(0, 10);

// ------------------------------------------------------------------ contestações
const deLinha = (r: any): Contestacao => ({
  id: r.id, invoiceId: r.invoice_id, numeroFatura: r.numero_fatura, abertaEm: r.aberta_em, origem: r.origem, justificativa: r.justificativa,
  setorMedidor: r.setor_medidor, encaminhadaEm: r.encaminhada_em, prazo: r.prazo, resposta: r.resposta, respondidaEm: r.respondida_em,
  decisao: r.decisao, decididaEm: r.decidida_em, novaFatura: r.nova_fatura, status: r.status, anexos: r.anexos || [], historico: r.historico || [], abertaPor: r.aberta_por,
});
const paraLinha = (c: Contestacao) => ({
  id: c.id, invoice_id: c.invoiceId, numero_fatura: c.numeroFatura, aberta_em: c.abertaEm, origem: c.origem, justificativa: c.justificativa,
  setor_medidor: c.setorMedidor ?? null, encaminhada_em: c.encaminhadaEm ?? null, prazo: c.prazo ?? null, resposta: c.resposta ?? null,
  respondida_em: c.respondidaEm ?? null, decisao: c.decisao ?? null, decidida_em: c.decididaEm ?? null, nova_fatura: c.novaFatura ?? null,
  status: c.status, anexos: c.anexos, historico: c.historico, aberta_por: c.abertaPor ?? null,
});

export async function listarContestacoes(): Promise<Contestacao[]> {
  const out: Contestacao[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await supabase.from('contestacoes').select('*').order('id').range(de, de + 999);
    checar(error);
    out.push(...(data || []).map(deLinha));
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function gravar(c: Contestacao) {
  const { error } = await supabase.from('contestacoes').upsert(paraLinha(c));
  checar(error);
}

async function marcarContestada(invoiceId: string, valor: boolean) {
  const { error } = await supabase.from('invoices').update({ contestada: valor }).eq('id', invoiceId);
  checar(error);
  db.invalidateCache();
}

const BUCKET_CONTESTACAO = 'anexos-contestacao';
const nomeSeguro = (n: string) => n.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w.-]+/g, '_').slice(-120);
export const LIMITE_ANEXO_MB = 20;
class Falta042Error extends Error { constructor() { super('Falta executar o script supabase/migrations/042_anexos_contestacao.sql no Supabase para guardar arquivos.'); } }
/** Envia os arquivos ao armazenamento privado e devolve os anexos a gravar na contestação. */
export async function enviarArquivos(contestacaoId: string, arquivos: File[]): Promise<AnexoContestacao[]> {
  const out: AnexoContestacao[] = [];
  for (const a of arquivos) {
    if (a.size > LIMITE_ANEXO_MB * 1024 * 1024) throw new Error(`"${a.name}" passa de ${LIMITE_ANEXO_MB} MB.`);
    const caminho = `${contestacaoId}/${uuidv4()}-${nomeSeguro(a.name)}`;
    const up = await supabase.storage.from(BUCKET_CONTESTACAO).upload(caminho, a, { contentType: a.type || undefined, upsert: false });
    if (up.error) { if (/bucket|not found/i.test(up.error.message || '')) throw new Falta042Error(); throw new Error(up.error.message); }
    out.push({ nome: a.name, caminho, tamanho: a.size, tipo: a.type || undefined });
  }
  return out;
}
/** Anexa arquivos (com nota opcional) a uma contestação, aberta ou encerrada. */
export async function anexarArquivos(c: Contestacao, arquivos: File[], usuario: string, texto?: string) {
  const enviados = await enviarArquivos(c.id, arquivos);
  await gravar({ ...c, anexos: [...c.anexos, ...enviados], historico: [...c.historico, ...enviados.map((a, i) => evento(usuario, 'ANEXO', `${a.nome}${i === 0 && texto ? `. ${texto}` : ''}`))] });
}
/** Uma consulta só: faturas que têm arquivos anexados em alguma contestação (aberta ou encerrada). */
export async function faturasComArquivos(): Promise<Map<string, AnexoContestacao[]>> {
  const m = new Map<string, AnexoContestacao[]>();
  const { data, error } = await supabase.from('contestacoes').select('invoice_id, anexos');
  if (error) return m; // script 008 ainda não executado: sem contestações
  (data || []).forEach((l: any) => {
    const com = ((l.anexos || []) as AnexoContestacao[]).filter(x => x.caminho);
    if (com.length) m.set(l.invoice_id, [...(m.get(l.invoice_id) || []), ...com]);
  });
  return m;
}
/** Baixa os arquivos (para juntar ao PDF da fatura na impressão). */
export async function baixarArquivos(anexos: AnexoContestacao[]): Promise<{ nome: string; tipo?: string; bytes: ArrayBuffer }[]> {
  const out: { nome: string; tipo?: string; bytes: ArrayBuffer }[] = [];
  for (const a of anexos) {
    const r = await supabase.storage.from(BUCKET_CONTESTACAO).download(a.caminho!);
    if (r.error || !r.data) throw new Error(`Não foi possível baixar o anexo "${a.nome}" da contestação.`);
    out.push({ nome: a.nome, tipo: a.tipo, bytes: await r.data.arrayBuffer() });
  }
  return out;
}
// ------------------------------------------------------------------ arquivos anexados direto à fatura (script 043)
const checar043 = (error: any) => {
  if (!error) return;
  if (/anexos/.test(error.message || '')) throw new Error('Falta executar o script supabase/migrations/043_anexos_fatura.sql no Supabase.');
  throw new Error(error.message);
};
export async function anexarArquivosFatura(inv: Invoice, arquivos: File[]) {
  const enviados = await enviarArquivos(`fatura-${inv.id}`, arquivos);
  const { error } = await supabase.from('invoices').update({ anexos: [...(inv.anexos || []), ...enviados] }).eq('id', inv.id);
  if (error) { await supabase.storage.from(BUCKET_CONTESTACAO).remove(enviados.map(a => a.caminho!)); checar043(error); }
  db.invalidateCache();
}
export async function removerAnexoFatura(inv: Invoice, a: AnexoContestacao) {
  const { error } = await supabase.from('invoices').update({ anexos: (inv.anexos || []).filter(x => x.caminho !== a.caminho) }).eq('id', inv.id);
  checar043(error);
  if (a.caminho) await supabase.storage.from(BUCKET_CONTESTACAO).remove([a.caminho]);
  db.invalidateCache();
}
export async function linkAnexoContestacao(caminho: string) {
  const { data, error } = await supabase.storage.from(BUCKET_CONTESTACAO).createSignedUrl(caminho, 300);
  if (error) throw new Error(error.message);
  return data!.signedUrl;
}

export async function abrirContestacao(inv: Invoice, d: { origem: string; justificativa: string; abertaEm: string; anexos?: AnexoContestacao[]; arquivos?: File[] }, usuario: string) {
  if (!d.justificativa.trim()) throw new Error('Informe a justificativa da OM.');
  const id = uuidv4();
  const enviados = await enviarArquivos(id, d.arquivos || []);
  const c: Contestacao = {
    id, invoiceId: inv.id, numeroFatura: inv.invoiceNumber, abertaEm: d.abertaEm, origem: d.origem, justificativa: d.justificativa.trim(),
    status: 'ABERTA', anexos: [...(d.anexos || []), ...enviados], abertaPor: usuario, historico: [evento(usuario, 'ABERTA', `Origem: ${d.origem}. ${d.justificativa.trim()}`, d.abertaEm)],
  };
  await gravar(c);
  await marcarContestada(inv.id, true);
  return c;
}

export async function encaminhar(c: Contestacao, setor: string, prazo: string, usuario: string, texto?: string) {
  await gravar({ ...c, status: 'ENCAMINHADA', setorMedidor: setor, encaminhadaEm: hoje(), prazo, historico: [...c.historico, evento(usuario, 'ENCAMINHADA', `Ao ${setor}, prazo ${prazo.split('-').reverse().join('/')}.${texto ? ' ' + texto : ''}`)] });
}
export async function responder(c: Contestacao, resposta: string, data: string, usuario: string) {
  if (!resposta.trim()) throw new Error('Informe a resposta do setor.');
  await gravar({ ...c, status: 'RESPONDIDA', resposta: resposta.trim(), respondidaEm: data, historico: [...c.historico, evento(usuario, 'RESPONDIDA', resposta.trim(), data)] });
}
export async function anotar(c: Contestacao, texto: string, usuario: string, anexo?: { nome: string; referencia?: string }) {
  await gravar({ ...c, anexos: anexo ? [...c.anexos, anexo] : c.anexos, historico: [...c.historico, evento(usuario, anexo ? 'ANEXO' : 'NOTA', anexo ? `${anexo.nome}${anexo.referencia ? ` — ${anexo.referencia}` : ''}${texto ? `. ${texto}` : ''}` : texto)] });
}

/** Encerra com a decisão. RETIFICADA e CANCELADA exigem que a fatura já tenha sido substituída/cancelada. */
export async function decidir(c: Contestacao, decisao: Decisao, usuario: string, texto: string, novaFatura?: string) {
  await gravar({
    ...c, status: 'ENCERRADA', decisao, decididaEm: hoje(), novaFatura: novaFatura ?? c.novaFatura ?? null,
    historico: [...c.historico, evento(usuario, decisao, [texto, novaFatura ? `Nova fatura ${novaFatura}.` : ''].filter(Boolean).join(' '))],
  });
  const outras = (await listarContestacoes()).filter(x => x.invoiceId === c.invoiceId && x.id !== c.id && x.status !== 'ENCERRADA');
  if (!outras.length) await marcarContestada(c.invoiceId, false);
}

/** Reabre uma contestação já encerrada (para corrigir a decisão). Volta ao último estágio anterior à decisão e a fatura volta a constar como contestada.
 *  Não desfaz retificação/cancelamento já feitos na fatura: devolve um aviso nesse caso. */
export async function reabrir(c: Contestacao, usuario: string, motivo: string): Promise<{ aviso?: string }> {
  if (c.status !== 'ENCERRADA') throw new Error('A contestação não está encerrada.');
  if (!motivo.trim()) throw new Error('Informe o motivo da reabertura.');
  const status = c.resposta ? 'RESPONDIDA' : c.encaminhadaEm ? 'ENCAMINHADA' : 'ABERTA';
  const anterior = [c.decisao, c.decididaEm ? `em ${c.decididaEm.split('-').reverse().join('/')}` : ''].filter(Boolean).join(' ');
  await gravar({
    ...c, status, decisao: null, decididaEm: null, novaFatura: null,
    historico: [...c.historico, evento(usuario, 'REABERTA', `Decisão anterior: ${anterior || '—'}. Motivo: ${motivo.trim()}`)],
  });
  const { data, error } = await supabase.from('invoices').select('is_canceled, substituida_por').eq('id', c.invoiceId).maybeSingle();
  checar(error);
  if (data?.is_canceled || data?.substituida_por) {
    return { aviso: data.is_canceled ? 'A fatura continua cancelada (o cancelamento não é desfeito aqui).' : `A fatura continua substituída por ${data.substituida_por} (a retificação não é desfeita aqui).` };
  }
  await marcarContestada(c.invoiceId, true);
  return {};
}

// ------------------------------------------------------------------ cancelamento e substituição
export async function cancelarFatura(inv: Invoice, motivo: string, devolverBaixas: boolean, usuario: string) {
  if (!motivo.trim()) throw new Error('O motivo do cancelamento é obrigatório.');
  // livro de créditos (script 033): o crédito usado volta à OM e o crédito gerado por um acerto é estornado; se já foi usado, a fatura NÃO é cancelada
  await estornarPorCancelamentoDeFatura(inv.invoiceNumber, inv.omId, hoje());
  if (devolverBaixas) {
    const { error } = await supabase.from('payment_allocations').delete().eq('invoice_id', inv.id);
    checar(error);
  }
  const { error } = await supabase.from('invoices').update({
    is_canceled: true, cancelamento_motivo: motivo.trim(), cancelada_em: hoje(), cancelada_por: usuario, contestada: false,
  }).eq('id', inv.id);
  checar(error);
  db.invalidateCache();
}

/** Desfaz um cancelamento feito SEM motivo (ex.: vindo da migração/planilha). Cancelamento registrado pelo sistema (com motivo) não é desfeito aqui: o crédito usado já foi estornado. */
export async function restaurarFaturaCancelada(inv: Invoice) {
  if (inv.cancelamentoMotivo || inv.canceladaEm) throw new Error('Esta fatura foi cancelada pelo sistema, com motivo. Para refazê-la, emita a versão seguinte (Retificar).');
  if (inv.substituidaPor) throw new Error(`A fatura foi substituída por ${inv.substituidaPor}; não dá para restaurá-la.`);
  const { error } = await supabase.from('invoices').update({ is_canceled: false, cancelamento_motivo: null, cancelada_em: null, cancelada_por: null }).eq('id', inv.id);
  checar(error);
  db.invalidateCache();
}

/** Confirma que o cancelamento foi proposital: grava o motivo na fatura. */
export async function registrarMotivoDoCancelamento(inv: Invoice, motivo: string, usuario: string) {
  if (!motivo.trim()) throw new Error('Informe o motivo do cancelamento.');
  const { error } = await supabase.from('invoices').update({ cancelamento_motivo: motivo.trim(), cancelada_por: usuario || null }).eq('id', inv.id);
  checar(error);
  db.invalidateCache();
}

export interface AlteracoesVersao {
  value: number; adjustmentAddition: number; adjustmentDeduction: number; consumption: string; issueDate: string; dueDate: string; observation: string;
}

/** Cria a versão seguinte (…-1), transfere as baixas para ela e marca a original como substituída. */
export async function substituirFatura(inv: Invoice, alt: AlteracoesVersao, motivo: string, usuario: string, numerosExistentes: string[]) {
  if (!motivo.trim()) throw new Error('Informe o motivo da retificação.');
  const numero = proximaVersao(inv.invoiceNumber, numerosExistentes);
  const { data: orig, error: e0 } = await supabase.from('invoices').select('*').eq('id', inv.id).single();
  checar(e0);
  const novoId = uuidv4();
  const { anexos: _anexos, pontos_atencao, enviada_em, certificada_em, siafi_em, cancelamento_motivo, cancelada_em, cancelada_por, substituida_por, ...copia } = orig as any;
  const { error: e1 } = await supabase.from('invoices').insert({
    ...copia, id: novoId, invoice_number: numero, value: alt.value, adjustment_addition: alt.adjustmentAddition, adjustment_deduction: alt.adjustmentDeduction,
    consumption: alt.consumption, issue_date: alt.issueDate, due_date: alt.dueDate, observation: alt.observation, is_canceled: false, contestada: false,
    substitui: inv.invoiceNumber, siplad_settled: false, origem: `Retificação de ${inv.invoiceNumber}`,
  });
  checar(e1);
  const { error: e2 } = await supabase.from('payment_allocations').update({ invoice_id: novoId }).eq('invoice_id', inv.id);
  checar(e2);
  const { error: e3 } = await supabase.from('invoices').update({
    is_canceled: true, substituida_por: numero, cancelamento_motivo: motivo.trim(), cancelada_em: hoje(), cancelada_por: usuario, contestada: false,
  }).eq('id', inv.id);
  checar(e3);
  db.invalidateCache();
  return { id: novoId, numero };
}

// ------------------------------------------------------------------ taxas da poupança
export async function listarTaxas(): Promise<{ mes: string; taxa: number; fonte?: string | null }[]> {
  const { data, error } = await supabase.from('taxas_poupanca').select('*').order('mes');
  checar(error);
  return (data || []).map(r => ({ mes: r.mes, taxa: Number(r.taxa), fonte: r.fonte }));
}
export async function salvarTaxas(taxas: { mes: string; taxa: number; fonte?: string | null }[]) {
  const { error } = await supabase.from('taxas_poupanca').upsert(taxas.map(t => ({ mes: t.mes, taxa: t.taxa, fonte: t.fonte ?? null })));
  checar(error);
}

// ------------------------------------------------------------------ correção por atraso
export interface CandidatoCorrecao { fatura: Invoice; correcao: Correcao; jaCorrigida?: string }

/** Faturas com pagamento (não adiantamento) feito depois do vencimento. */
export function candidatosCorrecao(invoices: Invoice[], baixas: PaymentAllocation[], docs: ReceivedDocument[], taxas: Map<string, number>, base: number): CandidatoCorrecao[] {
  const docPorId = new Map(docs.map(d => [d.id, d]));
  const corrigidas = new Map(invoices.filter(i => i.acertoDe && (i.baseCalculo as any)?.tipo === 'CORRECAO' && !i.isCanceled).map(i => [i.acertoDe!, i.invoiceNumber]));
  const porFatura = new Map<string, PaymentAllocation[]>();
  baixas.forEach(b => { const l = porFatura.get(b.invoiceId); if (l) l.push(b); else porFatura.set(b.invoiceId, [b]); });
  const out: CandidatoCorrecao[] = [];
  invoices.forEach(f => {
    if (f.isCanceled || f.quitacaoExterna || !f.dueDate || f.acertoDe) return;
    const pagos = (porFatura.get(f.id) || []).filter(b => !ehAdiantamento(b, docPorId.get(b.documentId)) && b.date > f.dueDate);
    if (!pagos.length) return;
    const c = calcularCorrecao(f.dueDate, pagos.map(b => ({ data: b.date, valor: b.amount })), taxas, base);
    if (c.total <= 0 && !c.semTaxa.length) return;
    out.push({ fatura: f, correcao: c, jaCorrigida: corrigidas.get(f.invoiceNumber) });
  });
  return out.sort((a, b) => b.correcao.total - a.correcao.total);
}

/** Emite as faturas de correção (linha 03, acréscimo) num lote do tipo CORRECAO. */
export async function emitirCorrecoes(cands: CandidatoCorrecao[], ctx: ContextoFaturamento, opcoes: { competencia: string; emissao: string; limite: string; vencimento?: string; usuario: string }) {
  const omPorId = new Map(ctx.omsFat.map(o => [o.id, o]));
  const itens: ItemLote[] = cands.map(c => {
    const f = c.fatura;
    const sigla = (f.serviceAcronym || lerFatura(f.invoiceNumber)?.sigla || '').toUpperCase();
    const om: OMFat = (f.omId && omPorId.get(f.omId)) || {
      id: f.omId || f.id, codigo: f.ug || lerFatura(f.invoiceNumber)?.codigo || '00000', nome: f.client, tipo: 'TERRA', comandoId: null,
      setor: f.sector, comando: f.command, ativo: true,
    };
    return {
      chave: f.id, omId: om.id, om, sigla, servico: f.type, unidade: '-', quantidade: null, quantidade2: null,
      valor: 0, acrescimo: c.correcao.total, debito: 0, acertoDe: f.invoiceNumber, avisos: [],
      base: {
        tipo: 'CORRECAO', regra: `Correção por pagamento com atraso (${citarCorrecao()}): taxa diária equivalente à poupança`,
        faturaCorrigida: f.invoiceNumber, dataLimite: f.dueDate, diasMax: c.correcao.diasMax,
        pagamentos: c.correcao.pagamentos.map(p => ({ data: p.data, valor: p.valor, dias: p.dias, correcao: p.correcao })),
      },
    };
  });
  const numerados = numerar(itens, ctx.invoices.map(i => i.invoiceNumber), opcoes.competencia);
  return emitirLote(numerados, { tipo: 'CORRECAO', competencia: opcoes.competencia, emissao: opcoes.emissao, limite: opcoes.limite, vencimento: opcoes.vencimento, usuario: opcoes.usuario });
}
