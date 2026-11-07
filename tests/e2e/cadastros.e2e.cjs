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
    received_documents: [], payment_allocations: [],
    precos: [], medicoes: [], atracacoes: [], lotes_faturamento: [], contestacoes: [], taxas_poupanca: [], rubricas: [], cobrancas: [], cash_flow_exits: [],
    propostas_tc: [], lotacoes_tc: [], matriz_tc: [], descontos_tc: [], atracacao_anual: [], auditoria: [], pendentes_tc: [], oms_nao_duplicadas: [],
  };
}

function handler(db, log) {
  return async route => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (status, body, headers) => route.fulfill({ status, contentType: 'application/json', headers, body: body === undefined ? '' : JSON.stringify(body) });
    if (url.pathname === '/auth/v1/token') {
      return json(200, { access_token: 't', token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'r', user: { id: 'a1', aud: 'authenticated', email: 'admin@mb.br', app_metadata: {}, user_metadata: {} } });
    }
    if (url.pathname.startsWith('/auth/v1/')) return json(200, {});
    if (url.pathname === '/rest/v1/rpc/om_adicionar_nome_alternativo') {
      const { p_om, p_nome } = JSON.parse(req.postData() || '{}');
      const o = db.oms.find(x => x.id === p_om); if (o && !(o.nomes_alternativos || []).includes(p_nome)) o.nomes_alternativos = [...(o.nomes_alternativos || []), p_nome];
      return json(200, null);
    }
    if (url.pathname === '/rest/v1/rpc/unificar_om') {
      const { p_manter, p_remover } = JSON.parse(req.postData() || '{}');
      let n = 0;
      Object.values(db).forEach(t => Array.isArray(t) && t.forEach(r => { if (r && r.om_id === p_remover) { r.om_id = p_manter; n++; } }));
      const m = db.oms.find(x => x.id === p_manter), r = db.oms.find(x => x.id === p_remover);
      m.nomes_alternativos = [...new Set([...(m.nomes_alternativos || []), ...(r.nomes_alternativos || []), r.nome])];
      Object.assign(r, { ativo: false, desativado_em: '2026-11-07', motivo_desativacao: `Unificada com ${m.nome}` });
      return json(200, n);
    }
    if (url.pathname === '/rest/v1/rpc/om_tem_movimento') {
      const { p_om_id } = JSON.parse(req.postData() || '{}');
      const o = db.oms.find(x => x.id === p_om_id);
      return json(200, !!o && db.invoices.some(i => i.ug === o.codigo && i.client.toLowerCase() === o.nome.toLowerCase()));
    }
    const m = url.pathname.match(/^\/rest\/v1\/(\w+)$/);
    if (!m) return json(404, {});
    const t = m[1];
    if (!db[t]) return json(200, []);
    const filtros = [...url.searchParams.entries()].filter(([k]) => !['select', 'order', 'columns', 'on_conflict', 'offset', 'limit'].includes(k));
    const casa = r => filtros.every(([k, v]) => {
      if (v.startsWith('eq.')) return String(r[k]) === v.slice(3);
      if (v.startsWith('in.(')) return v.slice(4, -1).split(',').map(x => x.replace(/^"|"$/g, '')).includes(String(r[k]));
      const cmp = (a, b) => (typeof a === 'number' ? a - Number(b) : String(a ?? '').localeCompare(b));
      if (v.startsWith('gte.')) return cmp(r[k], v.slice(4)) >= 0;
      if (v.startsWith('lte.')) return cmp(r[k], v.slice(4)) <= 0;
      if (v.startsWith('ilike.')) return String(r[k] ?? '').toLowerCase().includes(v.slice(6).replace(/%/g, '').toLowerCase());
      return true;
    });
    const metodo = req.method();
    log.push(`${metodo} ${t}`);
    if (metodo === 'GET') {
      const rows = db[t].filter(casa);
      if ((req.headers()['accept'] || '').includes('vnd.pgrst.object')) return rows[0] ? json(200, rows[0]) : json(406, { code: 'PGRST116', details: 'The result contains 0 rows', message: 'JSON object requested, multiple (or no) rows returned' });
      // paginação do PostgREST (offset/limit) e total pedido com Prefer: count=exact
      const off = Number(url.searchParams.get('offset') || 0);
      const lim = url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : rows.length;
      const pag = rows.slice(off, off + lim);
      const headers = (req.headers()['prefer'] || '').includes('count=exact')
        ? { 'Content-Range': `${off}-${off + pag.length - 1}/${rows.length}`, 'Access-Control-Expose-Headers': 'Content-Range' } : undefined;
      log.push(`GET ${t} offset=${off}`);
      return json(200, pag, headers);
    }
    if (metodo === 'POST') {
      const body = JSON.parse(req.postData() || '[]');
      const linhas = Array.isArray(body) ? body : [body];
      for (const l of linhas) {
        if (t === 'oms' && db.oms.some(o => o.codigo === l.codigo && o.nome.toLowerCase() === l.nome.toLowerCase())) return json(409, { code: '23505', message: 'duplicate key value violates unique constraint "oms_codigo_nome_uk"' });
        if (t === 'feriados') { db.feriados = db.feriados.filter(f => f.data !== l.data); }
        const PK = { propostas_tc: ['ano'], rubricas: ['ano', 'numero'], parametros: ['chave'] };
        const conflito = (url.searchParams.get('on_conflict') || '').split(',').filter(Boolean);
        if (!conflito.length && !l.id && PK[t]) conflito.push(...PK[t]);
        const ja = (l.id && db[t].find(r => r.id === l.id)) || (conflito.length && db[t].find(r => conflito.every(c => String(r[c]) === String(l[c]))));
        if (ja && (req.headers()['prefer'] || '').includes('merge-duplicates')) { Object.assign(ja, l); continue; } // upsert
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

function planilhaPagamento() {
  const cab = ['SETOR', 'COMANDO', 'Cliente', 'Fatura', 'Valor', 'Data Emis.', 'Data Venc.', 'Mês', 'Ano', 'Competência', 'TIPO', 'VALOR PAGO', 'SALDO', 'STATUS', 'QUITADA SIPLAD?', 'OBSERVAÇÕES'];
  const DIM = '40030 - Diretoria Industrial da Marinha';
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([cab,
    ['DGMM', DIM, 'Diretoria Industrial da Marinha', '40030-EL-08-2026-010-0', 10134.19, 46280, 46295, '', '', '', '', 10134.19, 0, 'PAGO', true, ''],
    ['DGMM', DIM, 'Navio-Patrulha Mangaratiba', '40032-DA-08-2026-010-0', 2960.81, 46280, '31/11/26', '', '', '', '', 0, 2960.81, 'VENCIDA', false, ''],
    ['DGMM', DIM, 'Diretoria Industrial da Marinha', '40030-AE-08-2026-004-0', 8656.28, 46280, 46295, '', '', '', '', 0, 8656.28, 'A VENCER', false, ''],
  ]), 'FATURAS');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([cab.slice(0, 11),
    ['DGMM', DIM, 'Diretoria Industrial da Marinha', '40030-TC-01-2025-014-0', 19615.73, 45700, 45716],
  ]), 'Faturas Pagas');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Data de situação', 'COMANDO', 'Cliente', 'NºALTCRED', 'TIPO', 'Valor ALTCRED', 'VALOR UTILIZADO', 'SALDO', 'OBSERVAÇÃO'],
    [46253, 'DGMM', DIM, 'G424.2026.AC.00343', 'PAGAMENTO', 10134.19, 10134.19, 0, ''],
  ]), 'ALTCRED');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Data de situação', 'COMANDO', 'CLIENTE', 'NºALTCRED', 'NºFATURA', 'VALOR UTILIZADO', 'TIPO'],
    [46253, 'DGMM', DIM, 'G424.2026.AC.00343', '40030-EL-08-2026-010-0', 10134.19, 'EL'],
    [46253, 'DGMM', DIM, 'G424.2026.AC.00343', '40030-EL-08-2026-099-0', 50, 'EL'],
  ]), 'LANÇAMENTOS');
  const f = path.join(os.tmpdir(), `siscont-e2e-pag-${Date.now()}.xlsx`);
  XLSX.writeFile(wb, f);
  return f;
}

/** PDF fictício no leiaute da "Solicitação de Alteração de Crédito" do SIPLAD (posições como no original). */
function pdfSiplad() {
  const { jsPDF } = require(path.join(__dirname, '../../node_modules/jspdf/dist/jspdf.node.min.js'));
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  doc.setFontSize(8);
  const t = (s, x, y) => doc.text(s, x, 842 - y);
  [['Solicitações de Alteração de', 180, 794], ['Crédito', 271, 773],
   ['N° da Solicitação', 22, 712], ['Dt. de Criação', 196, 712], ['Tipo Alteração', 396, 712],
   ['Z999.2026.AC.00001', 22, 698], ['10/03/2026', 196, 697], ['Indenização Serviços Prestados', 396, 697],
   ['ID do Usuário', 22, 669], ['Setor de Criação', 196, 669], ['ALTCRED de Origem', 396, 668],
   ['00.0000.00 - FULANO', 22, 654], ['12345 - ComTeste', 196, 654], ['--', 396, 654],
   ['UG Cliente', 196, 626], ['Tipo Tramitação', 23, 625], ['Origem Suplementação', 396, 625],
   ['--', 396, 610], ['Normal', 23, 607], ['12345 - ComTeste', 196, 607],
   ['Destino Destaque', 23, 532], ['UO Favorecida', 196, 532], ['Situação', 398, 532],
   ['--', 23, 517], ['--', 196, 517], ['Processada', 398, 517],
   ['Observação do Solicitante', 23, 495], ['Quitação das faturas 12346-EL-08-2026-010-0 e 12346-AE-08-2026-004-0.', 23, 480],
   ['Célula de Débito (CDD)', 245, 444],
   ['Moeda', 24, 427], ['PTRES', 63, 427], ['UO', 114, 427], ['Esfera', 147, 427], ['FR', 201, 427], ['ND', 255, 427], ['Plano Interno', 305, 427], ['UGR', 389, 427], ['UGE', 439, 427], ['Valor a Debitar', 494, 427],
   ['12345 -', 384, 410], ['1000000000', 181, 405], ['99999 -', 434, 405],
   ['R$', 32, 399], ['111111', 63, 399], ['22222', 108, 399], ['1', 158, 399], ['33903900', 241, 399], ['X.1.TESTE.0', 294, 399], ['ComTeste', 375, 399], ['1.000,00', 502, 399], ['UGETESTE', 434, 394],
   ['Células de Crédito (CDC)', 241, 364],
   ['Moeda', 24, 347], ['PTRES', 63, 347], ['UO', 114, 347], ['Esfera', 147, 347], ['FR', 201, 347], ['ND', 255, 347], ['Plano Interno', 305, 347], ['UGR', 389, 347], ['UGE', 439, 347], ['Valor a Creditar', 493, 347],
   ['1000000000', 181, 330], ['40015 -', 384, 330], ['40015 -', 434, 330],
   ['R$', 32, 325], ['111111', 63, 325], ['22222', 108, 325], ['1', 158, 325], ['33903900', 241, 325], ['R.TESTE.0', 296, 325], ['1.000,00', 502, 325], ['BNIC', 388, 320], ['BNIC', 438, 320],
   ['Valor Total a Creditar', 383, 305], ['1.000,00', 501, 305],
   ['Histórico Trâmite', 260, 272],
   ['OM', 48, 215], ['FULANO', 227, 215], ['10/03/2026', 300, 215],
   ['DGOM 20', 35, 195], ['Processamento em Batch', 100, 195], ['10/03/2026', 300, 195],
   ['DGOM 20', 35, 175], ['Processada', 128, 175], ['12/03/2026', 300, 175]].forEach(([s, x, y]) => t(s, x, y));
  const f = path.join(os.tmpdir(), `siscont-e2e-siplad-${Date.now()}.pdf`);
  fs.writeFileSync(f, Buffer.from(doc.output('arraybuffer')));
  return f;
}

const ok = (c, m) => { if (!c) throw new Error('FALHOU: ' + m); console.log('  ✓ ' + m); };

(async () => {
  const browser = await chromium.launch();
  const resultados = [];
  async function cenario(nome, arquivos, fn) {
    if (process.env.CENARIO && !nome.includes(process.env.CENARIO)) return; // ex.: CENARIO='Fase 5'
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
      await fn(page, db, arquivos, log);
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
    ok(await page.getByText('Códigos digitados errado, corrigidos').isVisible(), 'código digitado errado (40031) corrigido para 40030');
    ok(await page.getByLabel('Importar Diretoria Industrial da Marinha').count() === 1, 'Diretoria Industrial aparece uma vez só');
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
    ok(db.oms.find(o => o.codigo === '40030').codigo_proprio === true, 'OM gravada com o campo código próprio');
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

  await cenario('OM sem código próprio e indicativo naval', [], async (page, db) => {
    const cmd = { id: uid(), codigo: '41000', nome: 'Arsenal de Marinha do Rio de Janeiro', setor_id: db.setores[1].id, ativo: true };
    db.comandos.push(cmd);
    await page.getByRole('button', { name: 'Recarregar' }).click();
    await page.getByRole('button', { name: /Nova OM/ }).click();
    await page.getByLabel('Nome', { exact: true }).fill('PRESTNAV');
    await page.getByLabel('Comando (ComImSup)').selectOption(cmd.id);
    await page.getByLabel(/Não possui código próprio/).check();
    ok(await page.getByLabel('Código (5 dígitos)').inputValue() === '41000', 'código preenchido com o do comando (41000)');
    ok(await page.getByLabel('Código (5 dígitos)').isDisabled(), 'campo de código travado');
    await page.getByLabel('Indicativo naval').fill('prest nav');
    ok(await page.getByLabel('Indicativo naval').inputValue() === 'PRESTNAV', 'indicativo em maiúsculas, sem espaço');
    await page.getByRole('button', { name: 'Salvar', exact: true }).click();
    await page.getByRole('cell', { name: 'PRESTNAV' }).first().waitFor();
    const o = db.oms.find(x => x.nome === 'PRESTNAV');
    ok(o && o.codigo === '41000' && o.codigo_proprio === false && o.indicativo_naval === 'PRESTNAV', 'gravado com código do comando, sem código próprio e com indicativo');
    ok(await page.getByText('código do comando').first().isVisible(), 'lista mostra "código do comando"');
    await page.getByRole('button', { name: 'Comandos' }).click();
    await page.getByRole('row', { name: /Arsenal de Marinha/ }).getByTitle('Editar').click();
    await page.getByLabel('Indicativo naval').fill('AMRJRJ');
    await page.getByRole('button', { name: 'Salvar', exact: true }).click();
    await page.getByRole('cell', { name: 'AMRJRJ' }).waitFor();
    ok(db.comandos.find(c => c.codigo === '41000').indicativo_naval === 'AMRJRJ', 'indicativo naval do comando gravado');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'cadastros-comandos.png'), fullPage: true });
  });

  await cenario('Calculadora da data-limite (10 dias úteis com feriado)', [], async (page) => {
    await page.getByRole('button', { name: 'Parâmetros e feriados' }).click();
    await page.getByLabel('Data de emissão').fill('2026-10-23');
    await page.getByText('09/11/2026').waitFor();
    ok(true, 'emissão 23/10/2026 + 10 dias úteis (com Finados) = 09/11/2026');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'cadastros-parametros.png'), fullPage: true });
  });

  await cenario('Migrar faturas, ALTCRED e baixas ligadas ao cadastro', [planilhaPagamento()], async (page, db, arquivos) => {
    await page.getByRole('button', { name: 'Migrar faturas' }).click();
    await page.getByText('Importe primeiro o cadastro de OM').waitFor();
    ok(true, 'sem cadastro, a migração pede a importação do cadastro');
    await page.getByRole('button', { name: 'Importar planilhas' }).click();
    await page.locator('input[type=file]').setInputFiles(arquivos);
    await page.getByRole('button', { name: 'Gravar no cadastro' }).click();
    await page.getByRole('button', { name: 'Sim, gravar' }).click();
    await page.getByText('Importação concluída').waitFor();
    ok(db.oms.length === 2, `cadastro importado da mesma planilha (${db.oms.length} OM)`);

    await page.getByRole('button', { name: 'Migrar faturas' }).click();
    await page.locator('input[type=file]').setInputFiles(arquivos);
    await page.getByRole('heading', { name: 'Conferência com a planilha' }).waitFor({ timeout: 30000 });
    ok(await page.getByRole('cell', { name: 'Confere' }).isVisible(), 'em aberto da aba FATURAS confere com a planilha');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'cadastros-migrar.png'), fullPage: true });
    await page.getByRole('button', { name: 'Gravar migração' }).click();
    await page.getByRole('button', { name: 'Sim, gravar' }).click();
    await page.getByText('Migração concluída:').first().waitFor();
    const novas = db.invoices.filter(i => i.origem);
    const dim = db.oms.find(o => o.codigo === '40030');
    ok(novas.length === 4, `4 faturas gravadas (${novas.length})`);
    ok(novas.every(i => i.om_id), 'todas ligadas a uma OM do cadastro (om_id)');
    ok(novas.find(i => i.invoice_number === '40030-EL-08-2026-010-0').om_id === dim.id, 'fatura da DIM ligada à OM 40030');
    ok(novas.find(i => i.invoice_number === '40030-TC-01-2025-014-0').quitacao_externa, 'histórico entra como quitado fora do sistema');
    ok(db.received_documents.length === 1 && db.received_documents[0].document_number === 'G424.2026.AC.00343', 'ALTCRED gravada');
    ok(db.payment_allocations.length === 1 && Number(db.payment_allocations[0].amount) === 10134.19, 'baixa ligando ALTCRED e fatura');
    const da = db.invoices.find(i => i.invoice_number === '40032-DA-08-2026-010-0');
    ok(da.pontos_atencao.some(p => p.tipo === 'VENCIMENTO_CORRIGIDO'), 'vencimento recalculado anotado na fatura');
    ok(db.received_documents[0].pontos_atencao.some(p => p.tipo === 'BAIXA_SEM_FATURA' && p.mensagem.includes('40030-EL-08-2026-099-0')), 'baixa para fatura inexistente anotada na ALTCRED');

    // ícone na lista de faturas, detalhe e "marcar como resolvido"
    await page.getByRole('button', { name: 'Faturas emitidas' }).first().click();
    const linha = page.getByRole('row').filter({ hasText: '40032-DA-08-2026-010-0' });
    await linha.getByTestId('ponto-atencao').click();
    await page.getByText('Vencimento recalculado', { exact: true }).waitFor();
    ok(await page.getByText(/recalculado para \d{2}\/\d{2}\/2026/).isVisible(), 'janela mostra o problema e a data recalculada');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'pontos-fatura.png') });
    await page.getByRole('button', { name: 'Marcar como resolvido' }).click();
    await page.getByLabel('Justificativa').fill('Conferido no SIPLAD');
    await page.getByRole('button', { name: 'Confirmar' }).click();
    await page.getByText(/Resolvido por CC Admin/).waitFor();
    const reg = db.invoices.find(i => i.invoice_number === '40032-DA-08-2026-010-0').pontos_atencao.find(p => p.tipo === 'VENCIMENTO_CORRIGIDO');
    ok(reg.resolvido && reg.justificativa === 'Conferido no SIPLAD' && reg.resolvidoPor === 'CC Admin', 'resolução gravada com autor e justificativa');
    await page.keyboard.press('Escape'); // Esc fecha a janela

    // tela central
    await page.getByRole('button', { name: 'Pontos de Atenção' }).click();
    await page.getByRole('heading', { name: 'Pontos de Atenção' }).waitFor();
    await page.getByText('Baixa para fatura inexistente').first().waitFor();
    ok(true, 'tela Pontos de Atenção lista a baixa para fatura inexistente');
    ok(!(await page.getByRole('cell', { name: 'Vencimento recalculado' }).count()), 'ponto resolvido sai da lista de pendentes');
    await page.waitForTimeout(600);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'pontos-tela.png'), fullPage: true });
    await page.getByRole('button', { name: 'Cadastros' }).click();
    await page.getByRole('button', { name: 'Migrar faturas' }).click();

    await page.getByRole('button', { name: 'Desfazer migração' }).click();
    await page.getByRole('button', { name: 'Sim, remover' }).click();
    await page.getByText('Migração desfeita').waitFor();
    ok(db.invoices.length === 1 && db.invoices[0].id === 'i1' && !db.received_documents.length && !db.payment_allocations.length, 'desfazer remove só o que a migração gravou');
  });

  await cenario('Faturas com 7.000 registros: abre rápido, pagina e mostra a ALTCRED da quitada', [], async (page, db, _a, log) => {
    const doc = { id: uid(), document_number: 'G424.2026.AC.00343', document_type: 'ALTCRED', total_value: 5000000, date: '2026-02-01', operation: 'PAGAMENTO', client: 'DIM', sector: 'DGMM', command: '40030' };
    db.received_documents.push(doc);
    db.invoices = [];
    for (let i = 0; i < 7000; i++) {
      const hist = i >= 1500;
      db.invoices.push({
        id: uid(), ug: '40030', sector: 'DGMM', command: '40030 - DIM', client: 'Diretoria Industrial da Marinha',
        invoice_number: `40030-EL-${String((i % 12) + 1).padStart(2, '0')}-${hist ? 2024 : 2026}-${String(i).padStart(4, '0')}-0`,
        value: 100 + i, adjustment_addition: 0, adjustment_deduction: 0, issue_date: '2026-02-15', due_date: '2026-03-02',
        month_competence: (i % 12) + 1, year_competence: hist ? 2024 : 2026, competence: '', type: 'Eletricidade', service_acronym: 'EL',
        is_canceled: false, siplad_settled: false, om_id: null, origem: 'Planilha', quitacao_externa: hist ? 'Quitada antes do SISCONT' : null, quitada_em: null, contestada: false, pontos_atencao: [],
      });
      if (i < 1200) db.payment_allocations.push({ id: uid(), document_id: doc.id, invoice_id: db.invoices[i].id, amount: 100 + i, date: '2026-03-01', service_type: 'EL', siscont_settled: false });
    }
    await page.reload(); // o painel inicial já tinha lido (e guardado em cache) o banco antes da carga
    await page.getByRole('button', { name: 'Faturas emitidas' }).first().waitFor();
    const t0 = Date.now();
    await page.getByRole('button', { name: 'Faturas emitidas' }).first().click();
    await page.getByText(/de 7\.000 faturas/).waitFor({ timeout: 30000 });
    const ms = Date.now() - t0;
    ok(ms < 8000, `lista de 7.000 faturas aberta em ${(ms / 1000).toFixed(1)} s`);
    ok(await page.locator('tbody > tr').count() <= 60, 'só a página atual é desenhada (50 linhas)');
    ok(log.filter(l => l.startsWith('GET invoices offset=')).length >= 7, 'leitura paginada do banco (7 páginas)');
    const t1 = Date.now();
    await page.getByRole('button', { name: 'Próxima' }).click();
    await page.getByText('Página 2 de 140').waitFor();
    ok(Date.now() - t1 < 1500, `troca de página em ${Date.now() - t1} ms`);
    // quitada com baixa: mostra a ALTCRED
    await page.getByLabel('Busca').fill('40030-EL-01-2026-0000-0');
    const linha = page.getByRole('row').filter({ hasText: '40030-EL-01-2026-0000-0' });
    await linha.getByRole('button').first().click();
    await page.getByRole('cell', { name: 'G424.2026.AC.00343' }).first().waitFor();
    ok(true, 'fatura quitada mostra a ALTCRED vinculada');
    // histórico: explica por que não há ALTCRED e não mostra saldo
    await page.getByLabel('Busca').fill('40030-EL-01-2024-1500-0');
    const hist = page.getByRole('row').filter({ hasText: '40030-EL-01-2024-1500-0' });
    ok(await hist.getByText('Quitada').isVisible(), 'histórico aparece como quitada');
    await hist.getByRole('button').first().click();
    await page.getByText(/não informa a ALTCRED\/GRU usada/).waitFor();
    ok(true, 'histórico explica que a planilha não informa a ALTCRED');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'faturas-volume.png'), fullPage: false });
  });

  await cenario('Fase 2: PDF do SIPLAD, baixa assistida com sobra para adiantamento e extrato', [pdfSiplad()], async (page, db, arquivos) => {
    const setor = db.setores.find(x => x.sigla === 'DGMM');
    const cmd = { id: uid(), codigo: '12345', nome: 'Comando Teste', sigla: 'ComTeste', setor_id: setor.id, ativo: true };
    const om = { id: uid(), codigo: '12346', nome: 'Navio Teste', tipo: 'NAVIO', comando_id: cmd.id, setor_id: null, ativo: true, codigo_proprio: true };
    db.comandos.push(cmd); db.oms.push(om);
    const nova = (n, v, venc) => ({ id: uid(), ug: '12346', sector: 'DGMM', command: '12345 - Comando Teste', client: 'Navio Teste', invoice_number: n, value: v, adjustment_addition: 0, adjustment_deduction: 0, issue_date: '2026-09-15', due_date: venc, month_competence: 8, year_competence: 2026, competence: '08/2026', type: 'Eletricidade', service_acronym: n.split('-')[1], is_canceled: false, siplad_settled: false, om_id: om.id, origem: null, quitacao_externa: null, quitada_em: null, contestada: false, pontos_atencao: [] });
    db.invoices = [nova('12346-EL-08-2026-010-0', 400, '2026-09-29'), nova('12346-AE-08-2026-004-0', 350, '2026-09-29'), nova('12346-TL-07-2026-001-0', 90, '2026-08-31')];
    await page.reload();
    await page.getByRole('button', { name: 'Recebimentos (ALTCRED/GRU)' }).first().click();
    await page.getByRole('button', { name: 'PDF do SIPLAD' }).click();
    await page.locator('input[type=file][accept*="pdf"]').setInputFiles(arquivos);
    await page.getByText('Z999.2026.AC.00001').first().waitFor({ timeout: 20000 });
    ok(await page.getByLabel('Ação para Z999.2026.AC.00001').inputValue() === 'NOVA', 'PDF lido: ALTCRED nova reconhecida');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'fase2-siplad.png') });
    await page.getByRole('button', { name: 'Gravar', exact: true }).click();
    await page.getByText(/ALTCRED gravada\(s\) a partir do SIPLAD/).waitFor();
    const d = db.received_documents.find(x => x.document_number === 'Z999.2026.AC.00001');
    ok(d && Number(d.total_value) === 1000 && d.date === '2026-03-12', 'valor e data de situação (processada) gravados');
    ok(d.comando_id === cmd.id && d.ug === '12345', 'ligada ao comando pela UG cliente');
    ok(d.celulas.length === 2 && d.celulas[0].pi === 'X.1.TESTE.0' && d.celulas[1].ugr === '40015 - BNIC', 'células de débito e crédito (PI, UGR) gravadas');
    ok(d.destinacao.map(x => x.valor).join() === '12346-EL-08-2026-010-0,12346-AE-08-2026-004-0', 'faturas citadas na observação viram destinação');

    // baixa assistida
    await page.getByRole('heading', { name: 'Z999.2026.AC.00001' }).waitFor();
    const card = page.locator('div.border').filter({ has: page.getByRole('heading', { name: 'Z999.2026.AC.00001' }) }).last();
    await card.getByTitle('Ver Detalhes').click();
    await page.getByTestId('dados-siplad').waitFor();
    await page.getByRole('button', { name: 'Baixa assistida' }).click();
    await page.getByRole('heading', { name: /Baixa assistida/ }).waitFor();
    ok(await page.getByLabel('Valor para 12346-EL-08-2026-010-0').inputValue() === '400', 'fatura indicada recebe o saldo dela');
    ok(await page.getByLabel('Valor para 12346-TL-07-2026-001-0').inputValue() === '', 'fatura fora da destinação fica zerada (mesmo mais antiga)');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'fase2-baixa.png') });
    await page.getByLabel('Valor para 12346-EL-08-2026-010-0').fill('500');
    ok(await page.getByText(/passa do saldo da fatura/).isVisible(), 'não deixa passar do saldo da fatura');
    await page.getByLabel('Valor para 12346-EL-08-2026-010-0').fill('400');
    await page.getByRole('button', { name: 'Gravar baixas' }).click();
    await page.getByText(/baixa\(s\) gravada\(s\); sobra de R\$ 250,00 enviada para adiantamento/).waitFor();
    const bx = db.payment_allocations.filter(b => b.document_id === d.id);
    ok(bx.length === 2 && bx.every(b => b.tipo_baixa === 'PAGAMENTO'), '2 baixas de pagamento gravadas');
    ok(db.received_documents.find(x => x.id === d.id).sobra_adiantamento === true, 'sobra de R$ 250,00 marcada como adiantamento');

    // resumo de adiantamentos (aba Adiantamentos): a sobra aparece com saldo disponível
    await page.getByRole('button', { name: 'Adiantamentos', exact: true }).click();
    const resumo = page.getByTestId('resumo-adiantamentos');
    await resumo.waitFor();
    await resumo.getByText('12345 - ComTeste').first().click();
    ok(await resumo.getByText('sobra de pagamento (ALTCRED R$ 1.000,00)').isVisible(), 'resumo lista a ALTCRED cuja sobra foi para adiantamento');
    ok((await resumo.locator('tbody tr').first().innerText()).includes('R$ 250,00'), 'saldo disponível de adiantamento do cliente: R$ 250,00');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'fase2-adiantamentos.png'), fullPage: false });

    // extrato de conciliação
    await page.getByRole('button', { name: 'Extrato de conciliação' }).click();
    await page.getByPlaceholder(/Digite o código/).fill('12345');
    await page.getByRole('button', { name: /12345 - Comando Teste/ }).click();
    await page.getByRole('heading', { name: 'Faturas pagas (por data de situação)' }).waitFor();
    ok(await page.getByRole('cell', { name: 'ADIANTAMENTO' }).isVisible(), 'extrato mostra a sobra enviada para adiantamento');
    ok(await page.getByRole('cell', { name: '12346-TL-07-2026-001-0' }).isVisible(), 'fatura em aberto da OM subordinada aparece');
    ok(await page.getByText('R$ 90,00').first().isVisible(), 'total em aberto R$ 90,00');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'fase2-extrato.png'), fullPage: true });
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Excel' }).click()]);
    ok(/extrato_12345_\d{4}\.xlsx/.test(dl.suggestedFilename()), `Excel gerado (${dl.suggestedFilename()})`);
    const [dl2] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'PDF' }).click()]);
    ok(dl2.suggestedFilename().endsWith('.pdf'), 'PDF gerado');
  });

  await cenario('Fase 3: preços, rateio, mapa BNIC-35, lote com adiantamento, mensagem e PDF', [], async (page, db, _a, log) => {
    const setor = db.setores.find(x => x.sigla === 'DGMM');
    const cmd = { id: uid(), codigo: '40030', nome: 'Diretoria Industrial da Marinha', sigla: 'DIM', indicativo_naval: 'DIMRJ', setor_id: setor.id, ativo: true };
    const dim = { id: uid(), codigo: '40030', nome: 'Diretoria Industrial da Marinha', tipo: 'TERRA', comando_id: cmd.id, ativo: true, codigo_proprio: true };
    const npa = { id: uid(), codigo: '40032', nome: 'Navio-Patrulha Mangaratiba', tipo: 'NAVIO', comando_id: cmd.id, ativo: true, codigo_proprio: true };
    const banco = { id: uid(), codigo: '00994', nome: 'Banco do Brasil', tipo: 'EXTRA_MB', comando_id: null, ativo: true, codigo_proprio: true };
    db.comandos.push(cmd); db.oms.push(dim, npa, banco);
    db.service_definitions.push(
      { id: uid(), name: 'Taxa Condominial', unit_measure: '-', acronym: 'TC', nome_oficial: 'TAXA CONDOMINIAL', ordem: 10, ativo: true },
      { id: uid(), name: 'Eletricidade', unit_measure: 'KWH', acronym: 'EL', nome_oficial: 'FORNECIMENTO DE ENERGIA ELÉTRICA', setor_responsavel: 'a Divisão de Eletricidade (BNIC-34)', ordem: 30, ativo: true },
      { id: uid(), name: 'Diária de Atracação', unit_measure: 'DIA', acronym: 'DA', nome_oficial: 'DIÁRIA DE ATRACAÇÃO', emitida_de_acordo_com: 'DIÁRIA ESTABELECIDA', ordem: 40, ativo: true });
    db.invoices = [];
    db.received_documents.push({ id: uid(), document_number: 'G424.2026.AC.00403', document_type: 'ALTCRED', total_value: 5000, date: '2026-09-14', operation: 'ADIANTAMENTO', client: 'DIM', sector: 'DGMM', command: '40030', ug: '40030', comando_id: cmd.id, observation: '' });
    const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'siscont-f3-'));
    const rateio = path.join(pasta, 'rateio.xlsx'), mapa = path.join(pasta, 'G6.xlsx');
    let wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['ORGANIZAÇÕES APOIADAS', '', '', 'MEDIDO', '', '', 'VALOR TOTAL (R$)'], ['SIGLA', 'CÓDIGO', '', 'DIAS', 'CONSUMO (kWh)', 'Demanda (kW)', ''],
      ['DIM', '40030', '', 31, 12799, 40, 10134.19], ['BANCO DO BRASIL', '00994', '', 31, 1191, 3, 925.10], ['DESCONHECIDA', '99999', '', 31, 10, 1, 7]]), 'DADOS BNIC-41');
    XLSX.writeFile(wb, rateio);
    wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['BNIC-35'], ['', '', 'MÊS DE AGOSTO DE 2026'], ['', '', 'GERÊNCIA: G6'],
      ['NAVIOS', ...Array.from({ length: 31 }, (_, i) => i + 1)], ['NPA MANGARATIBA', ...Array(31).fill('A')], ['LEGENDA:']]), 'G6');
    XLSX.writeFile(wb, mapa);

    await page.reload();
    await page.getByRole('button', { name: 'Emitir faturas do mês' }).first().click();
    await page.getByRole('heading', { name: 'Faturamento' }).waitFor();
    // preços
    await page.getByRole('button', { name: 'Preços do ano' }).click();
    await page.getByLabel('Ano dos preços').fill('2026');
    await page.getByLabel('TC Diretoria Industrial da Marinha').fill('19615,73');
    await page.getByRole('button', { name: /Gravar \(1\)/ }).click();
    await page.getByText('Preços gravados.').first().waitFor();
    await page.getByLabel('Serviço dos preços').selectOption('DA');
    await page.getByLabel('DA Navio-Patrulha Mangaratiba').fill('95,51');
    await page.getByRole('button', { name: /Gravar \(1\)/ }).click();
    await page.waitForTimeout(400);
    ok(db.precos.length === 2 && db.precos.some(p => p.sigla === 'DA' && Number(p.valor) === 95.51), 'TC e diária de atracação de 2026 gravadas');
    // medições: rateio
    await page.getByRole('button', { name: 'Medições do mês' }).click();
    await page.getByLabel('Competência das medições').fill('2026-08');
    await page.getByLabel('Serviço', { exact: true }).selectOption('EL');
    await page.locator('input[type=file]').setInputFiles(rateio);
    await page.getByText(/Código 99999 .* não está no cadastro/).waitFor();
    await page.getByRole('button', { name: /Gravar \(2\)/ }).click();
    await page.getByText('2 medição(ões) gravada(s).').waitFor();
    ok(db.medicoes.length === 2 && Number(db.medicoes.find(m => m.om_id === dim.id).valor) === 10134.19, 'rateio importado: 2 OM, código desconhecido apontado');
    // atracação
    await page.getByRole('button', { name: 'Atracação (BNIC-35)' }).click();
    await page.getByLabel('Competência do mapa').fill('2026-08');
    await page.locator('input[type=file]').setInputFiles(mapa);
    await page.getByRole('button', { name: /Gravar \(1\)/ }).click();
    await page.getByText('1 navio(s) gravado(s).').waitFor();
    ok(db.atracacoes[0].dias_atracado === 31 && db.atracacoes[0].om_id === npa.id, 'mapa BNIC-35 importado: Mangaratiba 31 dias atracado');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'fase3-atracacao.png') });
    // lote
    await page.getByRole('button', { name: 'Lote de faturas' }).click();
    await page.getByLabel('Competência', { exact: true }).fill('2026-08');
    await page.getByRole('button', { name: 'Calcular prévia' }).click();
    await page.getByText('40030-TC-08-2026-001-0').waitFor();
    ok(await page.getByLabel('Valor de 40032-DA-08-2026-001-0').inputValue() === '2960.81', 'DA = 95,51 × 31 = 2.960,81');
    ok(await page.getByText('00994-EL-08-2026-001-0').isVisible() && await page.getByText('40030-EL-08-2026-002-0').isVisible(), 'numeração: extra-MB primeiro, sequência por serviço');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'fase3-previa.png'), fullPage: false });
    await page.getByRole('button', { name: 'Emitir lote' }).click();
    await page.getByRole('button', { name: 'Sim, emitir' }).click();
    await page.getByText(/Lote emitido: 4 faturas/).waitFor({ timeout: 15000 });
    const tc = db.invoices.find(i => i.invoice_number === '40030-TC-08-2026-001-0');
    ok(tc && tc.issue_date === '2026-09-15' && tc.data_limite_certificacao === '2026-09-29' && tc.due_date === '2026-10-15' && tc.lote_id, 'emissão 15/09/2026, certificação 29/09/2026 (10 dias úteis) e vencimento 15/10/2026 (30 dias corridos)');
    const ad = db.payment_allocations.filter(b => b.tipo_baixa === 'ADIANTAMENTO');
    ok(ad.length >= 1 && Math.abs(ad.reduce((s, b) => s + Number(b.amount), 0) - 5000) < 0.01, 'adiantamento de R$ 5.000,00 abatido automaticamente');
    ok(/Baixa na ALTCRED G424.2026.AC.00403/.test(db.invoices.find(i => i.id === ad[0].invoice_id).observation), 'fatura registra "Baixa na ALTCRED"');
    ok(db.lotes_faturamento.length === 1 && db.lotes_faturamento[0].qtd === 4, 'lote registrado');
    // lotes emitidos: mensagem e PDF
    await page.getByRole('button', { name: /AGO26/ }).click();
    await page.getByRole('button', { name: /mensagem/ }).first().click();
    const texto = await page.getByLabel('Texto da mensagem').inputValue();
    ok(/PARA: DIMRJ/.test(texto) && /40030-TC-08-2026-001-0/.test(texto), 'mensagem de envio com indicativo naval e faturas');
    await page.getByRole('button', { name: /marcar faturas/ }).click();
    await page.getByText(/marcada\(s\): enviadas/).waitFor();
    ok(db.invoices.filter(i => i.enviada_em).length === 3, 'faturas do comando marcadas como enviadas');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /PDF FR-172/ }).click()]);
    ok(/\.zip$/.test(dl.suggestedFilename()), `ZIP de PDF FR-172 gerado (${dl.suggestedFilename()})`);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'fase3-lotes.png'), fullPage: true });
  });

  await cenario('Fase 4: retificar (-1), contestação até a decisão, cancelamento com motivo e correção por atraso', [], async (page, db) => {
    const setor = db.setores.find(x => x.sigla === 'DGMM');
    const cmd = { id: uid(), codigo: '40030', nome: 'Diretoria Industrial da Marinha', setor_id: setor.id, ativo: true };
    const npa = { id: uid(), codigo: '40032', nome: 'Navio-Patrulha Mangaratiba', tipo: 'NAVIO', comando_id: cmd.id, ativo: true, codigo_proprio: true };
    db.comandos.push(cmd); db.oms.push(npa);
    db.service_definitions.push({ id: uid(), name: 'Diária de Atracação', unit_measure: 'DIA', acronym: 'DA', nome_oficial: 'DIÁRIA DE ATRACAÇÃO', setor_responsavel: 'o Agente de Manobras', ordem: 40, ativo: true });
    const fat = (n, v, extra = {}) => ({ id: uid(), ug: '40032', sector: 'DGMM', command: '40030 - Diretoria Industrial da Marinha', client: 'Navio-Patrulha Mangaratiba', invoice_number: n, value: v, adjustment_addition: 0, adjustment_deduction: 0, issue_date: '2026-09-15', due_date: '2026-09-29', month_competence: 8, year_competence: 2026, competence: '08/2026', type: 'Diária de Atracação', service_acronym: n.split('-')[1], is_canceled: false, siplad_settled: false, om_id: npa.id, contestada: false, pontos_atencao: [], substituida_por: null, cancelamento_motivo: null, lote_id: null, ...extra });
    const da = fat('40032-DA-08-2026-010-0', 2960.81), el = fat('40032-EL-08-2026-039-0', 2058.64), rb = fat('40032-RB-08-2026-004-0', 45207.21);
    db.invoices = [da, el, rb];
    const doc = { id: uid(), document_number: 'G424.2026.AC.00370', document_type: 'ALTCRED', total_value: 50000, date: '2026-10-29', operation: 'PAGAMENTO', client: 'DIM', sector: 'DGMM', command: '40030', comando_id: cmd.id };
    db.received_documents.push(doc);
    db.payment_allocations.push({ id: uid(), document_id: doc.id, invoice_id: da.id, amount: 1000, date: '2026-10-29', tipo_baixa: 'PAGAMENTO' },
      { id: uid(), document_id: doc.id, invoice_id: rb.id, amount: 45207.21, date: '2026-10-29', tipo_baixa: 'PAGAMENTO' });
    await page.reload();
    await page.getByRole('button', { name: 'Faturas emitidas' }).first().click();
    // 1) retificar a DA: nova versão -1 recebe a baixa
    await page.getByRole('row').filter({ hasText: '40032-DA-08-2026-010-0' }).getByTitle(/Retificar/).click();
    await page.getByLabel('Novo valor do serviço').fill('2865.30');
    await page.getByLabel('Motivo').fill('Navio atracado 30 dias, não 31 (BNIC-35 corrigido)');
    await page.getByRole('button', { name: 'Emitir 40032-DA-08-2026-010-1' }).click();
    await page.getByText(/cancela e substitui a 40032-DA-08-2026-010-0/).waitFor();
    const nova = db.invoices.find(i => i.invoice_number === '40032-DA-08-2026-010-1');
    ok(nova && Number(nova.value) === 2865.3 && nova.substitui === '40032-DA-08-2026-010-0', 'versão -1 criada com o novo valor e "substitui"');
    ok(da.is_canceled && da.substituida_por === '40032-DA-08-2026-010-1' && /BNIC-35/.test(da.cancelamento_motivo), 'original fica substituída, com motivo');
    ok(db.payment_allocations.find(b => b.amount === 1000).invoice_id === nova.id, 'baixa transferida para a nova versão');
    await page.getByText('Substituída').first().waitFor();
    // 2) contestar a EL
    await page.getByRole('row').filter({ hasText: '40032-EL-08-2026-039-0' }).getByTitle('Abrir contestação').click();
    await page.getByLabel('Motivo').fill('Navio docado em Niterói no período; não consumiu energia da BNIC');
    await page.getByRole('button', { name: 'Abrir contestação', exact: true }).last().click();
    await page.getByText(/Contestação da fatura 40032-EL-08-2026-039-0 aberta/).waitFor();
    ok(el.contestada === true && db.contestacoes.length === 1, 'contestação aberta e fatura marcada como contestada');
    await page.getByRole('button', { name: 'Contestações' }).first().click();
    await page.getByRole('heading', { name: 'Contestações' }).waitFor();
    await page.getByRole('button', { name: 'abrir' }).click();
    await page.getByPlaceholder(/Divisão de Eletricidade/).fill('Divisão de Eletricidade (BNIC-34)');
    await page.getByRole('button', { name: 'Encaminhar' }).click();
    await page.getByText('Encaminhada ao setor.').waitFor();
    await page.getByPlaceholder(/leitura conferida/).fill('Medidor do cais registrou consumo: navio esteve atracado até dia 20');
    await page.getByRole('button', { name: 'Registrar', exact: true }).first().click();
    await page.getByText('Resposta registrada.').waitFor();
    await page.getByLabel('Fundamento da decisão').fill('Consumo confirmado pela BNIC-34');
    await page.getByRole('button', { name: 'Ratificar (mantém)' }).click();
    await page.getByText(/fatura ratificada/).waitFor();
    const c = db.contestacoes[0];
    ok(c.status === 'ENCERRADA' && c.decisao === 'RATIFICADA' && c.historico.length === 4 && el.contestada === false, 'contestação: encaminhada → respondida → ratificada, histórico com 4 eventos');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'fase4-contestacao.png') });
    await page.keyboard.press('Escape'); // Esc fecha a janela
    // 3) cancelar a EL com motivo e devolução da baixa (sem baixa aqui) — motivo obrigatório
    await page.getByRole('button', { name: 'Faturas emitidas' }).first().click();
    await page.getByRole('row').filter({ hasText: '40032-EL-08-2026-039-0' }).getByTitle(/Cancelar fatura/).click();
    ok(await page.getByRole('button', { name: 'Cancelar fatura', exact: true }).last().isDisabled(), 'cancelar exige motivo');
    await page.getByLabel('Motivo').fill('Emitida em duplicidade');
    await page.getByRole('button', { name: 'Cancelar fatura', exact: true }).last().click();
    await page.getByText('Fatura 40032-EL-08-2026-039-0 cancelada.').waitFor();
    ok(el.is_canceled && el.cancelamento_motivo === 'Emitida em duplicidade' && el.cancelada_por === 'CC Admin', 'cancelamento registra motivo e responsável');
    // 4) correção por atraso: RB paga em 29/10 com data-limite 29/09
    await page.getByRole('button', { name: 'Emitir faturas do mês' }).first().click();
    await page.getByRole('button', { name: 'Correção por atraso (OI 6.2)' }).click();
    await page.getByLabel('Taxa SET26').fill('0,6');
    await page.getByLabel('Taxa OUT26').fill('0,6');
    await page.getByRole('button', { name: /Gravar \(2\)/ }).click();
    await page.getByText('Taxas gravadas.').waitFor();
    await page.getByRole('button', { name: 'Calcular correções' }).click();
    await page.getByText('40032-RB-08-2026-004-0').waitFor();
    ok(await page.getByText('+R$ 271,24').isVisible(), 'correção da RB: R$ 45.207,21 × 0,6% (30 dias) = R$ 271,24');
    await page.getByLabel('Competência das faturas de correção').fill('2026-10');
    await page.getByRole('button', { name: 'Emitir correções' }).click();
    await page.getByText(/fatura\(s\) de correção emitida\(s\)/).waitFor({ timeout: 15000 });
    const corr = db.invoices.find(i => i.acerto_de === '40032-RB-08-2026-004-0');
    ok(corr && Number(corr.adjustment_addition) === 271.24 && /^40032-RB-10-2026-\d{3}-0$/.test(corr.invoice_number) && /6\.2/.test(corr.observation), `fatura de correção ${corr && corr.invoice_number} (acréscimo R$ 271,24)`);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'fase4-correcao.png'), fullPage: true });
  });

  await cenario('Fase 5: quadro em aberto, cobrança por comando, painel, rubricas, NE classificada e disponível', [], async (page, db) => {
    const setor = db.setores.find(x => x.sigla === 'DGMM');
    const cmd = { id: uid(), codigo: '40030', nome: 'Diretoria Industrial da Marinha', indicativo_naval: 'DIMRJ', setor_id: setor.id, ativo: true };
    db.comandos.push(cmd);
    const fat = (n, v, venc, ano, tipo, extra = {}) => ({ id: uid(), ug: n.slice(0, 5), sector: 'DGMM', command: '40030 - Diretoria Industrial da Marinha', client: n.startsWith('40032') ? 'Navio-Patrulha Mangaratiba' : 'Diretoria Industrial da Marinha', invoice_number: n, value: v, adjustment_addition: 0, adjustment_deduction: 0, issue_date: venc, due_date: venc, month_competence: 8, year_competence: ano, competence: `08/${ano}`, type: tipo, service_acronym: n.split('-')[1], is_canceled: false, siplad_settled: false, contestada: false, pontos_atencao: [], ...extra });
    const tcPaga = fat('40030-TC-08-2026-014-0', 19615.73, '2026-09-29', 2026, 'Taxa Condominial');
    db.invoices = [
      fat('40030-TC-09-2025-014-0', 19615.73, '2025-10-31', 2025, 'Taxa Condominial'),
      fat('40032-EL-08-2026-039-0', 2058.64, '2026-09-29', 2026, 'Eletricidade'),
      fat('40032-RB-08-2026-004-0', 45207.21, '2026-09-29', 2026, 'Rebocador', { contestada: true }),
      fat('40030-AE-10-2026-004-0', 24114.60, '2099-12-31', 2026, 'Água e Esgoto'),
      tcPaga,
    ];
    const doc = { id: uid(), document_number: 'G424.2026.AC.00343', document_type: 'ALTCRED', total_value: 30000, date: '2026-09-10', operation: 'PAGAMENTO', client: 'DIM', sector: 'DGMM', command: '40030', comando_id: cmd.id, exercicio: 2026 };
    db.received_documents.push(doc);
    db.payment_allocations.push({ id: uid(), document_id: doc.id, invoice_id: tcPaga.id, amount: 19615.73, date: '2026-09-15', tipo_baixa: 'PAGAMENTO' });
    await page.reload();
    await page.getByRole('button', { name: 'Cobrança' }).first().click();
    await page.getByRole('heading', { name: 'Cobrança' }).waitFor();
    await page.getByText('Faturas vencidas 2025').waitFor();
    const bloco2025 = page.locator('section').filter({ hasText: 'Faturas vencidas 2025' });
    ok((await bloco2025.innerText()).includes('R$ 19.615,73'), 'vencidas 2025 por setor × tipo (TC R$ 19.615,73)');
    const totalAberto = page.locator('section').filter({ hasText: 'Faturas em aberto — total' });
    ok((await totalAberto.innerText()).includes('R$ 45.788,97'), 'em aberto total sem contestadas: R$ 45.788,97');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'fase5-quadro.png'), fullPage: true });
    await page.getByRole('button', { name: 'Mensagens de cobrança' }).click();
    await page.getByRole('button', { name: /gerar mensagem/ }).first().click();
    const texto = await page.getByLabel('Texto da cobrança').inputValue();
    ok(/^PARA: DIMRJ/.test(texto) && /40030-TC-09-2025-014-0/.test(texto) && !/40032-RB/.test(texto), 'mensagem de cobrança: indicativo, vencidas, sem a contestada');
    await page.getByRole('button', { name: /registrar/ }).click();
    await page.getByText('Cobrança registrada.').waitFor();
    ok(db.cobrancas.length === 1 && db.cobrancas[0].faturas.length === 2, 'cobrança registrada com as 2 faturas');
    await page.getByRole('button', { name: 'Painel do Encarregado' }).last().click(); // aba (o primeiro é o item do menu)
    await page.getByText('Dívida por condômino e idade').waitFor();
    ok(await page.getByText('ALTCRED/GRU com saldo parado').isVisible(), 'painel do Encarregado com dívida por idade e saldos parados');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'fase5-painel.png'), fullPage: true });

    // Fluxo de caixa: rubricas, NE classificada, importação de NE, condomínio e disponível
    const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'siscont-f5-'));
    const prop = path.join(pasta, 'proposta.xlsx'), nes = path.join(pasta, 'fluxo.xlsx');
    let wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Nº DE ORDEM', 'Conta Contábil', 'DESCRIÇÃO CONTAS', 'DESPESAS', 'VALOR PARA 2026 (R$)', '%RUB', 'VALOR 2025', 'VAR', 'DESCONTOS', 'VALOR RUBRICA ATUALIZADO'],
      [1, '8.9.9.1.1.08.02', 'DEMAIS', 'Manutenção de Telhados', 200000, '2,17%', 0, 0, 53903.08, 146096.92], [14, '', '', 'Serviço de Dedetização', 150000, '', 0, 0, 27639.27, 122360.73]]), 'Despesas_NOVO');
    XLSX.writeFile(wb, prop);
    wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['DATA', 'ALTCRED/NE', 'CLIENTE', 'ENTRADA', 'SAÍDA', 'SALDO', 'RUBRICA', 'DESCRIÇÃO'], ['Saldo Anterior'],
      ['10/10/2026', '740015000012026NE000122', 'AGUAS DO RIO 4 SPE S.A', '', 'R$ 94.860,00', '', 'Água e Esgoto', 'CONTRATACAO DOS SERVICOS'],
      ['11/10/2026', 'G424.2026.AC.00343', 'DIM', 'R$ 30.000,00', '', '', '', '']]), 'OUT2026');
    XLSX.writeFile(wb, nes);
    await page.getByRole('button', { name: 'Fluxo de caixa' }).first().click();
    await page.getByRole('button', { name: 'Rubricas', exact: true }).click();
    await page.getByLabel('Exercício das rubricas').fill('2026');
    await page.locator('input[type=file]').setInputFiles(prop);
    await page.getByText(/2 rubricas lidas/).waitFor();
    await page.getByRole('button', { name: 'Gravar' }).click();
    await page.getByText('Rubricas gravadas.').waitFor();
    ok(db.rubricas.length === 2 && Number(db.rubricas.find(r => r.numero === 1).valor_anual) === 146096.92, 'rubricas importadas da proposta (valor atualizado)');
    await page.getByRole('button', { name: 'Lançamentos' }).click();
    await page.getByRole('button', { name: 'Nova Saída' }).click();
    await page.getByLabel('Data', { exact: true }).fill('2026-10-05');
    await page.getByLabel('Número Documento').fill('2026NE0001');
    ok(await page.getByText(/Número fora do padrão da NE/).isVisible(), 'número de NE fora do padrão é apontado');
    await page.getByLabel('Número Documento').fill('740015000012026NE000123');
    await page.getByLabel('Cliente', { exact: true }).fill('DETOX DEDETIZADORA LTDA');
    await page.getByLabel('Valor Saída').fill('5040000'); // campo em centavos: R$ 50.400,00
    await page.getByLabel('Rubrica / categoria').selectOption('R14');
    await page.getByRole('button', { name: 'Salvar Lançamento' }).click();
    await page.getByText('Saída salva.').waitFor();
    const ne = db.cash_flow_exits.find(e => e.document_number === '740015000012026NE000123');
    ok(ne && ne.rubrica_numero === 14 && ne.categoria === 'CONDOMINIO' && Number(ne.value) === 50400, 'NE de R$ 50.400,00 gravada na rubrica 14');
    await page.locator('input[type=file][accept*="xlsx"]').first().setInputFiles(nes);
    await page.getByText(/1 nota\(s\) de empenho importada/).waitFor();
    ok(db.cash_flow_exits.some(e => e.document_number === '740015000012026NE000122' && e.categoria === 'AGUA'), 'NE importada da planilha e classificada como água');
    await page.getByRole('button', { name: 'Condomínio por rubrica' }).click();
    await page.getByLabel('Exercício do condomínio').fill('2026');
    await page.getByText(/Taxa condominial recebida em 2026/).waitFor();
    ok((await page.getByText(/Taxa condominial recebida em 2026/).innerText()).includes('R$ 19.615,73'), 'TC recebida em 2026 = baixa da fatura TC');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'fase5-condominio.png'), fullPage: true });
    await page.getByRole('button', { name: 'Disponível R.901.16' }).click();
    await page.getByLabel('Exercício do disponível').fill('2026');
    const disp = await page.locator('table').last().innerText();
    ok(disp.includes('R$ 19.615,73') && disp.includes('R$ 10.384,27') && disp.includes('R$ 94.860,00'), 'disponível: entrada condomínio 19.615,73, sem indicação 10.384,27, saída água 94.860,00');
  });

  await cenario('Fases 6 e 7: taxa condominial, diárias, publicação, auditoria, backup e menu por função', [], async (page, db) => {
    const classe = { id: uid(), nome: 'Corvetas Classe Barroso', ativo: true };
    db.classes_navio.push(classe);
    const sec = { id: uid(), codigo: '40002', nome: 'SecNSNQ', tipo: 'TERRA', ativo: true };
    const amrj = { id: uid(), codigo: '81100', nome: 'AMRJ', tipo: 'TERRA', ativo: true };
    const bar = { id: uid(), codigo: '91645', nome: 'Corveta Barroso', tipo: 'NAVIO', classe_id: classe.id, ativo: true };
    db.oms.push(sec, amrj, bar);
    db.auditoria.push({ id: 1, tabela: 'invoices', registro_id: 'i1', acao: 'UPDATE', em: '2026-11-06T10:00:00Z', usuario_email: 'oper@mb.br', antes: { status: 'PENDENTE' }, depois: { status: 'PAGO' } });
    const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'siscont-f6-'));
    const arq = path.join(pasta, 'proposta.xlsx');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Nº DE ORDEM', 'Conta Contábil', 'DESCRIÇÃO', 'DESPESAS', 'VALOR PARA 2026 (R$)', '%RUB', 'VALOR 2025( R$)', 'VARIAÇÃO % (2026/2025)', 'DESCONTOS', 'VALOR RUBRICA ATUALIZADO'],
      [1, '8.9.9.1.1.08.02', '', 'Manutenção de Telhados', 200000, '', 391421.64, '', 1500, 198500], [2, '', '', 'Navios', 1236100, '', 1151786.23]]), 'Despesas_NOVO');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['', 'CLIENTES'], ['', '', 1, 2], ['', 'SecNSNQ (Ed.23)', 'x', ''], ['', 'AMRJ', 'X', ''], ['', 'OM NOVA FORA DA ILHA', 'X', ''], ['', 'NAVIOS', '', 'X']]), 'Matriz_NOVO');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['OM', 'TAXA 2025', 'MENSAL', 'PROPOSTA', 'MENSAL', '%', '', 'DESCONTOS', '', '', '', '', '', 1, 2], ['SecNSNQ (Ed.23)'], ['AMRJ', '', '', '', '', '', '', 1000, '', '', '', '', '', 1000, 0], ['SUB-TOTAL']]), 'PROPOSTA CONDOMINIO');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['CLIENTES'], ['OM DE TERRA', '(A)', 'Lotação Anterior', '(B)'], ['', 'LOTAÇÃO', '', 'DIAS'],
      ['SecNSNQ (Ed.23)', 140, 76, 30], ['AMRJ', 1010, 1422, 30], ['OM NOVA FORA DA ILHA', 50, 40, 30], ['SUB TOTAL'], ['NAVIOS', '(A)', 'Lotação Anterior', '(B)'], ['', 'LOTAÇÃO', '', 'Nº MÉDIO DIAS'],
      ['CORVETA CLASSE BARROSO – CORVETA BARROSO', 148, 125, 28], ['TOTAL GERAL']]), 'RATEIO MODELO TÉCNICO_2026');
    XLSX.writeFile(wb, arq);
    await page.reload();
    await page.getByText('Contabilidade de custos', { exact: true }).waitFor();
    await page.getByText('Nenhum backup completo registrado.').waitFor();
    // menu por função, com grupos
    for (const g of ['Visão geral', 'Faturamento', 'Acompanhamento contábil', 'Contabilidade de custos', 'Configuração']) ok(await page.getByText(g, { exact: true }).first().isVisible(), `menu: grupo "${g}"`);
    ok(await page.getByText('Nenhum backup completo registrado.').isVisible(), 'lembrete de backup para o administrador');
    await page.getByRole('button', { name: 'Taxa condominial e diárias' }).click();
    await page.getByRole('heading', { name: 'Taxa condominial e diárias' }).waitFor();
    await page.getByLabel('Exercício da proposta').selectOption('2026');
    await page.getByText('Pendências: sem rubricas; sem OM com lotação.').waitFor();
    await page.getByRole('button', { name: 'Importar proposta (planilha)' }).click();
    await page.locator('input[aria-label="Arquivo da proposta"]').setInputFiles(arq);
    if (process.env.DEBUG_E2E) { await page.waitForTimeout(3000); console.log((await page.locator('body').innerText()).slice(0, 3000)); }
    await page.getByText(/2 rubricas/).waitFor();
    ok(await page.getByText('1 nome(s) sem correspondente automático.').isVisible() && (await page.getByLabel('O que fazer com OM NOVA FORA DA ILHA').inputValue()) === 'DEPOIS', 'nome sem correspondente: padrão "decidir depois" (não é perdido)');
    await page.getByRole('button', { name: 'Gravar importação' }).click();
    await page.getByText(/Proposta importada\. 1 nome\(s\) ficaram pendentes/).waitFor();
    const r1 = db.rubricas.find(r => r.numero === 1), r2 = db.rubricas.find(r => r.numero === 2);
    ok(db.rubricas.length === 2 && Number(r1.gasto_anterior) === 391421.64 && r2.destino === 'DA' && r1.destino === 'TC', 'rubricas com valor do ano anterior; "Navios" vai para as diárias');
    ok(Number(r1.desconto_geral) === 500 && Number(r1.desconto_planilha) === 1500, 'DESCONTOS 1.500 = AMRJ 1.000 (por OM) + 500 de desconto geral');
    ok(db.descontos_tc.length === 1 && db.descontos_tc[0].om_id === amrj.id && Number(db.descontos_tc[0].valor) === 1000, 'desconto da AMRJ na rubrica 1 importado da PROPOSTA CONDOMINIO');
    ok(db.lotacoes_tc.length === 3 && Number(db.lotacoes_tc.find(l => l.om_id === bar.id).dias) === 28, 'lotação de 2 OM + navio (28 dias/mês)');
    ok(db.matriz_tc.length === 2 && !db.matriz_tc.some(m => m.om_id === bar.id), 'matriz só da taxa condominial (navio fica nas diárias)');
    ok(db.pendentes_tc.length === 1 && db.pendentes_tc[0].nome === 'OM NOVA FORA DA ILHA' && Number(db.pendentes_tc[0].lotacao) === 50, 'pendência guardada com lotação e rubricas');
    // rubricas: colunas da planilha e conferência dos descontos
    const linhaR1 = (await page.getByRole('row').filter({ has: page.getByLabel('Descrição da rubrica 1') }).innerText()).replace(/\s+/g, ' ');
    ok(linhaR1.includes('R$ 1.500,00') && linhaR1.includes('R$ 198.500,00') && linhaR1.includes('✓'), `rubrica 1: descontos R$ 1.500,00, atualizado R$ 198.500,00 e confere com a planilha (${linhaR1})`);
    // resolver a pendência criando um cliente novo, fora da Ilha
    await page.getByRole('button', { name: /2\. Clientes e matriz/ }).click();
    await page.getByRole('button', { name: 'Escolher correspondente' }).click();
    await page.getByRole('button', { name: 'Criar novo cliente' }).click();
    await page.getByLabel('Nome do novo cliente').fill('OM Nova');
    await page.getByText('OM fora da Ilha das Cobras').click();
    await page.getByRole('button', { name: 'Criar e usar' }).click();
    await page.getByText(/"OM NOVA FORA DA ILHA" ligado a OM Nova/).waitFor();
    const nova = db.oms.find(o => o.nome === 'OM Nova');
    ok(nova && nova.fora_da_ilha === true && nova.codigo === '40015' && db.pendentes_tc.length === 0, 'cliente novo criado no cadastro (fora da Ilha, código 40015) e pendência resolvida');
    ok(db.lotacoes_tc.some(l => l.om_id === nova.id && Number(l.lotacao) === 50) && db.matriz_tc.some(m => m.om_id === nova.id && m.rubrica === 1), 'lotação e rubricas da linha da planilha passaram para o cliente');
    ok((nova.nomes_alternativos || []).includes('OM NOVA FORA DA ILHA'), 'nome da planilha guardado como nome alternativo (próxima importação reconhece)');
    // incluir cliente à mão
    await page.getByRole('button', { name: 'Incluir cliente' }).click();
    ok(await page.getByLabel('Buscar cliente').isVisible(), 'incluir cliente: busca no cadastro ou cria novo');
    await page.keyboard.press('Escape');
    // desconto da OM (SecNSNQ 23,5% no total)
    await page.getByRole('button', { name: '3. Descontos por OM' }).click();
    await page.getByLabel('OM do desconto').selectOption({ label: 'SecNSNQ' });
    await page.getByLabel('Valor do desconto').fill('23,5');
    ok(await page.getByRole('button', { name: 'Adicionar' }).isDisabled(), 'desconto exige justificativa');
    await page.getByLabel('Justificativa do desconto').fill('Edifício mantido pela própria OM');
    await page.getByRole('button', { name: 'Adicionar' }).click();
    await page.getByText('Desconto gravado.').waitFor();
    ok(db.descontos_tc.length === 2 && db.descontos_tc.some(d => Number(d.valor) === 23.5), 'desconto gravado');
    // média trienal: digitação e gravação
    await page.getByRole('button', { name: '6. Média trienal' }).click();
    await page.getByLabel('Dias Corvetas Classe Barroso 2023').fill('355');
    await page.getByLabel('Dias Corvetas Classe Barroso 2024').fill('288');
    await page.getByRole('button', { name: /Gravar \(2\)/ }).click();
    await page.getByText('2 registro(s) gravado(s).').waitFor();
    ok(db.atracacao_anual.length === 2, 'dias por classe e ano gravados');
    ok((await page.getByRole('row').filter({ hasText: 'Corvetas Classe Barroso' }).innerText()).includes('17.86'), 'média mensal da classe 17,86 (355 + 288 + 0 ÷ 3 ÷ 12)');
    // resultado da taxa: rubrica 1 = 199.500 (200.000 − 500) entre pesos 4.200 / 30.300 / 1.500; SecNSNQ 23.275,00 − 23,5% = 17.805,38
    await page.getByRole('button', { name: '4. Resultado da taxa' }).click();
    const linhaSec = await page.getByRole('row').filter({ hasText: 'SecNSNQ' }).first().innerText();
    ok(linhaSec.includes('R$ 17.805,38') && linhaSec.includes('R$ 1.483,78'), `SecNSNQ anual R$ 17.805,38 e mensal R$ 1.483,78 (${linhaSec.replace(/\s+/g, ' ')})`);
    ok((await page.getByRole('row').filter({ hasText: 'AMRJ' }).first().innerText()).includes('R$ 166.912,50'), 'AMRJ com o desconto de R$ 1.000 da planilha: R$ 166.912,50');
    ok(!(await page.getByRole('row').filter({ hasText: 'Corveta Barroso' }).count()), 'resultado da taxa não mistura navios');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'fase6-resultado.png'), fullPage: true });
    // diárias, separadas: 1.236.100 ÷ (148×28×12) × 148 = 3.678,87/dia
    await page.getByRole('button', { name: '7. Resultado das diárias' }).click();
    ok((await page.getByRole('row').filter({ hasText: 'Corveta Barroso' }).first().innerText()).includes('R$ 3.678,87'), 'diária da Corveta Barroso R$ 3.678,87 (custo militar-dia × lotação)');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'fase6-diarias.png'), fullPage: true });
    // aprovar e publicar
    await page.getByRole('button', { name: 'Aprovar proposta' }).click();
    await page.getByRole('button', { name: 'Confirmar' }).click();
    await page.getByText('Proposta aprovada.').waitFor();
    await page.getByRole('button', { name: 'Publicar taxa condominial' }).click();
    await page.getByRole('button', { name: 'Confirmar' }).click();
    await page.getByText(/Taxa condominial 2026 publicada: 3 OM/).waitFor();
    ok(!db.precos.some(p => p.sigla === 'DA'), 'publicar a taxa não publica as diárias');
    await page.getByRole('button', { name: 'Publicar diárias' }).click();
    await page.getByRole('button', { name: 'Confirmar' }).click();
    await page.getByText(/Diárias 2026 publicadas: 1 navio/).waitFor();
    const tcSec = db.precos.find(p => p.sigla === 'TC' && p.om_id === sec.id), da = db.precos.find(p => p.sigla === 'DA' && p.om_id === bar.id);
    ok(tcSec && Number(tcSec.valor) === 1483.78 && da && Number(da.valor) === 3678.87, 'publicado: TC mensal SecNSNQ R$ 1.483,78 e DA da Barroso R$ 3.678,87 nos Preços de 2026');
    ok(db.propostas_tc.length === 1 && db.propostas_tc[0].status === 'DIVULGADA', 'proposta DIVULGADA');
    // auditoria
    ok(!(await page.getByRole('button', { name: 'Auditoria', exact: true }).count()), 'menu sem item "Auditoria" separado');
    await page.getByRole('button', { name: 'Pontos de Atenção' }).click();
    await page.getByRole('tab', { name: /Histórico de alterações/ }).click();
    await page.getByText('status: PENDENTE → PAGO').waitFor();
    await page.getByText('status: PENDENTE → PAGO').click();
    ok(await page.getByText('oper@mb.br').first().isVisible(), 'trilha mostra usuário e alteração');
    await page.getByLabel('Ação').selectOption('DELETE');
    await page.getByText('Nenhum registro.').waitFor();
    ok(true, 'filtro por ação');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'fase7-auditoria.png'), fullPage: true });
    await page.getByRole('button', { name: 'Fazer backup agora' }).click();
    await page.getByRole('heading', { name: 'Administração' }).waitFor();
    ok(true, 'lembrete leva à Administração');
  });

  await cenario('Página inicial: números de cara, composição do em aberto, gráficos, lista ao clicar e taxa condominial', [], async (page, db) => {
    const amrj = { id: uid(), codigo: '81100', nome: 'Arsenal de Marinha do Rio de Janeiro', sigla: 'AMRJ', tipo: 'TERRA', ativo: true };
    const sec = { id: uid(), codigo: '40002', nome: 'SecNSNQ', tipo: 'TERRA', ativo: true };
    db.oms.push(amrj, sec);
    db.precos.push({ id: uid(), ano: 2026, sigla: 'TC', om_id: amrj.id, valor: 101673.7, unidade: 'MÊS' }, { id: uid(), ano: 2026, sigla: 'TC', om_id: sec.id, valor: 10057.36, unidade: 'MÊS' });
    const fat = (n, cli, tipo, ano, mes, venc, valor, extra = {}) => ({
      id: uid(), ug: '40030', sector: 'DGMM', command: '40030 - DIM', client: cli, invoice_number: n, value: valor, adjustment_addition: 0, adjustment_deduction: 0,
      issue_date: `${ano}-${String(mes).padStart(2, '0')}-15`, due_date: venc, month_competence: mes, year_competence: ano, competence: '', type: tipo, service_acronym: n.split('-')[1],
      is_canceled: false, siplad_settled: false, om_id: null, origem: 'Planilha', quitacao_externa: null, quitada_em: null, contestada: false, pontos_atencao: [], ...extra,
    });
    db.invoices = [
      fat('40030-TC-05-2024-001-0', 'Diretoria Industrial da Marinha', 'Taxa Condominial', 2024, 5, '2024-07-15', 300),
      fat('40031-AE-09-2025-001-0', 'Centro de Perícias Médicas', 'Água e Esgoto', 2025, 9, '2025-11-14', 80),
      fat('40030-EL-09-2026-001-0', 'Diretoria Industrial da Marinha', 'Energia Elétrica', 2026, 9, '2026-10-15', 200),
      fat('81100-TC-10-2026-001-0', 'Arsenal de Marinha do Rio de Janeiro', 'Taxa Condominial', 2026, 10, '2099-12-15', 400, { contestada: true }),
      fat('40030-AE-01-2026-001-0', 'Diretoria Industrial da Marinha', 'Água e Esgoto', 2026, 1, '2026-03-02', 1000),
      fat('40030-AE-02-2026-001-0', 'Diretoria Industrial da Marinha', 'Água e Esgoto', 2026, 2, '2026-04-02', 999, { is_canceled: true }),
    ];
    const doc = { id: uid(), document_number: 'G424.2026.AC.00001', document_type: 'ALTCRED', total_value: 1030, date: '2026-03-01', operation: 'PAGAMENTO', client: 'DIM', sector: 'DGMM', command: '40030' };
    db.received_documents.push(doc);
    db.payment_allocations.push({ id: uid(), document_id: doc.id, invoice_id: db.invoices[4].id, amount: 1000, date: '2026-03-01', service_type: 'AE', tipo_baixa: 'PAGAMENTO' },
      { id: uid(), document_id: doc.id, invoice_id: db.invoices[1].id, amount: 30, date: '2026-03-01', service_type: 'AE', tipo_baixa: 'PAGAMENTO' });
    await page.reload();
    await page.getByRole('button', { name: 'Painel inicial' }).click();
    await page.getByLabel('Ano de referência').selectOption('2026');
    const valorDe = async t => (await page.getByRole('button', { name: new RegExp(`^${t}:`) }).innerText()).replace(/\s+/g, ' ');
    await page.getByRole('button', { name: /^Faturado em 2026:/ }).waitFor();
    ok((await valorDe('Faturado em 2026')).includes('R$ 1.600,00'), 'faturado em 2026 = R$ 1.600,00 (sem a cancelada)');
    ok((await valorDe('Vencidas até 2025')).includes('R$ 350,00'), 'vencidas até 2025 = R$ 350,00 (2024 + saldo parcial de 2025)');
    ok((await valorDe('Vencidas de 2026')).includes('R$ 200,00'), 'vencidas de 2026 = R$ 200,00');
    ok((await valorDe('Total vencidas')).includes('R$ 550,00'), 'total vencidas = R$ 550,00');
    ok((await valorDe('A vencer')).includes('R$ 400,00'), 'a vencer = R$ 400,00');
    ok((await valorDe('Total em aberto')).includes('R$ 950,00') && (await valorDe('Total em aberto')).includes('contestação'), 'total em aberto = R$ 950,00, com aviso da contestada');
    ok(await page.getByText('Total mensal (todas as OM)').isVisible() && (await page.getByText('R$ 111.731,06').count()) > 0, 'taxa condominial geral mensal R$ 111.731,06');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'painel-inicial.png'), fullPage: true });
    if (SHOTS) { for (const [k, y] of [[2, 700], [3, 1400]]) { await page.locator('main .overflow-y-auto').first().evaluate((el, yy) => el.scrollTo(0, yy), y); await page.waitForTimeout(400); await page.screenshot({ path: path.join(SHOTS, `painel-inicial-${k}.png`) }); } await page.locator('main .overflow-y-auto').first().evaluate(el => el.scrollTo(0, 0)); }
    await page.getByRole('button', { name: /^Total vencidas:/ }).click();
    await page.getByRole('heading', { name: 'Faturas vencidas' }).waitFor();
    ok((await page.locator('table').last().innerText()).includes('40030-TC-05-2024-001-0'), 'clicar no cartão abre a lista das faturas vencidas');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'painel-lista.png') });
    ok((await page.locator('table').last().locator('tbody tr').first().innerText()).includes('40030-TC-05-2024-001-0'), 'lista ordenada por vencimento (mais antigo primeiro)');
    const cab = page.locator('th button', { hasText: 'Em aberto' }); await cab.click(); if (!(await cab.innerText()).includes('▼')) await cab.click();
    ok((await page.locator('table').last().locator('tbody tr').first().innerText()).includes('40030-TC-05-2024-001-0'), 'ordenar por valor em aberto ao clicar no cabeçalho (maior primeiro)');
    await page.keyboard.press('Escape');
    // filtro múltiplo: todos os clientes exceto a DIM
    await page.getByRole('button', { name: /^Cliente \(OM\): Todos/ }).click();
    await page.getByRole('option', { name: 'Diretoria Industrial da Marinha' }).click();
    await page.keyboard.press('Escape'); await page.getByRole('heading', { name: 'Painel inicial' }).click();
    ok(await page.getByTitle('Remover filtro').isVisible() && (await page.getByTitle('Remover filtro').innerText()).includes('todos exceto Diretoria Industrial da Marinha'), 'filtro "todos exceto" com etiqueta removível');
    ok((await valorDe('Total em aberto')).includes('R$ 450,00'), 'sem a DIM: em aberto R$ 450,00 (CPMM 50 + AMRJ 400)');
    await page.getByTitle('Remover filtro').click();
    ok((await valorDe('Total em aberto')).includes('R$ 950,00'), 'filtro removido volta a R$ 950,00');
  });

  await cenario('Cadastro: duplicidades, unificação, OM fora da Ilha e grupo de setores da Cobrança', [], async (page, db) => {
    page.on('dialog', d => d.accept());
    const setor = db.setores.find(x => x.sigla === 'DGMM');
    const cmd = { id: uid(), codigo: '40030', nome: 'Diretoria Industrial da Marinha', sigla: 'DIM', setor_id: setor.id, ativo: true };
    db.comandos.push(cmd);
    const a = { id: uid(), codigo: '40030', codigo_proprio: true, nome: 'Diretoria Industrial da Marinha', sigla: 'DIM', tipo: 'TERRA', comando_id: cmd.id, ativo: true, nomes_alternativos: [] };
    const b = { id: uid(), codigo: '40031', codigo_proprio: true, nome: 'DIRETORIA INDUSTRIAL DA MARINHA', tipo: 'TERRA', comando_id: cmd.id, ativo: false, desativado_em: '2025-01-01', nomes_alternativos: [] };
    const c = { id: uid(), codigo: '00994', nome: 'Banco do Brasil', tipo: 'EXTRA_MB', ativo: true, nomes_alternativos: [] };
    const d = { id: uid(), codigo: '40015', codigo_proprio: false, nome: 'BANCO DO BRASIL', tipo: 'EXTRA_MB', ativo: true, nomes_alternativos: [] };
    db.oms.push(a, b, c, d);
    db.invoices.push({ id: uid(), ug: '40031', client: 'DIRETORIA INDUSTRIAL DA MARINHA', invoice_number: '40031-TC-08-2025-016-0', om_id: b.id, value: 1, year_competence: 2025, month_competence: 8 },
      { id: uid(), ug: '40031', client: 'DIRETORIA INDUSTRIAL DA MARINHA', invoice_number: '40031-TC-09-2025-016-0', om_id: b.id, value: 1, year_competence: 2025, month_competence: 9 });
    await page.getByRole('button', { name: 'Recarregar' }).click();
    await page.getByRole('button', { name: 'Duplicidades' }).click();
    await page.getByText(/grupo\(s\)/).waitFor();
    const grupoDim = page.locator('div.border.rounded-xl').filter({ hasText: '40031' }).last();
    ok(await grupoDim.getByText('mesmo nome').first().isVisible(), 'DIM × DIRETORIA INDUSTRIAL (código diferente, desativada) apontadas como duplicadas');
    ok(await grupoDim.getByLabel('Manter Diretoria Industrial da Marinha (40030)').isChecked(), 'sugere manter a ativa');
    await grupoDim.getByRole('button', { name: 'Unificar marcadas na que fica' }).click();
    await page.getByText(/1 cadastro\(s\) unificado\(s\)/).waitFor();
    ok(db.invoices.filter(i => i.om_id === a.id).length === 2 && !db.invoices.some(i => i.om_id === b.id), 'faturas da duplicada passaram para a OM que fica');
    ok(b.ativo === false && /Unificada com/.test(b.motivo_desativacao) && a.nomes_alternativos.includes('DIRETORIA INDUSTRIAL DA MARINHA'), 'duplicada desativada; nome guardado como alternativo');
    const grupoBanco = page.locator('div.border.rounded-xl').filter({ hasText: '00994' }).last();
    await grupoBanco.getByRole('button', { name: 'Não são a mesma OM' }).click();
    await page.getByText(/Não aparecerão mais aqui/).waitFor();
    ok(db.oms_nao_duplicadas.length === 1 && !(await page.locator('div.border.rounded-xl.p-3').filter({ hasText: '00994' }).count()), '"não são a mesma" grava e some da lista');
    // OM fora da Ilha
    await page.getByRole('button', { name: 'OM / Clientes' }).click();
    await page.getByRole('row', { name: /40030.*Diretoria Industrial da Marinha/ }).getByTitle('Editar').click();
    await page.getByText('OM fora da Ilha das Cobras').click();
    await page.getByRole('button', { name: 'Salvar' }).click();
    await page.getByText('OM atualizada.').waitFor();
    ok(a.fora_da_ilha === true, 'OM marcada como fora da Ilha');
    await page.getByLabel('Localização').selectOption('FORA');
    ok(await page.getByText('fora da Ilha', { exact: true }).first().isVisible(), 'filtro "Fora da Ilha" com etiqueta na lista');
    // Cobrança: grupo de setores editável
    db.invoices.push({ id: uid(), ug: '40030', sector: 'DGMM', command: '40030 - DIM', client: 'Diretoria Industrial da Marinha', invoice_number: '40030-AE-09-2026-001-0', value: 100, adjustment_addition: 0, adjustment_deduction: 0, issue_date: '2026-09-15', due_date: '2026-10-15', month_competence: 9, year_competence: 2026, type: 'Água e Esgoto', is_canceled: false },
      { id: uid(), ug: '00994', sector: 'EXTRA-MB', command: 'EXTRA-MARINHA', client: 'Banco do Brasil', invoice_number: '00994-AE-09-2026-001-0', value: 50, adjustment_addition: 0, adjustment_deduction: 0, issue_date: '2026-09-15', due_date: '2026-10-15', month_competence: 9, year_competence: 2026, type: 'Água e Esgoto', is_canceled: false });
    await page.reload();
    await page.getByRole('button', { name: 'Cobrança' }).first().click();
    await page.getByRole('button', { name: /^Setores: Todos/ }).waitFor();
    await page.getByRole('button', { name: 'Exceto Setor do Material' }).click();
    ok((await page.getByRole('button', { name: /^Setores:/ }).getAttribute('aria-label')).includes('Todos exceto DGMM'), 'atalho "Exceto Setor do Material" = todos exceto DGMM');
    await page.getByRole('button', { name: 'definir grupo…' }).click();
    await page.getByLabel('Nome do grupo').fill('Extra-Marinha');
    await page.locator('label', { hasText: 'DGMM' }).last().locator('input').uncheck();
    await page.locator('label', { hasText: 'EXTRA-MB' }).last().locator('input').check();
    await page.getByRole('button', { name: 'Gravar', exact: true }).click();
    await page.getByText('Grupo de setores gravado.').waitFor();
    ok(db.parametros.find(p => p.chave === 'setores_material').valor === 'EXTRA-MB' && db.parametros.find(p => p.chave === 'nome_grupo_setores').valor === 'Extra-Marinha', 'grupo de setores não é mais fixo (gravado como parâmetro)');
    await page.getByRole('button', { name: 'Só Extra-Marinha' }).waitFor();
    ok(true, 'atalhos passam a usar o novo grupo');
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
      // grava o cadastro no banco simulado e analisa a migração das faturas (sem gravar)
      await page.getByRole('button', { name: 'Gravar no cadastro' }).click();
      await page.getByRole('button', { name: 'Sim, gravar' }).click();
      await page.getByText('Importação concluída').waitFor({ timeout: 120000 });
      await page.getByRole('button', { name: 'Migrar faturas' }).click();
      const t1 = Date.now();
      await page.locator('input[type=file]').setInputFiles(arquivos);
      await page.getByRole('heading', { name: 'Conferência com a planilha' }).waitFor({ timeout: 180000 });
      ok(true, `migração analisada em ${((Date.now() - t1) / 1000).toFixed(1)} s`);
      console.log('    ' + (await page.locator('text=/Serão gravados/').innerText()).replace(/\s+/g, ' '));
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'cadastros-migrar-real.png'), fullPage: true });
    });
  }

  await browser.close();
  console.log('\n===== RESUMO =====');
  resultados.forEach(([n, r]) => console.log(`${r === 'OK' ? '✅' : '❌'} ${n}`));
  process.exit(resultados.some(r => r[1] !== 'OK') ? 1 : 0);
})();
