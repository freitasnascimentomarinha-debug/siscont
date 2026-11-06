/** Supabase falso em memória, suficiente para testar api/admin-users.ts. */
export interface FakeAuthUser {
  id: string;
  email: string;
  password?: string;
  user_metadata?: any;
  app_metadata?: any;
  created_at?: string;
  last_sign_in_at?: string | null;
  email_confirmed_at?: string | null;
  banned_until?: string | null;
}

export function createFakeSupabase(seed: { users: FakeAuthUser[]; profiles: any[]; tokens: Record<string, string> }) {
  const authUsers = new Map(seed.users.map(u => [u.id, { ...u }]));
  const profiles = new Map(seed.profiles.map(p => [p.id, { ...p }]));
  let nextId = 1;
  const calls: string[] = [];

  const query = (table: string) => {
    if (table !== 'profiles') throw new Error('tabela inesperada ' + table);
    const filters: [string, any][] = [];
    let op: 'select' | 'update' | 'delete' = 'select';
    let patch: any = null;
    const rows = () => [...profiles.values()].filter(r => filters.every(([k, v]) => r[k] === v));
    const builder: any = {
      select: () => builder,
      eq: (k: string, v: any) => { filters.push([k, v]); return builder; },
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      update: (p: any) => { op = 'update'; patch = p; return builder; },
      delete: () => { op = 'delete'; return builder; },
      upsert: async (row: any) => {
        calls.push('upsert:' + row.id);
        profiles.set(row.id, { ...(profiles.get(row.id) || {}), ...row });
        return { error: null };
      },
      then: (resolve: any, reject: any) => {
        try {
          if (op === 'update') { rows().forEach(r => Object.assign(r, patch)); calls.push('update'); resolve({ error: null }); }
          else if (op === 'delete') { rows().forEach(r => profiles.delete(r.id)); calls.push('delete'); resolve({ error: null }); }
          else resolve({ data: rows(), error: null });
        } catch (e) { reject(e); }
      },
    };
    return builder;
  };

  const client: any = {
    from: query,
    auth: {
      getUser: async (token: string) => {
        const id = seed.tokens[token];
        const u = id && authUsers.get(id);
        return u ? { data: { user: u }, error: null } : { data: { user: null }, error: { message: 'invalid JWT' } };
      },
      admin: {
        listUsers: async () => ({ data: { users: [...authUsers.values()] }, error: null }),
        createUser: async (attrs: any) => {
          if ([...authUsers.values()].some(u => u.email === attrs.email)) {
            return { data: { user: null }, error: { message: 'A user with this email address has already been registered' } };
          }
          const u = { id: `new-${nextId++}`, email: attrs.email, password: attrs.password, user_metadata: attrs.user_metadata, app_metadata: attrs.app_metadata, email_confirmed_at: attrs.email_confirm ? new Date().toISOString() : null, created_at: new Date().toISOString() };
          authUsers.set(u.id, u);
          return { data: { user: u }, error: null };
        },
        updateUserById: async (id: string, attrs: any) => {
          const u = authUsers.get(id);
          if (!u) return { data: null, error: { message: 'User not found' } };
          if (attrs.password) u.password = attrs.password;
          if (attrs.email) u.email = attrs.email;
          if (attrs.ban_duration) u.banned_until = attrs.ban_duration === 'none' ? null : new Date(Date.now() + 1e10).toISOString();
          calls.push(`updateUserById:${id}:${Object.keys(attrs).join(',')}`);
          return { data: { user: u }, error: null };
        },
        deleteUser: async (id: string) => {
          if (!authUsers.delete(id)) return { error: { message: 'User not found' } };
          calls.push('deleteUser:' + id);
          return { error: null };
        },
      },
    },
  };
  return { client, authUsers, profiles, calls };
}
