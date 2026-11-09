import { supabase } from './supabase';

/** Dívida que fechou cada mês (tabela do script 026). Devolve null se o script ainda não foi executado. */
export async function listarDividaMensal(): Promise<Map<string, number> | null> {
  const { data, error } = await supabase.from('divida_mensal').select('mes,valor');
  if (error) {
    if (error.code === '42P01' || error.code === 'PGRST205' || /divida_mensal|schema cache/i.test(error.message || '')) return null;
    throw new Error(error.message);
  }
  return new Map((data || []).map((r: any) => [r.mes as string, Number(r.valor)]));
}

/** Registra (ou atualiza) a dívida do mês. Quem só consulta (Encarregado) não consegue gravar: devolve false sem erro. */
export async function registrarDividaMensal(mes: string, valor: number): Promise<boolean> {
  const { error } = await supabase.from('divida_mensal').upsert({ mes, valor, origem: 'sistema', registrado_em: new Date().toISOString() }, { onConflict: 'mes' });
  return !error;
}
