/** Avisos rápidos (toast) exibidos no canto da tela. Sem dependências externas. */
export type ToastType = 'error' | 'success' | 'info';
export interface Toast { id: number; type: ToastType; text: string }

type Listener = (t: Toast) => void;
const listeners = new Set<Listener>();
let seq = 0;

const emit = (type: ToastType, text: string) => {
  const toast = { id: ++seq, type, text };
  listeners.forEach(l => l(toast));
};

/** Converte erros do Supabase/PostgREST em mensagens claras em português. */
export const friendlyError = (err: any): string => {
  const msg = String(err?.message || err || '');
  const low = msg.toLowerCase();
  const code = err?.code;
  if (code === '42501' || low.includes('row-level security') || low.includes('permission denied')) {
    return 'Sem permissão para esta operação. Seu perfil pode ser apenas de Consulta ou o acesso foi bloqueado.';
  }
  if (code === '23505' || low.includes('duplicate key')) return 'Registro duplicado: já existe um item com esses dados.';
  if (code === '23503' || low.includes('foreign key')) return 'Este registro está vinculado a outros lançamentos e não pode ser alterado/excluído.';
  if (low.includes('jwt') && low.includes('expired')) return 'Sua sessão expirou. Saia e entre novamente.';
  if (low.includes('failed to fetch') || low.includes('network')) return 'Sem conexão com o servidor. Verifique sua internet e tente novamente.';
  return msg || 'Erro inesperado.';
};

export const notify = {
  error: (text: string) => emit('error', text),
  success: (text: string) => emit('success', text),
  info: (text: string) => emit('info', text),
  /** Registra o erro no console e mostra aviso amigável. */
  fail: (context: string, err: any) => {
    console.error(`[${context}]`, err);
    emit('error', `${context}: ${friendlyError(err)}`);
  },
  subscribe: (l: Listener) => {
    listeners.add(l);
    return () => { listeners.delete(l); };
  },
};
