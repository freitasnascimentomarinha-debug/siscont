/** Totais do Painel inicial calculados no banco (função painel_resumo, script 038): evita baixar todas as faturas e baixas. */
import { supabase } from './supabase';

export interface LinhaResumo {
  omId: string | null; setor: string | null; comando: string | null; cliente: string | null; tipo: string;
  ano: number; mes: number; contestada: boolean; vencida: boolean; faixa: string; ehTc: boolean;
  qtd: number; total: number; pago: number; saldo: number;
}

const n = (v: unknown) => Number(v) || 0;

export const painelService = {
  /** Lança erro se a função ainda não existir no banco (a tela então volta ao modo antigo). */
  async resumo(hoje: string): Promise<LinhaResumo[]> {
    const { data, error } = await supabase.rpc('painel_resumo_json', { p_hoje: hoje });
    if (error) throw error;
    if (!Array.isArray(data)) throw new Error('painel_resumo_json devolveu um formato inesperado');
    const todas: LinhaResumo[] = (data as any[]).map(r => ({
      omId: r.om_id ?? null, setor: r.setor ?? null, comando: r.comando ?? null, cliente: r.cliente ?? null, tipo: r.tipo || '—',
      ano: n(r.ano), mes: n(r.mes), contestada: !!r.contestada, vencida: !!r.vencida, faixa: r.faixa || 'A vencer', ehTc: !!r.eh_tc,
      qtd: n(r.qtd), total: n(r.total), pago: n(r.pago), saldo: n(r.saldo),
    }));
    return todas;
  },
};
