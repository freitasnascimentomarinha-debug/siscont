import { supabase } from './supabase';
import { RegistroAuditoria } from '../utils/auditoria';

export class Fase7NaoInstaladaError extends Error {
  constructor() { super('Falta executar o script supabase/migrations/010_rotinas_anuais_auditoria.sql no Supabase.'); }
}
const checar = (error: any) => {
  if (!error) return;
  if (/auditoria/.test(error.message || '') || error.code === '42P01' || error.code === 'PGRST205') throw new Fase7NaoInstaladaError();
  throw new Error(error.message);
};
const mapear = (r: any): RegistroAuditoria => ({
  id: r.id, tabela: r.tabela, registroId: r.registro_id, acao: r.acao, em: r.em, usuarioId: r.usuario_id, usuarioEmail: r.usuario_email, antes: r.antes, depois: r.depois,
});

export interface FiltroAuditoria { tabela?: string; acao?: string; registroId?: string; usuario?: string; de?: string; ate?: string; pagina?: number; porPagina?: number }

export async function listarAuditoria(f: FiltroAuditoria): Promise<{ linhas: RegistroAuditoria[]; total: number }> {
  const por = f.porPagina ?? 50, ini = (f.pagina ?? 0) * por;
  let q = supabase.from('auditoria').select('*', { count: 'exact' }).order('em', { ascending: false }).order('id', { ascending: false });
  if (f.tabela) q = q.eq('tabela', f.tabela);
  if (f.acao) q = q.eq('acao', f.acao);
  if (f.registroId) q = q.eq('registro_id', f.registroId);
  if (f.usuario) q = q.ilike('usuario_email', `%${f.usuario}%`);
  if (f.de) q = q.gte('em', `${f.de}T00:00:00`);
  if (f.ate) q = q.lte('em', `${f.ate}T23:59:59`);
  const { data, error, count } = await q.range(ini, ini + por - 1);
  checar(error);
  return { linhas: (data || []).map(mapear), total: count ?? 0 };
}

/** Histórico de um registro (ex.: uma fatura), do mais recente para o mais antigo. */
export async function historico(tabela: string, registroId: string) {
  return (await listarAuditoria({ tabela, registroId, porPagina: 500 })).linhas;
}

// ------------------------------------------------------------------ backup assistido
/** Tabelas das fases 2 a 6, exportadas "como estão" no backup (as das fases 0–1 já vão pelo db.getAllData). */
export const TABELAS_BACKUP_EXTRAS = [
  'precos', 'medicoes', 'atracacoes', 'lotes_faturamento', 'contestacoes', 'taxas_poupanca', 'rubricas', 'cobrancas',
  'propostas_tc', 'lotacoes_tc', 'matriz_tc', 'descontos_tc', 'atracacao_anual',
];

export async function exportarTabela(tabela: string): Promise<any[] | null> {
  const out: any[] = [];
  for (let ini = 0; ; ini += 1000) {
    const { data, error } = await supabase.from(tabela).select('*').range(ini, ini + 999);
    if (error) return out.length ? out : null; // tabela ainda não criada: fica fora do backup
    out.push(...(data || []));
    if (!data || data.length < 1000) return out;
  }
}

export async function ultimoBackup(): Promise<string | null> {
  const { data } = await supabase.from('parametros').select('valor').eq('chave', 'ultimo_backup').maybeSingle();
  return data?.valor || null;
}
export async function registrarBackup(quando = new Date().toISOString()) {
  await supabase.from('parametros').upsert({ chave: 'ultimo_backup', valor: quando, descricao: 'Data/hora do último backup completo (gravada pela Administração)' });
}
