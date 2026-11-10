/**
 * Histórico de dados da OM com data de vigência (script 029).
 * Mudou de nome, UG, comando ou setor? O cadastro guarda o valor de hoje e cada mudança com a data em que passou a valer;
 * daqui se descobre como a OM era numa data qualquer. Fatura já emitida NÃO é reescrita: este histórico serve para o que
 * ainda vai ser emitido ou consultado.
 */
import type { OM, OMHistorico } from '../types';

export interface DadosDaOM { nome: string; codigo: string; comandoId: string | null; setorId: string | null; sigla: string | null }

const CAMPO: Record<OMHistorico['campo'], keyof DadosDaOM> = { nome: 'nome', codigo: 'codigo', comando_id: 'comandoId', setor_id: 'setorId', sigla: 'sigla' };

/** Como a OM era em `data` (AAAA-MM-DD): desfaz, do mais novo para o mais antigo, as mudanças que só valem depois dessa data. */
export function dadosDaOMEm(om: Pick<OM, 'nome' | 'codigo' | 'comandoId' | 'setorId' | 'sigla'>, historico: OMHistorico[], data: string): DadosDaOM {
  const d: DadosDaOM = { nome: om.nome, codigo: om.codigo, comandoId: om.comandoId ?? null, setorId: om.setorId ?? null, sigla: om.sigla ?? null };
  [...historico]
    .sort((a, b) => b.vigenteDesde.localeCompare(a.vigenteDesde) || String(b.criadoEm || '').localeCompare(String(a.criadoEm || '')))
    .forEach(h => {
      if (h.vigenteDesde > data) (d as any)[CAMPO[h.campo]] = h.valorAnterior;
    });
  return d;
}

/** Histórico agrupado por data e ato (uma "mudança" pode alterar vários campos de uma vez). */
export function mudancasAgrupadas(historico: OMHistorico[]) {
  const m = new Map<string, { chave: string; vigenteDesde: string; ato: string; motivo: string; campos: OMHistorico[] }>();
  historico.forEach(h => {
    const chave = `${h.vigenteDesde}|${h.ato || ''}|${h.motivo || ''}|${(h.criadoEm || '').slice(0, 16)}`;
    const g = m.get(chave) || { chave, vigenteDesde: h.vigenteDesde, ato: h.ato || '', motivo: h.motivo || '', campos: [] };
    g.campos.push(h); m.set(chave, g);
  });
  return [...m.values()].sort((a, b) => b.vigenteDesde.localeCompare(a.vigenteDesde));
}

export const ROTULO_CAMPO: Record<OMHistorico['campo'], string> = { nome: 'Nome', codigo: 'UG', comando_id: 'Comando', setor_id: 'Setor', sigla: 'Sigla' };
