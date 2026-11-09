import { supabase } from './supabase';
import { LinhaAtividade } from '../utils/painelGerencial';

/**
 * Atividade registrada por usuário entre duas datas (AAAA-MM-DD), somada pelo banco a partir da trilha de auditoria.
 * Devolve null se o script 025 ainda não foi executado.
 */
export async function atividadeUsuarios(de: string, ate: string): Promise<LinhaAtividade[] | null> {
  const { data, error } = await supabase.rpc('atividade_usuarios', { p_de: de, p_ate: ate });
  if (error) {
    if (/atividade_usuarios|function|schema cache/i.test(error.message || '') || error.code === '42883' || error.code === 'PGRST202') return null;
    throw new Error(error.message);
  }
  return ((data as any[]) || []).map(r => ({ usuario: r.usuario, tabela: r.tabela, acao: r.acao, qtd: Number(r.qtd), ultima: r.ultima ?? null }));
}
