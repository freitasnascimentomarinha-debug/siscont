import { supabase } from './supabase';
import { db } from './db';
import { cadastroService } from './cadastroService';
import { CashFlowExit, Comando, Invoice, InvoiceStatus } from '../types';
import { FaturaAberta, Rubrica } from '../utils/relatorios';
import { lerFatura } from '../utils/cadastroImport';
import { ehAdiantamento } from '../utils/baixas';
import { listaAdiantamentos } from '../utils/adiantamentos';

export class Fase5NaoInstaladaError extends Error {
  constructor() { super('Falta executar o script supabase/migrations/009_relatorios_fase5.sql no Supabase.'); }
}
const checar = (error: any) => {
  if (!error) return;
  if (/rubricas|cobrancas|rubrica_numero|categoria|anulada_em/.test(error.message || '')) throw new Fase5NaoInstaladaError();
  throw new Error(error.message);
};

export const siglaDe = (i: Invoice) => (i.serviceAcronym || lerFatura(i.invoiceNumber)?.sigla || '').toUpperCase();

/** Faturas com saldo a pagar (exclui canceladas, quitadas e histórico). */
export function faturasAbertas(invoices: Invoice[]): FaturaAberta[] {
  return invoices
    .filter(i => !i.isCanceled && i.status !== InvoiceStatus.PAID && (i.saldoAPagar ?? 0) > 0.005)
    .map(i => ({
      id: i.id, numero: i.invoiceNumber, setor: i.sector || '—', comando: i.command || '—', cliente: i.client, omId: i.omId ?? null,
      tipo: (i.type || siglaDe(i)).toUpperCase(), ano: i.yearCompetence, mes: i.monthCompetence, vencimento: i.dueDate || '9999-12-31',
      saldo: i.saldoAPagar ?? 0, contestada: !!i.contestada,
    }));
}

export async function carregarBase() {
  const [invoices, docs, baixas, comandos, parametros, oms, setores] = await Promise.all([
    db.getInvoices(), db.getDocuments(), db.getAllocations(), cadastroService.listComandos().catch(() => [] as Comando[]), cadastroService.listParametros().catch(() => []),
    cadastroService.listOMs().catch(() => []), cadastroService.listSetores().catch(() => []),
  ]);
  const par = Object.fromEntries(parametros.map(p => [p.chave, p.valor]));
  return { invoices, docs, baixas, comandos, par, oms, setores };
}

/**
 * Setor e comando das faturas pelo CADASTRO da OM (e não pelo texto gravado na fatura): duas grafias do mesmo
 * comando viram uma linha só no quadro e na mensagem de cobrança. Fatura sem OM ligada mantém o texto.
 */
export function rotularPeloCadastro(fs: FaturaAberta[], cad: { oms: { id: string; nome: string; comandoId?: string | null; setorId?: string | null }[]; comandos: Comando[]; setores: { id: string; sigla: string }[] }): FaturaAberta[] {
  const om = new Map(cad.oms.map(o => [o.id, o]));
  const cmd = new Map(cad.comandos.map(c => [c.id, c]));
  const set = new Map(cad.setores.map(x => [x.id, x]));
  return fs.map(f => {
    const o = f.omId ? om.get(f.omId) : undefined;
    if (!o) return f;
    const c = o.comandoId ? cmd.get(o.comandoId) : undefined;
    const setor = (o.setorId && set.get(o.setorId)?.sigla) || (c?.setorId && set.get(c.setorId)?.sigla) || f.setor;
    return { ...f, setor, comando: c ? `${c.codigo ? `${c.codigo} - ` : ''}${c.nome}` : f.comando, cliente: o.nome };
  });
}

/** Comando pelo texto "40030 - Diretoria ..." (para achar o indicativo naval). */
export function comandoDoTexto(texto: string, comandos: Comando[]) {
  const cod = texto.match(/^\d{4,5}/)?.[0];
  const c = cod ? comandos.find(x => x.codigo === cod) : comandos.find(x => x.nome.toLowerCase() === texto.toLowerCase());
  return { nome: c?.nome ?? texto, indicativo: c?.indicativoNaval ?? null };
}

/** ALTCRED/GRU com saldo sem movimento há mais de N dias (painel do Encarregado). */
export function saldosParados(base: Awaited<ReturnType<typeof carregarBase>>, hoje: string, dias: number) {
  const ultimo = new Map<string, string>();
  base.baixas.forEach(b => { if (!ultimo.has(b.documentId) || b.date > ultimo.get(b.documentId)!) ultimo.set(b.documentId, b.date); });
  return base.docs
    .filter(d => d.availableValue > 0.005)
    .map(d => { const u = ultimo.get(d.id) || d.date; return { doc: d, ultimo: u, dias: Math.round((Date.parse(hoje) - Date.parse(u)) / 86400000) }; })
    .filter(x => x.dias > dias)
    .sort((a, b) => b.doc.availableValue - a.doc.availableValue);
}

export const adiantamentosComSaldo = (base: Awaited<ReturnType<typeof carregarBase>>) =>
  listaAdiantamentos(base.docs, base.baixas, base.invoices).filter(l => l.saldo > 0.005);

/** TC recebida no ano: baixas (pagamento e adiantamento) em faturas de taxa condominial, pela data da baixa. */
export function tcRecebida(base: Awaited<ReturnType<typeof carregarBase>>, ano: number) {
  const tc = new Set(base.invoices.filter(i => siglaDe(i) === 'TC' && !i.isCanceled).map(i => i.id));
  return Math.round(base.baixas.filter(b => tc.has(b.invoiceId) && b.date.startsWith(String(ano))).reduce((s, b) => s + b.amount, 0) * 100) / 100;
}

/** Baixas com a sigla da fatura (para classificar as entradas por categoria). */
export function baixasComSigla(base: Awaited<ReturnType<typeof carregarBase>>) {
  const sig = new Map(base.invoices.map(i => [i.id, siglaDe(i)]));
  const docs = new Map(base.docs.map(d => [d.id, d]));
  return base.baixas.map(b => ({ documentId: b.documentId, amount: b.amount, sigla: sig.get(b.invoiceId) || '', adiantamento: ehAdiantamento(b, docs.get(b.documentId)) }));
}

// ------------------------------------------------------------------ rubricas
export async function listarRubricas(ano: number): Promise<Rubrica[]> {
  const { data, error } = await supabase.from('rubricas').select('*').eq('ano', ano).order('numero');
  checar(error);
  return (data || []).map(r => ({ ano: r.ano, numero: r.numero, descricao: r.descricao, contaContabil: r.conta_contabil, valorAnual: Number(r.valor_anual), percentual: r.percentual === null ? null : Number(r.percentual) }));
}
export async function salvarRubricas(rs: Rubrica[]) {
  const { error } = await supabase.from('rubricas').upsert(rs.map(r => ({ ano: r.ano, numero: r.numero, descricao: r.descricao, conta_contabil: r.contaContabil ?? null, valor_anual: r.valorAnual, percentual: r.percentual ?? null })));
  checar(error);
}

// ------------------------------------------------------------------ saídas (NE) com classificação
export interface Saida extends CashFlowExit { rubricaNumero?: number | null; categoria?: string | null; anuladaEm?: string | null; motivoAnulacao?: string | null }
export async function listarSaidas(): Promise<Saida[]> {
  const out: any[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await supabase.from('cash_flow_exits').select('*').order('id').range(de, de + 999);
    checar(error);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out.map(e => ({
    id: e.id, date: e.date, documentNumber: e.document_number, documentType: e.document_type, client: e.client, value: Number(e.value),
    rubric: e.rubric, description: e.description, observation: e.observation, isCanceled: e.is_canceled,
    rubricaNumero: e.rubrica_numero ?? null, categoria: e.categoria ?? null, anuladaEm: e.anulada_em ?? null, motivoAnulacao: e.motivo_anulacao ?? null,
  }));
}
export async function salvarSaidas(ss: Saida[]) {
  const linhas = ss.map(s => ({
    id: s.id, date: s.date, document_number: s.documentNumber, document_type: s.documentType, client: s.client, value: s.value,
    rubric: s.rubric, description: s.description, observation: s.observation ?? null, is_canceled: !!s.isCanceled,
    rubrica_numero: s.rubricaNumero ?? null, categoria: s.categoria ?? null, anulada_em: s.anuladaEm ?? null, motivo_anulacao: s.motivoAnulacao ?? null,
  }));
  for (let i = 0; i < linhas.length; i += 500) {
    const { error } = await supabase.from('cash_flow_exits').upsert(linhas.slice(i, i + 500));
    checar(error);
  }
  db.invalidateCache('exits');
}

export async function registrarCobranca(c: { comando: string; indicativo?: string | null; faturas: string[]; valor: number; texto: string; usuario: string }) {
  const { error } = await supabase.from('cobrancas').insert({ comando: c.comando, indicativo: c.indicativo ?? null, faturas: c.faturas, valor: c.valor, texto: c.texto, enviada_por: c.usuario });
  checar(error);
}
export async function listarCobrancas(): Promise<{ comando: string; enviadaEm: string; faturas: string[]; valor: number }[]> {
  const { data, error } = await supabase.from('cobrancas').select('comando, enviada_em, faturas, valor').order('enviada_em', { ascending: false });
  checar(error);
  return (data || []).map(r => ({ comando: r.comando, enviadaEm: r.enviada_em, faturas: r.faturas || [], valor: Number(r.valor) }));
}
