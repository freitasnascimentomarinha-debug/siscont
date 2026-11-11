import { supabase } from './supabase';
import { LinhaRegime, Regime } from '../utils/regimeOnd';

const paraLinha = (r: any): LinhaRegime => ({
  id: r.id, escopo: r.escopo, sigla: r.sigla, omId: r.om_id ?? null, anoInicio: Number(r.ano_inicio), regime: r.regime ?? null,
  motivo: r.motivo ?? null, origem: r.origem, criadoPorNome: r.criado_por_nome ?? null, criadoEm: r.criado_em ?? null,
});

/** Regimes de fim de exercício (script 032). Sem o script, devolve vazio e o faturamento segue como era antes. */
export const regimeOndService = {
  listar: async (): Promise<LinhaRegime[]> => {
    const { data, error } = await supabase.from('regime_ond').select('*').order('ano_inicio', { ascending: false }).order('criado_em', { ascending: false });
    if (error) return [];
    return (data || []).map(paraLinha);
  },
  instalado: async (): Promise<boolean> => {
    const { error } = await supabase.from('regime_ond').select('id').limit(1);
    return !error;
  },
  /** Grava uma nova linha (nunca altera nem apaga as anteriores). Operador e administrador. */
  registrar: async (l: { escopo: 'SERVICO' | 'OM'; sigla: string; omId?: string | null; anoInicio: number; regime: Regime | null; motivo?: string }): Promise<void> => {
    const { error } = await supabase.from('regime_ond').insert({
      escopo: l.escopo, sigla: l.sigla, om_id: l.escopo === 'OM' ? l.omId : null, ano_inicio: l.anoInicio, regime: l.regime, motivo: l.motivo?.trim() || null, origem: 'USUARIO',
    });
    if (error) {
      if (/regime_ond/.test(error.message || '') && /does not exist|Could not find/i.test(error.message || '')) throw new Error('Falta executar o script supabase/migrations/032_regime_ond.sql no Supabase.');
      throw error;
    }
  },
};
