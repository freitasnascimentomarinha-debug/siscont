/**
 * A qual OM pertence cada ALTCRED/GRU, e com que setor/comando ela aparece.
 *
 * O documento traz o cliente e a UG digitados como vieram do SIPLAD ou da planilha. Para agrupar e conciliar pelo
 * cadastro (e não pelo texto), a OM é achada:
 *   1. pelo nome do cliente (nome da OM ou um dos "outros nomes"), sem diferenciar acento e maiúsculas;
 *   2. pela UG, mas só quando o código é de UMA OM ativa (códigos como 41000 são usados por muitas OM).
 * Setor e comando vêm do cadastro da OM; sem OM, do comando ligado ao documento; sem nada, do texto digitado.
 */
const norm = (t: string) => (t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export interface OMCad { id: string; nome: string; codigo: string; comandoId?: string | null; setorId?: string | null; tipo?: string; ativo: boolean; nomesAlternativos?: string[]; /** UGs que a OM já teve */ codigosAnteriores?: string[] }
export interface ComandoCad { id: string; nome: string; codigo?: string | null; setorId?: string | null }
export interface SetorCad { id: string; sigla: string }
export interface DocRef { /** OM gravada no documento (script 029): vale antes do nome e da UG */ omId?: string | null; client: string; ug?: string | null; comandoId?: string | null; sector?: string; command?: string }
export interface Rotulo { omId: string | null; setor: string; comando: string; cliente: string; comandoId: string | null }

export function criarResolvedor(oms: OMCad[], comandos: ComandoCad[], setores: SetorCad[]) {
  const porNome = new Map<string, OMCad[]>();
  oms.forEach(o => [o.nome, ...(o.nomesAlternativos || [])].forEach(n => { const k = norm(n); if (k) porNome.set(k, [...(porNome.get(k) || []), o]); }));
  const ativasPorCodigo = new Map<string, OMCad[]>();
  // a UG atual e as que a OM já teve (mudou de UG: o documento antigo e a importação do SIPLAD continuam achando a OM)
  oms.filter(o => o.ativo).forEach(o => [o.codigo, ...(o.codigosAnteriores || [])].forEach(c => { const l = ativasPorCodigo.get(c) || []; if (!l.includes(o)) ativasPorCodigo.set(c, [...l, o]); }));
  const porId = new Map(oms.map(o => [o.id, o]));
  const cmd = new Map(comandos.map(c => [c.id, c]));
  const set = new Map(setores.map(s => [s.id, s]));
  const rotuloComando = (c?: ComandoCad) => (c ? `${c.codigo ? `${c.codigo} - ` : ''}${c.nome}` : '');

  /** OM do documento, ou null quando não dá para saber com segurança. */
  const omDoDocumento = (d: DocRef): OMCad | null => {
    if (d.omId && porId.has(d.omId)) return porId.get(d.omId)!;
    const pelo = porNome.get(norm(d.client)) || [];
    if (pelo.length) return pelo.find(o => o.ativo) || pelo[0];
    const pelaUg = d.ug ? ativasPorCodigo.get(d.ug.trim()) || [] : [];
    return pelaUg.length === 1 ? pelaUg[0] : null;
  };
  /** O código é de uma OM só? (senão não serve para identificar o cliente) */
  const codigoUnico = (codigo: string) => (ativasPorCodigo.get(codigo) || []).length === 1;

  const rotuloDaOM = (o: OMCad): Rotulo => {
    const c = o.comandoId ? cmd.get(o.comandoId) : undefined;
    const s = (o.setorId && set.get(o.setorId)) || (c?.setorId && set.get(c.setorId)) || undefined;
    return { omId: o.id, setor: s?.sigla || (o.tipo === 'EXTRA_MB' ? 'EXTRA-MB' : 'Sem setor'), comando: rotuloComando(c) || (o.tipo === 'EXTRA_MB' ? 'EXTRA-MARINHA' : 'Sem comando'), cliente: o.nome, comandoId: c?.id ?? null };
  };
  const rotuloDoDocumento = (d: DocRef): Rotulo => {
    const o = omDoDocumento(d);
    if (o) return rotuloDaOM(o);
    const c = d.comandoId ? cmd.get(d.comandoId) : undefined;
    if (c) return { omId: null, setor: (c.setorId && set.get(c.setorId)?.sigla) || d.sector || 'Sem setor', comando: rotuloComando(c), cliente: d.client || 'Sem cliente', comandoId: c.id };
    return { omId: null, setor: d.sector || 'Sem setor', comando: d.command || 'Sem comando', cliente: d.client || 'Sem cliente', comandoId: null };
  };
  return { omDoDocumento, rotuloDoDocumento, rotuloDaOM, codigoUnico };
}
