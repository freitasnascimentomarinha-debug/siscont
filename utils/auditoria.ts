/** Fase 7 — trilha de auditoria e backup assistido (funções puras). */
export const TABELAS_AUDITADAS: Record<string, string> = {
  invoices: 'Faturas', payment_allocations: 'Baixas', received_documents: 'ALTCRED / GRU', cash_flow_exits: 'Saídas (fluxo de caixa)',
  contestacoes: 'Contestações', lotes_faturamento: 'Lotes de faturamento', precos: 'Preços', parametros: 'Parâmetros',
  propostas_tc: 'Proposta da taxa condominial', descontos_tc: 'Descontos da taxa', profiles: 'Usuários',
};
export const ACOES: Record<string, string> = { INSERT: 'Inclusão', UPDATE: 'Alteração', DELETE: 'Exclusão' };
const IGNORAR = new Set(['updated_at', 'created_at']);

export interface RegistroAuditoria {
  id: number; tabela: string; registroId: string; acao: 'INSERT' | 'UPDATE' | 'DELETE'; em: string;
  usuarioId: string | null; usuarioEmail: string | null; antes: Record<string, any> | null; depois: Record<string, any> | null;
}
export interface Diferenca { campo: string; de: any; para: any }

/** Campos alterados (na inclusão, os preenchidos; na exclusão, os que existiam). */
export function diferencas(r: Pick<RegistroAuditoria, 'acao' | 'antes' | 'depois'>): Diferenca[] {
  const a = r.antes || {}, d = r.depois || {};
  const campos = [...new Set([...Object.keys(a), ...Object.keys(d)])].filter(c => !IGNORAR.has(c));
  return campos
    .filter(c => JSON.stringify(a[c] ?? null) !== JSON.stringify(d[c] ?? null))
    .filter(c => r.acao !== 'INSERT' || (d[c] !== null && d[c] !== ''))
    .map(c => ({ campo: c, de: a[c] ?? null, para: d[c] ?? null }))
    .sort((x, y) => x.campo.localeCompare(y.campo));
}

/** Resumo em uma linha: "status: PENDENTE → PAGO; valor: 10 → 12". */
export function resumo(r: RegistroAuditoria, max = 4): string {
  const ds = diferencas(r);
  if (r.acao === 'INSERT') return `incluído (${ds.length} campos)`;
  if (r.acao === 'DELETE') return `excluído${r.antes?.invoice_number ? ` (${r.antes.invoice_number})` : r.antes?.numero ? ` (${r.antes.numero})` : ''}`;
  const txt = ds.slice(0, max).map(x => `${x.campo}: ${valorCurto(x.de)} → ${valorCurto(x.para)}`).join('; ');
  return ds.length > max ? `${txt}; +${ds.length - max}` : txt || 'sem mudança de conteúdo';
}
export const valorCurto = (v: any) => {
  if (v === null || v === undefined || v === '') return '∅';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return s.length > 40 ? `${s.slice(0, 37)}…` : s;
};

/** Dias desde o último backup (null = nunca registrado). */
export function diasSemBackup(ultimo: string | null | undefined, hoje = new Date()): number | null {
  if (!ultimo) return null;
  const t = Date.parse(ultimo);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((hoje.getTime() - t) / 86400000));
}
export const backupAtrasado = (dias: number | null, limite = 7) => dias === null || dias > limite;
