import { supabase } from './supabase';
import { ApuracaoLinha, SemMovimento } from '../utils/faturamento';

const r2 = (n: number) => Math.round(n * 100) / 100;
export class Fase34NaoInstaladaError extends Error {
  constructor() { super('Falta executar o script supabase/migrations/034_apuracao_ond.sql no Supabase (meses sem movimento e apuração do OND).'); }
}
const traduzir = (error: any): never => {
  const msg = String(error?.message || '');
  if (/meses_sem_movimento|apuracoes_ond/.test(msg) && /does not exist|Could not find|schema cache/i.test(msg)) throw new Fase34NaoInstaladaError();
  if (/apuracoes_ond_uk|duplicate key/.test(msg)) throw new Error('Este acerto já foi apurado (uma apuração por OM, serviço e exercício). Atualize a tela.');
  throw error;
};

export interface SemMovimentoLinha extends SemMovimento { id: string; motivo?: string | null; criadoPorNome?: string | null; criadoEm?: string | null }

export async function listarSemMovimento(ano?: number): Promise<SemMovimentoLinha[]> {
  let q = supabase.from('meses_sem_movimento').select('*');
  if (ano) q = q.eq('ano', ano);
  const { data, error } = await q;
  if (error) return [];
  return (data || []).map((r: any) => ({ id: r.id, omId: r.om_id, sigla: r.sigla, ano: Number(r.ano), mes: Number(r.mes), motivo: r.motivo, criadoPorNome: r.criado_por_nome, criadoEm: r.criado_em }));
}
/** Marca meses como "sem movimento" (valem zero na média e no acerto). Operador e administrador. */
export async function marcarSemMovimento(marcas: { omId: string; sigla: string; ano: number; mes: number }[], motivo: string) {
  if (!marcas.length) return;
  const { error } = await supabase.from('meses_sem_movimento').upsert(marcas.map(m => ({ om_id: m.omId, sigla: m.sigla, ano: m.ano, mes: m.mes, motivo: motivo.trim() || null })), { onConflict: 'om_id,sigla,ano,mes', ignoreDuplicates: true });
  if (error) traduzir(error);
}
export async function desmarcarSemMovimento(id: string) {
  const { error } = await supabase.from('meses_sem_movimento').delete().eq('id', id);
  if (error) traduzir(error);
}

const deLinha = (r: any): ApuracaoLinha => ({
  id: r.id, omId: r.om_id, sigla: r.sigla, exercicio: Number(r.exercicio), estimadaNumero: r.estimada_numero, estimado: Number(r.estimado), real: Number(r.real),
  diferenca: Number(r.diferenca), resultado: r.resultado, acertoNumero: r.acerto_numero, loteId: r.lote_id, memoria: r.memoria, criadoPorNome: r.criado_por_nome,
  criadoEm: r.criado_em, canceladaEm: r.cancelada_em, canceladaMotivo: r.cancelada_motivo,
});
export async function listarApuracoes(): Promise<ApuracaoLinha[]> {
  const { data, error } = await supabase.from('apuracoes_ond').select('*').order('criado_em', { ascending: false });
  if (error) return [];
  return (data || []).map(deLinha);
}
/** Registra as apurações (uma por OM, serviço e exercício): o banco recusa a repetição. Chamar ANTES das faturas do lote. */
export async function registrarApuracoes(linhas: Omit<ApuracaoLinha, 'id'>[], loteId: string | null) {
  if (!linhas.length) return;
  const { error } = await supabase.from('apuracoes_ond').insert(linhas.map(a => ({
    om_id: a.omId, sigla: a.sigla, exercicio: a.exercicio, estimada_numero: a.estimadaNumero ?? null, estimado: r2(a.estimado), real: r2(a.real), diferenca: r2(a.diferenca),
    resultado: a.resultado, acerto_numero: a.acertoNumero ?? null, lote_id: loteId, memoria: a.memoria ?? null,
  })));
  if (error) traduzir(error);
}
/** Desfaz as apurações de um lote cuja emissão falhou (cancelamento, o registro não se apaga). */
export async function desfazerApuracoesDoLote(loteId: string) {
  await supabase.from('apuracoes_ond').update({ cancelada_em: new Date().toISOString(), cancelada_motivo: 'Emissão do lote desfeita' }).eq('lote_id', loteId).is('cancelada_em', null);
}
/** Cancelamento de uma apuração (procedimento do administrador, com motivo). */
export async function cancelarApuracao(id: string, motivo: string) {
  if (!motivo.trim()) throw new Error('Informe o motivo do cancelamento da apuração.');
  const { error } = await supabase.from('apuracoes_ond').update({ cancelada_em: new Date().toISOString(), cancelada_motivo: motivo.trim() }).eq('id', id).is('cancelada_em', null);
  if (error) traduzir(error);
}
