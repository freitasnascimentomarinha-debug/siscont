import { describe, it, expect, beforeEach } from 'vitest';
import handler, { handleAdminUsers, getServerConfig } from '../api/admin-users';
import { createFakeSupabase } from './fakeSupabase';

const ADMIN = 'admin-1';
const ADMIN2 = 'admin-2';
const OPER = 'oper-1';
const READER = 'reader-1';

let fake: ReturnType<typeof createFakeSupabase>;
const call = (token: string | undefined, body: any, method = 'POST') =>
  handleAdminUsers(fake.client, { method, authorization: token ? `Bearer ${token}` : undefined, body });

beforeEach(() => {
  fake = createFakeSupabase({
    users: [
      { id: ADMIN, email: 'admin@mb.br', last_sign_in_at: '2026-11-01T10:00:00Z', email_confirmed_at: '2026-01-01' },
      { id: OPER, email: 'oper@mb.br', email_confirmed_at: '2026-01-01' },
      { id: READER, email: 'leitor@mb.br', email_confirmed_at: null },
    ],
    profiles: [
      { id: ADMIN, name: 'Admin', email: 'admin@mb.br', role: 'ADMIN', active: true },
      { id: OPER, name: 'Operador', email: 'oper@mb.br', role: 'USER', active: true },
      { id: READER, name: 'Leitor', email: 'leitor@mb.br', role: 'READ_ONLY', active: false },
    ],
    tokens: { 'tok-admin': ADMIN, 'tok-oper': OPER },
  });
});

describe('autorização', () => {
  it('recusa sem token', async () => {
    const r = await call(undefined, { action: 'list' });
    expect(r.status).toBe(401);
  });
  it('recusa token inválido', async () => {
    const r = await call('xxx', { action: 'list' });
    expect(r.status).toBe(401);
  });
  it('recusa quem não é ADMIN', async () => {
    const r = await call('tok-oper', { action: 'list' });
    expect(r.status).toBe(403);
  });
  it('recusa ADMIN bloqueado', async () => {
    fake.profiles.get(ADMIN).active = false;
    const r = await call('tok-admin', { action: 'list' });
    expect(r.status).toBe(403);
  });
  it('recusa método não permitido', async () => {
    const r = await call('tok-admin', {}, 'DELETE');
    expect(r.status).toBe(405);
  });
  it('recusa ação desconhecida', async () => {
    const r = await call('tok-admin', { action: 'hack' });
    expect(r.status).toBe(400);
  });
});

describe('listar', () => {
  it('une Auth + perfil, ordena por nome e marca pendentes', async () => {
    const r = await call('tok-admin', { action: 'list' });
    expect(r.status).toBe(200);
    const names = r.body.users.map((u: any) => u.name);
    expect(names).toEqual(['Admin', 'Leitor', 'Operador']);
    const leitor = r.body.users.find((u: any) => u.id === READER);
    expect(leitor).toMatchObject({ role: 'READ_ONLY', active: false, emailConfirmed: false, lastSignInAt: null });
    const admin = r.body.users.find((u: any) => u.id === ADMIN);
    expect(admin.lastSignInAt).toBe('2026-11-01T10:00:00Z');
  });
  it('GET também lista', async () => {
    const r = await call('tok-admin', undefined, 'GET');
    expect(r.status).toBe(200);
    expect(r.body.users).toHaveLength(3);
  });
});

describe('criar', () => {
  it('cria login confirmado e perfil ativo com o perfil escolhido', async () => {
    const r = await call('tok-admin', { action: 'create', name: ' Novo ', email: 'NOVO@mb.br ', password: 'senhaforte1', role: 'USER' });
    expect(r.status).toBe(200);
    const id = r.body.id;
    expect(fake.authUsers.get(id)).toMatchObject({ email: 'novo@mb.br', password: 'senhaforte1' });
    expect(fake.authUsers.get(id)!.email_confirmed_at).toBeTruthy();
    expect(fake.profiles.get(id)).toMatchObject({ name: 'Novo', role: 'USER', active: true, email: 'novo@mb.br' });
  });
  it('valida senha curta, e-mail e perfil', async () => {
    expect((await call('tok-admin', { action: 'create', name: 'X', email: 'x@mb.br', password: '123', role: 'USER' })).status).toBe(400);
    expect((await call('tok-admin', { action: 'create', name: 'X', email: 'invalido', password: '12345678', role: 'USER' })).status).toBe(400);
    expect((await call('tok-admin', { action: 'create', name: 'X', email: 'x@mb.br', password: '12345678', role: 'ROOT' })).status).toBe(400);
    expect((await call('tok-admin', { action: 'create', name: '', email: 'x@mb.br', password: '12345678', role: 'USER' })).status).toBe(400);
  });
  it('e-mail duplicado retorna 409 com mensagem em português', async () => {
    const r = await call('tok-admin', { action: 'create', name: 'X', email: 'oper@mb.br', password: '12345678', role: 'USER' });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/Já existe/);
  });
});

describe('editar', () => {
  it('altera nome e perfil sem perder demais campos', async () => {
    const r = await call('tok-admin', { action: 'update', id: OPER, name: 'Operador 2', role: 'READ_ONLY' });
    expect(r.status).toBe(200);
    expect(fake.profiles.get(OPER)).toMatchObject({ name: 'Operador 2', role: 'READ_ONLY', active: true, email: 'oper@mb.br' });
  });
  it('altera e-mail no Auth e no perfil', async () => {
    const r = await call('tok-admin', { action: 'update', id: OPER, email: 'novo.oper@mb.br' });
    expect(r.status).toBe(200);
    expect(fake.authUsers.get(OPER)!.email).toBe('novo.oper@mb.br');
    expect(fake.profiles.get(OPER).email).toBe('novo.oper@mb.br');
  });
  it('admin não pode rebaixar a si mesmo', async () => {
    const r = await call('tok-admin', { action: 'update', id: ADMIN, role: 'USER' });
    expect(r.status).toBe(409);
    expect(fake.profiles.get(ADMIN).role).toBe('ADMIN');
  });
  it('permite rebaixar outro admin quando ainda resta admin ativo', async () => {
    fake.authUsers.set(ADMIN2, { id: ADMIN2, email: 'a2@mb.br' });
    fake.profiles.set(ADMIN2, { id: ADMIN2, name: 'A2', role: 'ADMIN', active: true });
    const r = await call('tok-admin', { action: 'update', id: ADMIN2, role: 'USER' });
    expect(r.status).toBe(200);
    expect(fake.profiles.get(ADMIN2).role).toBe('USER');
  });
});

describe('senha, bloqueio e exclusão', () => {
  it('redefine senha de outro usuário', async () => {
    const r = await call('tok-admin', { action: 'set_password', id: OPER, password: 'novaSenha99' });
    expect(r.status).toBe(200);
    expect(fake.authUsers.get(OPER)!.password).toBe('novaSenha99');
  });
  it('recusa senha curta', async () => {
    expect((await call('tok-admin', { action: 'set_password', id: OPER, password: 'abc' })).status).toBe(400);
  });
  it('bloqueia (ban no Auth + perfil inativo) e libera', async () => {
    let r = await call('tok-admin', { action: 'set_active', id: OPER, active: false });
    expect(r.status).toBe(200);
    expect(fake.profiles.get(OPER).active).toBe(false);
    expect(fake.authUsers.get(OPER)!.banned_until).toBeTruthy();
    const list = await call('tok-admin', { action: 'list' });
    expect(list.body.users.find((u: any) => u.id === OPER).active).toBe(false);

    r = await call('tok-admin', { action: 'set_active', id: OPER, active: true });
    expect(r.status).toBe(200);
    expect(fake.profiles.get(OPER).active).toBe(true);
    expect(fake.authUsers.get(OPER)!.banned_until).toBeNull();
  });
  it('libera cadastro pendente', async () => {
    const r = await call('tok-admin', { action: 'set_active', id: READER, active: true });
    expect(r.status).toBe(200);
    expect(fake.profiles.get(READER).active).toBe(true);
  });
  it('não bloqueia a si mesmo', async () => {
    expect((await call('tok-admin', { action: 'set_active', id: ADMIN, active: false })).status).toBe(409);
  });
  it('exclui do Auth e do perfil', async () => {
    const r = await call('tok-admin', { action: 'delete', id: OPER });
    expect(r.status).toBe(200);
    expect(fake.authUsers.has(OPER)).toBe(false);
    expect(fake.profiles.has(OPER)).toBe(false);
  });
  it('não exclui a si mesmo', async () => {
    expect((await call('tok-admin', { action: 'delete', id: ADMIN })).status).toBe(409);
    expect(fake.authUsers.has(ADMIN)).toBe(true);
  });
  it('não exclui o último outro admin se ele for o único ativo restante', async () => {
    // ADMIN2 é admin ativo; ADMIN (chamador) também -> pode excluir ADMIN2
    fake.authUsers.set(ADMIN2, { id: ADMIN2, email: 'a2@mb.br' });
    fake.profiles.set(ADMIN2, { id: ADMIN2, name: 'A2', role: 'ADMIN', active: true });
    expect((await call('tok-admin', { action: 'delete', id: ADMIN2 })).status).toBe(200);
  });
});

describe('handler HTTP', () => {
  it('responde 503 NOT_CONFIGURED sem a chave service_role', async () => {
    const prev = { ...process.env };
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    let status = 0; let body = '';
    const res = { setHeader: () => {}, set statusCode(v: number) { status = v; }, end: (b: string) => { body = b; } };
    await handler({ method: 'POST', headers: {}, body: {} }, res);
    expect(status).toBe(503);
    expect(JSON.parse(body).code).toBe('NOT_CONFIGURED');
    process.env = prev;
  });
  it('lê a URL das variáveis do Vite como alternativa', () => {
    expect(getServerConfig({ VITE_SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k' }))
      .toEqual({ url: 'https://x.supabase.co', serviceKey: 'k' });
  });
});
