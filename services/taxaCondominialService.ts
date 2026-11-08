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
  if (/pendentes_tc|destino|desconto_planilha/.test(error.message || '')) throw new Error('Falta executar o script supabase/migrations/012_clientes_taxas.sql no Supabase.');
  throw new Error(error.message);
};

export type StatusProposta = 'PROPOSTA' | 'APROVADA' | 'DIVULGADA';
export interface Proposta { ano: number; status: StatusProposta; aprovadaEm?: string | null; divulgadaEm?: string | null; observacao?: string | null; /** total do grupo Navios na planilha importada (conferência) */ naviosPlanilha?: number | null }
export type Destino = 'TC' | 'DA' | 'PAR';
export interface RubricaProposta extends RubricaTC {
  contaContabil?: string | null; gastoAnterior?: number | null; justificativa?: string | null;
  /** TC = taxa condominial (OM de terra); DA = linha "Navios" (diárias de atracação); PAR = fora da taxa, só para o PAR */
  destino: Destino;
  /** parte desta rubrica paga pelos navios (aba NAVIOS); a soma de todas é o valor rateado entre os navios */
  parcelaNavios?: number | null;
  /** por que este valor (memória para conferência) */
  justificativaValor?: string | null;
  /** coluna DESCONTOS da planilha importada (conferência) */
  descontoPlanilha?: number | null;
}
/** Linha da planilha sem correspondente no cadastro, guardada para decidir depois. */
export interface Pendente {
  id: string; ano: number; nome: string; tipo: 'TERRA' | 'NAVIO'; lotacao: number | null; lotacaoAnterior: number | null; dias: number | null;
  rubricas: number[]; descontos: { rubrica: number; valor: number }[];
}
export const destinoPadrao = (descricao: string): Destino => (/\bNAVIOS?\b/i.test(descricao) ? 'DA' : 'TC');
export interface Subsidio { id: string; ano: number; rubrica: number; descricao: string; documento: string | null; valor: number; observacao: string | null; criadoPor?: string | null }
export interface Anexo { id: string; ano: number; rubrica: number; nomeArquivo: string; caminho: string; tamanho: number | null; tipo: string | null; descricao: string | null; enviadoPor: string | null; createdAt: string }
export interface Fechado { tipo?: 'TC' | 'DA'; nome: string; omId: string | null; anteriorAnual: number | null; anteriorMensal: number | null; proposta: number | null; descontos: number | null; atualizada: number | null; mensal: number | null }
export interface ExtratoPlanilha { nome: string; omId: string | null; rubrica: number; bruto: number; desconto: number; liquido: number }
export interface Lotacao { omId: string; lotacao: number; lotacaoAnterior: number | null; /** dias/mês informados (navio); vazio = média trienal da classe */ dias: number | null; /** área ocupada (m²) e peso informado, para os critérios por área e por peso */ area?: number | null; peso?: number | null }

export interface DadosProposta {
  proposta: Proposta; rubricas: RubricaProposta[]; lotacoes: Lotacao[]; matriz: Set<string>; descontos: Desconto[];
  atracacaoAnual: AnoClasse[]; oms: OM[]; classes: ClasseNavio[]; pendentes: Pendente[];
  subsidios: Subsidio[]; anexos: Anexo[]; fechados: Fechado[]; extratos: ExtratoPlanilha[];
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
  const pend = await supabase.from('pendentes_tc').select('*').eq('ano', ano); // ausente antes do script 012
  // tabelas do script 013 (vazias se ainda não executado)
  const [sub, anx, fec, ext] = await Promise.all(['subsidios_tc', 'anexos_tc', 'fechados_tc', 'extratos_tc'].map(t => supabase.from(t).select('*').eq('ano', ano)));
  const ok = (x: any) => (x.error ? [] : x.data || []);
  const N = (v: any) => (v == null ? null : Number(v));
  [p, rub, lot, mat, desc, atr].forEach(r => checar(r.error));
  return {
    proposta: p.data ? { ano, status: p.data.status, aprovadaEm: p.data.aprovada_em, divulgadaEm: p.data.divulgada_em, observacao: p.data.observacao, naviosPlanilha: p.data.navios_planilha == null ? null : Number(p.data.navios_planilha) } : { ano, status: 'PROPOSTA' },
    rubricas: (rub.data || []).map(r => ({
      numero: r.numero, descricao: r.descricao, contaContabil: r.conta_contabil, valorPrevisto: Number(r.valor_previsto ?? r.valor_anual ?? 0),
      descontoGeral: Number(r.desconto_geral ?? 0), gastoAnterior: r.gasto_anterior === null || r.gasto_anterior === undefined ? null : Number(r.gasto_anterior), justificativa: r.justificativa_desconto,
      destino: (['TC', 'DA', 'PAR'].includes(r.destino) ? r.destino : destinoPadrao(r.descricao || '')) as Destino,
      descontoPlanilha: r.desconto_planilha == null ? null : Number(r.desconto_planilha),
      parcelaNavios: N(r.parcela_navios), justificativaValor: r.justificativa_valor ?? null,
      criterio: (r.criterio || 'LOTACAO'), percentualOM: r.percentual_om == null ? 100 : Number(r.percentual_om), modoNavios: r.modo_navios === 'CONJUNTO' ? 'CONJUNTO' : 'SEPARADO',
      // antes do 014 só havia a parte dos navios em R$: vira percentual do valor previsto
      percentualNavios: r.percentual_navios != null ? Number(r.percentual_navios) : (r.parcela_navios && Number(r.valor_previsto ?? r.valor_anual) ? Math.round((Number(r.parcela_navios) / Number(r.valor_previsto ?? r.valor_anual)) * 1e6) / 1e4 : 0),
    })),
    lotacoes: (lot.data || []).map(l => ({ omId: l.om_id, lotacao: Number(l.lotacao), lotacaoAnterior: l.lotacao_anterior == null ? null : Number(l.lotacao_anterior), dias: l.dias === null || l.dias === undefined ? null : Number(l.dias), area: l.area == null ? null : Number(l.area), peso: l.peso == null ? null : Number(l.peso) })),
    matriz: new Set((mat.data || []).map(m => `${m.rubrica}|${m.om_id}`)),
    descontos: (desc.data || []).map(d => ({ id: d.id, omId: d.om_id, rubrica: d.rubrica, tipo: d.tipo, valor: Number(d.valor), justificativa: d.justificativa || '' })),
    atracacaoAnual: (atr.data || []).map(a => ({ ano: a.ano, classeId: a.classe_id, dias: Number(a.dias), navios: a.navios })),
    oms, classes,
    pendentes: pend.error ? [] : (pend.data || []).map(x => ({
      id: x.id, ano: x.ano, nome: x.nome, tipo: x.tipo, lotacao: x.lotacao == null ? null : Number(x.lotacao), lotacaoAnterior: x.lotacao_anterior == null ? null : Number(x.lotacao_anterior),
      dias: x.dias == null ? null : Number(x.dias), rubricas: x.rubricas || [], descontos: x.descontos || [],
    })),
    subsidios: ok(sub).map((x: any) => ({ id: x.id, ano: x.ano, rubrica: x.rubrica, descricao: x.descricao, documento: x.documento, valor: Number(x.valor), observacao: x.observacao, criadoPor: x.criado_por })),
    anexos: ok(anx).map((x: any) => ({ id: x.id, ano: x.ano, rubrica: x.rubrica, nomeArquivo: x.nome_arquivo, caminho: x.caminho, tamanho: N(x.tamanho), tipo: x.tipo, descricao: x.descricao, enviadoPor: x.enviado_por, createdAt: x.created_at })),
    fechados: ok(fec).map((x: any) => ({ tipo: x.tipo === 'DA' ? 'DA' : 'TC', nome: x.nome, omId: x.om_id, anteriorAnual: N(x.anterior_anual), anteriorMensal: N(x.anterior_mensal), proposta: N(x.proposta), descontos: N(x.descontos), atualizada: N(x.atualizada), mensal: N(x.mensal) })),
    extratos: ok(ext).map((x: any) => ({ nome: x.nome, omId: x.om_id, rubrica: x.rubrica, bruto: Number(x.bruto || 0), desconto: Number(x.desconto || 0), liquido: Number(x.liquido || 0) })),
  };
}

export async function salvarProposta(p: Proposta) {
  const reg: any = { ano: p.ano, status: p.status, aprovada_em: p.aprovadaEm ?? null, divulgada_em: p.divulgadaEm ?? null, observacao: p.observacao ?? null, ...(p.naviosPlanilha !== undefined ? { navios_planilha: p.naviosPlanilha } : {}) };
  let { error } = await supabase.from('propostas_tc').upsert(reg);
  if (error && /navios_planilha/.test(error.message || '')) { delete reg.navios_planilha; ({ error } = await supabase.from('propostas_tc').upsert(reg)); }
  checar(error);
}

export async function salvarRubricasProposta(ano: number, rs: RubricaProposta[]) {
  // valor vigente (usado pelo fluxo de caixa e pelo %RUB) = previsto − desconto geral
  await salvarRubricas(rs.map(r => ({ ano, numero: r.numero, descricao: r.descricao, contaContabil: r.contaContabil ?? null, valorAnual: Math.max(0, r.valorPrevisto - r.descontoGeral), percentual: null })));
  for (const r of rs) {
    const base = { valor_previsto: r.valorPrevisto, desconto_geral: r.descontoGeral, gasto_anterior: r.gastoAnterior ?? null, justificativa_desconto: r.justificativa ?? null };
    const criterios = { criterio: r.criterio || 'LOTACAO', percentual_om: r.percentualOM ?? 100, percentual_navios: r.percentualNavios ?? 0, modo_navios: r.modoNavios || 'SEPARADO' };
    let { error } = await supabase.from('rubricas').update({ ...base, ...criterios, destino: r.destino, desconto_planilha: r.descontoPlanilha ?? null, parcela_navios: r.parcelaNavios ?? null, justificativa_valor: r.justificativaValor ?? null }).eq('ano', ano).eq('numero', r.numero);
    if (error && /criterio|percentual_om|percentual_navios|modo_navios/.test(error.message || '')) {
      const padrao = (r.criterio || 'LOTACAO') === 'LOTACAO' && (r.percentualOM ?? 100) === 100 && (r.modoNavios || 'SEPARADO') === 'SEPARADO';
      if (!padrao) throw new Error('Para mudar o critério de rateio, execute o script supabase/migrations/014_criterios_rateio.sql no Supabase.');
      // antes do 014: guarda a parte dos navios em R$
      ({ error } = await supabase.from('rubricas').update({ ...base, destino: r.destino, desconto_planilha: r.descontoPlanilha ?? null, parcela_navios: r.percentualNavios ? Math.round(r.valorPrevisto * r.percentualNavios) / 100 : r.parcelaNavios ?? null, justificativa_valor: r.justificativaValor ?? null }).eq('ano', ano).eq('numero', r.numero));
    }
    if (error && /parcela_navios|justificativa_valor|rubricas_destino_ck/.test(error.message || '')) {
      if (r.destino === 'PAR' || r.parcelaNavios || r.justificativaValor) throw new Error('Falta executar o script supabase/migrations/013_subsidios_conferencia.sql no Supabase (destino PAR, parcela dos navios e justificativa do valor).');
      ({ error } = await supabase.from('rubricas').update({ ...base, destino: r.destino, desconto_planilha: r.descontoPlanilha ?? null }).eq('ano', ano).eq('numero', r.numero)); // antes do 013
    }
    if (error && /destino|desconto_planilha/.test(error.message || '')) ({ error } = await supabase.from('rubricas').update(base).eq('ano', ano).eq('numero', r.numero)); // antes do 012
    checar(error);
  }
}

export async function salvarLotacoes(ano: number, ls: Lotacao[], removidas: string[] = []) {
  if (removidas.length) { const { error } = await supabase.from('lotacoes_tc').delete().eq('ano', ano).in('om_id', removidas); checar(error); }
  if (!ls.length) return;
  const linhas = ls.map(l => ({ ano, om_id: l.omId, lotacao: l.lotacao, lotacao_anterior: l.lotacaoAnterior, dias: l.dias, ...(l.area != null || l.peso != null ? { area: l.area ?? null, peso: l.peso ?? null } : {}) }));
  let { error } = await supabase.from('lotacoes_tc').upsert(linhas, { onConflict: 'ano,om_id' });
  if (error && /area|peso/.test(error.message || '')) throw new Error('Para usar área ou peso informado, execute o script supabase/migrations/014_criterios_rateio.sql no Supabase.');
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
/** Descontos por OM vindos da planilha: substitui os importados antes (os lançados à mão ficam). */
export const JUSTIFICATIVA_IMPORTADA = 'Importado da planilha (aba PROPOSTA CONDOMINIO)';
export async function importarDescontos(ano: number, ds: { omId: string; rubrica: number; valor: number }[]) {
  const { error: e1 } = await supabase.from('descontos_tc').delete().eq('ano', ano).eq('justificativa', JUSTIFICATIVA_IMPORTADA);
  checar(e1);
  if (!ds.length) return;
  const { error } = await supabase.from('descontos_tc').insert(ds.map(d => ({ id: uuidv4(), ano, om_id: d.omId, rubrica: d.rubrica, tipo: 'VALOR', valor: d.valor, justificativa: JUSTIFICATIVA_IMPORTADA })));
  checar(error);
}

// ------------------------------------------------------------------ pendentes (nomes sem correspondente)
export async function salvarPendentes(ano: number, ps: Omit<Pendente, 'id' | 'ano'>[]) {
  if (!ps.length) return;
  const { error: e1 } = await supabase.from('pendentes_tc').delete().eq('ano', ano).in('nome', ps.map(p => p.nome));
  checar(e1);
  const { error } = await supabase.from('pendentes_tc').insert(ps.map(p => ({
    id: uuidv4(), ano, nome: p.nome, tipo: p.tipo, lotacao: p.lotacao, lotacao_anterior: p.lotacaoAnterior, dias: p.dias, rubricas: p.rubricas, descontos: p.descontos,
  })));
  checar(error);
}
export async function excluirPendente(id: string) { const { error } = await supabase.from('pendentes_tc').delete().eq('id', id); checar(error); }

/** Liga a pendência a uma OM do cadastro: grava lotação, participação nas rubricas e descontos, e apaga a pendência. */
export async function resolverPendente(p: Pendente, omId: string, om?: OM) {
  if (p.lotacao) await salvarLotacoes(p.ano, [{ omId, lotacao: p.lotacao, lotacaoAnterior: p.lotacaoAnterior, dias: p.tipo === 'NAVIO' ? p.dias : null }]);
  if (p.rubricas.length) {
    const { error } = await supabase.from('matriz_tc').upsert(p.rubricas.map(r => ({ ano: p.ano, rubrica: r, om_id: omId })), { onConflict: 'ano,rubrica,om_id' });
    checar(error);
  }
  if (p.descontos.length) {
    const { error } = await supabase.from('descontos_tc').insert(p.descontos.map(d => ({ id: uuidv4(), ano: p.ano, om_id: omId, rubrica: d.rubrica, tipo: 'VALOR', valor: d.valor, justificativa: JUSTIFICATIVA_IMPORTADA })));
    checar(error);
  }
  // o nome da planilha passa a ser reconhecido nas próximas importações
  if (om && !(om.nomesAlternativos || []).includes(p.nome)) await supabase.rpc('om_adicionar_nome_alternativo', { p_om: omId, p_nome: p.nome }).then(() => undefined, () => undefined);
  await excluirPendente(p.id);
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
export async function publicar(ano: number, r: ResultadoRateio, usuario: string, parte: 'TC' | 'DA' = 'TC') {
  const precos = parte === 'TC'
    ? r.oms.filter(o => o.tipo === 'TERRA' && o.mensal > 0).map(o => ({ ano, sigla: 'TC', omId: o.omId, valor: o.mensal, unidade: 'MÊS', descricao: `Proposta ${ano} publicada por ${usuario}` }))
    : r.oms.filter(o => o.tipo === 'NAVIO' && (o.diaria || 0) > 0).map(o => ({ ano, sigla: 'DA', omId: o.omId, valor: o.diaria!, unidade: 'DIA', descricao: `Proposta ${ano} publicada por ${usuario} (${o.regraDiaria === 'SEM_HISTORICO' ? 'classe sem histórico' : 'custo militar-dia × lotação'})` }));
  await salvarPrecos(precos);
  await salvarProposta({ ano, status: 'DIVULGADA', divulgadaEm: new Date().toISOString().slice(0, 10) });
  return precos.length;
}

/** TC mensal e diária do ano anterior (para os comparativos). */
export async function tcAnterior(ano: number, sigla: 'TC' | 'DA' = 'TC') {
  const p = (await listarPrecos([ano - 1])).filter(x => x.sigla === sigla && x.omId);
  return new Map(p.map(x => [x.omId!, x.valor]));
}

export { listarRubricas };

// ------------------------------------------------------------------ subsídios, contratos e conferência (script 013)
const falta013 = (e: any) => { if (e && /subsidios_tc|anexos_tc|fechados_tc|extratos_tc|bucket/i.test(e.message || '')) throw new Error('Falta executar o script supabase/migrations/013_subsidios_conferencia.sql no Supabase.'); checar(e); };

export async function salvarSubsidio(s: Omit<Subsidio, 'id'> & { id?: string }) {
  const { error } = await supabase.from('subsidios_tc').upsert({ id: s.id || uuidv4(), ano: s.ano, rubrica: s.rubrica, descricao: s.descricao.trim(), documento: s.documento?.trim() || null, valor: s.valor, observacao: s.observacao?.trim() || null, criado_por: s.criadoPor ?? null });
  falta013(error);
}
export async function excluirSubsidio(id: string) { const { error } = await supabase.from('subsidios_tc').delete().eq('id', id); falta013(error); }
export async function importarSubsidios(ano: number, linhas: Omit<Subsidio, 'id' | 'ano'>[]) {
  if (!linhas.length) return;
  const { error } = await supabase.from('subsidios_tc').insert(linhas.map(l => ({ id: uuidv4(), ano, rubrica: l.rubrica, descricao: l.descricao, documento: l.documento, valor: l.valor, observacao: l.observacao, criado_por: l.criadoPor ?? null })));
  falta013(error);
}

const BUCKET = 'contratos-tc';
const nomeSeguro = (n: string) => n.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '_').slice(-120);
/** Envia o arquivo para o Storage privado e registra o anexo da rubrica. */
export async function enviarAnexo(ano: number, rubrica: number, arquivo: File, descricao: string, usuario: string) {
  const caminho = `${ano}/${rubrica}/${uuidv4()}-${nomeSeguro(arquivo.name)}`;
  const up = await supabase.storage.from(BUCKET).upload(caminho, arquivo, { contentType: arquivo.type || undefined, upsert: false });
  if (up.error) falta013(up.error);
  const { error } = await supabase.from('anexos_tc').insert({ id: uuidv4(), ano, rubrica, nome_arquivo: arquivo.name, caminho, tamanho: arquivo.size, tipo: arquivo.type || null, descricao: descricao.trim() || null, enviado_por: usuario });
  if (error) { await supabase.storage.from(BUCKET).remove([caminho]); falta013(error); }
}
export async function linkAnexo(caminho: string) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(caminho, 300);
  falta013(error);
  return data!.signedUrl;
}
export async function excluirAnexo(a: Anexo) {
  await supabase.storage.from(BUCKET).remove([a.caminho]);
  const { error } = await supabase.from('anexos_tc').delete().eq('id', a.id);
  falta013(error);
}

/** Guarda os valores fechados e os extratos da planilha importada (substitui os do ano). */
export async function salvarConferencia(ano: number, fechados: Fechado[], extratos: ExtratoPlanilha[]) {
  const d1 = await supabase.from('fechados_tc').delete().eq('ano', ano);
  if (d1.error && /fechados_tc/.test(d1.error.message)) return false; // sem o 013: a conferência só não fica guardada
  await supabase.from('extratos_tc').delete().eq('ano', ano);
  if (fechados.length) falta013((await supabase.from('fechados_tc').insert(fechados.map(f => ({ ano, tipo: f.tipo || 'TC', nome: f.nome, om_id: f.omId, anterior_anual: f.anteriorAnual, anterior_mensal: f.anteriorMensal, proposta: f.proposta, descontos: f.descontos, atualizada: f.atualizada, mensal: f.mensal })))).error);
  for (let i = 0; i < extratos.length; i += 500) {
    falta013((await supabase.from('extratos_tc').insert(extratos.slice(i, i + 500).map(e => ({ ano, nome: e.nome, om_id: e.omId, rubrica: e.rubrica, bruto: e.bruto, desconto: e.desconto, liquido: e.liquido })))).error);
  }
  return true;
}


/**
 * Rubricas consolidadas do ano (valor final por rubrica, depois dos descontos das OM), calculadas com os dados da
 * Taxa condominial — é o que o Fluxo de caixa mostra e usa no %RUB. Retorna `semRateio` quando a proposta do ano
 * ainda não tem OM com lotação (nada a ratear).
 */
export async function rubricasConsolidadas(ano: number): Promise<{ rubricas: import('../utils/taxaConsolidada').RubricaConsolidada[]; semRateio: boolean; status: string }> {
  const [{ calcularTaxaAno, consolidarRubricas }, { cadastroService }] = await Promise.all([import('../utils/taxaConsolidada'), import('./cadastroService')]);
  const [dados, parametros] = await Promise.all([carregarProposta(ano), cadastroService.listParametros().catch(() => [])]);
  const calc = calcularTaxaAno(dados, ano, parametros as any);
  return { rubricas: consolidarRubricas(dados, calc), semRateio: !calc.resultado.oms.length, status: dados.proposta?.status || 'PROPOSTA' };
}
