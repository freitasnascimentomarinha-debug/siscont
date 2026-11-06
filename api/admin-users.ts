/**
 * SISCONT - API de administração de usuários (Vercel Serverless Function)
 *
 * Rota: POST /api/admin-users   (GET também lista)
 * Cabeçalho: Authorization: Bearer <access_token do Supabase do administrador>
 * Corpo: { action: 'list' | 'create' | 'update' | 'set_password' | 'set_active' | 'delete', ... }
 *
 * Operações que exigem a chave service_role (criar login, trocar senha de
 * terceiros, bloquear, excluir do Auth) só podem rodar no servidor. A chave
 * NUNCA vai para o navegador.
 *
 * Variáveis de ambiente (Vercel > Settings > Environment Variables):
 *   SUPABASE_SERVICE_ROLE_KEY   (obrigatória - Supabase > Project Settings > API > service_role)
 *   SUPABASE_URL                (opcional; usa VITE_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL se ausente)
 *
 * Este arquivo é autocontido (sem imports relativos) de propósito: as funções
 * da Vercel rodam como ESM e imports relativos sem extensão quebram em runtime.
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';

export type Role = 'ADMIN' | 'USER' | 'READ_ONLY';
const ROLES: Role[] = ['ADMIN', 'USER', 'READ_ONLY'];
const MIN_PASSWORD = 8;
const BAN_FOREVER = '876000h'; // ~100 anos

export interface ManagedUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  createdAt: string | null;
  lastSignInAt: string | null;
  emailConfirmed: boolean;
}

export interface ApiResult {
  status: number;
  body: any;
}

class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

const ok = (body: any = { ok: true }): ApiResult => ({ status: 200, body });

const isEmail = (v: unknown): v is string =>
  typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

const normRole = (v: unknown): Role => {
  if (typeof v === 'string' && (ROLES as string[]).includes(v)) return v as Role;
  throw new HttpError(400, 'Perfil de acesso inválido.');
};

const requireId = (v: unknown): string => {
  if (typeof v !== 'string' || !v.trim()) throw new HttpError(400, 'Usuário não informado.');
  return v.trim();
};

const requirePassword = (v: unknown): string => {
  if (typeof v !== 'string' || v.length < MIN_PASSWORD) {
    throw new HttpError(400, `A senha deve ter pelo menos ${MIN_PASSWORD} caracteres.`);
  }
  return v;
};

const translateAuthError = (err: any): HttpError => {
  const msg = String(err?.message || err || '');
  const low = msg.toLowerCase();
  if (low.includes('already') && (low.includes('registered') || low.includes('exists'))) {
    return new HttpError(409, 'Já existe um usuário com este e-mail.');
  }
  if (low.includes('password')) return new HttpError(400, `Senha recusada pelo Supabase: ${msg}`);
  return new HttpError(500, msg || 'Erro inesperado no Supabase.');
};

async function loadProfiles(admin: SupabaseClient): Promise<Map<string, any>> {
  const { data, error } = await admin.from('profiles').select('*');
  if (error) throw new HttpError(500, `Erro ao ler perfis: ${error.message}`);
  return new Map((data || []).map((p: any) => [p.id, p]));
}

async function listAuthUsers(admin: SupabaseClient): Promise<any[]> {
  const all: any[] = [];
  for (let page = 1; page < 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw translateAuthError(error);
    const users = data?.users || [];
    all.push(...users);
    if (users.length < 1000) break;
  }
  return all;
}

async function listUsers(admin: SupabaseClient): Promise<ManagedUser[]> {
  const [authUsers, profiles] = await Promise.all([listAuthUsers(admin), loadProfiles(admin)]);
  return authUsers
    .map((u: any) => {
      const p = profiles.get(u.id) || {};
      const bannedUntil = u.banned_until ? new Date(u.banned_until).getTime() : 0;
      const banned = bannedUntil > Date.now();
      return {
        id: u.id,
        name: p.name || u.user_metadata?.name || (u.email || '').split('@')[0],
        email: u.email || p.email || '',
        role: (ROLES as string[]).includes(p.role) ? p.role : 'READ_ONLY',
        active: p.active !== false && !banned,
        createdAt: u.created_at || p.created_at || null,
        lastSignInAt: u.last_sign_in_at || null,
        emailConfirmed: !!(u.email_confirmed_at || u.confirmed_at),
      } as ManagedUser;
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

/** Garante que a operação não deixa o sistema sem nenhum administrador ativo. */
async function assertAnotherActiveAdmin(admin: SupabaseClient, exceptId: string) {
  const { data, error } = await admin.from('profiles').select('id, role, active').eq('role', 'ADMIN');
  if (error) throw new HttpError(500, error.message);
  const others = (data || []).filter((p: any) => p.id !== exceptId && p.active !== false);
  if (others.length === 0) {
    throw new HttpError(409, 'Operação negada: o sistema ficaria sem nenhum administrador ativo.');
  }
}

async function getProfile(admin: SupabaseClient, id: string) {
  const { data, error } = await admin.from('profiles').select('*').eq('id', id).maybeSingle();
  if (error) throw new HttpError(500, error.message);
  return data as any;
}

/** Valida o token do chamador e exige perfil ADMIN ativo. */
async function authorize(admin: SupabaseClient, authHeader: string | undefined) {
  const token = (authHeader || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) throw new HttpError(401, 'Sessão não informada. Faça login novamente.');
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) throw new HttpError(401, 'Sessão inválida ou expirada. Faça login novamente.');
  const profile = await getProfile(admin, data.user.id);
  if (!profile || profile.role !== 'ADMIN' || profile.active === false) {
    throw new HttpError(403, 'Apenas administradores podem gerenciar usuários.');
  }
  return data.user;
}

export async function handleAdminUsers(
  admin: SupabaseClient,
  req: { method?: string; authorization?: string; body?: any }
): Promise<ApiResult> {
  try {
    if (req.method !== 'POST' && req.method !== 'GET') {
      throw new HttpError(405, 'Método não permitido.');
    }
    const caller = await authorize(admin, req.authorization);
    const body = (req.method === 'GET' ? { action: 'list' } : req.body) || {};
    const action = String(body.action || '');

    switch (action) {
      case 'list':
        return ok({ users: await listUsers(admin) });

      case 'create': {
        const name = String(body.name || '').trim();
        if (!name) throw new HttpError(400, 'Informe o nome do usuário.');
        if (!isEmail(body.email)) throw new HttpError(400, 'E-mail inválido.');
        const email = body.email.trim().toLowerCase();
        const password = requirePassword(body.password);
        const role = normRole(body.role || 'USER');

        const { data, error } = await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { name },
          app_metadata: { created_by_admin: true },
        });
        if (error || !data?.user) throw translateAuthError(error);

        const { error: pErr } = await admin
          .from('profiles')
          .upsert({ id: data.user.id, name, email, role, active: true });
        if (pErr) {
          // Desfaz para não deixar login sem perfil
          await admin.auth.admin.deleteUser(data.user.id);
          throw new HttpError(500, `Erro ao criar perfil: ${pErr.message}`);
        }
        return ok({ id: data.user.id });
      }

      case 'update': {
        const id = requireId(body.id);
        const current = await getProfile(admin, id);
        const patch: Record<string, any> = {};
        if (body.name !== undefined) {
          const name = String(body.name).trim();
          if (!name) throw new HttpError(400, 'O nome não pode ficar vazio.');
          patch.name = name;
        }
        if (body.role !== undefined) {
          const role = normRole(body.role);
          if (role !== 'ADMIN' && (current?.role === 'ADMIN')) {
            if (id === caller.id) throw new HttpError(409, 'Você não pode remover o seu próprio perfil de administrador.');
            await assertAnotherActiveAdmin(admin, id);
          }
          patch.role = role;
        }
        if (body.email !== undefined) {
          if (!isEmail(body.email)) throw new HttpError(400, 'E-mail inválido.');
          const email = body.email.trim().toLowerCase();
          if (email !== (current?.email || '').toLowerCase()) {
            const { error } = await admin.auth.admin.updateUserById(id, { email, email_confirm: true });
            if (error) throw translateAuthError(error);
          }
          patch.email = email;
        }
        if (Object.keys(patch).length === 0) throw new HttpError(400, 'Nada para atualizar.');
        const { error } = await admin.from('profiles').upsert({ id, ...(current || {}), ...patch });
        if (error) throw new HttpError(500, `Erro ao salvar perfil: ${error.message}`);
        return ok();
      }

      case 'set_password': {
        const id = requireId(body.id);
        const password = requirePassword(body.password);
        const { error } = await admin.auth.admin.updateUserById(id, { password });
        if (error) throw translateAuthError(error);
        return ok();
      }

      case 'set_active': {
        const id = requireId(body.id);
        const active = body.active === true;
        if (!active) {
          if (id === caller.id) throw new HttpError(409, 'Você não pode bloquear o seu próprio acesso.');
          const target = await getProfile(admin, id);
          if (target?.role === 'ADMIN') await assertAnotherActiveAdmin(admin, id);
        }
        const { error: aErr } = await admin.auth.admin.updateUserById(id, {
          ban_duration: active ? 'none' : BAN_FOREVER,
        } as any);
        if (aErr) throw translateAuthError(aErr);
        const { error } = await admin.from('profiles').update({ active }).eq('id', id);
        if (error) throw new HttpError(500, `Erro ao atualizar perfil: ${error.message}`);
        return ok();
      }

      case 'delete': {
        const id = requireId(body.id);
        if (id === caller.id) throw new HttpError(409, 'Você não pode excluir o seu próprio usuário.');
        const target = await getProfile(admin, id);
        if (target?.role === 'ADMIN') await assertAnotherActiveAdmin(admin, id);
        const { error } = await admin.auth.admin.deleteUser(id);
        if (error && !String(error.message || '').toLowerCase().includes('not found')) {
          throw translateAuthError(error);
        }
        await admin.from('profiles').delete().eq('id', id);
        return ok();
      }

      default:
        throw new HttpError(400, `Ação desconhecida: "${action}".`);
    }
  } catch (err: any) {
    if (err instanceof HttpError) {
      return { status: err.status, body: { error: err.message, code: err.code } };
    }
    console.error('[admin-users] erro inesperado', err);
    return { status: 500, body: { error: err?.message || 'Erro interno.' } };
  }
}

export function getServerConfig(env: Record<string, string | undefined> = process.env) {
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  return { url, serviceKey };
}

export default async function handler(req: any, res: any) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  const { url, serviceKey } = getServerConfig();
  if (!url || !serviceKey) {
    res.statusCode = 503;
    res.end(JSON.stringify({
      code: 'NOT_CONFIGURED',
      error: 'Gestão de usuários indisponível: configure SUPABASE_SERVICE_ROLE_KEY nas variáveis de ambiente da Vercel e faça novo deploy.',
    }));
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const result = await handleAdminUsers(admin, {
    method: req.method,
    authorization: req.headers?.authorization,
    body,
  });
  res.statusCode = result.status;
  res.end(JSON.stringify(result.body));
}
