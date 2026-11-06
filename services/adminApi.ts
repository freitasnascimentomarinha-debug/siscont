import { supabase } from './supabase';
import { ManagedUser, UserRole } from '../types';

/** Erro da API de administração; `notConfigured` indica que falta a chave service_role no servidor. */
export class AdminApiError extends Error {
  constructor(message: string, public status: number, public notConfigured = false) {
    super(message);
  }
}

const ENDPOINT = '/api/admin-users';
const TIMEOUT_MS = 20000;

async function call<T = any>(action: string, payload: Record<string, any> = {}): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new AdminApiError('Sessão expirada. Entre novamente.', 401);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ action, ...payload }),
      signal: controller.signal,
    });
  } catch (err: any) {
    if (err?.name === 'AbortError') throw new AdminApiError('O servidor demorou para responder. Tente novamente.', 504);
    throw new AdminApiError('Sem conexão com o servidor. Verifique sua internet.', 0);
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }

  // Sem JSON = rota inexistente (ex.: rodando com `vite` local, sem as funções da Vercel)
  if (!body) {
    throw new AdminApiError(
      'API de usuários não encontrada neste ambiente (as funções em /api só rodam na Vercel ou com `vercel dev`).',
      res.status,
      true
    );
  }
  if (!res.ok) {
    throw new AdminApiError(body.error || `Erro ${res.status}`, res.status, body.code === 'NOT_CONFIGURED');
  }
  return body as T;
}

export const adminApi = {
  listUsers: async (): Promise<ManagedUser[]> => (await call<{ users: ManagedUser[] }>('list')).users,
  createUser: (u: { name: string; email: string; password: string; role: UserRole }) => call('create', u),
  updateUser: (u: { id: string; name?: string; email?: string; role?: UserRole }) => call('update', u),
  setPassword: (id: string, password: string) => call('set_password', { id, password }),
  setActive: (id: string, active: boolean) => call('set_active', { id, active }),
  deleteUser: (id: string) => call('delete', { id }),
};
