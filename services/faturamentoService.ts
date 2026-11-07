import { v4 as uuidv4 } from 'uuid';
import { supabase } from './supabase';
import { db } from './db';
import { cadastroService } from './cadastroService';
import { supabaseService } from './supabaseService';
import { Comando, Invoice, OM, Setor } from '../types';
import { listaAdiantamentos } from '../utils/adiantamentos';
import { datasDaFatura, somarDiasUteis } from '../utils/diasUteis';
import {
  AtracacaoFat, DadosLote, DocAdiantDisp, FaturaHist, ItemLote, MedicaoFat, OMFat, PrecoFat, ServicoFat, TipoLote, partes, pad,
} from '../utils/faturamento';
import { lerFatura } from '../utils/cadastroImport';

const r2 = (n: number) => Math.round(n * 100) / 100;
export class Fase3NaoInstaladaError extends Error {
  constructor() { super('Falta executar o script supabase/migrations/007_faturamento_fase3.sql no Supabase.'); }
}
const checar = (error: any) => {
  if (!error) return;
  if (/lotes_faturamento_tipo_check/.test(error.message || '')) throw new Error('Falta executar o script supabase/migrations/008_contestacao_fase4.sql no Supabase.');
  if (/relation .*(precos|medicoes|atracacoes|lotes_faturamento)|lote_id|base_calculo|estimado|acerto_de/.test(error.message || '')) throw new Fase3NaoInstaladaError();
  throw new Error(error.message);
};

async function tudo<T = any>(tabela: string, filtro?: (q: any) => any): Promise<T[]> {
  const out: T[] = [];
  for (let de = 0; ; de += 1000) {
    let q = supabase.from(tabela).select('*').order('id').range(de, de + 999);
    if (filtro) q = filtro(q);
    const { data, error } = await q;
    checar(error);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

// ------------------------------------------------------------------ preços
export async function listarPrecos(anos: number[]): Promise<(PrecoFat & { id: string; descricao?: string | null })[]> {
  const rows = await tudo('precos', q => q.in('ano', anos));
  return rows.map(r => ({ id: r.id, ano: r.ano, sigla: r.sigla, omId: r.om_id, valor: Number(r.valor), unidade: r.unidade, descricao: r.descricao }));
}
export async function salvarPrecos(precos: { id?: string; ano: number; sigla: string; omId: string | null; valor: number; unidade?: string | null; descricao?: string | null }[]) {
  const atuais = precos.length ? await listarPrecos([...new Set(precos.map(p => p.ano))]) : [];
  const linhas = precos.map(p => {
    const ja = p.id ? { id: p.id } : atuais.find(a => a.ano === p.ano && a.sigla === p.sigla && (a.omId ?? null) === (p.omId ?? null));
    return { id: ja?.id ?? uuidv4(), ano: p.ano, sigla: p.sigla, om_id: p.omId, valor: r2(p.valor), unidade: p.unidade ?? null, descricao: p.descricao ?? null };
  });
  for (let i = 0; i < linhas.length; i += 500) {
    const { error } = await supabase.from('precos').upsert(linhas.slice(i, i + 500));
    checar(error);
  }
}
export async function excluirPreco(id: string) { const { error } = await supabase.from('precos').delete().eq('id', id); checar(error); }

// ------------------------------------------------------------------ medições
export async function listarMedicoes(competencias: string[]): Promise<(MedicaoFat & { id: string; detalhe?: any[]; origem?: string | null })[]> {
  const rows = await tudo('medicoes', q => q.in('competencia', competencias));
  return rows.map(r => ({
    id: r.id, competencia: r.competencia, sigla: r.sigla, omId: r.om_id, quantidade: r.quantidade === null ? null : Number(r.quantidade),
    quantidade2: r.quantidade2 === null ? null : Number(r.quantidade2), valor: r.valor === null ? null : Number(r.valor),
    estimada: r.estimada, detalhe: r.detalhe, origem: r.origem,
  }));
}
export async function salvarMedicoes(ms: (MedicaoFat & { detalhe?: any[]; origem?: string | null })[]) {
  const linhas = ms.map(m => ({
    competencia: m.competencia, sigla: m.sigla, om_id: m.omId, quantidade: m.quantidade ?? null, quantidade2: m.quantidade2 ?? null,
    valor: m.valor ?? null, estimada: !!m.estimada, detalhe: m.detalhe ?? [], origem: m.origem ?? null,
  }));
  for (let i = 0; i < linhas.length; i += 500) {
    const { error } = await supabase.from('medicoes').upsert(linhas.slice(i, i + 500), { onConflict: 'competencia,sigla,om_id' });
    checar(error);
  }
}
export async function excluirMedicao(competencia: string, sigla: string, omId: string) {
  const { error } = await supabase.from('medicoes').delete().eq('competencia', competencia).eq('sigla', sigla).eq('om_id', omId);
  checar(error);
}

// ------------------------------------------------------------------ atracação (BNIC-35)
export async function listarAtracacoes(competencias: string[]): Promise<(AtracacaoFat & { id: string; dias: string[]; gerencia?: string | null })[]> {
  const rows = await tudo('atracacoes', q => q.in('competencia', competencias));
  return rows.map(r => ({ id: r.id, competencia: r.competencia, omId: r.om_id, previsao: r.previsao, dias: r.dias || [], diasAtracado: r.dias_atracado, diasDocado: r.dias_docado, gerencia: r.gerencia }));
}
export async function salvarAtracacoes(as: { competencia: string; omId: string; previsao: boolean; dias: string[]; gerencia?: string | null }[]) {
  const linhas = as.map(a => ({
    competencia: a.competencia, om_id: a.omId, previsao: a.previsao, dias: a.dias, gerencia: a.gerencia ?? null,
    dias_atracado: a.dias.filter(d => d === 'A').length, dias_docado: a.dias.filter(d => d === 'D').length,
  }));
  for (let i = 0; i < linhas.length; i += 500) {
    const { error } = await supabase.from('atracacoes').upsert(linhas.slice(i, i + 500), { onConflict: 'competencia,om_id,previsao' });
    checar(error);
  }
}

// ------------------------------------------------------------------ dados do lote
export interface ContextoFaturamento {
  oms: OM[]; omsFat: OMFat[]; comandos: Comando[]; setores: Setor[]; servicos: ServicoFat[];
  invoices: Invoice[]; feriados: string[]; prazo: number; prazoVencimento: number; diaEmissao: number;
}

export async function carregarContexto(): Promise<ContextoFaturamento> {
  const [oms, comandos, setores, servicos, feriados, parametros, invoices] = await Promise.all([
    cadastroService.listOMs(), cadastroService.listComandos(), cadastroService.listSetores(), cadastroService.listServicos(),
    cadastroService.listFeriados(), cadastroService.listParametros(), db.getInvoices(),
  ]);
  const cmd = new Map(comandos.map(c => [c.id, c]));
  const set = new Map(setores.map(s => [s.id, s]));
  const omsFat: OMFat[] = oms.map(o => {
    const c = o.comandoId ? cmd.get(o.comandoId) : undefined;
    const setorId = o.setorId || c?.setorId;
    return {
      id: o.id, codigo: o.codigo, nome: o.nome, tipo: o.tipo, comandoId: o.comandoId ?? null,
      setor: (setorId && set.get(setorId)?.sigla) || (o.tipo === 'EXTRA_MB' ? 'EXTRA-MB' : ''),
      comando: c ? `${c.codigo ? c.codigo + ' - ' : ''}${c.nome}` : (o.tipo === 'EXTRA_MB' ? 'EXTRA-MARINHA' : ''),
      ativo: o.ativo, desativadoEm: o.desativadoEm ?? null, ativadoEm: o.ativadoEm ?? null,
    };
  });
  const param = (k: string, d: number) => Number(parametros.find(p => p.chave === k)?.valor) || d;
  return {
    oms, omsFat, comandos, setores, invoices,
    servicos: servicos.filter(s => s.ativo !== false).map(s => ({ sigla: s.acronym.toUpperCase(), nome: s.name, unidade: s.unitMeasure || '', ordem: s.ordem ?? 999, responsavel: s.setorResponsavel ?? null, telefone: s.telefoneSetor ?? null })),
    feriados: feriados.map(f => f.data), prazo: param('prazo_certificacao_dias_uteis', 10), prazoVencimento: param('prazo_vencimento_dias_corridos', 30), diaEmissao: param('dia_emissao', 15),
  };
}

export const historicoDe = (invoices: Invoice[]): FaturaHist[] => invoices.map(i => ({
  id: i.id, numero: i.invoiceNumber, omId: i.omId ?? null, sigla: (i.serviceAcronym || lerFatura(i.invoiceNumber)?.sigla || '').toUpperCase(),
  ano: i.yearCompetence, mes: i.monthCompetence, valor: r2(i.value + (i.adjustmentAddition || 0) - (i.adjustmentDeduction || 0)),
  cancelada: i.isCanceled, estimado: !!i.estimado, acertoDe: i.acertoDe ?? null,
}));

/** Competências cujos dados o lote precisa. */
export function competenciasDoLote(tipo: TipoLote, comp: string): string[] {
  const { ano } = partes(comp);
  if (tipo === 'MENSAL') return [comp];
  if (tipo === 'OND') return [10, 11, 12].map(m => `${ano}-${pad(m)}`);
  return [10, 11, 12].map(m => `${ano}-${pad(m)}`); // ACERTO: comp = ano do OND (AAAA-10)
}

export async function montarDados(ctx: ContextoFaturamento, tipo: TipoLote, comp: string): Promise<DadosLote> {
  const { ano } = partes(comp);
  const comps = competenciasDoLote(tipo, comp);
  const [precos, medicoes, atracacoes] = await Promise.all([listarPrecos([ano]), listarMedicoes(comps), listarAtracacoes(comps)]);
  return {
    competencia: comp, tipo, oms: ctx.omsFat, servicos: ctx.servicos, precos, medicoes, atracacoes,
    historico: historicoDe(ctx.invoices),
  };
}

/** Adiantamentos com saldo (ALTCRED de adiantamento ou sobra de pagamento). */
export async function adiantamentosDisponiveis(): Promise<DocAdiantDisp[]> {
  const [docs, baixas, faturas] = await Promise.all([db.getDocuments(), db.getAllocations(), db.getInvoices()]);
  const porId = new Map(docs.map(d => [d.id, d]));
  return listaAdiantamentos(docs, baixas, faturas)
    .filter(l => l.saldo > 0.005)
    .map(l => { const d = porId.get(l.docId)!; return { id: l.docId, numero: l.numero, saldo: l.saldo, data: l.data, comandoId: d.comandoId ?? null, ug: d.ug ?? null }; });
}

export const dataEmissaoPadrao = (comp: string, dia: number) => {
  const { ano, mes } = partes(comp);
  const y = mes === 12 ? ano + 1 : ano, m = mes === 12 ? 1 : mes + 1;
  return `${y}-${pad(m)}-${pad(Math.min(dia, 28))}`;
};
export const dataLimite = (emissao: string, ctx: ContextoFaturamento) => somarDiasUteis(emissao, ctx.prazo, ctx.feriados);
/** Vencimento (pagamento): emissão + 30 dias corridos (próximo dia útil); OND vence na data-limite de certificação. */
export const dataVencimento = (emissao: string, ctx: ContextoFaturamento, ond = false) =>
  datasDaFatura(emissao, { ond, prazoCertificacao: ctx.prazo, prazoVencimento: ctx.prazoVencimento, feriados: ctx.feriados }).vencimento;

// ------------------------------------------------------------------ emissão
const fmtQtd = (n: number | null) => (n === null || n === undefined ? '' : n.toLocaleString('pt-BR', { maximumFractionDigits: 2 }));

export async function emitirLote(itens: ItemLote[], opcoes: {
  tipo: TipoLote; competencia: string; emissao: string; limite: string; vencimento?: string; usuario: string; observacao?: string;
}, onProgresso?: (m: string) => void) {
  if (!itens.length) throw new Error('Nenhuma fatura para emitir.');
  if (itens.some(i => !i.numero)) throw new Error('Há faturas sem número.');
  const loteId = uuidv4();
  const totalFinal = r2(itens.reduce((s, i) => s + i.valor + i.acrescimo - i.debito - (i.adiantamentos || []).reduce((a, b) => a + b.valor, 0), 0));
  const { error: e1 } = await supabase.from('lotes_faturamento').insert({
    id: loteId, competencia: opcoes.competencia, tipo: opcoes.tipo, data_emissao: opcoes.emissao, data_limite: opcoes.limite,
    qtd: itens.length, total: totalFinal, criado_por: opcoes.usuario, observacao: opcoes.observacao ?? null,
  });
  checar(e1);
  onProgresso?.('Gravando faturas...');
  const linhas = itens.map(i => {
    const lido = lerFatura(i.numero!)!;
    const mes = lido.competencia % 100, ano = Math.floor(lido.competencia / 100);
    const obs = [
      ...(i.adiantamentos || []).map(a => `Baixa na ALTCRED ${a.numero}.`),
      i.acertoDe ? ((i.base as any).tipo === 'CORRECAO' ? `Correção da fatura ${i.acertoDe} paga com atraso (OI 40-04, item 6.2).` : `Acerto da fatura ${i.acertoDe} (estimado OND).`) : '',
      i.estimado ? 'Faturamento estimado de fim de exercício (OND): será acertado com o consumo real.' : '',
    ].filter(Boolean).join(' ');
    return {
      id: uuidv4(), ug: i.om.codigo, sector: i.om.setor, command: i.om.comando, client: i.om.nome, invoice_number: i.numero,
      consumption: [fmtQtd(i.quantidade), i.quantidade2 != null ? `${fmtQtd(i.quantidade2)} kW` : ''].filter(Boolean).join(' / '),
      unit_measure: i.unidade, service_acronym: i.sigla, value: r2(i.valor), adjustment_addition: r2(i.acrescimo), adjustment_deduction: r2(i.debito),
      issue_date: opcoes.emissao, due_date: i.estimado || opcoes.tipo === 'OND' ? opcoes.limite : (opcoes.vencimento || opcoes.limite), data_limite_certificacao: opcoes.limite, month_competence: mes, year_competence: ano, competence: `${pad(mes)}/${ano}`,
      type: i.servico, is_canceled: false, observation: obs, siplad_settled: false, om_id: i.omId, origem: `Lote ${opcoes.tipo} ${opcoes.competencia}`,
      contestada: false, lote_id: loteId, base_calculo: i.base, estimado: !!i.estimado, acerto_de: i.acertoDe ?? null,
      _adiant: i.adiantamentos || [],
    };
  });
  for (let k = 0; k < linhas.length; k += 300) {
    let { error } = await supabase.from('invoices').insert(linhas.slice(k, k + 300).map(({ _adiant, ...l }) => l));
    if (error && /data_limite_certificacao/.test(error.message || '')) {
      // banco ainda sem o script 011: grava sem a coluna de certificação (o vencimento já sai com a regra nova)
      ({ error } = await supabase.from('invoices').insert(linhas.slice(k, k + 300).map(({ _adiant, data_limite_certificacao, ...l }) => l)));
    }
    if (error) {
      await supabase.from('lotes_faturamento').delete().eq('id', loteId);
      if (/duplicate key/.test(error.message)) throw new Error('Algum número de fatura já existe (outra emissão ao mesmo tempo?). Recalcule a prévia e tente de novo.');
      checar(error);
    }
    onProgresso?.(`Faturas: ${Math.min(k + 300, linhas.length)} de ${linhas.length}`);
  }
  const baixas = linhas.flatMap(l => l._adiant.map(a => ({
    id: uuidv4(), document_id: a.docId, invoice_id: l.id, amount: a.valor, date: opcoes.emissao, service_type: l.type,
    siscont_settled: true, observation: 'Abatimento automático de adiantamento (lote)', tipo_baixa: 'ADIANTAMENTO',
  })));
  for (let k = 0; k < baixas.length; k += 500) {
    const { error } = await supabase.from('payment_allocations').insert(baixas.slice(k, k + 500));
    checar(error);
  }
  db.invalidateCache();
  return { loteId, faturas: linhas.length, adiantamentos: baixas.length, total: totalFinal };
}

export interface Lote { id: string; competencia: string; tipo: TipoLote; dataEmissao: string; dataLimite: string; qtd: number; total: number; criadoPor?: string; createdAt: string }
export async function listarLotes(): Promise<Lote[]> {
  const rows = await tudo('lotes_faturamento');
  return rows.map(r => ({ id: r.id, competencia: r.competencia, tipo: r.tipo, dataEmissao: r.data_emissao, dataLimite: r.data_limite, qtd: r.qtd, total: Number(r.total), criadoPor: r.criado_por, createdAt: r.created_at }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Marca envio/SIPLAD/SIAFI nas faturas. */
export async function marcarFaturas(ids: string[], campo: 'enviada_em' | 'certificada_em' | 'siafi_em', data: string | null) {
  for (let i = 0; i < ids.length; i += 200) {
    const { error } = await supabase.from('invoices').update({ [campo]: data }).in('id', ids.slice(i, i + 200));
    checar(error);
  }
  db.invalidateCache();
}

/** Faturas do lote com os campos da Fase 3 (lidos direto, para o PDF e o envio). */
export async function faturasDoLote(loteId: string) {
  const rows = await tudo('invoices', q => q.eq('lote_id', loteId));
  return rows;
}

export { supabaseService };
