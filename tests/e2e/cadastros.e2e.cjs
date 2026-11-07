/**
 * Teste ponta-a-ponta da tela Cadastros com Supabase simulado em memória.
 * Uso: VITE_SUPABASE_URL=http://supabase.mock VITE_SUPABASE_ANON_KEY=anon npx vite --port 5179 &
 *      BASE_URL=http://localhost:5179 node tests/e2e/cadastros.e2e.cjs [planilhas reais opcionais...]
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');
const XLSX = require(path.join(__dirname, '../../node_modules/xlsx'));
const BASE = process.env.BASE_URL || 'http://localhost:5179';
const SHOTS = process.env.SHOTS_DIR || null;
const extras = process.argv.slice(2);

const now = Math.floor(Date.now() / 1000);
let seq = 0; const uid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

function novoBanco() {
  return {
    setores: ['COMOPNAV', 'DGMM', 'EXTRA-MB'].map((s, i) => ({ id: uid(), sigla: s, nome: null, ordem: (i + 1) * 10, ativo: true })),
    comandos: [], classes_navio: [], oms: [],
    service_definitions: [{ id: uid(), name: 'Água e Esgoto', unit_measure: 'M³', acronym: 'AE', nome_oficial: 'FORNECIMENTO DE ÁGUA POTÁVEL E COLETA DE ESGOTO', anexo_oi: 'Anexo C', ordem: 20, ativo: true }],
    parametros: [{ chave: 'prazo_certificacao_dias_uteis', valor: '10', descricao: 'Data-limite de certificação no SIPLAD' }],
    feriados: [{ data: '2026-11-02', descricao: 'Finados', tipo: 'NACIONAL' }],
    profiles: [{ id: 'a1', name: 'CC Admin', email: 'admin@mb.br', role: 'ADMIN', active: true }],
    invoices: [{ id: 'i1', ug: '91645', client: 'Corveta Barroso' }],
  };
}

function handler(db, log) {
  return async route => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: body === undefined ? '' : JSON.stringify(body) });
    if (url.pathname === '/auth/v1/token') {
      return json(200, { access_token: 't', token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'r', user: { id: 'a1', aud: 'authenticated', email: 'admin@mb.br', app_metadata: {}, user_metadata: {} } });
    }
    if (url.pathname.startsWith('/auth/v1/')) return json(200, {});
    if (url.pathname === '/rest/v1/rpc/om_tem_movimento') {
      const { p_om_id } = JSON.parse(req.postData() || '{}');
      const o = db.oms.find(x => x.id === p_om_id);
      return json(200, !!o && db.invoices.some(i => i.ug === o.codigo && i.client.toLowerCase() === o.nome.toLowerCase()));
    }
    const m = url.pathname.match(/^\/rest\/v1\/(\w+)$/);
    if (!m) return json(404, {});
    const t = m[1];
    if (!db[t]) return json(200, []);
    const filtros = [...url.searchParams.entries()].filter(([k]) => !['select', 'order', 'columns', 'on_conflict'].includes(k));
    const casa = r => filtros.every(([k, v]) => v.startsWith('eq.') ? String(r[k]) === v.slice(3) : true);
    const metodo = req.method();
    log.push(`${metodo} ${t}`);
    if (metodo === 'GET') {
      const rows = db[t].filter(casa);
      if ((req.headers()['accept'] || '').includes('vnd.pgrst.object')) return rows[0] ? json(200, rows[0]) : json(406, { code: 'PGRST116' });
      return json(200, rows);
    }
    if (metodo === 'POST') {
      const body = JSON.parse(req.postData() || '[]');
      const linhas = Array.isArray(body) ? body : [body];
      for (const l of linhas) {
        if (t === 'oms' && db.oms.some(o => o.codigo === l.codigo && o.nome.toLowerCase() === l.nome.toLowerCase())) return json(409, { code: '23505', message: 'duplicate key value violates unique constraint "oms_codigo_nome_uk"' });
        if (t === 'feriados') { db.feriados = db.feriados.filter(f => f.data !== l.data); }
        db[t].push({ id: l.id || uid(), ativo: true, ...l });
      }
      return json(201);
    }
    if (metodo === 'PATCH') {
      const patch = JSON.parse(req.postData() || '{}');
      db[t].filter(casa).forEach(r => Object.assign(r, patch));
      return json(204);
    }
    if (metodo === 'DELETE') { db[t] = db[t].filter(r => !casa(r)); return json(204); }
    return json(405, {});
  };
}

function planilhaSintetica() {
  const linhas = [
    ['Setor', 'Comando', 'Cliente', 'Fatura', 'Valor'],
    ['COMOPNAV', '91610 - Comando do 1º Esquadrão de Escolta', 'Corveta Barroso', '91645-EL-08-2026-032-0', 100],
    ['COMOPNAV', '91610 - Comando do 1º Esquadrão de Escolta', 'Corveta Barroso', '91645-DA-09-2026-011-0', 100],
    ['COMOPNAV', '91610 - Comando do 1º Esquadrão de Escolta', 'CORVETA BARROSO', '91645-TL-07-2026-004-0', 10],
    ['DGMM', '40030 - Diretoria Industrial da Marinha', 'Navio-Patrulha Mangaratiba', '40032-DA-08-2026-010-0', 2960.81],
    ['DGMM', '40030 - Diretoria Industrial da Marinha', 'Navio-Patrulha Mangaratiba', '40032-RB-06-2026-001-0', 36356.81],
    ['DGMM', '40030 - Diretoria Industrial da Marinha', 'Diretoria Industrial da Marinha', '40030-TC-08-2026-014-0', 19615.73],
    ['DGMM', '40030 - Diretoria Industrial da Marinha', 'Diretoria Industrial da Marinha', '40031-TC-08-2026-016-0', 1],
    ['DGN', '51200-Grupamento de Navios Hidroceanograficos', 'Navio Polar Almirante Maximiano', '51215-EL-07-2024-035-0', 25555.36],
    ['EXTRA-MARINHA', 'EXTRA-MARINHA', 'BANCO DO BRASIL', '00994-AE-09-2026-020-0', 223.98],
  ];
  const hist = [['NÚMERO DE DIAS'], ['CLASSE NAVIO', 'NAVIO', 'JAN'], ['Corvetas Classe Barroso', 'Barroso', 31], ['Navio Polar', 'Almirante Maximiano', 0]];
  const wb = XLSX.utils.book_new();
  // repete Diretoria Industrial para que 40031 vire "código suspeito"
  for (let i = 1; i <= 6; i++) linhas.push(['DGMM', '40030 - Diretoria Industrial da Marinha', 'Diretoria Industrial da Marinha', `40030-AE-0${i}-2026-004-0`, 1]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(linhas), 'FATURAS');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(hist), '2025');
  const f = path.join(os.tmpdir(), `siscont-e2e-${Date.now()}.xlsx`);
  XLSX.writeFile(wb, f);
  return f;
}

const ok = (c, m) => { if (!c) throw new Error('FALHOU: ' + m); console.log('  ✓ ' + m); };

(async () => {
  const browser = await chromium.launch();
  const resultados = [];
  async function cenario(nome, arquivos, fn) {
    console.log(`\n▶ ${nome}`);
    const db = novoBanco(); const log = [];
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const erros = [];
    page.on('pageerror', e => erros.push(e.message));
    await page.route(u => u.hostname === 'supabase.mock', handler(db, log));
    try {
      await page.goto(BASE);
      await page.getByLabel('E-mail de Acesso').fill('admin@mb.br');
      await page.getByLabel('Senha', { exact: true }).fill('senha12345');
      await page.getByRole('button', { name: 'Entrar no Sistema' }).click();
      await page.getByRole('button', { name: 'Cadastros' }).click();
      await page.getByRole('heading', { name: 'Cadastros' }).waitFor();
      await fn(page, db, arquivos);
      ok(erros.length === 0, `sem erros de JavaScript ${erros.join(' | ')}`);
      resultados.push([nome, 'OK']);
    } catch (e) {
      console.log('  ✗ ' + e.message.split('\n')[0]);
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `FALHA-${nome.replace(/\W+/g, '_')}.png`), fullPage: true });
      resultados.push([nome, 'FALHOU']);
    }
    await ctx.close();
  }

  await cenario('Importar planilha, sanear e gravar o cadastro', [planilhaSintetica()], async (page, db, arquivos) => {
    await page.getByRole('button', { name: 'Importar planilhas' }).click();
    await page.locator('input[type=file]').setInputFiles(arquivos);
    await page.getByText('Relatório de saneamento').waitFor({ timeout: 20000 });
    ok(await page.getByText('Código provavelmente digitado errado').first().isVisible(), 'aviso de código suspeito (40031) exibido');
    ok(!(await page.getByLabel('Importar Diretoria Industrial da Marinha').nth(1).isChecked()), 'cliente com código suspeito vem desmarcado');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'cadastros-importar.png'), fullPage: true });
    await page.getByRole('button', { name: 'Gravar no cadastro' }).click();
    await page.getByRole('button', { name: 'Sim, gravar' }).click();
    await page.getByText(/Importação concluída/).waitFor({ timeout: 15000 });
    const barroso = db.oms.find(o => o.codigo === '91645');
    ok(db.oms.length === 5, `5 clientes gravados (gravou ${db.oms.length}: ${db.oms.map(o => o.codigo).join(',')})`);
    ok(barroso && barroso.tipo === 'NAVIO' && barroso.classe_id, 'Corveta Barroso gravada como navio e com classe');
    ok(db.comandos.some(c => c.codigo === '91610') && db.comandos.some(c => c.codigo === '40030'), 'comandos criados com código');
    const polar = db.oms.find(o => o.codigo === '51215');
    ok(polar && polar.ativo === false && polar.desativado_em === '2024-08-31', 'navio sem fatura recente entrou desativado com data');
    ok(db.oms.find(o => o.codigo === '00994').tipo === 'EXTRA_MB', 'banco gravado como extra-MB');
    await page.getByRole('button', { name: 'OM / Clientes' }).click();
    await page.getByRole('cell', { name: /Corveta Barroso/ }).first().waitFor();
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'cadastros-oms.png'), fullPage: true });
  });

  await cenario('Desativar navio sem excluir; excluir bloqueado com faturas', [], async (page, db) => {
    const cmd = { id: uid(), codigo: '91610', nome: 'Comando do 1º Esquadrão de Escolta', setor_id: db.setores[0].id, ativo: true };
    db.comandos.push(cmd);
    db.oms.push({ id: uid(), codigo: '91645', nome: 'Corveta Barroso', tipo: 'NAVIO', comando_id: cmd.id, ativo: true });
    db.oms.push({ id: uid(), codigo: '91646', nome: 'Navio Teste Sem Fatura', tipo: 'NAVIO', comando_id: cmd.id, ativo: true });
    await page.getByRole('button', { name: 'Recarregar' }).click();
    await page.getByRole('cell', { name: /Corveta Barroso/ }).waitFor();
    const linha = page.getByRole('row', { name: /Corveta Barroso/ });
    await linha.getByTitle('Desativar (mantém o histórico)').click();
    await page.getByLabel('Data de desativação').fill('2026-10-31');
    await page.getByLabel('Motivo (opcional)').fill('Baixa do serviço ativo');
    await page.getByRole('button', { name: 'Desativar', exact: true }).click();
    await page.waitForTimeout(500);
    const b = db.oms.find(o => o.codigo === '91645');
    ok(b.ativo === false && b.desativado_em === '2026-10-31' && b.motivo_desativacao === 'Baixa do serviço ativo', 'navio desativado com data e motivo, registro mantido');
    await page.getByLabel('Situação').selectOption('');
    await page.getByRole('row', { name: /Corveta Barroso/ }).getByTitle('Excluir (só sem faturas)').click();
    await page.getByRole('button', { name: 'Excluir', exact: true }).click();
    await page.getByText(/possui faturas e não pode ser excluída/).waitFor();
    ok(db.oms.some(o => o.codigo === '91645'), 'exclusão de OM com faturas bloqueada');
    await page.getByRole('row', { name: /Navio Teste Sem Fatura/ }).getByTitle('Excluir (só sem faturas)').click();
    await page.getByRole('button', { name: 'Excluir', exact: true }).click();
    await page.waitForTimeout(500);
    ok(!db.oms.some(o => o.codigo === '91646'), 'OM sem faturas pode ser excluída');
  });

  await cenario('Calculadora da data-limite (10 dias úteis com feriado)', [], async (page) => {
    await page.getByRole('button', { name: 'Parâmetros e feriados' }).click();
    await page.getByLabel('Data de emissão').fill('2026-10-23');
    await page.getByText('09/11/2026').waitFor();
    ok(true, 'emissão 23/10/2026 + 10 dias úteis (com Finados) = 09/11/2026');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'cadastros-parametros.png'), fullPage: true });
  });

  if (extras.length) {
    await cenario('Planilhas reais (só análise, sem gravar)', extras, async (page, db, arquivos) => {
      await page.getByRole('button', { name: 'Importar planilhas' }).click();
      const t0 = Date.now();
      await page.locator('input[type=file]').setInputFiles(arquivos);
      await page.getByText('Relatório de saneamento').waitFor({ timeout: 120000 });
      const mem = await page.evaluate(() => (performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null));
      ok(true, `análise de ${arquivos.length} planilhas reais em ${((Date.now() - t0) / 1000).toFixed(1)} s (memória JS: ${mem ?? '?'} MB)`);
      const resumo = await page.locator('text=/Serão criados:/').innerText();
      console.log('    ' + resumo.replace(/\s+/g, ' '));
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'cadastros-importar-real.png'), fullPage: false });
    });
  }

  await browser.close();
  console.log('\n===== RESUMO =====');
  resultados.forEach(([n, r]) => console.log(`${r === 'OK' ? '✅' : '❌'} ${n}`));
  process.exit(resultados.some(r => r[1] !== 'OK') ? 1 : 0);
})();
