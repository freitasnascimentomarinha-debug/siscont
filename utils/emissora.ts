/**
 * OM responsável pela emissão das faturas (hoje a BNIC). Ela entra nos rateios só para controle e contabilidade de
 * custos — a OM não é cliente de si mesma, então nunca recebe fatura. Pode ser trocada em Cadastros › Parâmetros, e
 * dá para escolher se ela participa ou não dos rateios (taxa condominial).
 *
 * Parâmetros (tabela parametros): om_emissora_id (id da OM no cadastro) e om_emissora_rateio ('SIM' | 'NAO').
 * Sem o parâmetro, procura a OM pela sigla BNIC / nome "Base Naval da Ilha das Cobras" / código OMPS-E.
 */
import { chave } from './cadastroImport';

export interface Emissora { omId: string | null; nome: string; codigo: string; participaRateio: boolean; definidaNosParametros: boolean }
type OMBase = { id: string; nome: string; codigo: string; sigla?: string | null; tipo: string; ativo?: boolean; codigoProprio?: boolean };
type Param = { chave: string; valor: string | null };

export const PARAM_EMISSORA = 'om_emissora_id';
export const PARAM_EMISSORA_RATEIO = 'om_emissora_rateio';

export function resolverEmissora(oms: OMBase[], parametros: Param[]): Emissora {
  const p = (k: string) => parametros.find(x => x.chave === k)?.valor ?? null;
  const participaRateio = (p(PARAM_EMISSORA_RATEIO) || 'SIM').toUpperCase() !== 'NAO';
  const id = p(PARAM_EMISSORA);
  let om = id ? oms.find(o => o.id === id) : undefined;
  const definida = !!om;
  if (!om) {
    const codigo = p('codigo_omps') || '40015';
    const terra = oms.filter(o => o.tipo !== 'NAVIO' && o.ativo !== false);
    om = terra.find(o => chave(o.sigla) === 'bnic')
      ?? terra.find(o => chave(o.nome).includes('basenavaldailhadascobras'))
      ?? terra.find(o => chave(o.nome) === 'bnic')
      ?? terra.find(o => o.codigo === codigo && o.codigoProprio !== false && o.tipo === 'TERRA');
  }
  return { omId: om?.id ?? null, nome: om?.nome ?? '', codigo: om?.codigo ?? '', participaRateio, definidaNosParametros: definida };
}

/** "Arsenal de Marinha do Rio de Janeiro - BGL1 (Ed.16)" → responsável, complemento (quem consome) e edifício. */
export function partesDoNome(nome: string): { responsavel: string; complemento: string | null; edificio: string | null } {
  const t = String(nome || '').replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
  const ed = t.match(/\(?\b(?:ED(?:IF[IÍ]CIO)?)\.?\s*(\d+[A-Z]?)\b[^)]*\)?/i);
  const semEd = ed ? t.replace(ed[0], ' ').replace(/\s+/g, ' ').trim() : t;
  const i = semEd.lastIndexOf(' - ');
  const responsavel = (i > 0 ? semEd.slice(0, i) : semEd).trim();
  const complemento = i > 0 ? semEd.slice(i + 3).trim() || null : null;
  return { responsavel, complemento, edificio: ed ? ed[1].toUpperCase() : null };
}
