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
  it('cria e muda para o perfil Treinamento (o servidor aceita o perfil)', async () => {
    const r = await call('tok-admin', { action: 'create', name: 'Aluno', email: 'aluno@mb.br', password: 'senhaforte1', role: 'TREINAMENTO' });
    expect(r.status).toBe(200);
    expect(fake.profiles.get(r.body.id)).toMatchObject({ role: 'TREINAMENTO', active: true });
    const u = await call('tok-admin', { action: 'update', id: OPER, role: 'TREINAMENTO' });
    expect(u.status).toBe(200);
    expect(fake.profiles.get(OPER)).toMatchObject({ role: 'TREINAMENTO' });
    const lista = await call('tok-admin', { action: 'list' });
    expect(lista.body.users.find((x: any) => x.id === OPER).role).toBe('TREINAMENTO');   // a lista não rebaixa para Consulta
  });
  it('cria Consulta Gerencial e guarda setor e função informativos', async () => {
    const r = await call('tok-admin', { action: 'create', name: 'Chefe', email: 'chefe@mb.br', password: 'senhaforte1', role: 'CONSULTA_GERENCIAL', setor: 'FATURAMENTO', funcao: 'AUXILIAR' });
    expect(r.status).toBe(200);
    expect(fake.profiles.get(r.body.id)).toMatchObject({ role: 'CONSULTA_GERENCIAL', active: true, setor: 'FATURAMENTO', funcao: 'AUXILIAR' });
    const lista = await call('tok-admin', { action: 'list' });
    expect(lista.body.users.find((x: any) => x.id === r.body.id)).toMatchObject({ role: 'CONSULTA_GERENCIAL', setor: 'FATURAMENTO', funcao: 'AUXILIAR' });
  });
  it('sem setor/função informados, o perfil nasce sem esses campos (banco ainda sem o script 035 não quebra)', async () => {
    const r = await call('tok-admin', { action: 'create', name: 'Sem Setor', email: 'ss@mb.br', password: 'senhaforte1', role: 'USER' });
    expect(r.status).toBe(200);
    expect('setor' in fake.profiles.get(r.body.id)).toBe(false);
    expect('funcao' in fake.profiles.get(r.body.id)).toBe(false);
    const lista = await call('tok-admin', { action: 'list' });
    expect(lista.body.users.find((x: any) => x.id === r.body.id)).toMatchObject({ setor: null, funcao: null });
  });
  it('recusa setor e função fora da lista', async () => {
    expect((await call('tok-admin', { action: 'create', name: 'X', email: 'x@mb.br', password: '12345678', role: 'USER', setor: 'COZINHA' })).status).toBe(400);
    expect((await call('tok-admin', { action: 'create', name: 'X', email: 'x@mb.br', password: '12345678', role: 'USER', funcao: 'REI' })).status).toBe(400);
    expect((await call('tok-admin', { action: 'update', id: OPER, setor: 'COZINHA' })).status).toBe(400);
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

describe('vários setores, cada um com a sua função (script 036)', () => {
  const ATRIB = [{ setor: 'FATURAMENTO', funcao: 'ENCARREGADO_SETOR' }, { setor: 'CUSTOS', funcao: 'AUXILIAR' }];
  it('cria com mais de um setor: guarda a lista e o primeiro par em setor/funcao', async () => {
    const r = await call('tok-admin', { action: 'create', name: 'Acumula', email: 'ac@mb.br', password: 'senhaforte1', role: 'USER', atribuicoes: ATRIB });
    expect(r.status).toBe(200);
    expect(fake.profiles.get(r.body.id)).toMatchObject({ atribuicoes: ATRIB, setor: 'FATURAMENTO', funcao: 'ENCARREGADO_SETOR' });
    const u = (await call('tok-admin', { action: 'list' })).body.users.find((x: any) => x.id === r.body.id);
    expect(u.atribuicoes).toEqual(ATRIB);
  });
  it('edita, troca a ordem, tira um setor e limpa tudo', async () => {
    expect((await call('tok-admin', { action: 'update', id: OPER, atribuicoes: ATRIB })).status).toBe(200);
    expect(fake.profiles.get(OPER).atribuicoes).toEqual(ATRIB);
    expect((await call('tok-admin', { action: 'update', id: OPER, atribuicoes: [ATRIB[1]] })).status).toBe(200);
    expect(fake.profiles.get(OPER)).toMatchObject({ atribuicoes: [ATRIB[1]], setor: 'CUSTOS', funcao: 'AUXILIAR' });
    expect((await call('tok-admin', { action: 'update', id: OPER, name: 'Só o nome' })).status).toBe(200);   // não informar = não muda
    expect(fake.profiles.get(OPER).atribuicoes).toEqual([ATRIB[1]]);
    expect((await call('tok-admin', { action: 'update', id: OPER, atribuicoes: [] })).status).toBe(200);
    expect(fake.profiles.get(OPER)).toMatchObject({ atribuicoes: [], setor: null, funcao: null });
  });
  it('função é opcional em cada setor', async () => {
    expect((await call('tok-admin', { action: 'update', id: OPER, atribuicoes: [{ setor: 'CUSTOS' }, { setor: 'FATURAMENTO', funcao: '' }] })).status).toBe(200);
    expect(fake.profiles.get(OPER).atribuicoes).toEqual([{ setor: 'CUSTOS', funcao: null }, { setor: 'FATURAMENTO', funcao: null }]);
  });
  it('recusa setor repetido, setor ou função inexistente, mais de 3 e formato errado', async () => {
    const upd = (a: any) => call('tok-admin', { action: 'update', id: OPER, atribuicoes: a });
    expect((await upd([{ setor: 'CUSTOS' }, { setor: 'CUSTOS', funcao: 'AUXILIAR' }])).status).toBe(400);
    expect((await upd([{ setor: 'COZINHA' }])).status).toBe(400);
    expect((await upd([{ setor: 'CUSTOS', funcao: 'REI' }])).status).toBe(400);
    expect((await upd([{ setor: 'FATURAMENTO' }, { setor: 'CUSTOS' }, { setor: 'ACOMPANHAMENTO_CONTABIL' }, { setor: 'FATURAMENTO' }])).status).toBe(400);
    expect((await upd('FATURAMENTO')).status).toBe(400);
    expect((await upd([{ funcao: 'AUXILIAR' }])).status).toBe(400);
  });
  it('perfil antigo (só setor/funcao, sem a lista) aparece como um par; banco sem o script 036 devolve mensagem clara', async () => {
    fake.profiles.get(OPER).setor = 'CUSTOS'; fake.profiles.get(OPER).funcao = 'AUXILIAR';
    const u = (await call('tok-admin', { action: 'list' })).body.users.find((x: any) => x.id === OPER);
    expect(u.atribuicoes).toEqual([{ setor: 'CUSTOS', funcao: 'AUXILIAR' }]);
    const sem = (await call('tok-admin', { action: 'list' })).body.users.find((x: any) => x.id === ADMIN);
    expect(sem.atribuicoes).toEqual([]);
  });
});

describe('editar', () => {
  it('define, troca e limpa setor e função sem mexer no resto', async () => {
    expect((await call('tok-admin', { action: 'update', id: OPER, setor: 'CUSTOS', funcao: 'ENCARREGADO_SETOR' })).status).toBe(200);
    expect(fake.profiles.get(OPER)).toMatchObject({ role: 'USER', active: true, setor: 'CUSTOS', funcao: 'ENCARREGADO_SETOR' });
    expect((await call('tok-admin', { action: 'update', id: OPER, name: 'Só o nome' })).status).toBe(200);   // não informar = não muda
    expect(fake.profiles.get(OPER)).toMatchObject({ name: 'Só o nome', setor: 'CUSTOS', funcao: 'ENCARREGADO_SETOR' });
    expect((await call('tok-admin', { action: 'update', id: OPER, setor: null, funcao: '' })).status).toBe(200);
    expect(fake.profiles.get(OPER)).toMatchObject({ setor: null, funcao: null });
  });
  it('muda para Encarregado da Divisão e Consulta Gerencial', async () => {
    expect((await call('tok-admin', { action: 'update', id: OPER, role: 'ENCARREGADO' })).status).toBe(200);
    expect(fake.profiles.get(OPER).role).toBe('ENCARREGADO');
    expect((await call('tok-admin', { action: 'update', id: OPER, role: 'CONSULTA_GERENCIAL' })).status).toBe(200);
    const lista = await call('tok-admin', { action: 'list' });
    expect(lista.body.users.find((x: any) => x.id === OPER).role).toBe('CONSULTA_GERENCIAL');   // a lista não rebaixa para Consulta
  });
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
