/**
 * Varredura do SISCONT: volume realista de dados simulados, abre cada página do menu, clica em cada aba e botão seguro
 * e mede: tempo até a tela ficar pronta, requisições ao banco, bytes, tarefas longas do navegador e qualquer erro
 * (erro de JavaScript, console.error, requisição com falha ou aviso de erro na tela).
 * Uso (via cadastros.e2e.cjs):  VARREDURA=1 VARREDURA_OUT=/caminho/relatorio.json node tests/e2e/cadastros.e2e.cjs
 */
const fs = require('fs');

/** Botões que gravam, apagam, enviam ou saem: a varredura NÃO clica neles. */
const PERIGOSO = /exclu|apag|remov|cancel|grav|salv|emit|import|migr|desfaz|zer|sim,|confirm|envi|regist|lan[cç]|pagar|baix|cri|novo|nova|adicion|restaur|backup|sair|encerrar|treinamento|bloque|reset|substit|retific|publi|aprovar|ativar|desativar|unific|renomear|aplicar|corrigir|resolver|marcar|certificar|siplad|siafi|assin|fazer|mudar|alterar|editar|abrir o detalhe|limpar tudo/i;

async function varredura(page, db, uid, opcoes = {}) {
  const N_FAT = opcoes.faturas || 7000;
  // ---- dados de volume realista
  const setor = db.setores[1];
  const cmds = Array.from({ length: 8 }, (_, i) => ({ id: uid(), codigo: String(40000 + i * 7), nome: `Comando de Teste ${i + 1}`, setor_id: db.setores[i % 3].id, ativo: true, indicativo_naval: `CMD${i + 1}` }));
  db.comandos.push(...cmds);
  const oms = Array.from({ length: 160 }, (_, i) => ({
    id: uid(), codigo: String(40100 + i), nome: i % 5 === 0 ? `Navio de Teste ${i}` : `OM de Teste ${i}`, tipo: i % 5 === 0 ? 'NAVIO' : i >= 150 ? 'EXTRA_MB' : 'TERRA',
    comando_id: i >= 150 ? null : cmds[i % 8].id, setor_id: i >= 150 ? db.setores[2].id : null, ativo: true, nomes_alternativos: [], codigo_proprio: true,
  }));
  db.oms.push(...oms);
  const SERV = [['AE', 'Água e Esgoto'], ['EL', 'Eletricidade'], ['TC', 'Taxa Condominial'], ['DA', 'Diária de Atracação'], ['RB', 'Rebocador'], ['VT', 'Viatura'], ['TL', 'Telefonia']];
  db.invoices = [];
  for (let i = 0; i < N_FAT; i++) {
    const om = oms[i % oms.length], [sg, sn] = SERV[i % SERV.length];
    const ano = i % 10 < 6 ? 2026 : i % 10 < 9 ? 2025 : 2024, mes = (i % 12) + 1;
    const venc = `${ano}-${String(mes).padStart(2, '0')}-${i % 2 ? '15' : '28'}`;
    db.invoices.push({
      id: uid(), ug: om.codigo, sector: 'DGMM', command: '40000 - Comando', client: om.nome, invoice_number: `${om.codigo}-${sg}-${String(mes).padStart(2, '0')}-${ano}-${String(i).padStart(4, '0')}-0`,
      value: 500 + (i % 97) * 31.17, adjustment_addition: 0, adjustment_deduction: 0, issue_date: `${ano}-${String(mes).padStart(2, '0')}-15`, due_date: venc,
      month_competence: mes, year_competence: ano, competence: `${String(mes).padStart(2, '0')}/${ano}`, type: sn, service_acronym: sg, is_canceled: i % 53 === 0, siplad_settled: i % 3 === 0,
      om_id: om.id, origem: 'Planilha', quitacao_externa: ano === 2024 ? 'Quitada antes do SISCONT' : null, quitada_em: null, contestada: i % 41 === 0, pontos_atencao: [],
    });
  }
  const docs = [];
  for (let i = 0; i < 500; i++) {
    const om = oms[(i * 7) % oms.length], gru = i % 5 === 0;
    docs.push({ id: uid(), document_number: `${gru ? 'GRU' : 'G484.2026.AC'}.${String(i).padStart(5, '0')}`, document_type: gru ? 'GRU' : 'ALTCRED', total_value: 20000 + i * 130, date: `2026-${String((i % 10) + 1).padStart(2, '0')}-10`,
      operation: i % 4 === 0 ? 'ADIANTAMENTO' : 'PAGAMENTO', client: om.nome, sector: 'DGMM', command: '40000 - Comando', ug: om.codigo, om_id: om.id, comando_id: om.comando_id });
  }
  db.received_documents.push(...docs);
  for (let i = 0; i < 4500; i++) {
    const f = db.invoices[(i * 3) % N_FAT], d = docs[i % docs.length];
    if (f.is_canceled) continue;
    db.payment_allocations.push({ id: uid(), document_id: d.id, invoice_id: f.id, amount: 100 + (i % 50) * 10, date: '2026-05-20', service_type: f.service_acronym, siscont_settled: false, tipo_baixa: d.operation });
  }
  for (let i = 0; i < 300; i++) db.cash_flow_exits.push({ id: uid(), date: `2026-${String((i % 10) + 1).padStart(2, '0')}-12`, document_number: `2026NE${String(i).padStart(6, '0')}`, client: 'Fornecedor ' + (i % 30), value: 3000 + i * 11, rubric: i % 30, description: 'Despesa de teste', observation: '', is_canceled: false, document_type: 'EMPENHO' });

  // ---- instrumentação do navegador
  await page.addInitScript(() => {
    window.__lt = 0; try { new PerformanceObserver(l => l.getEntries().forEach(e => { window.__lt += e.duration; })).observe({ entryTypes: ['longtask'] }); } catch { /* sem suporte */ }
  });
  const T_INI = Date.now();
  page.setDefaultTimeout(3000);
  const erros = [], falhas = [], medidas = [];
  let reqs = 0, bytes = 0, emVoo = 0, ultimaAtividade = Date.now();
  page.on('pageerror', e => erros.push(`JS: ${e.message}`));
  page.on('close', () => console.log('      ✖ a página foi fechada em ' + ((Date.now() - T_INI) / 1000).toFixed(1) + ' s desde o início; último clique: ' + ultimoRotulo));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) erros.push(`console: ${m.text().slice(0, 200)}`); });
  page.on('request', r => { if (new URL(r.url()).hostname === 'supabase.mock') { emVoo++; reqs++; ultimaAtividade = Date.now(); } });
  page.on('framenavigated', () => { emVoo = 0; });
  const fim = r => { if (new URL(r.url()).hostname === 'supabase.mock') { emVoo = Math.max(0, emVoo - 1); ultimaAtividade = Date.now(); } };
  page.on('requestfinished', fim); page.on('requestfailed', r => { fim(r); if (new URL(r.url()).hostname === 'supabase.mock') falhas.push(`falhou: ${r.method()} ${r.url().slice(0, 90)}`); });
  page.on('response', async r => { if (new URL(r.url()).hostname === 'supabase.mock') { try { bytes += (await r.body()).length; } catch { /* ignora */ } if (r.status() >= 400 && r.status() !== 406) falhas.push(`HTTP ${r.status()}: ${r.request().method()} ${new URL(r.url()).pathname}`); } });
  // "quieto" = nenhuma requisição nova por um instante (e nada em andamento), com limite de tempo
  const quieto = async (ms = 500, max = 20000) => { const t0 = Date.now(); await page.waitForTimeout(ms); while (Date.now() - t0 < max) { if (emVoo <= 0 && Date.now() - ultimaAtividade > ms) return true; await page.waitForTimeout(80); } emVoo = 0; return false; };
  page.on('download', () => undefined);
  page.context().browser()?.on('disconnected', () => console.log('      ✖✖ O NAVEGADOR (Chromium) FOI ENCERRADO após ' + ((Date.now() - T_INI) / 1000).toFixed(1) + ' s'));
  page.on('crash', () => { erros.push('O NAVEGADOR TRAVOU (crash da página)'); console.log('      ✖✖ O NAVEGADOR TRAVOU (crash da página) depois de: ' + ultimoRotulo); });
  let ultimoRotulo = '';

  await page.reload(); await page.locator('nav button').first().waitFor({ timeout: 60000 }); await quieto();
  const itens = (await page.locator('nav button').allInnerTexts()).map(t => t.trim()).filter(t => t && !/Sair|Encerrar|Tela Cheia|Treinamento|Minha Conta/i.test(t));
  const menuBtn = nome => page.locator('nav button').filter({ hasText: nome }).first();

  if (process.env.VARREDURA_DEBUG) {
    const ctx = page.context();
    ctx.on('page', p2 => console.log('      [evento] nova aba aberta: ' + p2.url()));
    page.on('popup', p2 => console.log('      [evento] popup: ' + p2.url()));
    page.on('download', d => console.log('      [evento] download: ' + d.suggestedFilename()));
    page.on('dialog', d => { console.log('      [evento] dialogo: ' + d.message().slice(0, 100)); d.dismiss(); });
    page.on('crash', () => console.log('      [evento] CRASH'));
    await page.screenshot({ path: process.env.VARREDURA_DEBUG + '/enc_inicio.png' });
    await menuBtn('Painel do Encarregado').click({ force: true, timeout: 10000 }); await quieto(500, 30000);
    await page.getByText('Encerramento do exercício', { exact: true }).first().click({ timeout: 10000 }); await quieto(800, 40000);
    console.log('      [debug] aba aberta; clicando em Excel...');
    await page.screenshot({ path: process.env.VARREDURA_DEBUG + '/enc_antes.png' });
    const t = Date.now();
    for (const bt of (process.env.VARREDURA_BOTAO || 'Excel').split(',')) {
      console.log('      [debug] clicando em ' + bt);
      await page.getByRole('button', { name: bt, exact: true }).first().click({ timeout: 10000 }).catch(e => console.log('      [debug] erro no clique: ' + e.message.split('\n')[0]));
      await page.waitForTimeout(Number(process.env.VARREDURA_ESPERA || 1500));
      console.log('      [debug] página fechada? ' + page.isClosed());
      if (page.isClosed()) return medidas;
    }
    console.log('      [debug] página fechada? ' + page.isClosed() + ' após ' + (Date.now() - t) + ' ms');
    return medidas;
  }
  for (const nome of itens) {
    if (process.env.VARREDURA_PAGINA && !nome.includes(process.env.VARREDURA_PAGINA)) continue;
    const pag = { pagina: nome, ms: null, reqs: 0, bytes: 0, longtask: 0, cliques: 0, erros: [], falhas: [], avisos: [] };
    const e0 = erros.length, f0 = falhas.length;
    // recarrega para começar sem cache (como no primeiro acesso do dia)
    await page.reload(); await page.locator('nav button').first().waitFor({ timeout: 60000 }); await quieto(300);
    reqs = 0; bytes = 0; await page.evaluate(() => { window.__lt = 0; });
    const t0 = Date.now();
    await menuBtn(nome).click();
    try { await page.locator('main h1, main h2, main h3').first().waitFor({ timeout: 30000 }); } catch { pag.erros.push('a página não mostrou título em 30 s'); }
    await quieto(400);
    pag.ms = Date.now() - t0; pag.reqs = reqs; pag.bytes = bytes; pag.longtask = Math.round(await page.evaluate(() => window.__lt));
    // ---- cliques seguros
    const visitados = new Set(); let cliques = 0;
    for (let rodada = 0; rodada < 4 && cliques < 30; rodada++) {
      if (process.env.DEBUG_VARREDURA) console.log('        t=' + ((Date.now() - T_INI) / 1000).toFixed(1) + ' [rodada ' + rodada + '] fechada=' + page.isClosed() + ' url=' + (page.isClosed() ? '-' : page.url()));
      // rótulos de todos os botões visíveis, lidos de uma vez (rápido, mesmo com listas enormes)
      const rotulos = await page.evaluate(() => [...document.querySelectorAll('main button, main [role=tab], main summary')]
        .filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
        .map(e => ((e.innerText || e.getAttribute('aria-label') || e.getAttribute('title') || '').trim().replace(/\s+/g, ' ').slice(0, 60))));
      let novos = 0;
      for (const rot of rotulos) {
        if (cliques >= 30) break;
        if (!rot || visitados.has(rot) || PERIGOSO.test(rot)) continue;
        if (!process.env.VARREDURA_EXPORTS && /excel|pdf|csv|zip|extrato de saldos/i.test(rot)) { pag.exportsPulados = (pag.exportsPulados || 0) + 1; visitados.add(rot); continue; }
        if (process.env.VARREDURA_SO && !process.env.VARREDURA_SO.split(',').includes(rot)) continue;
        const b = page.locator('main button, main [role=tab], main summary').filter({ hasText: rot.slice(0, 40) }).first();
        visitados.add(rot); novos++; cliques++; ultimoRotulo = rot;
        if (process.env.DEBUG_VARREDURA) console.log(`      t=${((Date.now() - T_INI) / 1000).toFixed(1)} clicando: ${rot}`);
        const antes = erros.length, alertas = await page.locator('[role=alert]').count();
        const tc = Date.now();
        try {
          const ehExport = /excel|pdf|csv|zip|extrato de saldos/i.test(rot);
          if (ehExport) {
            // exportação: mede quanto tempo leva para o arquivo ficar pronto
            const [d] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }).catch(() => null), b.click({ timeout: 4000 })]);
            if (d) { pag.exports = pag.exports || []; pag.exports.push({ botao: rot, arquivo: d.suggestedFilename(), ms: Date.now() - tc }); }
            else pag.avisos.push(`"${rot}" não gerou arquivo em 60 s`);
          } else {
            await b.click({ timeout: 4000 });
          }
          const tr = Date.now();
          const resp = await Promise.race([page.evaluate(() => 1).then(() => 'ok'), new Promise(r => setTimeout(() => r('congelada'), 25000))]);
          const preso = Date.now() - tr;
          if (resp === 'congelada') { pag.erros.push(`CONGELOU ao clicar em "${rot}": a página não respondeu em 25 s`); console.log(`      ✖ CONGELOU em "${rot}" (>25 s sem responder)`); throw new Error('congelou'); }
          if (preso > 1500) pag.avisos.push(`"${rot}" deixou a página sem responder por ${(preso / 1000).toFixed(1)} s`);
          await quieto(250, 15000);
        } catch (e) { if (/congelou/.test(String(e))) { pag.cliques = cliques; medidas.push(pag); throw e; } pag.avisos.push(`não consegui clicar em "${rot}": ${String(e).split('\n')[0].slice(0, 80)}`); continue; }
        if (process.env.DEBUG_VARREDURA) console.log('        t=' + ((Date.now() - T_INI) / 1000).toFixed(1) + ' [ok clique] fechada=' + page.isClosed());
        const ms = Date.now() - tc;
        if (ms > 4000) pag.avisos.push(`"${rot}" demorou ${(ms / 1000).toFixed(1)} s`);
        const novosAlertas = await page.locator('[role=alert]').allInnerTexts();
        if (novosAlertas.length > alertas) pag.erros.push(`aviso de erro ao clicar em "${rot}": ${novosAlertas.slice(alertas).join(' | ').slice(0, 160)}`);
        if (erros.length > antes) pag.erros.push(`erro ao clicar em "${rot}": ${erros.slice(antes).join(' | ').slice(0, 200)}`);
        await page.keyboard.press('Escape').catch(() => undefined);
        if (process.env.DEBUG_VARREDURA) console.log('        t=' + ((Date.now() - T_INI) / 1000).toFixed(1) + ' [pós-Escape] fechada=' + page.isClosed());
        // se a página mudou (clicou numa navegação), volta
        if (!(await page.locator('main').first().isVisible().catch(() => false))) { await menuBtn(nome).click().catch(() => undefined); await quieto(300); }
      }
      if (!novos) break;
    }
    pag.cliques = cliques; pag.erros.push(...erros.slice(e0).filter(x => !pag.erros.some(y => y.includes(x.slice(0, 60))))); pag.falhas = [...new Set(falhas.slice(f0))];
    medidas.push(pag);
    console.log(`  • ${nome.padEnd(30)} pronta em ${String(pag.ms).padStart(5)} ms · ${String(pag.reqs).padStart(3)} req · ${(pag.bytes / 1048576).toFixed(1)} MB · tarefas longas ${pag.longtask} ms · ${pag.cliques} cliques · ${pag.erros.length} erro(s)`);
    pag.erros.forEach(e => console.log(`      ⚠ ${e}`));
  }
  if (process.env.VARREDURA_OUT) fs.writeFileSync(process.env.VARREDURA_OUT, JSON.stringify({ faturas: N_FAT, documentos: db.received_documents.length, baixas: db.payment_allocations.length, oms: db.oms.length, medidas }, null, 2));
  return medidas;
}
module.exports = { varredura };
