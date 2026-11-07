import { v4 as uuidv4 } from 'uuid';
import { supabase } from './supabase';
import { cadastroService } from './cadastroService';
import { salvarPrecos, listarPrecos, listarAtracacoes } from './faturamentoService';
import { listarRubricas, salvarRubricas } from './relatoriosService';
import { ClasseNavio, OM } from '../types';
import { AnoClasse, Desconto, RubricaTC, ResultadoRateio } from '../utils/taxaCondominial';
import { pad } from '../utils/faturamento';

export class Fase6NaoInstaladaError extends Error {
  constructor() { super('Falta executar o script supabase/migrations/010_rotinas_anuais_auditoria.sql no Supabase.'); }
}
const checar = (error: any) => {
  if (!error) return;
  if (/propostas_tc|lotacoes_tc|matriz_tc|descontos_tc|atracacao_anual|valor_previsto|desconto_geral|gasto_anterior/.test(error.message || '')) throw new Fase6NaoInstaladaError();
  throw new Error(error.message);
};

export type StatusProposta = 'PROPOSTA' | 'APROVADA' | 'DIVULGADA';
export interface Proposta { ano: number; status: StatusProposta; aprovadaEm?: string | null; divulgadaEm?: string | null; observacao?: string | null }
export interface RubricaProposta extends RubricaTC { contaContabil?: string | null; gastoAnterior?: number | null; justificativa?: string | null }
export interface Lotacao { omId: string; lotacao: number; lotacaoAnterior: number | null; /** dias/mês informados (navio); vazio = média trienal da classe */ dias: number | null }

export interface DadosProposta {
  proposta: Proposta; rubricas: RubricaProposta[]; lotacoes: Lotacao[]; matriz: Set<string>; descontos: Desconto[];
  atracacaoAnual: AnoClasse[]; oms: OM[]; classes: ClasseNavio[];
}

export async function carregarProposta(ano: number): Promise<DadosProposta> {
  const [p, rub, lot, mat, desc, atr, oms, classes] = await Promise.all([
    supabase.from('propostas_tc').select('*').eq('ano', ano).maybeSingle(),
    supabase.from('rubricas').select('*').eq('ano', ano).order('numero'),
    supabase.from('lotacoes_tc').select('*').eq('ano', ano),
    supabase.from('matriz_tc').select('*').eq('ano', ano),
    supabase.from('descontos_tc').select('*').eq('ano', ano),
    supabase.from('atracacao_anual').select('*').gte('ano', ano - 3).lte('ano', ano),
    cadastroService.listOMs(), cadastroService.listClasses(),
  ]);
  [p, rub, lot, mat, desc, atr].forEach(r => checar(r.error));
  return {
    proposta: p.data ? { ano, status: p.data.status, aprovadaEm: p.data.aprovada_em, divulgadaEm: p.data.divulgada_em, observacao: p.data.observacao } : { ano, status: 'PROPOSTA' },
    rubricas: (rub.data || []).map(r => ({
      numero: r.numero, descricao: r.descricao, contaContabil: r.conta_contabil, valorPrevisto: Number(r.valor_previsto ?? r.valor_anual ?? 0),
      descontoGeral: Number(r.desconto_geral ?? 0), gastoAnterior: r.gasto_anterior === null || r.gasto_anterior === undefined ? null : Number(r.gasto_anterior), justificativa: r.justificativa_desconto,
    })),
    lotacoes: (lot.data || []).map(l => ({ omId: l.om_id, lotacao: Number(l.lotacao), lotacaoAnterior: l.lotacao_anterior == null ? null : Number(l.lotacao_anterior), dias: l.dias === null || l.dias === undefined ? null : Number(l.dias) })),
    matriz: new Set((mat.data || []).map(m => `${m.rubrica}|${m.om_id}`)),
    descontos: (desc.data || []).map(d => ({ id: d.id, omId: d.om_id, rubrica: d.rubrica, tipo: d.tipo, valor: Number(d.valor), justificativa: d.justificativa || '' })),
    atracacaoAnual: (atr.data || []).map(a => ({ ano: a.ano, classeId: a.classe_id, dias: Number(a.dias), navios: a.navios })),
    oms, classes,
  };
}

export async function salvarProposta(p: Proposta) {
  const { error } = await supabase.from('propostas_tc').upsert({ ano: p.ano, status: p.status, aprovada_em: p.aprovadaEm ?? null, divulgada_em: p.divulgadaEm ?? null, observacao: p.observacao ?? null });
  checar(error);
}

export async function salvarRubricasProposta(ano: number, rs: RubricaProposta[]) {
  // valor vigente (usado pelo fluxo de caixa e pelo %RUB) = previsto − desconto geral
  await salvarRubricas(rs.map(r => ({ ano, numero: r.numero, descricao: r.descricao, contaContabil: r.contaContabil ?? null, valorAnual: Math.max(0, r.valorPrevisto - r.descontoGeral), percentual: null })));
  for (const r of rs) {
    const { error } = await supabase.from('rubricas').update({ valor_previsto: r.valorPrevisto, desconto_geral: r.descontoGeral, gasto_anterior: r.gastoAnterior ?? null, justificativa_desconto: r.justificativa ?? null }).eq('ano', ano).eq('numero', r.numero);
    checar(error);
  }
}

export async function salvarLotacoes(ano: number, ls: Lotacao[], removidas: string[] = []) {
  if (removidas.length) { const { error } = await supabase.from('lotacoes_tc').delete().eq('ano', ano).in('om_id', removidas); checar(error); }
  if (!ls.length) return;
  const { error } = await supabase.from('lotacoes_tc').upsert(ls.map(l => ({ ano, om_id: l.omId, lotacao: l.lotacao, lotacao_anterior: l.lotacaoAnterior, dias: l.dias })), { onConflict: 'ano,om_id' });
  checar(error);
}

export async function salvarMatriz(ano: number, matriz: Set<string>) {
  const { error: e1 } = await supabase.from('matriz_tc').delete().eq('ano', ano);
  checar(e1);
  const linhas = [...matriz].map(k => { const [r, om] = k.split('|'); return { ano, rubrica: Number(r), om_id: om }; });
  for (let i = 0; i < linhas.length; i += 500) {
    const { error } = await supabase.from('matriz_tc').insert(linhas.slice(i, i + 500));
    checar(error);
  }
}

export async function salvarDesconto(ano: number, d: Desconto) {
  const { error } = await supabase.from('descontos_tc').upsert({ id: d.id || uuidv4(), ano, om_id: d.omId, rubrica: d.rubrica, tipo: d.tipo, valor: d.valor, justificativa: d.justificativa });
  checar(error);
}
export async function excluirDesconto(id: string) { const { error } = await supabase.from('descontos_tc').delete().eq('id', id); checar(error); }

export async function salvarAtracacaoAnual(linhas: AnoClasse[], origem: string) {
  const { error } = await supabase.from('atracacao_anual').upsert(linhas.map(l => ({ ano: l.ano, classe_id: l.classeId, dias: l.dias, navios: l.navios, origem })), { onConflict: 'ano,classe_id' });
  checar(error);
}

/** Dias atracados ("A") de cada classe num ano, somando os mapas BNIC-35 registrados (realizado). */
export async function diasDoBnic35(ano: number, oms: OM[]): Promise<Map<string, number>> {
  const at = (await listarAtracacoes(Array.from({ length: 12 }, (_, i) => `${ano}-${pad(i + 1)}`))).filter(a => !a.previsao);
  const classeDe = new Map(oms.map(o => [o.id, o.classeId]));
  const m = new Map<string, number>();
  at.forEach(a => { const c = classeDe.get(a.omId); if (c) m.set(c, (m.get(c) || 0) + a.diasAtracado); });
  return m;
}

/** Tabela vigente: TC mensal de cada OM e diária de cada navio, gravadas nos Preços do ano (usados pela emissão). */
export async function publicar(ano: number, r: ResultadoRateio, usuario: string) {
  const precos = [
    ...r.oms.filter(o => o.tipo === 'TERRA' && o.mensal > 0).map(o => ({ ano, sigla: 'TC', omId: o.omId, valor: o.mensal, unidade: 'MÊS', descricao: `Proposta ${ano} publicada por ${usuario}` })),
    ...r.oms.filter(o => o.tipo === 'NAVIO' && (o.diaria || 0) > 0).map(o => ({ ano, sigla: 'DA', omId: o.omId, valor: o.diaria!, unidade: 'DIA', descricao: `Proposta ${ano} (${o.regraDiaria === 'SEM_HISTORICO' ? 'classe sem histórico' : 'custo militar-dia × lotação'})` })),
  ];
  await salvarPrecos(precos);
  await salvarProposta({ ano, status: 'DIVULGADA', divulgadaEm: new Date().toISOString().slice(0, 10) });
  return precos.length;
}

/** TC mensal do ano anterior (para o comparativo). */
export async function tcAnterior(ano: number) {
  const p = (await listarPrecos([ano - 1])).filter(x => x.sigla === 'TC' && x.omId);
  return new Map(p.map(x => [x.omId!, x.valor]));
}

export { listarRubricas };
