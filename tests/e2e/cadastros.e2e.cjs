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
    propostas_tc: [], lotacoes_tc: [], matriz_tc: [], descontos_tc: [], atracacao_anual: [], auditoria: [], pendentes_tc: [], oms_nao_duplicadas: [], subsidios_tc: [], anexos_tc: [], fechados_tc: [], extratos_tc: [],
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
    if (url.pathname.startsWith('/storage/v1/object/sign/')) return json(200, { signedURL: '/object/sign/arquivo?token=t' });
    if (url.pathname.startsWith('/storage/v1/')) { (db.storage = db.storage || []).push(`${req.method()} ${url.pathname}`); return json(200, { Key: url.pathname, Id: 'x' }); }
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
      db.invoices.forEach(i => { if (i.om_id === p_manter && (i.client || '').toLowerCase() === r.nome.toLowerCase()) i.client = m.nome; });
      db.oms.splice(db.oms.indexOf(r), 1);   // script 016: o duplicado é excluído e o nome dele não é guardado
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
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: 'America/Sao_Paulo', locale: 'pt-BR' });
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
    await page.getByRole('button', { name: 'OM / Clientes' }).click();
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
    await page.getByRole('button', { name: 'OM / Clientes' }).click();
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
    await page.getByRole('button', { name: /^Escolher comandos e OM/ }).click();
    await page.getByLabel('Buscar comando ou OM').fill('12345');
    await page.getByRole('checkbox', { name: /Comando 12345 - Comando Teste/ }).check();
    await page.getByRole('button', { name: 'fechar' }).click();
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
    await page.getByRole('heading', { name: 'Emitir faturas do mês' }).waitFor();
    // resumo do mês: abre primeiro e aponta o que falta antes de calcular
    await page.getByText(/pendência\(s\) para/).waitFor();
    ok(await page.getByText('Nenhum preço carregado.').first().isVisible(), 'resumo do mês: preços da TC pendentes antes de lançar');
    ok(await page.getByText(/Nenhuma medição lançada/).first().isVisible() && await page.getByText(/Mapa não lançado/).isVisible(), 'resumo do mês: medições e mapa de atracação pendentes');
    // preços
    await page.getByRole('button', { name: 'Preços do ano', exact: true }).click();
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
    await page.getByRole('button', { name: 'Medições do mês', exact: true }).click();
    await page.getByLabel('Competência das medições').fill('2026-08');
    await page.getByLabel('Serviço', { exact: true }).selectOption('EL');
    await page.getByRole('tabpanel').locator('input[type=file]').setInputFiles(rateio);
    await page.getByText(/Código 99999 .* não está no cadastro/).waitFor();
    await page.getByRole('button', { name: /Gravar \(2\)/ }).click();
    await page.getByText('2 medição(ões) gravada(s).').waitFor();
    ok(db.medicoes.length === 2 && Number(db.medicoes.find(m => m.om_id === dim.id).valor) === 10134.19, 'rateio importado: 2 OM, código desconhecido apontado');
    // atracação
    await page.getByRole('button', { name: 'Atracação', exact: true }).click();
    await page.getByLabel('Competência do mapa').fill('2026-08');
    ok(await page.getByText(/Nenhum navio com mapa lançado/).isVisible() && await page.getByRole('button', { name: /Navio-Patrulha Mangaratiba dia 1$/ }).count() === 0, 'atracação: grade vazia até lançar o mapa (não lista todos os navios ativos)');
    await page.getByRole('tabpanel').locator('input[type=file]').setInputFiles(mapa);
    await page.getByRole('button', { name: /Gravar \(1\)/ }).click();
    await page.getByText('1 navio(s) gravado(s).').waitFor();
    ok(db.atracacoes[0].dias_atracado === 31 && db.atracacoes[0].om_id === npa.id, 'mapa BNIC-35 importado: Mangaratiba 31 dias atracado');
    // setor responsável pelo lançamento: cadastrado na própria aba (não fixo no código), sem apagar os outros campos do serviço
    ok(await page.getByRole('tabpanel').getByText(/Responsável pelos dados de Diária de Atracação:/).isVisible() && await page.getByRole('tabpanel').getByText('não cadastrado').isVisible(), 'atracação: responsável aparece como não cadastrado');
    await page.getByRole('button', { name: /cadastrar/ }).click();
    await page.getByLabel('Setor responsável de DA').fill('Gerência Portuária');
    await page.getByRole('button', { name: 'Gravar', exact: true }).click();
    await page.getByText('Responsável de DA gravado.').waitFor();
    const da = db.service_definitions.find(x => x.acronym === 'DA');
    ok(da.setor_responsavel === 'Gerência Portuária' && da.nome_oficial === 'DIÁRIA DE ATRACAÇÃO' && da.emitida_de_acordo_com === 'DIÁRIA ESTABELECIDA', 'responsável gravado no cadastro do serviço sem apagar os outros campos');
    await page.getByRole('tabpanel').getByText(/Gerência Portuária/).waitFor();
    ok(true, 'responsável cadastrado aparece na aba');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'fase3-atracacao.png') });
    // lote
    await page.getByRole('button', { name: 'Lote de faturas', exact: true }).click();
    await page.getByLabel('Competência', { exact: true }).fill('2026-08');
    await page.getByRole('button', { name: 'Calcular prévia' }).click();
    await page.getByText('40030-TC-08-2026-001-0').waitFor();
    ok(await page.getByLabel('Valor de 40032-DA-08-2026-001-0').inputValue() === '2960.81', 'DA = 95,51 × 31 = 2.960,81');
    ok(await page.getByText('00994-EL-08-2026-001-0').isVisible() && await page.getByText('40030-EL-08-2026-002-0').isVisible(), 'numeração: extra-MB primeiro, sequência por serviço');
    await page.getByRole('button', { name: 'Resumo do mês', exact: true }).click();
    ok(await page.getByLabel('Competência do resumo').inputValue() === '2026-08', 'competência compartilhada entre as abas');
    await page.getByRole('button', { name: 'Lote de faturas', exact: true }).click();
    ok(await page.getByText('40030-TC-08-2026-001-0').isVisible(), 'trocar de aba não apaga a prévia do lote');
    const [dlPrevia] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Prévia em Excel/ }).click()]);
    ok(/^previa_lote_MENSAL_2026-08\.xlsx$/.test(dlPrevia.suggestedFilename()), 'prévia do lote exportada em Excel');
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
    await page.getByLabel('Buscar lote').fill('zzz');
    ok(await page.getByText('Nenhum lote com esses filtros.').isVisible(), 'lotes emitidos: busca sem resultado');
    await page.getByLabel('Buscar lote').fill('ago26');
    await page.getByLabel('Filtrar lotes por tipo').selectOption('MENSAL');
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

  await cenario('Norma (OI) configurável: parâmetro e rótulos do Faturamento', [], async (page, db) => {
    await page.getByRole('button', { name: 'Parâmetros e feriados', exact: true }).click();
    await page.getByLabel('Norma (nome)').waitFor();
    await page.getByLabel('Norma (nome)').fill('OI 41-02');
    await page.getByLabel('Item da correção por atraso').fill('7.3');
    await page.getByLabel('Anexo da diária de atracação').fill('Anexo M');
    await page.getByRole('button', { name: 'Gravar norma' }).click();
    await page.getByText('Norma gravada.').waitFor();
    await page.waitForTimeout(500);
    for (let i = 0; i < 20 && !(db.parametros.find(p => p.chave === 'norma_item_correcao')?.valor === '7.3' && db.parametros.find(p => p.chave === 'norma_anexo_diaria')?.valor === 'Anexo M'); i++) await page.waitForTimeout(250);
    ok(db.parametros.find(p => p.chave === 'norma_nome')?.valor === 'OI 41-02' && db.parametros.find(p => p.chave === 'norma_item_correcao')?.valor === '7.3', 'norma gravada nos parâmetros');
    ok(db.parametros.find(p => p.chave === 'norma_anexo_diaria')?.valor === 'Anexo M', 'anexo da diária gravado nos parâmetros');
    await page.reload();
    await page.getByRole('button', { name: 'Emitir faturas do mês' }).first().click();
    await page.getByRole('heading', { name: 'Emitir faturas do mês' }).waitFor();
    await page.getByRole('button', { name: 'Correção por atraso (OI 41-02, item 7.3)', exact: true }).waitFor();
    ok(true, 'aba de correção cita a norma cadastrada');
    ok(await page.getByRole('button', { name: 'Atracação', exact: true }).isVisible() && !(await page.getByText(/BNIC-35/).count()), 'nenhum setor fixo (BNIC-35) nas abas do Faturamento');
  });

  await cenario('Faturas emitidas: datas sem perder 1 dia, filtros, lote e exclusão só do administrador', [], async (page, db) => {
    const setor = db.setores.find(x => x.sigla === 'DGMM');
    const cmd = { id: uid(), codigo: '40030', nome: 'Diretoria Industrial da Marinha', sigla: 'DIM', indicativo_naval: 'DIMRJ', setor_id: setor.id, ativo: true };
    const om = { id: uid(), codigo: '40030', nome: 'Diretoria Industrial da Marinha', tipo: 'TERRA', comando_id: cmd.id, ativo: true, codigo_proprio: true };
    db.comandos.push(cmd); db.oms.push(om);
    const f = (id, n, extra) => ({ id, invoice_number: n, ug: '40030', sector: 'DGMM', command: 'Com A', client: 'Diretoria Industrial da Marinha', value: 1000, adjustment_addition: 0, adjustment_deduction: 0,
      issue_date: '2026-09-15', due_date: '2026-10-15', month_competence: 8, year_competence: 2026, competence: '08/2026', type: 'Taxa Condominial', service_acronym: 'TC', is_canceled: false, siplad_settled: false,
      om_id: om.id, lote_id: null, enviada_em: null, certificada_em: null, siafi_em: null, data_limite_certificacao: '2026-09-29', ...extra });
    db.invoices = [f(uid(), '40030-TC-08-2026-001-0', {}), f(uid(), '40030-EL-08-2026-001-0', { type: 'Eletricidade', service_acronym: 'EL', value: 500 }),
      f(uid(), '51209-DA-01-2023-047-0', { client: 'NHo Taurus', om_id: null, ug: '51209', sector: 'COMOPNAV', command: 'Com B', month_competence: 1, year_competence: 2023, competence: '01/2023' }),
      f(uid(), '40030-TC-07-2026-001-0', { is_canceled: true, value: 9999, month_competence: 7, competence: '07/2026' })];
    await page.reload();
    await page.getByRole('button', { name: 'Faturas emitidas' }).first().click();
    await page.getByRole('heading', { name: 'Faturas emitidas' }).waitFor();
    await page.getByRole('row', { name: /40030-TC-08-2026-001-0/ }).waitFor();
    // layout: a tabela cabe na largura da tela (sem arrastar para o lado) e a coluna de ações fica visível
    const sobra = await page.locator('table').first().evaluate(t => { const c = t.parentElement; return c.scrollWidth - c.clientWidth; });
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'faturas-layout.png') });
    ok(sobra <= 1, `lista de faturas cabe na largura da tela sem rolagem horizontal (sobra ${sobra}px)`);
    ok(await page.getByRole('button', { name: 'Editar a fatura 40030-TC-08-2026-001-0' }).isVisible(), 'ações da fatura visíveis sem arrastar a tela');
    // 1. data de vencimento sem perder 1 dia (o navegador do teste roda em fuso de Brasília)
    ok((await page.getByRole('row', { name: /40030-TC-08-2026-001-0/ }).innerText()).includes('15/10/2026'), 'vencimento 15/10/2026 aparece como 15/10/2026 (sem perder 1 dia)');
    // 3. cabeçalho: ativas e canceladas, serviço sem as canceladas
    await page.getByText(/Na lista: 4/).waitFor();
    ok(await page.getByText(/3 ativas, 1 canceladas/).isVisible() && await page.getByText(/R\$ 2\.500,00/).first().isVisible(), 'cabeçalho: 3 ativas, 1 cancelada e serviço prestado sem a cancelada (R$ 2.500,00)');
    // 5. sem OM ligada
    ok(await page.getByRole('button', { name: /1 sem OM ligada/ }).isVisible(), 'aponta a fatura sem OM ligada ao cadastro');
    await page.getByLabel('Filtrar por cadastro').selectOption('sem');
    ok(await page.getByRole('row', { name: /51209-DA-01-2023-047-0/ }).count() === 1 && await page.getByRole('row', { name: /40030-TC-08-2026-001-0/ }).count() === 0, 'filtro "só sem OM ligada" mostra só a fatura sem cadastro');
    await page.getByRole('button', { name: 'limpar estes filtros' }).click();
    // 2. filtro de várias escolhas: só o setor COMOPNAV
    await page.getByRole('button', { name: /^Setor:/ }).click();
    await page.getByTitle('Mostrar só COMOPNAV').click({ force: true });
    await page.keyboard.press('Escape');
    ok(await page.getByRole('row', { name: /51209-DA-01-2023-047-0/ }).count() === 1 && await page.getByRole('row', { name: /40030-TC-08-2026-001-0/ }).count() === 0, 'filtro de setor (várias escolhas): só COMOPNAV');
    await page.getByRole('button', { name: 'limpar estes filtros' }).click();
    // acompanhamento e lote
    await page.getByRole('row', { name: /40030-TC-08-2026-001-0/ }).getByRole('button').first().waitFor();
    await page.getByLabel('Selecionar a fatura 40030-TC-08-2026-001-0').check();
    await page.getByLabel('Selecionar a fatura 40030-EL-08-2026-001-0').check();
    await page.getByText('2 selecionada(s)').waitFor();
    await page.getByRole('button', { name: 'SIPLAD: lançado' }).click();
    await page.getByText(/2 fatura\(s\): SIPLAD lançado/).waitFor();
    ok(db.invoices.filter(i => i.siplad_settled).length === 2, 'SIPLAD marcado em lote em 2 faturas');
    await page.getByLabel('Selecionar a fatura 40030-TC-08-2026-001-0').check();
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'faturas-emitidas.png'), fullPage: false });
    await page.getByRole('button', { name: 'Enviadas hoje' }).click();
    await page.getByText(/1 fatura\(s\): marcadas como enviadas/).waitFor();
    const tc = db.invoices.find(i => i.invoice_number === '40030-TC-08-2026-001-0');
    ok(!!tc.enviada_em && !db.invoices.find(i => i.invoice_number === '40030-EL-08-2026-001-0').enviada_em, 'envio marcado em lote só na fatura escolhida');
    await page.getByLabel('Filtrar por andamento').selectOption('naoEnviada');
    await page.getByRole('row', { name: /40030-TC-08-2026-001-0/ }).waitFor({ state: 'detached' });
    ok(await page.getByRole('row', { name: /40030-EL-08-2026-001-0/ }).count() === 1, 'filtro "ainda não enviadas" tira a fatura enviada');
    await page.getByLabel('Filtrar por andamento').selectOption('');
    // acompanhamento na linha expandida
    await page.getByRole('row', { name: /40030-EL-08-2026-001-0/ }).getByRole('button').first().click();
    await page.getByText('Data-limite de certificação').waitFor();
    ok(await page.getByText('29/09/2026').isVisible(), 'data-limite de certificação 29/09/2026 (sem perder 1 dia)');
    // 12. nova fatura avulsa com aviso; 10. ações com nome acessível; 11. exclusão (admin vê)
    ok(await page.getByRole('button', { name: 'Editar a fatura 40030-TC-08-2026-001-0' }).isVisible() && await page.getByRole('button', { name: 'Excluir a fatura 40030-TC-08-2026-001-0' }).isVisible(), 'ações com nome acessível; administrador vê Excluir');
    await page.getByRole('button', { name: /Nova fatura avulsa/ }).click();
    ok(await page.getByText(/A emissão regular é feita pelo lote/).isVisible(), 'nova fatura avulsa avisa que a emissão regular é pelo lote');
    await page.keyboard.press('Escape');
  });

  await cenario('Mapa analítico: crédito só abate a dívida da própria OM, níveis somam e totais conferem', [], async (page, db) => {
    const setor = db.setores.find(x => x.sigla === 'DGMM');
    const cmdA = { id: uid(), codigo: '40030', nome: 'Diretoria Industrial da Marinha', sigla: 'DIM', setor_id: setor.id, ativo: true };
    const cmdB = { id: uid(), codigo: '41000', nome: 'Arsenal de Marinha do Rio de Janeiro', sigla: 'AMRJ', setor_id: setor.id, ativo: true };
    const dim = { id: uid(), codigo: '40030', nome: 'Diretoria Industrial da Marinha', tipo: 'TERRA', comando_id: cmdA.id, ativo: true, codigo_proprio: true };
    const amrj = { id: uid(), codigo: '41000', nome: 'Arsenal de Marinha do Rio de Janeiro', tipo: 'TERRA', comando_id: cmdB.id, ativo: true, codigo_proprio: true };
    db.comandos.push(cmdA, cmdB); db.oms.push(dim, amrj);
    const f = (n, om, venc, valor) => ({ id: uid(), invoice_number: n, ug: om.codigo, sector: 'DGMM', command: 'texto livre da fatura', client: om.nome, value: valor, adjustment_addition: 0, adjustment_deduction: 0,
      issue_date: '2026-09-15', due_date: venc, month_competence: 8, year_competence: 2026, competence: '08/2026', type: 'Taxa Condominial', service_acronym: 'TC', is_canceled: false, siplad_settled: false, om_id: om.id });
    db.invoices = [f('40030-TC-08-2026-001-0', dim, '2026-10-15', 1000), f('40030-EL-08-2026-001-0', dim, '2099-12-31', 300), { ...f('41000-TC-05-2026-001-0', amrj, '2026-06-15', 200), contestada: true }];
    const doc = (n, nome, valor) => ({ id: uid(), document_number: n, document_type: 'ALTCRED', total_value: valor, date: '2026-09-14', operation: 'PAGAMENTO', client: nome, sector: 'DGMM', command: 'outro texto do documento', ug: '99999', observation: '' });
    db.received_documents.push(doc('G1.2026.AC.00001', 'Diretoria Industrial da Marinha', 400), doc('G1.2026.AC.00002', 'Arsenal de Marinha do Rio de Janeiro', 5000));
    await page.reload();
    await page.getByRole('button', { name: 'Faturas emitidas' }).first().click();
    await page.getByRole('heading', { name: 'Faturas emitidas' }).waitFor();
    await page.getByRole('button', { name: /Mapa Analítico de Contas/ }).click();
    await page.getByText('Dívida em aberto').waitFor();
    const cartao = async (rot) => (await page.locator('button[title]').filter({ hasText: rot }).first().innerText()).replace(/\s+/g, ' ');
    ok(/R\$ 1\.300,00/.test(await cartao('Dívida em aberto')), 'dívida em aberto R$ 1.300,00 (saldo real das 2 faturas)');
    ok(/R\$ 1\.000,00/.test(await cartao('Vencido')) && /R\$ 300,00/.test(await cartao('A vencer')), 'vencido R$ 1.000,00 e a vencer R$ 300,00');
    ok(/R\$ 900,00/.test(await cartao('A pagar (líquido)')), 'a pagar R$ 900,00: crédito de R$ 400 abate só a dívida da própria OM');
    ok(/R\$ 5\.000,00/.test(await cartao('Crédito que sobra')), 'crédito do Arsenal (R$ 5.000,00) sobra e não paga fatura da Diretoria Industrial');
    // estrutura: o comando é o do cadastro e o crédito está junto da dívida da mesma OM
    await page.getByRole('button', { name: 'expandir tudo' }).click();
    ok(await page.getByText('40030 - Diretoria Industrial da Marinha').first().isVisible(), 'comando mostrado é o do cadastro (código - nome), não o texto digitado');
    ok(await page.getByText('ALTCRED/GRU: G1.2026.AC.00001').isVisible() && await page.getByText('40030-TC-08-2026-001-0').isVisible(), 'crédito e faturas aparecem juntos na OM');
    ok(await page.getByText(/sobra R\$ 5\.000,00/).first().isVisible() && await page.getByText(/sobra R\$ 5\.000,00/).count() === 3, 'OM com crédito maior que a dívida mostra a sobra (e ela soma no comando e no setor)');
    ok((await page.locator('tfoot').innerText()).replace(/\s+/g, ' ').includes('R$ 900,00'), 'rodapé: total a pagar R$ 900,00');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'mapa-analitico.png'), fullPage: true });
    // ---- interatividade: os cartões e as barras dos gráficos filtram a própria árvore
    const vencido = page.getByRole('button', { name: /^Vencido/ });
    await vencido.click();
    ok(await vencido.getAttribute('aria-pressed') === 'true', 'cartão "Vencido" fica ligado (destacado)');
    await page.getByText('40030-TC-08-2026-001-0').first().waitFor();
    ok(await page.getByText('40030-EL-08-2026-001-0').count() === 0, 'clicar em "Vencido" deixa na árvore só as faturas vencidas');
    ok(await page.getByText('41000-TC-05-2026-001-0').count() === 0 && await page.getByText('Arsenal de Marinha do Rio de Janeiro').count() === 0, 'a fatura vencida contestada não entra (e a OM que só tinha ela sai da árvore)');
    ok(await page.getByLabel('Filtros do mapa').getByText(/Só faturas vencidas \(sem contestadas\)/).isVisible(), 'etiqueta mostra o filtro ligado');
    if (SHOTS) { await page.waitForTimeout(1200); await page.screenshot({ path: path.join(SHOTS, 'mapa-vencidas.png'), fullPage: true }); }
    ok((await page.locator('tfoot').innerText()).replace(/\s+/g, ' ').includes('R$ 600,00'), 'total a pagar das vencidas: R$ 1.000 − crédito R$ 400 = R$ 600');
    const [pdf] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'PDF', exact: true }).click()]);
    const conteudo = fs.readFileSync(await pdf.path(), 'latin1');
    if (SHOTS) fs.copyFileSync(await pdf.path(), path.join(SHOTS, 'mapa-analitico-vencidas.pdf'));
    ok(/^mapa_analitico_\d{4}-\d{2}-\d{2}\.pdf$/.test(pdf.suggestedFilename()), 'PDF do mapa gerado');
    ok(conteudo.includes('40030-TC-08-2026-001-0') && !conteudo.includes('40030-EL-08-2026-001-0') && !conteudo.includes('41000-TC-05-2026-001-0'), 'PDF imprime só o filtro: a vencida, sem a fatura a vencer e sem a contestada');
    ok(conteudo.includes('40030 - Diretoria Industrial da Marinha') && conteudo.includes('G1.2026.AC.00001'), 'PDF no formato da árvore: comando, OM, fatura e ALTCRED');
    await page.getByLabel(/Tirar as contestadas/).uncheck();
    await page.getByText('41000-TC-05-2026-001-0').first().waitFor();
    ok(true, 'desmarcando "Tirar as contestadas", a vencida contestada volta para a árvore');
    await page.getByLabel(/Tirar as contestadas/).check();
    await vencido.click();
    await page.getByText('40030-EL-08-2026-001-0').first().waitFor();
    ok(await vencido.getAttribute('aria-pressed') === 'false', 'clicar de novo em "Vencido" desliga o filtro');
    const aVencer = page.getByRole('button', { name: /^A vencer/ });
    await aVencer.click();
    await page.getByText('40030-TC-08-2026-001-0').first().waitFor({ state: 'detached' });
    ok(await page.getByText('40030-EL-08-2026-001-0').first().isVisible(), '"A vencer" deixa na árvore só as faturas a vencer');
    await aVencer.click();
    const sobra = page.getByRole('button', { name: /^Crédito que sobra/ });
    await sobra.click();
    await page.getByText('Diretoria Industrial da Marinha').first().waitFor({ state: 'detached' });
    ok(await page.getByText('Arsenal de Marinha do Rio de Janeiro').first().isVisible(), '"Crédito que sobra" deixa na árvore só a OM com sobra');
    await sobra.click();
    // nome da OM abre o detalhe
    await page.getByRole('button', { name: 'Diretoria Industrial da Marinha', exact: true }).click();
    const dlg = page.getByRole('dialog');
    await dlg.getByText('G1.2026.AC.00001').waitFor();
    ok(await dlg.getByText('40030-TC-08-2026-001-0').isVisible(), 'clicar no nome da OM abre o detalhe com faturas e ALTCRED dela');
    await page.keyboard.press('Escape');
    // foco numa OM
    await page.getByRole('button', { name: 'focar', exact: true }).first().click({ force: true });
    await page.getByLabel('Filtros do mapa').waitFor();
    ok(await page.getByLabel('Filtros do mapa').getByText(/^OM /).isVisible(), 'foco numa OM mostra a etiqueta do filtro');
    await page.getByRole('button', { name: 'ver todos' }).click();
    ok(await page.getByLabel('Filtros do mapa').count() === 0, '"ver todos" tira os filtros');
    ok(await page.locator('.recharts-wrapper').count() === 0, 'os dois gráficos saíram do mapa');
    // busca, ordenação e exportação
    await page.getByLabel('Buscar no mapa').fill('G1.2026.AC.00002');
    await page.getByText('Arsenal de Marinha do Rio de Janeiro').first().waitFor();
    ok(await page.getByText('Diretoria Industrial da Marinha').count() === 0, 'busca por ALTCRED mostra só a OM dela');
    await page.getByLabel('Buscar no mapa').fill('');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Excel' }).click()]);
    ok(/^mapa_analitico_\d{4}-\d{2}-\d{2}\.xlsx$/.test(dl.suggestedFilename()), 'mapa exportado em Excel');
    // ver faturas na lista
    await page.getByRole('button', { name: 'ver faturas na lista' }).first().click();
    await page.getByLabel('Busca').waitFor();
    ok((await page.getByLabel('Busca').inputValue()).length > 0, '"ver faturas na lista" leva à lista já filtrada pela OM');
  });

  await cenario('Mapa analítico: crédito devolvido por fatura cancelada é da OM da fatura (RT DGMM paga o Arsenal)', [], async (page, db) => {
    const setor = db.setores.find(x => x.sigla === 'DGMM');
    const cmdB = { id: uid(), codigo: '41000', nome: 'Arsenal de Marinha do Rio de Janeiro', sigla: 'AMRJ', setor_id: setor.id, ativo: true };
    const amrj = { id: uid(), codigo: '41000', nome: 'Arsenal de Marinha do Rio de Janeiro', tipo: 'TERRA', comando_id: cmdB.id, ativo: true, codigo_proprio: true };
    db.comandos.push(cmdB); db.oms.push(amrj);
    const fat = { id: uid(), invoice_number: '41000-TC-09-2025-002-0', ug: '41000', sector: 'DGMM', command: 'Arsenal', client: amrj.nome, value: 19707.4, adjustment_addition: 0, adjustment_deduction: 0,
      issue_date: '2025-10-15', due_date: '2025-11-15', month_competence: 9, year_competence: 2025, competence: '09/2025', type: 'Taxa Condominial', service_acronym: 'TC', is_canceled: true, siplad_settled: false, om_id: amrj.id };
    db.invoices = [fat];
    const doc = { id: uid(), document_number: 'B4D0.2026.AC.00824', document_type: 'ALTCRED', total_value: 5210.74, date: '2026-08-19', operation: 'PAGAMENTO', client: '40001 - RT DGMM', sector: 'DGMM', command: '40001 - RT DGMM', ug: '40001', observation: 'PAGAMENTO DE FATURAS DO AMRJ 2025' };
    db.received_documents.push(doc);
    db.payment_allocations.push({ id: uid(), document_id: doc.id, invoice_id: fat.id, amount: 5210.74, date: '2026-08-19', tipo_baixa: 'PAGAMENTO' });
    await page.reload();
    await page.getByRole('button', { name: 'Faturas emitidas' }).first().click();
    await page.getByRole('heading', { name: 'Faturas emitidas' }).waitFor();
    await page.getByRole('button', { name: /Mapa Analítico de Contas/ }).click();
    await page.getByText('Crédito que sobra').waitFor();
    const cartao = async (rot) => (await page.locator('button[title]').filter({ hasText: rot }).first().innerText()).replace(/\s+/g, ' ');
    ok(/R\$ 5\.210,74/.test(await cartao('Crédito que sobra')), 'o crédito de R$ 5.210,74 aparece como sobra');
    await page.getByRole('button', { name: 'expandir tudo' }).click();
    ok(await page.getByText('Arsenal de Marinha do Rio de Janeiro').first().isVisible() && await page.getByText(/devolvido da fatura cancelada 41000-TC-09-2025-002-0/).isVisible(), 'crédito está na OM Arsenal, com a origem (fatura cancelada)');
    ok(await page.getByText(/crédito sem OM no cadastro/).count() === 0 && await page.getByText(/40001 - RT DGMM/).count() === 0, 'não aparece mais como "sem OM no cadastro" nem em nome do RT DGMM');
  });

  await cenario('Acompanhamento contábil: datas, agrupamento pelo cadastro e extrato com pagamentos de outra UG', [], async (page, db) => {
    const setor = db.setores.find(x => x.sigla === 'DGMM');
    const cmd = { id: uid(), codigo: '41000', nome: 'Arsenal de Marinha do Rio de Janeiro', sigla: 'AMRJ', setor_id: setor.id, ativo: true };
    const amrj = { id: uid(), codigo: '41000', nome: 'Arsenal de Marinha do Rio de Janeiro', tipo: 'TERRA', comando_id: cmd.id, ativo: true, codigo_proprio: true };
    const skm = { id: uid(), codigo: '41000', nome: 'SKM', tipo: 'EXTRA_MB', comando_id: cmd.id, ativo: true, codigo_proprio: false };
    db.comandos.push(cmd); db.oms.push(amrj, skm);
    const fat = { id: uid(), invoice_number: '41000-EL-09-2025-001-0', ug: '41000', sector: 'DGMM', command: 'Arsenal', client: amrj.nome, value: 3000, adjustment_addition: 0, adjustment_deduction: 0,
      issue_date: '2025-10-15', due_date: '2025-11-15', month_competence: 9, year_competence: 2025, competence: '09/2025', type: 'Energia Elétrica', service_acronym: 'EL', is_canceled: false, siplad_settled: false, om_id: amrj.id };
    const fat2 = { ...fat, id: uid(), invoice_number: '41000-AE-10-2026-001-0', value: 800, issue_date: '2026-11-15', due_date: '2026-12-15', month_competence: 10, year_competence: 2026, competence: '10/2026', type: 'Água e Esgoto', service_acronym: 'AE' };
    const fatOutra = { ...fat, id: uid(), invoice_number: '41000-TC-10-2026-009-0', client: 'SKM', om_id: skm.id, value: 50, issue_date: '2026-11-15', due_date: '2026-12-15', month_competence: 10, year_competence: 2026, competence: '10/2026', type: 'Taxa Condominial', service_acronym: 'TC' };
    db.invoices = [fat, fat2, fatOutra];
    const docAmrj = { id: uid(), document_number: 'AMRJ.2026.AC.00001', document_type: 'ALTCRED', total_value: 1020, date: '2026-10-01', operation: 'PAGAMENTO', client: 'ARSENAL DE MARINHA DO RIO DE JANEIRO', sector: 'texto livre', command: 'texto livre', ug: '41000', observation: '' };
    const docRt = { id: uid(), document_number: 'B4D0.2026.AC.00824', document_type: 'ALTCRED', total_value: 2000, date: '2026-10-05', operation: 'PAGAMENTO', client: '40001 - RT DGMM', sector: 'DGMM', command: '40001 - RT DGMM', ug: '40001', observation: 'PAGAMENTO DE FATURAS DO AMRJ 2025' };
    db.received_documents.push(docAmrj, docRt);
    db.payment_allocations.push({ id: uid(), document_id: docAmrj.id, invoice_id: fat.id, amount: 1000, date: '2026-10-01', tipo_baixa: 'PAGAMENTO' }, { id: uid(), document_id: docAmrj.id, invoice_id: fatOutra.id, amount: 20, date: '2026-10-01', tipo_baixa: 'PAGAMENTO' }, { id: uid(), document_id: docRt.id, invoice_id: fat.id, amount: 2000, date: '2026-10-05', tipo_baixa: 'PAGAMENTO' });
    await page.reload();
    // Recebimentos: documento do dia 1º não cai no mês anterior; agrupado pelo cadastro
    await page.getByRole('button', { name: 'Recebimentos (ALTCRED/GRU)' }).first().click();
    await page.getByRole('heading', { name: 'Recebimentos (ALTCRED/GRU)' }).waitFor();
    await page.getByLabel('Mês').selectOption('10');
    await page.getByLabel('Ano').selectOption('2026');
    await page.getByText('AMRJ.2026.AC.00001').waitFor();
    ok(true, 'filtro de mês: a ALTCRED de 01/10/2026 aparece em outubro (antes caía em setembro)');
    ok(await page.getByText('Comando: 41000 - Arsenal de Marinha do Rio de Janeiro').first().isVisible() && await page.getByText('Comando: texto livre').count() === 0, 'agrupado pelo comando do cadastro, não pelo texto digitado');
    ok(await page.getByText(/Mostrando 1–2 de 2 documentos/).isVisible(), 'paginação com total de documentos');
    await page.getByLabel('Fatura paga (nº)').fill('41000-EL-09-2025');
    ok(await page.getByText('B4D0.2026.AC.00824').isVisible() && await page.getByText('AMRJ.2026.AC.00001').isVisible(), 'busca pela fatura paga encontra as ALTCRED que pagaram');
    // Novo documento já pagando faturas em aberto da OM
    await page.getByLabel('Fatura paga (nº)').fill('');
    await page.getByRole('button', { name: 'Novo Documento' }).click();
    const dlgDoc = page.getByRole('dialog');
    await dlgDoc.getByLabel('Operação').selectOption('PAGAMENTO');
    await dlgDoc.getByLabel('Tipo Documento').selectOption('ALTCRED');
    await dlgDoc.getByLabel('Número Documento').fill('AMRJ.2026.AC.00099');
    await dlgDoc.getByLabel('Valor Total').fill('50000'); // campo em centavos: R$ 500,00
    await dlgDoc.getByLabel('Data', { exact: true }).fill('2026-11-20');
    await dlgDoc.getByLabel('Cliente', { exact: true }).fill('Arsenal');
    await page.getByRole('option', { name: /Arsenal de Marinha do Rio de Janeiro/ }).first().click();
    await dlgDoc.getByLabel('Pagar a fatura 41000-AE-10-2026-001-0').waitFor();
    ok(await dlgDoc.getByLabel('Pagar a fatura 41000-TC-10-2026-009-0').count() === 0, 'lista primeiro só as faturas em aberto da OM do documento (a da SKM não aparece)');
    ok(await dlgDoc.getByLabel('Pagar a fatura 41000-EL-09-2025-001-0').count() === 0, 'fatura já quitada não aparece');
    await dlgDoc.getByLabel('Cliente das faturas a pagar').selectOption('SKM');
    ok(await dlgDoc.getByLabel('Pagar a fatura 41000-TC-10-2026-009-0').count() === 1 && await dlgDoc.getByLabel('Pagar a fatura 41000-AE-10-2026-001-0').count() === 0, 'filtro "Cliente (OM)": escolher outra OM mostra só as faturas dela');
    ok((await dlgDoc.getByLabel('Cliente das faturas a pagar').locator('option', { hasText: 'SKM' }).innerText()).startsWith('41000 · SKM'), 'a lista de clientes mostra a UG na frente do nome');
    await dlgDoc.getByLabel('Cliente das faturas a pagar').selectOption('__todas');
    await dlgDoc.getByLabel('Buscar fatura em aberto').fill('41000');
    ok(await dlgDoc.getByLabel('Pagar a fatura 41000-TC-10-2026-009-0').count() === 1, 'a busca da lista aceita a UG');
    await dlgDoc.getByLabel('Buscar fatura em aberto').fill('');
    await dlgDoc.getByLabel('UG para filtrar o cliente').fill('41000');
    ok(await dlgDoc.getByLabel('Cliente das faturas a pagar').locator('option').count() >= 3, 'o campo UG filtra a lista de clientes');
    await dlgDoc.getByLabel('UG para filtrar o cliente').fill('');

    ok(await dlgDoc.getByLabel('Pagar a fatura 41000-TC-10-2026-009-0').count() === 1 && await dlgDoc.getByLabel('Pagar a fatura 41000-AE-10-2026-001-0').count() === 1, '"Todas as OM" mostra as faturas de todas as OM');
    await dlgDoc.getByLabel('Pagar a fatura 41000-AE-10-2026-001-0').check();
    ok(await dlgDoc.getByText(/fica disponível no documento/).isVisible() && (await dlgDoc.getByLabel('Valor a pagar da fatura 41000-AE-10-2026-001-0').inputValue()) === '500', 'valor do documento (R$ 500) distribuído na fatura escolhida, até o saldo');
    await dlgDoc.getByLabel('Valor a pagar da fatura 41000-AE-10-2026-001-0').fill('600');
    ok(await dlgDoc.getByText(/passa do valor do documento/).isVisible(), 'avisa quando o valor a pagar passa do valor do documento');
    await dlgDoc.getByLabel('Valor a pagar da fatura 41000-AE-10-2026-001-0').fill('450');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'novo-documento-pagando.png'), fullPage: false });
    await page.getByRole('button', { name: 'Salvar e baixar 1 fatura(s)' }).click();
    await page.getByText(/Documento salvo e 1 fatura\(s\) baixada\(s\)/).waitFor();
    const novoDoc = db.received_documents.find(d => d.document_number === 'AMRJ.2026.AC.00099');
    const bxNova = db.payment_allocations.filter(b => b.document_id === novoDoc?.id);
    ok(novoDoc && bxNova.length === 1 && Number(bxNova[0].amount) === 450 && bxNova[0].invoice_id === fat2.id && bxNova[0].date === '2026-11-20', 'documento gravado com a baixa de R$ 450 na fatura escolhida, na data do documento');
    // Extrato do Arsenal: inclui o pagamento feito pelo RT DGMM e a coluna Comando é o comando
    await page.getByRole('button', { name: 'Extrato de conciliação' }).first().click();
    ok(await page.getByText(/OM com mais valor em aberto/).count() === 0, 'sem a linha de sugestões (OM com mais valor em aberto)');
    await page.getByRole('button', { name: /^Escolher comandos e OM/ }).click();
    await page.getByLabel('Buscar comando ou OM').fill('41000');
    await page.getByRole('radio', { name: 'Comandos' }).click();
    ok(await page.getByRole('checkbox', { name: /^OM / }).count() === 0 && await page.getByRole('checkbox', { name: /^Comando 41000/ }).count() === 1, 'filtro por tipo: só comandos');
    await page.getByRole('radio', { name: 'OM', exact: true }).click();
    ok(await page.getByRole('checkbox', { name: /^OM 41000 - / }).count() === 2, 'filtro por tipo: só OM (Arsenal e SKM, mesmo código)');
    ok((await page.getByLabel('Setor', { exact: true }).locator('option').allInnerTexts()).join('|') === 'Todos os setores|DGMM', 'a lista de setores mostra só os setores em uso');
    await page.getByLabel('Setor', { exact: true }).selectOption('DGMM');
    ok(await page.getByRole('checkbox', { name: /^OM 41000 - / }).count() === 2, 'filtro por setor (DGMM tem as duas)');
    await page.getByLabel('Setor', { exact: true }).selectOption('');
    await page.getByRole('checkbox', { name: 'OM 41000 - Arsenal de Marinha do Rio de Janeiro' }).check();
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'extrato-filtro.png') });
    await page.getByRole('button', { name: 'fechar' }).click();
    await page.getByLabel('Exercício do extrato').selectOption('2026');
    await page.getByText('B4D0.2026.AC.00824').first().waitFor();
    ok(true, 'extrato do Arsenal inclui o pagamento feito pelo RT DGMM (outra UG)');
    ok(await page.getByRole('cell', { name: '41000 - Arsenal de Marinha do Rio de Janeiro' }).first().isVisible(), 'coluna Comando do saldo ALTCRED mostra o comando (e não o setor)');
    const resumo = page.getByLabel('Resumo da conciliação');
    ok(await resumo.getByText(/Resumo da conciliação — fecha/).isVisible(), 'resumo da conciliação fecha (recebido − usado = saldo)');
    ok((await resumo.innerText()).replace(/\s+/g, ' ').includes('Usado em faturas de outras OM R$ 20,00'), 'resumo mostra o usado em faturas de outras OM (R$ 20,00 da SKM)');
    ok((await resumo.innerText()).replace(/\s+/g, ' ').includes('Faturas da OM pagas por outros pagadores R$ 2.000,00'), 'resumo mostra o pago por outros pagadores (RT DGMM)');
    ok(await page.getByText('fatura de outra OM').first().isVisible() && await page.getByRole('cell', { name: 'SKM', exact: true }).first().isVisible(), 'uso da ALTCRED do Arsenal na fatura da SKM aparece, marcado como fatura de outra OM');
    ok(await page.getByText('pago por outro pagador').first().isVisible(), 'pagamento do RT DGMM marcado como pago por outro pagador');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'extrato-arsenal.png'), fullPage: true });
    // Extrato da SKM (mesmo código 41000): não puxa a ALTCRED do Arsenal
    await page.getByLabel('Comandos e OM do extrato').getByRole('button', { name: 'limpar' }).click();
    await page.getByRole('button', { name: /^Escolher comandos e OM/ }).click();
    await page.getByLabel('Buscar comando ou OM').fill('SKM');
    await page.getByRole('checkbox', { name: 'OM 41000 - SKM' }).check();
    await page.getByRole('button', { name: 'fechar' }).click();
    await page.waitForTimeout(500);
    const quadroSaldo = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Saldo ALTCRED', exact: true }) });
    const quadroPagas = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Faturas pagas (por data de situação)' }) });
    ok(await quadroSaldo.getByText('AMRJ.2026.AC.00001').count() === 0, 'código compartilhado (41000) não põe a ALTCRED do Arsenal no saldo da SKM');
    ok(await quadroPagas.getByText('AMRJ.2026.AC.00001').count() === 1 && await quadroPagas.getByText('pago por outro pagador').count() === 1, 'no extrato da SKM, a fatura paga pela ALTCRED do Arsenal aparece como paga por outro pagador');
    // vários comandos/OM no mesmo extrato
    await page.getByRole('button', { name: /^Escolher comandos e OM/ }).click();
    await page.getByLabel('Buscar comando ou OM').fill('Arsenal');
    await page.getByRole('checkbox', { name: 'OM 41000 - Arsenal de Marinha do Rio de Janeiro' }).check();
    await page.getByRole('button', { name: 'fechar' }).click();
    ok(await page.getByLabel('Comandos e OM do extrato').getByRole('button').count() === 3, 'extrato com mais de uma OM (SKM + Arsenal, e o botão limpar)');
    ok(await quadroSaldo.getByText('AMRJ.2026.AC.00001').count() === 1, 'com o Arsenal junto, a ALTCRED dele entra no saldo');
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
    await page.getByRole('button', { name: 'Correção por atraso (OI 40-04, item 6.2)', exact: true }).click();
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
    const [pdfCob] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /PDF das faturas/ }).click()]);
    const txtCob = fs.readFileSync(await pdfCob.path(), 'latin1');
    if (SHOTS) fs.copyFileSync(await pdfCob.path(), path.join(SHOTS, 'cobranca.pdf'));
    ok(/^cobranca_.+_\d{4}-\d{2}-\d{2}\.pdf$/.test(pdfCob.suggestedFilename()), `PDF da cobrança gerado (${pdfCob.suggestedFilename()})`);
    ok(txtCob.includes('40030-TC-09-2025-014-0') && !txtCob.includes('40032-RB') && txtCob.includes('DIMRJ') && txtCob.includes('Setor') && txtCob.includes('TOTAL EM ATRASO'), 'PDF da cobrança em árvore com as faturas da mensagem');
    await page.getByRole('button', { name: /registrar/ }).click();
    await page.getByText('Cobrança registrada.').waitFor();
    ok(db.cobrancas.length === 1 && db.cobrancas[0].faturas.length === 2, 'cobrança registrada com as 2 faturas');
    await page.getByRole('button', { name: 'Painel do Encarregado' }).first().click(); // item do menu (tela própria)
    await page.getByRole('heading', { name: 'Painel do Encarregado' }).waitFor();
    await page.getByText('Dívida por condômino e idade').waitFor();
    ok(await page.getByText('ALTCRED/GRU com saldo parado').isVisible(), 'painel do Encarregado com dívida por idade e saldos parados');
    // interatividade: indicador, linha da OM, valor de faixa e gráfico abrem a lista de faturas
    await page.getByRole('button', { name: /^Vencido/ }).click();
    await page.getByRole('dialog').getByText('Faturas vencidas').first().waitFor();
    const nVenc = await page.getByRole('dialog').locator('tbody tr').count();
    ok(nVenc >= 1, `indicador "Vencido" abre a lista de faturas (${nVenc})`);
    await page.getByLabel('Buscar na lista').fill('zzzz-nada');
    ok(await page.getByRole('dialog').getByText('Nenhuma fatura.').isVisible(), 'busca dentro da lista filtra as faturas');
    await page.keyboard.press('Escape');
    await page.getByRole('cell', { name: 'Diretoria Industrial da Marinha', exact: true }).click();
    ok(await page.getByRole('dialog').getByText(/Faturas de Diretoria Industrial da Marinha/).first().isVisible(), 'clicar na linha da OM abre as faturas dela');
    await page.keyboard.press('Escape');
    await page.getByLabel('Buscar na dívida').fill('mangaratiba');
    ok(await page.getByRole('cell', { name: /Mangaratiba/ }).count() === 1 && await page.getByRole('cell', { name: 'Diretoria Industrial da Marinha', exact: true }).count() === 0, 'busca na tabela de dívida filtra as OM');
    await page.getByLabel('Buscar na dívida').fill('');
    ok(await page.getByText('Maiores valores vencidos por OM').isVisible() && await page.getByText('Idade da dívida', { exact: true }).isVisible(), 'gráficos de idade da dívida e maiores devedores');
    await page.waitForTimeout(1500); // animação dos gráficos
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
      [1, '8.9.9.1.1.08.02', '', 'Manutenção de Telhados', 200000, '', 391421.64, '', 1500, 198500], [2, '', '', 'Navios', 100000, '', 1151786.23], [3, '', '', 'Recompletamento de Estoque', 5000, '', 0]]), 'Despesas_NOVO');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['', 'EXTRATO DEMONSTRATIVO DA TAXA CONDOMINIAL – 2026'], ['', 'Nº DE ORDEM', 'DESPESAS –   NAVIOS', 'VALOR ANUAL APROVADO EM REAIS', 'VALOR MENSAL', '', '%RUB', 'VALOR DESCONTO', 'VALOR ATUALIZADO'],
      ['', 1, 'Manutenção de Telhados', 100000, 8333.33, '', 1, 0, 100000], ['', 'TOTAL ANO', '', 100000]]), 'NAVIOS');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['', 'EXTRATO DEMONSTRATIVO DA TAXA CONDOMINIAL – 2026'], ['', 'Nº DE ORDEM', 'DESPESAS – AMRJ', 'VALOR ANUAL APROVADO EM REAIS', 'VALOR MENSAL', '', '%RUB', 'VALOR DESCONTO', 'VALOR ATUALIZADO'],
      ['', 1, 'Manutenção de Telhados', 167912.5, 13992.71, '', 1, 1000, 166912.5], ['', 'TOTAL ANO', '', 167912.5], ['', 'TOTAL MÊS (ANO / 12)', '', 13992.71]]), 'AMRJ');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['', 'CLIENTES'], ['', '', 1, 2], ['', 'SecNSNQ (Ed.23)', 'x', ''], ['', 'AMRJ', 'X', ''], ['', 'OM NOVA FORA DA ILHA', 'X', ''], ['', 'NAVIOS', '', 'X']]), 'Matriz_NOVO');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['OM', 'TAXA 2025', 'MENSAL', 'PROPOSTA 2026 (A)', 'MENSAL', '%', '', 'DESCONTOS ANUAL', '', 'PROPOSTA ATUALIZADA', 'MENSAL', '', '', 1, 2],
      ['SecNSNQ (Ed.23)', 17000, 1416.67, 23275, 1939.58, '', '', 5469.62, '', 17805.38, 1483.78], ['AMRJ', 160000, 13333.33, 167912.5, 13992.71, '', '', 1000, '', 166912.5, 13909.00, '', '', 1000, 0], ['SUB-TOTAL'],
      ['NAVIOS', 'DIÁRIA 2025', 'PROPOSTA DIÁRIA 2026 (A)', '% (A)', 'N° DIAS MÉDIO', 'VALOR ESTIMADO MÊS'], ['CORVETA CLASSE BARROSO – CORVETA BARROSO', 300, 297.62, -0.01, 28, 8333.33], ['SUB-TOTAL']]), 'PROPOSTA CONDOMINIO');
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
    await page.getByText(/3 rubricas/).waitFor();
    ok(await page.getByText('1 nome(s) sem correspondente automático.').isVisible() && (await page.getByLabel('O que fazer com OM NOVA FORA DA ILHA').inputValue()) === 'DEPOIS', 'nome sem correspondente: padrão "decidir depois" (não é perdido)');
    await page.getByRole('button', { name: 'Gravar importação' }).click();
    await page.getByText(/Proposta importada\. 1 nome\(s\) ficaram pendentes/).waitFor();
    const r1 = db.rubricas.find(r => r.numero === 1), r2 = db.rubricas.find(r => r.numero === 2);
    ok(db.rubricas.length === 2 && !r2 && Number(r1.gasto_anterior) === 391421.64 && r1.destino === 'TC' && Number(db.propostas_tc[0].navios_planilha) === 100000, '"Navios" não vira rubrica: é o total do grupo (guardado para conferência)');
    ok(db.rubricas.find(r => r.numero === 3).destino === 'PAR', 'rubrica depois da última da matriz fica "só PAR" (fora da taxa)');
    ok(Number(r1.percentual_navios) === 50 && Number(r1.percentual_om) === 100 && r1.criterio === 'LOTACAO' && r1.modo_navios === 'SEPARADO', 'rubrica 1: OM 100% por pessoa e navios 50% à parte (aba NAVIOS)');
    ok(db.fechados_tc.length === 3 && db.fechados_tc.find(f => f.tipo === 'DA').om_id === bar.id && db.extratos_tc.some(e => e.om_id === amrj.id && e.rubrica === 1), 'valores fechados (OM e navios) e extrato da AMRJ guardados para conferência');
    ok(Number(r1.desconto_geral) === 500 && Number(r1.desconto_planilha) === 1500, 'DESCONTOS 1.500 = AMRJ 1.000 (por OM) + 500 de desconto geral');
    ok(db.descontos_tc.length === 1 && db.descontos_tc[0].om_id === amrj.id && Number(db.descontos_tc[0].valor) === 1000, 'desconto da AMRJ na rubrica 1 importado da PROPOSTA CONDOMINIO');
    ok(db.lotacoes_tc.length === 3 && Number(db.lotacoes_tc.find(l => l.om_id === bar.id).dias) === 28, 'lotação de 2 OM + navio (28 dias/mês)');
    ok(db.matriz_tc.length === 2 && !db.matriz_tc.some(m => m.om_id === bar.id), 'matriz só da taxa condominial (navio fica nas diárias)');
    ok(db.pendentes_tc.length === 1 && db.pendentes_tc[0].nome === 'OM NOVA FORA DA ILHA' && Number(db.pendentes_tc[0].lotacao) === 50, 'pendência guardada com lotação e rubricas');
    // rubricas: colunas da planilha e conferência dos descontos
    const linhaR1 = (await page.getByRole('row').filter({ has: page.getByLabel('Descrição da rubrica 1') }).innerText()).replace(/\s+/g, ' ');
    ok(linhaR1.includes('R$ 1.500,00') && linhaR1.includes('R$ 198.500,00') && linhaR1.includes('✓'), `rubrica 1: descontos R$ 1.500,00, atualizado R$ 198.500,00 e confere com a planilha (${linhaR1})`);
    ok(await page.getByText('SOMA DAS 1 RUBRICAS DA TAXA').isVisible() && await page.getByText('Fora da taxa — só para o cálculo do PAR').isVisible() && await page.getByText('Grupo NAVIOS — diárias de atracação').isVisible(), 'blocos: soma das rubricas da taxa, grupo NAVIOS e PAR');
    ok((await page.getByText(/Valor do grupo NAVIOS/).innerText()).includes('R$ 100.000,00'), 'valor do grupo NAVIOS = 50% da rubrica 1 e confere com a planilha');
    // critério de rateio: por área deixa as colunas de área na matriz; volta para por pessoa
    await page.getByLabel('Critério da rubrica 1').selectOption('AREA');
    ok(await page.getByLabel('Critério da rubrica 1').inputValue() === 'AREA', 'critério da rubrica pode ser trocado na tabela');
    await page.getByLabel('Critério da rubrica 1').selectOption('LOTACAO');
    // ficha da rubrica 1: justificativa, subsídio e contrato
    await page.getByRole('button', { name: 'Ficha da rubrica 1' }).click();
    await page.getByLabel('Justificativa do valor').fill('Contrato 12/2026 de 12 meses + reajuste');
    await page.getByLabel('Descrição do subsídio').fill('Contrato de manutenção de telhados');
    await page.getByLabel('Documento do subsídio').fill('Contrato 12/2026');
    await page.getByLabel('Valor do subsídio').fill('200000');
    await page.getByRole('button', { name: 'Incluir subsídio' }).click();
    await page.getByText('fecha com o valor previsto').waitFor();
    ok(db.subsidios_tc.length === 1 && Number(db.subsidios_tc[0].valor) === 200000 && db.subsidios_tc[0].documento === 'Contrato 12/2026', 'subsídio gravado e soma fecha com o valor previsto');
    const contrato = path.join(pasta, 'contrato_12_2026.pdf'); fs.writeFileSync(contrato, '%PDF-1.4 teste');
    await page.getByLabel('Descrição do documento').fill('Contrato 12/2026');
    await page.locator('input[aria-label="Arquivo do contrato"]').setInputFiles(contrato);
    await page.getByText('1 arquivo(s) anexado(s).').waitFor();
    ok(db.anexos_tc.length === 1 && db.anexos_tc[0].nome_arquivo === 'contrato_12_2026.pdf' && db.storage.some(x => x.includes('/contratos-tc/2026/1/')), 'contrato enviado ao armazenamento e registrado na rubrica');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'ficha-rubrica.png'), fullPage: true });
    await page.getByRole('button', { name: 'Gravar e fechar' }).click();
    await page.getByText('Rubricas gravadas.').waitFor();
    ok(db.rubricas.find(r => r.numero === 1).justificativa_valor === 'Contrato 12/2026 de 12 meses + reajuste', 'justificativa do valor gravada');
    ok((await page.getByRole('row').filter({ has: page.getByLabel('Descrição da rubrica 1') }).innerText()).includes('📎 1'), 'situação da rubrica mostra o documento anexado');
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
    ok(await page.getByText(/1 de 2 conferem/).isVisible() && (await page.getByText(/1 de 2 conferem/).innerText()).includes('AMRJ'), 'conferência com o valor fechado da planilha aponta a OM diferente (AMRJ)');
    await page.getByRole('row').filter({ hasText: 'AMRJ' }).first().click();
    ok((await page.locator('table').last().innerText()).includes('R$ 166.912,50 ✓'), 'extrato da AMRJ confere rubrica a rubrica com a aba do cliente');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'fase6-resultado.png'), fullPage: true });
    // diárias: 50% de 200.000 = 100.000 ÷ (148×28×12) × 148 = 297,62/dia
    await page.getByRole('button', { name: '7. Resultado das diárias' }).click();
    ok((await page.getByRole('row').filter({ hasText: 'Corveta Barroso' }).first().innerText()).includes('R$ 297,62'), 'diária da Corveta Barroso R$ 297,62 (custo militar-dia × lotação)');
    ok(await page.getByText(/valores de diária conferem/).isVisible(), 'diárias conferem com a aba PROPOSTA');
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
    ok(tcSec && Number(tcSec.valor) === 1483.78 && da && Number(da.valor) === 297.62, 'publicado: TC mensal SecNSNQ R$ 1.483,78 e DA da Barroso R$ 297,62 nos Preços de 2026');
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
    ok((await page.locator('table').last().locator('tbody tr').first().innerText()).includes('40030-TC-05-2024-001-0'), 'lista começa pela de maior valor em aberto');
    const cab = page.locator('th button', { hasText: 'Em aberto' }); await cab.click(); if (!(await cab.innerText()).includes('▼')) await cab.click();
    ok((await page.locator('table').last().locator('tbody tr').first().innerText()).includes('40030-TC-05-2024-001-0'), 'ordenar por valor em aberto ao clicar no cabeçalho (maior primeiro)');
    await page.keyboard.press('Escape');
    // filtro múltiplo: todos os clientes exceto a DIM
    await page.getByRole('button', { name: /^Cliente \(OM\): Todos/ }).click();
    await page.getByRole('option', { name: 'Diretoria Industrial da Marinha' }).click();
    await page.keyboard.press('Escape'); await page.getByRole('heading', { name: 'Painel inicial' }).click();
    ok(await page.getByTitle('Remover filtro').isVisible() && (await page.getByTitle('Remover filtro').innerText()).includes('todos exceto Diretoria Industrial da Marinha'), 'filtro "todos exceto" com etiqueta removível');
    ok(await page.getByText('não são o total geral').isVisible(), 'aviso bem visível de filtro ativo');
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
    ok(!db.oms.includes(b) && !a.nomes_alternativos.includes('DIRETORIA INDUSTRIAL DA MARINHA') && db.invoices.filter(i => i.om_id === a.id).every(i => i.client === a.nome), 'duplicada excluída; faturas com o nome da que fica; nome duplicado não guardado');
    await page.waitForTimeout(500);
    ok(!(await page.locator('div.border.rounded-xl.p-3').filter({ hasText: '40031' }).count()), 'depois de unificar, o grupo sai da lista (não volta como duplicidade)');
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
    // Faturas e Saldos: o campo Cliente busca no cadastro e preenche UG, setor e comando
    await page.getByRole('button', { name: 'Faturas emitidas' }).first().click();
    await page.getByRole('button', { name: 'Nova Fatura' }).click();
    await page.getByLabel('Cliente', { exact: true }).fill('industrial');
    await page.getByRole('option', { name: /Diretoria Industrial da Marinha/ }).first().click();
    ok(await page.getByText(/Ligado ao cadastro: 40030 · Diretoria Industrial da Marinha/).isVisible()
      && await page.getByLabel('UG (Unidade Gestora)').inputValue() === '40030' && await page.getByLabel('Setor', { exact: true }).inputValue() === 'DGMM', 'fatura: cliente escolhido no cadastro preenche UG, setor e comando');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Recebimentos (ALTCRED/GRU)' }).first().click();
    await page.getByRole('button', { name: 'Novo Documento' }).click();
    await page.getByRole('dialog').getByLabel('Cliente', { exact: true }).fill('banco');
    ok(await page.getByText('Cadastrar novo cliente').isVisible(), 'documento: busca no cadastro com opção de cadastrar cliente novo');
    await page.getByRole('option', { name: /Banco do Brasil/ }).first().click();
    ok(await page.getByText(/Ligado ao cadastro: 00994 · Banco do Brasil/).isVisible(), 'documento ligado à OM do cadastro');
    await page.keyboard.press('Escape');
    // Lista de navios do Histórico Trienal × cadastro
    const classeB = { id: uid(), nome: 'Corvetas Classe Barroso', ativo: true };
    db.classes_navio.push(classeB);
    db.oms.push({ id: uid(), codigo: '91645', nome: 'Corveta Barroso', tipo: 'NAVIO', classe_id: null, ativo: true, nomes_alternativos: [] });
    const hist = path.join(os.tmpdir(), `siscont-lista-${Date.now()}.xlsx`);
    const wbL = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wbL, XLSX.utils.aoa_to_sheet([['CLASSE NAVIO', 'NAVIO'], ['Corvetas Classe Barroso', 'Corveta Barroso'], ['Navio Polar', 'Almirante Maximiano']]), 'LISTA DE NAVIOS');
    XLSX.writeFile(wbL, hist);
    await page.getByRole('button', { name: 'Cadastros' }).click();
    await page.getByRole('button', { name: 'Lista de navios' }).click();
    await page.locator('input[aria-label="Planilha do histórico trienal"]').setInputFiles(hist);
    await page.getByText(/1 classe\(s\) a criar/).waitFor();
    ok(await page.getByText('Navios com classe diferente da lista').isVisible(), 'aponta navio do cadastro sem a classe da lista');
    await page.getByRole('button', { name: 'Corrigir todas pela lista' }).click();
    await page.getByText(/Classes corrigidas: 1/).waitFor();
    ok(db.oms.find(o => o.nome === 'Corveta Barroso').classe_id === classeB.id, 'classe do navio corrigida pela lista');
    await page.getByRole('button', { name: /Criar todas/ }).click();
    await page.getByText(/Classes criadas: 1/).waitFor();
    await page.getByRole('button', { name: /Incluir todos/ }).click();
    await page.getByText(/Navios incluídos no cadastro: 1/).waitFor();
    const polar = db.oms.find(o => o.nome === 'Almirante Maximiano');
    ok(polar && polar.tipo === 'NAVIO' && polar.classe_id === db.classes_navio.find(c => c.nome === 'Navio Polar').id, 'classe e navio que faltavam criados no cadastro');
    await page.getByText('Cadastro de navios e classes confere com a lista.').waitFor();
    ok(true, 'depois das correções o cadastro confere com a lista');
  });

  await cenario('Planilha de água e esgoto: conferência, regra do HCM, ligação e lançamento', [], async (page, db) => {
    const om = (codigo, nome, tipo = 'TERRA', extra = {}) => { const o = { id: uid(), codigo, nome, tipo, comando_id: null, ativo: true, codigo_proprio: true, nomes_alternativos: [], ...extra }; db.oms.push(o); return o; };
    const amrj = om('41000', 'Arsenal de Marinha do Rio de Janeiro'), bnic = om('40015', 'Base Naval da Ilha das Cobras');
    const cpmm = om('65730', 'Centro de Perícias Médicas da Marinha'), hcm = om('65701', 'Hospital Central da Marinha');
    const pres = om('81940', 'Presídio da Marinha'), btl = om('31050', 'Batalhão Naval');
    const bahia = om('40015', 'Navio de Desembarque Multipropósito Bahia', 'NAVIO', { codigo_proprio: false });
    db.service_definitions.push(
      { id: uid(), name: 'Eletricidade', unit_measure: 'KWH', acronym: 'EL', nome_oficial: 'FORNECIMENTO DE ENERGIA ELÉTRICA', ordem: 30, ativo: true },
      { id: uid(), name: 'Água e Esgoto', unit_measure: 'M³', acronym: 'AE', nome_oficial: 'FORNECIMENTO DE ÁGUA POTÁVEL E COLETA DE ESGOTO', ordem: 20, ativo: true });
    // planilha fictícia no formato da divisão
    const P = 21.5, T = 0.02, U = P * 2 * (1 + T), v = m => Math.round(m * U * 100) / 100;
    const L = c => { const l = Array(21).fill(null); Object.entries(c).forEach(([k, x]) => { l[k.charCodeAt(0) - 65] = x; }); return l; };
    const cab = L({ B: 'CONSUMIDOR', E: 'CÓDIGO DA OM', F: 'HIDRÔMETRO', I: 'LEITURA ATUAL', K: 'LEITURA ANTERIOR', N: 'CONSUMO (M³)', Q: 'CONSUMO (DIAS)', R: 'CONSUMO TOTAL (M³)', T: 'TOTAL A PAGAR' });
    const med = 100 + 20 + 350 + 100 + 50 + 40 + 7, conta = 2000 * U, resto = conta - v(med);
    const linhas = [
      L({ B: 'PLANILHA DE FATURAMENTO DE ÁGUA DOCE E TRATAMENTO DE ESGOTO' }),
      L({ B: 'DATA DA LEITURA ANTERIOR 28/08/2026', F: 'DATA DA LEITURA ATUAL 28/09/26', L: 'MEDIÇÃO 09/2026', R: 'VENCIMENTO 23/10/2026' }),
      L({ B: 'OM', F: 'MATRÍCULAS', I: 'VALOR DO CONSUMO  (R$)', O: 'VOLUME  CONSUMIDO (M³)', R: 'VALOR DO (M³)', U: P }),
      L({ A: 'BNIC', F: '400000001-0', I: conta, O: 2000 }),
      L({ A: 'ARES-MAS (FORA DO RATEIO)', F: '400000003-2', I: 900, O: 20 }),
      L({ R: 'TAXAS (%)', U: T }),
      L({ B: 'OMs APOIADAS' }), cab,
      L({ B: 'AMRJ', E: 41000, F: 'Consumidores não hidrometrados', N: 0.38 * (2000 - med), R: 0.38 * (2000 - med), T: 0.38 * resto }),
      L({ F: 'H-17 (Ed.17)', I: 1100, K: 1000, N: 100, R: 100, T: v(100) }),
      L({ B: 'BNIC', E: 40015, F: 'Consumidores não hidrometrados', N: 0.62 * (2000 - med), R: 0.62 * (2000 - med), T: 0.62 * resto }),
      L({ B: 'CPMM', E: 65730, F: 'H-66', I: 320, K: 300, N: 20, R: 20, T: v(20) }),
      L({ B: 'HCM', E: 65701, F: 'H-67', I: 1500, K: 1000, N: 500, R: 350, T: v(350) }),
      L({ B: 'PRESÍDIO DA MARINHA', E: 81940, F: 'H-68', I: 200, K: 120, N: 80, R: 100, T: v(100) }),
      L({ F: 'H-69', I: 70, K: 50, N: 20 }),
      L({ B: 'BATALHÃO NAVAL', E: 31050, F: 'H-70', I: 150, K: 100, N: 50, R: 50, T: v(50) }),
      L({ B: 'CAIS DA PORTUGUESA' }), cab,
      L({ B: 'NDM Bahia', E: '*******', F: 'H-23', I: 140, K: 100, N: 40, Q: 31, R: 40, T: v(40) }),
      L({ B: 'SEM CONEXÃO', E: '*******', F: 'H-46 (Ed.51)', I: 17, K: 10, N: 7, R: 7, T: v(7) }),
      L({ A: 'ARES-MAS (FORA DO RATEIO – BATALHÃO NAVAL)' }), cab,
      L({ B: 'ARES-MAS (BATALHÃO NAVAL)', E: 31050, F: 'MAT. 400000003-2', R: 20, T: 900 }),
      L({ A: 'Obs.:' }),
      L({ A: 'Consumo do HCM = H67 (entrada do HCM) – H66 (CPMM) – H68 – H69 (PRESÍDIO) – H70 (BATALHÃO)' }),
    ];
    const arq = path.join(os.tmpdir(), `siscont-agua-${Date.now()}.xlsx`);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(linhas), 'SETEMBRO 2026'); XLSX.writeFile(wb, arq);

    await page.reload();
    await page.getByRole('button', { name: 'Emitir faturas do mês' }).first().click();
    await page.getByRole('heading', { name: 'Emitir faturas do mês' }).waitFor();
    await page.getByRole('button', { name: 'Medições do mês', exact: true }).click();
    await page.getByLabel('Competência das medições').fill('2026-08');
    await page.getByLabel('Serviço', { exact: true }).selectOption('EL');
    await page.getByRole('tabpanel').locator('input[type=file]').setInputFiles(arq);
    const dlg = page.getByRole('dialog', { name: 'Conferir planilha de água e esgoto' });
    await dlg.waitFor();
    ok(await dlg.getByText('Confere', { exact: false }).first().isVisible(), 'totais da planilha conferem com as contas da concessionária');
    ok(await dlg.getByText(/pela observação \(H67 − H66 − H68 − H69 − H70\)/).isVisible(), 'observação do HCM conferida com as leituras');
    ok(await dlg.getByText(/H-46 \(Ed\.51\).*ninguém seria cobrado/).isVisible(), 'aponta consumo sem dono ("SEM CONEXÃO")');
    ok(await dlg.getByText(/ligada pelo nome: Navio de Desembarque Multipropósito Bahia/).isVisible(), 'navio sem código ligado pelo nome');
    await dlg.getByLabel('OM da linha 20').selectOption(bnic.id);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'agua-conferencia.png'), fullPage: false });
    await dlg.getByRole('button', { name: 'Lançar nas medições' }).click();
    await page.getByText(/Planilha de água lida: 7 OM/).waitFor();
    ok(await page.getByLabel('Competência das medições').inputValue() === '2026-09' && await page.getByLabel('Serviço', { exact: true }).inputValue() === 'AE', 'tela passa para a competência e o serviço da planilha');
    await page.getByRole('button', { name: /Gravar \(7\)/ }).click();
    await page.getByText('7 medição(ões) gravada(s).').waitFor();
    const m = id => db.medicoes.find(x => x.om_id === id && x.competencia === '2026-09' && x.sigla === 'AE');
    ok(Number(m(hcm.id).quantidade) === 330 && Math.abs(Number(m(hcm.id).valor) - v(330)) < 0.02, 'HCM pela observação: 350 − 20 (CPMM) = 330 m³');
    ok(Number(m(btl.id).valor) === Math.round((v(50) + 900) * 100) / 100, 'Batalhão Naval: hidrômetro + ARES-MAS (fora do rateio)');
    ok(Number(m(bahia.id).quantidade) === 40, 'NDM Bahia lançado');
    const total = db.medicoes.filter(x => x.competencia === '2026-09').reduce((s, x) => s + Number(x.valor), 0);
    ok(Math.abs(total - (conta + 900)) < 0.05, `total lançado = contas da concessionária (${total.toFixed(2)})`);
    ok(Math.abs(Number(m(amrj.id).valor) - (0.38 * resto + v(100) + 0.38 * v(20))) < 0.05, 'diferença do HCM volta para AMRJ (38%) e BNIC (62%)');
    ok(m(cpmm.id) && m(pres.id) && (m(hcm.id).detalhe || []).length === 1, 'detalhe por hidrômetro guardado');
  });

  await cenario('OM emissora (BNIC): parâmetro, rateio sem fatura e clientes com complemento', [], async (page, db) => {
    page.on('dialog', d => d.accept());
    const setor = db.setores.find(x => x.sigla === 'DGMM');
    const cAmrj = { id: uid(), codigo: '41000', nome: 'Arsenal de Marinha do Rio de Janeiro', sigla: 'AMRJ', setor_id: setor.id, ativo: true };
    db.comandos.push(cAmrj);
    const om = (codigo, nome, extra = {}) => { const o = { id: uid(), codigo, nome, tipo: 'TERRA', comando_id: null, ativo: true, codigo_proprio: true, nomes_alternativos: [], ...extra }; db.oms.push(o); return o; };
    const bnic = om('40015', 'Base Naval da Ilha das Cobras', { sigla: 'BNIC' });
    const amrj = om('41000', 'Arsenal de Marinha do Rio de Janeiro', { sigla: 'AMRJ', comando_id: cAmrj.id });
    const bgl = om('40015', 'Arsenal de Marinha do Rio de Janeiro - BGL1', { tipo: 'EXTRA_MB', codigo_proprio: false });
    om('40015', 'ARSENAL DE MARINHA DO RIO DE JANEIRO - SKM', { tipo: 'EXTRA_MB', codigo_proprio: false, comando_id: cAmrj.id });
    om('51000', 'Policlínica Naval (Ed.16)'); om('51001', 'POLICLINICA NAVAL (ED.32)');
    db.service_definitions.push({ id: uid(), name: 'Eletricidade', unit_measure: 'KWH', acronym: 'EL', nome_oficial: 'FORNECIMENTO DE ENERGIA ELÉTRICA', ordem: 30, ativo: true });
    db.medicoes.push({ id: uid(), competencia: '2026-08', sigla: 'EL', om_id: bnic.id, quantidade: 100, valor: 5000, estimada: false },
      { id: uid(), competencia: '2026-08', sigla: 'EL', om_id: amrj.id, quantidade: 10, valor: 700, estimada: false });
    await page.getByRole('button', { name: 'Recarregar' }).click();
    // duplicidades: complemento e edifícios diferentes não são duplicados; sugere o comando do responsável
    await page.getByRole('button', { name: 'Duplicidades' }).click();
    await page.getByText(/Clientes com complemento sem o comando do responsável \(1\)/).waitFor();
    ok(!(await page.locator('div.border.rounded-xl.p-3').filter({ hasText: 'SKM' }).count()) && !(await page.locator('div.border.rounded-xl.p-3').filter({ hasText: 'ED.32' }).count()), 'complemento (BGL1, SKM) e edifícios diferentes não aparecem como duplicidade');
    await page.getByRole('button', { name: 'Ligar todos ao comando do responsável' }).click();
    await page.getByText(/1 cliente\(s\) ligado\(s\)/).waitFor();
    ok(bgl.comando_id === cAmrj.id, 'BGL1 ligada ao comando do Arsenal');
    // parâmetro: OM emissora sugerida (BNIC) e gravada
    await page.getByRole('button', { name: 'Parâmetros e feriados' }).click();
    await page.getByText(/Sugestão automática: Base Naval da Ilha das Cobras/).waitFor();
    ok(await page.getByLabel('OM emissora').inputValue() === bnic.id, 'BNIC sugerida como OM emissora');
    await page.getByLabel('Não participa').check();
    await page.getByRole('button', { name: 'Gravar', exact: true }).click();
    await page.getByText('OM emissora gravada.').waitFor();
    ok(db.parametros.find(p => p.chave === 'om_emissora_id').valor === bnic.id && db.parametros.find(p => p.chave === 'om_emissora_rateio').valor === 'NAO', 'OM emissora e participação gravadas nos parâmetros');
    // lote: a BNIC fica de fora (só controle)
    await page.reload();
    await page.getByRole('button', { name: 'Emitir faturas do mês' }).first().click();
    await page.getByRole('heading', { name: 'Emitir faturas do mês' }).waitFor();
    await page.getByRole('button', { name: 'Lote de faturas', exact: true }).click();
    await page.getByLabel('Competência', { exact: true }).fill('2026-08');
    await page.getByRole('button', { name: 'Calcular prévia' }).click();
    await page.getByText(/é a OM emissora: R\$ 5\.000,00 de rateio \(EL\)/).waitFor();
    ok(await page.getByText('41000-EL-08-2026-001-0').isVisible() && !(await page.getByText(/40015-EL-08-2026/).count()), 'lote sem fatura para a OM emissora');
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
