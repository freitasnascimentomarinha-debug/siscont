/**
 * Público dos relatórios: MB (OM da Marinha) × Extra-MB (clientes de fora da Marinha: bancos, empresas...).
 * A classificação vem do CADASTRO da OM (tipo EXTRA_MB); sem OM ligada, pelo texto de setor/comando ("EXTRA").
 */
export type Publico = 'TODOS' | 'MB' | 'EXTRA';
export const ROTULO_PUBLICO: Record<Publico, string> = { TODOS: 'Todos', MB: 'MB', EXTRA: 'Extra-MB' };
/** Sufixo para títulos de PDF/Excel e nomes de arquivo. */
export const sufixoPublico = (p: Publico) => (p === 'EXTRA' ? ' — Extra-Marinha' : p === 'MB' ? ' — MB (sem Extra-Marinha)' : '');
export const arquivoPublico = (p: Publico) => (p === 'EXTRA' ? '_extra_mb' : p === 'MB' ? '_mb' : '');
export const passaPublico = (p: Publico, extra: boolean) => p === 'TODOS' || (p === 'EXTRA') === extra;

const norm = (t: string) => (t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const textoExtra = (...t: (string | null | undefined)[]) => t.some(x => /extra/i.test(x || ''));

export interface OMTipo { id: string; nome: string; tipo?: string | null; ativo?: boolean; codigo?: string; nomesAlternativos?: string[] }

export function criarClassificador(oms: OMTipo[]) {
  const extraIds = new Set(oms.filter(o => o.tipo === 'EXTRA_MB').map(o => o.id));
  const porNome = new Map<string, OMTipo>();
  oms.forEach(o => [o.nome, ...(o.nomesAlternativos || [])].forEach(n => { const k = norm(n); if (k && !porNome.has(k)) porNome.set(k, o); }));
  const omExtra = (omId?: string | null) => !!omId && extraIds.has(omId);
  /** Fatura: pela OM ligada; sem OM, pelo nome do cliente no cadastro ou pelo texto de setor/comando. */
  const faturaExtra = (f: { omId?: string | null; client?: string; sector?: string; command?: string }) => {
    if (f.omId && oms.some(o => o.id === f.omId)) return extraIds.has(f.omId);
    const o = f.client ? porNome.get(norm(f.client)) : undefined;
    return o ? o.tipo === 'EXTRA_MB' : textoExtra(f.sector, f.command);
  };
  /** Documento (ALTCRED/GRU): pelo cliente no cadastro; senão pelo texto de setor/comando. */
  const docExtra = (d: { client?: string; sector?: string; command?: string }) => {
    const o = d.client ? porNome.get(norm(d.client)) : undefined;
    return o ? o.tipo === 'EXTRA_MB' : textoExtra(d.sector, d.command);
  };
  return { omExtra, faturaExtra, docExtra, extraIds };
}
