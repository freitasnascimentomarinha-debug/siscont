/**
 * Situação da solicitação (ALTCRED) no SIPLAD, em grupos que o sistema entende.
 * Só "Processada" significa que o crédito já entrou; "Aguardando processamento" e "Em análise" ainda podem mudar;
 * "Devolvida", "Cancelada/rejeitada" e "Não processada" não são recebimento.
 */
export type CodigoSituacao = 'PROCESSADA' | 'AGUARDANDO' | 'EM_ANALISE' | 'NAO_PROCESSADA' | 'DEVOLVIDA' | 'CANCELADA' | 'SEM_INFO' | 'OUTRA';

export interface SituacaoSiplad {
  codigo: CodigoSituacao; rotulo: string; texto: string;
  /** o crédito já entrou na BNIC */
  recebido: boolean;
  /** sugestão ao importar: false = vem marcada como "Não importar" */
  importarPadrao: boolean;
  /** classes (Tailwind) da etiqueta */
  classe: string;
  explicacao: string;
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function classificarSituacao(texto?: string | null): SituacaoSiplad {
  const t = norm(String(texto || '').trim());
  const base = { texto: String(texto || '').trim() };
  if (!t || t === '--') return { ...base, codigo: 'SEM_INFO', rotulo: 'Situação não informada', recebido: true, importarPadrao: true, classe: 'bg-slate-100 text-slate-600', explicacao: 'O PDF não trouxe a situação; tratada como recebida.' };
  if (/nao processad/.test(t)) return { ...base, codigo: 'NAO_PROCESSADA', rotulo: 'Não processada', recebido: false, importarPadrao: false, classe: 'bg-red-100 text-red-700', explicacao: 'O SIPLAD não processou a solicitação: o crédito não entrou.' };
  if (/devolvid/.test(t)) return { ...base, codigo: 'DEVOLVIDA', rotulo: 'Devolvida à origem', recebido: false, importarPadrao: false, classe: 'bg-red-100 text-red-700', explicacao: 'A solicitação voltou para o solicitante: o crédito não entrou.' };
  if (/cancelad|rejeitad|indeferid|negad|anulad/.test(t)) return { ...base, codigo: 'CANCELADA', rotulo: 'Cancelada / rejeitada', recebido: false, importarPadrao: false, classe: 'bg-red-100 text-red-700', explicacao: 'A solicitação foi cancelada ou rejeitada: o crédito não entrou.' };
  if (/processad/.test(t)) return { ...base, codigo: 'PROCESSADA', rotulo: 'Processada', recebido: true, importarPadrao: true, classe: 'bg-emerald-100 text-emerald-800', explicacao: 'O crédito já entrou na BNIC.' };
  if (/aguard/.test(t)) return { ...base, codigo: 'AGUARDANDO', rotulo: 'Aguardando processamento', recebido: false, importarPadrao: true, classe: 'bg-amber-100 text-amber-800', explicacao: 'Ainda não foi processada: o crédito pode não ter entrado. Importe de novo quando o SIPLAD processar.' };
  if (/analise|tramit|pendente|enviad|criad|elabora|assinatura|aprova/.test(t)) return { ...base, codigo: 'EM_ANALISE', rotulo: 'Em análise / tramitação', recebido: false, importarPadrao: true, classe: 'bg-blue-100 text-blue-800', explicacao: 'Está em análise: o crédito ainda não entrou.' };
  return { ...base, codigo: 'OUTRA', rotulo: base.texto, recebido: false, importarPadrao: true, classe: 'bg-slate-200 text-slate-700', explicacao: 'Situação que o sistema não reconhece: confira no SIPLAD.' };
}

/** Texto dos filtros da tela de Recebimentos. */
export const FILTRO_SITUACAO: { value: string; label: string }[] = [
  { value: 'todas', label: 'Todas' }, { value: 'PROCESSADA', label: 'Processada' }, { value: 'AGUARDANDO', label: 'Aguardando processamento' },
  { value: 'EM_ANALISE', label: 'Em análise / tramitação' }, { value: 'NAO_RECEBIDA', label: 'Devolvida / cancelada / não processada' }, { value: 'SEM_INFO', label: 'Sem situação (migrada da planilha)' },
];
export function passaFiltroSituacao(filtro: string, texto?: string | null): boolean {
  if (!filtro || filtro === 'todas') return true;
  const c = classificarSituacao(texto).codigo;
  if (filtro === 'NAO_RECEBIDA') return c === 'DEVOLVIDA' || c === 'CANCELADA' || c === 'NAO_PROCESSADA';
  return c === filtro;
}
