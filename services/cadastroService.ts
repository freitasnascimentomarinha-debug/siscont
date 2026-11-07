import { supabase } from './supabase';
import {
  ClasseNavio, Client, Comando, Feriado, OM, Parametro, ServicoCatalogo, Setor, TipoOM,
} from '../types';

/** Lançado quando as tabelas da Fase 1 ainda não foram criadas (script 002 não executado). */
export class CadastroNaoInstaladoError extends Error {
  constructor() {
    super('Os cadastros da Fase 1 ainda não foram instalados no banco. Execute o script supabase/migrations/002_cadastros_fase1.sql no Supabase (SQL Editor).');
  }
}

const isMissingTable = (error: any) => {
  const msg = String(error?.message || '').toLowerCase();
  return error?.code === '42P01' || error?.code === 'PGRST205' || msg.includes('could not find the table') || (msg.includes('relation') && msg.includes('does not exist'));
};

const check = (error: any) => {
  if (!error) return;
  if (isMissingTable(error)) throw new CadastroNaoInstaladoError();
  throw error;
};

const nn = <T,>(v: T | undefined): T | null => (v === undefined || v === '' ? null : v);

// --- mapeamentos banco (snake_case) <-> app (camelCase) ---
const toSetor = (r: any): Setor => ({ id: r.id, sigla: r.sigla, nome: r.nome, ordem: r.ordem ?? 100, ativo: r.ativo !== false });
const toComando = (r: any): Comando => ({
  id: r.id, codigo: r.codigo, nome: r.nome, sigla: r.sigla, setorId: r.setor_id,
  ativo: r.ativo !== false, desativadoEm: r.desativado_em, motivoDesativacao: r.motivo_desativacao,
});
const toClasse = (r: any): ClasseNavio => ({ id: r.id, nome: r.nome, ativo: r.ativo !== false, desativadoEm: r.desativado_em });
const toOM = (r: any): OM => ({
  id: r.id, codigo: r.codigo, nome: r.nome, sigla: r.sigla, indicativoNaval: r.indicativo_naval,
  tipo: (r.tipo || 'TERRA') as TipoOM, comandoId: r.comando_id, setorId: r.setor_id, areaCnic: r.area_cnic,
  lotacao: r.lotacao, classeId: r.classe_id, cnpj: r.cnpj, endereco: r.endereco, emails: r.emails,
  telefone: r.telefone, observacao: r.observacao, ativo: r.ativo !== false, ativadoEm: r.ativado_em,
  desativadoEm: r.desativado_em, motivoDesativacao: r.motivo_desativacao,
});
const toServico = (r: any): ServicoCatalogo => ({
  id: r.id, name: r.name, unitMeasure: r.unit_measure, acronym: (r.acronym || '').trim(),
  nomeOficial: r.nome_oficial, emitidaDeAcordoCom: r.emitida_de_acordo_com, setorResponsavel: r.setor_responsavel,
  telefoneSetor: r.telefone_setor, prazoEnvio: r.prazo_envio, anexoOi: r.anexo_oi, criterio: r.criterio,
  ordem: r.ordem, ativo: r.ativo !== false,
});

const fromSetor = (s: Partial<Setor>) => ({ sigla: s.sigla?.trim(), nome: nn(s.nome?.trim()), ordem: s.ordem ?? 100, ativo: s.ativo ?? true });
const fromComando = (c: Partial<Comando>) => ({
  codigo: nn(c.codigo?.trim()), nome: c.nome?.trim(), sigla: nn(c.sigla?.trim()), setor_id: nn(c.setorId),
  ativo: c.ativo ?? true, desativado_em: nn(c.desativadoEm), motivo_desativacao: nn(c.motivoDesativacao),
});
const fromClasse = (c: Partial<ClasseNavio>) => ({ nome: c.nome?.trim(), ativo: c.ativo ?? true, desativado_em: nn(c.desativadoEm) });
const fromOM = (o: Partial<OM>) => ({
  codigo: o.codigo?.trim(), nome: o.nome?.trim(), sigla: nn(o.sigla?.trim()), indicativo_naval: nn(o.indicativoNaval?.trim()?.toUpperCase()),
  tipo: o.tipo || 'TERRA', comando_id: nn(o.comandoId), setor_id: nn(o.setorId), area_cnic: o.areaCnic ?? null,
  lotacao: o.lotacao ?? null, classe_id: o.tipo === 'NAVIO' ? nn(o.classeId) : null, cnpj: nn(o.cnpj?.trim()),
  endereco: nn(o.endereco?.trim()), emails: nn(o.emails?.trim()), telefone: nn(o.telefone?.trim()),
  observacao: nn(o.observacao?.trim()), ativo: o.ativo ?? true, ativado_em: nn(o.ativadoEm),
  desativado_em: nn(o.desativadoEm), motivo_desativacao: nn(o.motivoDesativacao),
});

async function list<T>(table: string, map: (r: any) => T, order: string): Promise<T[]> {
  const { data, error } = await supabase.from(table).select('*').order(order);
  check(error);
  return (data || []).map(map);
}

async function save(table: string, id: string | undefined, payload: any) {
  const q = id ? supabase.from(table).update(payload).eq('id', id) : supabase.from(table).insert(payload);
  const { error } = await q;
  check(error);
}

async function remove(table: string, id: string) {
  const { error } = await supabase.from(table).delete().eq('id', id);
  check(error);
}

export const cadastroService = {
  // Setores
  listSetores: () => list('setores', toSetor, 'ordem'),
  saveSetor: (s: Partial<Setor>) => save('setores', s.id, fromSetor(s)),
  deleteSetor: (id: string) => remove('setores', id),

  // Comandos
  listComandos: () => list('comandos', toComando, 'nome'),
  saveComando: (c: Partial<Comando>) => save('comandos', c.id, fromComando(c)),
  deleteComando: (id: string) => remove('comandos', id),

  // Classes
  listClasses: () => list('classes_navio', toClasse, 'nome'),
  saveClasse: (c: Partial<ClasseNavio>) => save('classes_navio', c.id, fromClasse(c)),
  deleteClasse: (id: string) => remove('classes_navio', id),

  // OM
  listOMs: () => list('oms', toOM, 'codigo'),
  saveOM: (o: Partial<OM>) => save('oms', o.id, fromOM(o)),
  deleteOM: (id: string) => remove('oms', id),
  omTemMovimento: async (id: string): Promise<boolean> => {
    const { data, error } = await supabase.rpc('om_tem_movimento', { p_om_id: id });
    check(error);
    return !!data;
  },

  // Serviços (tabela service_definitions, ampliada pelo script 002)
  listServicos: async (): Promise<ServicoCatalogo[]> => {
    const { data, error } = await supabase.from('service_definitions').select('*');
    check(error);
    return (data || []).map(toServico).sort((a, b) => (a.ordem ?? 100) - (b.ordem ?? 100) || a.acronym.localeCompare(b.acronym));
  },
  saveServico: async (s: Partial<ServicoCatalogo>) => {
    const payload: any = {
      name: s.name?.trim(), unit_measure: s.unitMeasure?.trim(), acronym: s.acronym?.trim().toUpperCase(),
      nome_oficial: nn(s.nomeOficial?.trim()), emitida_de_acordo_com: nn(s.emitidaDeAcordoCom?.trim()),
      setor_responsavel: nn(s.setorResponsavel?.trim()), telefone_setor: nn(s.telefoneSetor?.trim()),
      prazo_envio: nn(s.prazoEnvio?.trim()), anexo_oi: nn(s.anexoOi?.trim()), criterio: nn(s.criterio?.trim()),
      ordem: s.ordem ?? 100, ativo: s.ativo ?? true,
    };
    if (!s.id) payload.id = crypto.randomUUID();
    await save('service_definitions', s.id, payload);
  },

  // Parâmetros e feriados
  listParametros: async (): Promise<Parametro[]> => {
    const { data, error } = await supabase.from('parametros').select('*').order('chave');
    check(error);
    return (data || []).map(r => ({ chave: r.chave, valor: r.valor ?? '', descricao: r.descricao }));
  },
  saveParametro: async (p: Parametro) => {
    const { error } = await supabase.from('parametros').update({ valor: p.valor }).eq('chave', p.chave);
    check(error);
  },
  listFeriados: async (): Promise<Feriado[]> => {
    const { data, error } = await supabase.from('feriados').select('*').order('data');
    check(error);
    return (data || []) as Feriado[];
  },
  saveFeriado: async (f: Feriado) => {
    const { error } = await supabase.from('feriados').upsert(f);
    check(error);
  },
  deleteFeriado: async (data: string) => {
    const { error } = await supabase.from('feriados').delete().eq('data', data);
    check(error);
  },
};

/**
 * Converte o cadastro novo para o formato antigo `Client` usado pelas telas de
 * Faturas e Saldos (preenchimento automático pelo código). Só OM ativas.
 */
export function omsToClients(oms: OM[], comandos: Comando[], setores: Setor[]): Client[] {
  const cmd = new Map(comandos.map(c => [c.id, c]));
  const set = new Map(setores.map(s => [s.id, s]));
  return oms
    .filter(o => o.ativo)
    .map(o => {
      const c = o.comandoId ? cmd.get(o.comandoId) : undefined;
      const setorId = o.setorId || c?.setorId || undefined;
      return {
        id: o.id,
        ug: o.codigo,
        name: o.nome,
        sector: (setorId && set.get(setorId)?.sigla) || '',
        command: c ? (c.codigo ? `${c.codigo} - ${c.nome}` : c.nome) : '',
      };
    });
}
