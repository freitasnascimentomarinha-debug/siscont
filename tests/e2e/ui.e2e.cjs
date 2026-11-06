/**
 * Teste ponta-a-ponta da interface com Supabase e /api simulados.
 * Uso:  VITE_SUPABASE_URL=http://supabase.mock VITE_SUPABASE_ANON_KEY=anon npx vite --port 5179 &
 *       BASE_URL=http://localhost:5179 node tests/e2e/ui.e2e.cjs
 */
const { chromium } = require('playwright');
const BASE = process.env.BASE_URL || 'http://localhost:5179';
const SHOTS = process.env.SHOTS_DIR || null;

const now = Math.floor(Date.now() / 1000);
const mkUser = (id, email) => ({ id, aud: 'authenticated', role: 'authenticated', email, email_confirmed_at: '2026-01-01T00:00:00Z', user_metadata: {}, app_metadata: {}, created_at: '2026-01-01T00:00:00Z' });

function setup(state) {
  return async route => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    state.log.push(`${req.method()} ${url.pathname}${url.search}`);

    if (url.pathname === '/auth/v1/token') {
      const body = JSON.parse(req.postData() || '{}');
      const acct = state.accounts[body.email];
      if (!acct || acct.password !== body.password) return json(400, { error: 'invalid_grant', error_description: 'Invalid login credentials', msg: 'Invalid login credentials', code: 'invalid_credentials' });
      state.current = acct;
      return json(200, { access_token: 'tok-' + acct.id, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'r', user: mkUser(acct.id, body.email) });
    }
    if (url.pathname === '/auth/v1/logout') return route.fulfill({ status: 204, body: '' });
    if (url.pathname === '/auth/v1/user') return json(200, mkUser(state.current.id, state.current.email));
    if (url.pathname === '/auth/v1/recover') { state.recover = JSON.parse(req.postData()).email; return json(200, {}); }

    if (url.pathname === '/rest/v1/profiles') {
      const id = (url.searchParams.get('id') || '').replace('eq.', '');
      const p = state.profiles.filter(x => !id || x.id === id);
      const accept = req.headers()['accept'] || '';
      if (accept.includes('vnd.pgrst.object')) return p[0] ? json(200, p[0]) : json(406, { code: 'PGRST116', message: 'no rows' });
      return json(200, p);
    }
    if (url.pathname.startsWith('/rest/v1/')) return json(200, []);

    if (url.pathname === '/api/admin-users') {
      if (!state.apiConfigured) return json(503, { code: 'NOT_CONFIGURED', error: 'Gestão de usuários indisponível: configure SUPABASE_SERVICE_ROLE_KEY.' });
      const body = JSON.parse(req.postData() || '{}');
      state.apiCalls.push(body);
      if (body.action === 'list') return json(200, { users: state.managed });
      if (body.action === 'create') {
        state.managed.push({ id: 'n1', name: body.name, email: body.email, role: body.role, active: true, createdAt: null, lastSignInAt: null, emailConfirmed: true });
        return json(200, { id: 'n1' });
      }
      if (body.action === 'set_active') { state.managed.find(u => u.id === body.id).active = body.active; return json(200, { ok: true }); }
      return json(200, { ok: true });
    }
    return route.continue();
  };
}

const assert = (cond, msg) => { if (!cond) throw new Error('FALHOU: ' + msg); console.log('  ✓ ' + msg); };

(async () => {
  const browser = await chromium.launch();
  const results = [];

  async function scenario(name, state, fn) {
    console.log(`\n▶ ${name}`);
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route(u => u.hostname === 'supabase.mock' || u.pathname.startsWith('/api/'), setup(state));
    try {
      await fn(page);
      assert(errors.length === 0, `sem erros de JavaScript na página ${errors.length ? '(' + errors.join(' | ') + ')' : ''}`);
      results.push([name, 'OK']);
    } catch (e) {
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/FALHA-${name.replace(/\W+/g, '_')}.png` });
      console.log('  ✗ ' + e.message);
      results.push([name, 'FALHOU']);
    }
    await ctx.close();
  }

  const baseState = () => ({
    log: [], apiCalls: [], apiConfigured: true, current: null,
    accounts: {
      'admin@mb.br': { id: 'a1', email: 'admin@mb.br', password: 'senha12345' },
      'leitor@mb.br': { id: 'r1', email: 'leitor@mb.br', password: 'senha12345' },
      'bloq@mb.br': { id: 'b1', email: 'bloq@mb.br', password: 'senha12345' },
    },
    profiles: [
      { id: 'a1', name: 'CC Admin', email: 'admin@mb.br', role: 'ADMIN', active: true },
      { id: 'r1', name: 'SG Leitor', email: 'leitor@mb.br', role: 'READ_ONLY', active: true },
      { id: 'b1', name: 'CB Bloqueado', email: 'bloq@mb.br', role: 'USER', active: false },
    ],
    managed: [
      { id: 'a1', name: 'CC Admin', email: 'admin@mb.br', role: 'ADMIN', active: true, createdAt: '2026-01-01', lastSignInAt: '2026-11-05T12:00:00Z', emailConfirmed: true },
      { id: 'r1', name: 'SG Leitor', email: 'leitor@mb.br', role: 'READ_ONLY', active: true, createdAt: '2026-01-01', lastSignInAt: '2026-11-04T12:00:00Z', emailConfirmed: true },
      { id: 'p1', name: 'MN Pendente', email: 'pend@mb.br', role: 'READ_ONLY', active: false, createdAt: '2026-11-06T09:00:00Z', lastSignInAt: null, emailConfirmed: false },
    ],
  });

  const login = async (page, email, pass) => {
    await page.goto(BASE);
    await page.getByLabel('E-mail de Acesso').fill(email);
    await page.getByLabel('Senha', { exact: true }).fill(pass);
    await page.getByRole('button', { name: 'Entrar no Sistema' }).click();
  };

  await scenario('Login com senha errada mostra mensagem em português', baseState(), async page => {
    await login(page, 'admin@mb.br', 'errada');
    await page.getByText('E-mail ou senha incorretos.').waitFor({ timeout: 8000 });
    assert(true, 'mensagem "E-mail ou senha incorretos."');
  });

  await scenario('Admin entra e gerencia usuários', baseState(), async page => {
    await login(page, 'admin@mb.br', 'senha12345');
    await page.getByRole('button', { name: 'Administração' }).waitFor({ timeout: 10000 });
    assert(await page.getByText('Administrador', { exact: true }).first().isVisible(), 'perfil exibido em português na barra lateral');
    await page.getByRole('button', { name: 'Administração' }).click();
    await page.getByText('cadastro(s) aguardando liberação').waitFor();
    assert(true, 'seção de cadastros pendentes aparece');
    assert(await page.getByRole('cell', { name: /SG Leitor/ }).isVisible(), 'lista de usuários carregada pela API');
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/admin-usuarios.png` });

    await page.getByRole('button', { name: 'Novo Usuário' }).click();
    await page.getByLabel('Nome (posto/graduação e nome de guerra)').fill('1SG Teste');
    await page.getByLabel('E-mail').fill('teste@mb.br');
    await page.getByLabel('Perfil de Acesso').selectOption('USER');
    await page.getByRole('button', { name: 'Criar Usuário' }).click();
    await page.getByText(/Usuário 1SG Teste criado/).waitFor();
    assert(true, 'novo usuário criado com mensagem de sucesso');
    const created = (await page.evaluate(() => 1), null);
    assert(await page.getByRole('cell', { name: /1SG Teste/ }).isVisible(), 'novo usuário aparece na lista');

    await page.getByRole('button', { name: 'Liberar como Operador' }).click();
    await page.getByText(/Acesso de MN Pendente liberado/).waitFor();
    assert(true, 'cadastro pendente liberado');
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/admin-usuarios-apos-acoes.png` });
  });

  await scenario('Sem chave no servidor: modo limitado com aviso', { ...baseState(), apiConfigured: false }, async page => {
    await login(page, 'admin@mb.br', 'senha12345');
    await page.getByRole('button', { name: 'Administração' }).click();
    await page.getByText('Modo limitado: API de usuários não configurada').waitFor();
    assert(true, 'aviso de modo limitado exibido');
    assert(await page.getByRole('button', { name: 'Novo Usuário' }).isDisabled(), 'botão Novo Usuário desabilitado');
    assert(await page.getByRole('cell', { name: /SG Leitor/ }).isVisible(), 'lista vem dos perfis do banco');
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/admin-modo-limitado.png` });
  });

  await scenario('Usuário de Consulta não vê Administração', baseState(), async page => {
    await login(page, 'leitor@mb.br', 'senha12345');
    await page.getByRole('button', { name: 'Faturas' }).waitFor({ timeout: 10000 });
    assert(!(await page.getByRole('button', { name: 'Administração' }).count()), 'menu Administração oculto');
    assert(await page.getByText('Consulta', { exact: true }).first().isVisible(), 'perfil "Consulta" exibido');
  });

  await scenario('Usuário bloqueado/pendente é barrado no login', baseState(), async page => {
    await login(page, 'bloq@mb.br', 'senha12345');
    await page.getByText(/pendente de liberação ou foi bloqueado/).waitFor({ timeout: 10000 });
    assert(true, 'mensagem de acesso bloqueado exibida e permanece na tela de login');
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/login-bloqueado.png` });
  });

  await scenario('Esqueci minha senha envia link', baseState(), async page => {
    const st = baseState();
    await page.unroute(() => true);
    await page.route(u => u.hostname === 'supabase.mock' || u.pathname.startsWith('/api/'), setup(st));
    await page.goto(BASE);
    await page.getByRole('button', { name: 'Esqueci minha senha' }).click();
    await page.getByLabel('E-mail de Acesso').fill('admin@mb.br');
    await page.getByRole('button', { name: 'Enviar Link de Recuperação' }).click();
    await page.getByText(/você receberá um link/).waitFor();
    assert(st.recover === 'admin@mb.br', 'requisição de recuperação enviada ao Supabase');
  });

  await scenario('Minha Conta abre a partir da barra lateral', baseState(), async page => {
    await login(page, 'admin@mb.br', 'senha12345');
    await page.getByTitle('Minha Conta: alterar nome e senha').click();
    await page.getByRole('heading', { name: 'Minha Conta' }).waitFor();
    assert(await page.getByLabel('Senha atual').isVisible(), 'formulário de troca de senha disponível');
  });

  await browser.close();
  console.log('\n===== RESUMO =====');
  results.forEach(([n, r]) => console.log(`${r === 'OK' ? '✅' : '❌'} ${n}`));
  process.exit(results.some(r => r[1] !== 'OK') ? 1 : 0);
})();
