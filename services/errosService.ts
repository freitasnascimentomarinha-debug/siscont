/**
 * Registro de erros do sistema: o que der errado na tela de um usuário vira uma linha em "erros_sistema" (script 037),
 * que o administrador vê em Administração › Erros. Nunca atrapalha o uso: qualquer falha ao registrar é ignorada.
 */
import { supabase } from './supabase';

export interface ErroSistema { id: string; criado_em: string; email: string | null; pagina: string | null; mensagem: string; detalhe: string | null; versao: string | null; resolvido: boolean }

let pagina = '';
export const definirPaginaDoErro = (p: string) => { pagina = p; };

/** Ruídos que não são defeito do sistema (extensões do navegador, redimensionamento, conexão que caiu). */
const IGNORAR = /ResizeObserver loop|Script error\.?$|Failed to fetch dynamically imported|Load failed|NetworkError|Failed to fetch|AbortError|The user aborted/i;

const recentes = new Map<string, number>();
let enviadosNaSessao = 0;

/** Decide se vale registrar (função pura, testada): descarta ruído, repetição em 60 s e excesso na sessão. */
export function deveRegistrar(mensagem: string, agora = Date.now(), memoria = recentes, enviados = enviadosNaSessao): boolean {
  if (!mensagem || IGNORAR.test(mensagem)) return false;
  if (enviados >= 20) return false;
  const chave = mensagem.slice(0, 200);
  const antes = memoria.get(chave);
  if (antes !== undefined && agora - antes < 60000) return false;
  memoria.set(chave, agora);
  return true;
}

export async function registrarErro(erro: unknown, origem = ''): Promise<void> {
  try {
    const e = erro as { message?: string; stack?: string } | string | null;
    const mensagem = String((typeof e === 'string' ? e : e?.message) || erro || '').slice(0, 1000);
    if (!deveRegistrar(mensagem)) return;
    enviadosNaSessao++;
    const { data } = await supabase.auth.getSession();
    const u = data.session?.user;
    if (!u) return;                                   // sem login não há como gravar (a regra do banco exige usuário)
    const detalhe = [origem, typeof e === 'object' && e?.stack ? e.stack : ''].filter(Boolean).join('\n').slice(0, 4000) || null;
    await supabase.from('erros_sistema').insert({ user_id: u.id, email: u.email ?? null, pagina: pagina || null, mensagem, detalhe, versao: (import.meta as any).env?.VITE_COMMIT || null });
  } catch { /* registrar nunca pode quebrar a tela */ }
}

let instalado = false;
export function instalarCapturaDeErros() {
  if (instalado || typeof window === 'undefined') return;
  instalado = true;
  window.addEventListener('error', ev => { void registrarErro(ev.error || ev.message, 'window.onerror'); });
  window.addEventListener('unhandledrejection', ev => { void registrarErro(ev.reason, 'promessa sem tratamento'); });
}

export const errosService = {
  async listar(limite = 200): Promise<ErroSistema[]> {
    const { data, error } = await supabase.from('erros_sistema').select('*').order('criado_em', { ascending: false }).limit(limite);
    if (error) throw error;
    return (data || []) as ErroSistema[];
  },
  async marcarResolvido(id: string, resolvido: boolean) {
    const { error } = await supabase.from('erros_sistema').update({ resolvido }).eq('id', id);
    if (error) throw error;
  },
  async apagarResolvidos() {
    const { error } = await supabase.from('erros_sistema').delete().eq('resolvido', true);
    if (error) throw error;
  },
};
