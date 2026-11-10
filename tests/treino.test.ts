import { beforeEach, describe, expect, it } from 'vitest';
import { alvosDaEscrita, apagarTeste, chaveDe, classificar, estadoVazio, gravarTeste, lerConsulta, linhaCasa, misturarLeitura } from '../utils/treinoSandbox';
import { ativarTreino, criarFetchTreino, totalLancamentosDeTeste, zerarTreino } from '../services/treino';

const q = (s: string) => lerConsulta(new URLSearchParams(s));

describe('modo treinamento: consulta e filtros', () => {
  it('lê filtros, ordem, limite e on_conflict', () => {
    const c = q('select=*&om_id=eq.a1&valor=gte.10&order=data.desc,id&limit=1000&offset=2000&on_conflict=ano,om_id');
    expect(c.filtros).toEqual([{ coluna: 'om_id', op: 'eq', valor: 'a1' }, { coluna: 'valor', op: 'gte', valor: '10' }]);
    expect(c.ordem).toEqual([{ coluna: 'data', asc: false }, { coluna: 'id', asc: true }]);
    expect([c.limite, c.offset, c.conflito]).toEqual([1000, 2000, ['ano', 'om_id']]);
  });
  it('operadores eq, in, gte, is, ilike, cs, not', () => {
    const l = { id: 'x', valor: 15, nome: 'Centro Naval', ativo: true, nulo: null, tags: ['a', 'b'] };
    const ok = (s: string) => linhaCasa(l, q(s).filtros);
    expect(ok('id=eq.x') && !ok('id=eq.y')).toBe(true);
    expect(ok('valor=gte.10') && !ok('valor=gte.20') && ok('valor=eq.15')).toBe(true);
    expect(ok('id=in.(x,y)') && ok('id=in.("x","z")') && !ok('id=in.(a,b)')).toBe(true);
    expect(ok('nulo=is.null') && !ok('nome=is.null') && ok('ativo=is.true')).toBe(true);
    expect(ok('nome=ilike.*naval*') && !ok('nome=ilike.*xyz*')).toBe(true);
    expect(ok('tags=cs.{a}') && !ok('tags=cs.{z}')).toBe(true);
    expect(ok('id=not.eq.y') && !ok('id=not.eq.x')).toBe(true);
  });
});

describe('modo treinamento: cópia de teste', () => {
  it('incluir, alterar e apagar aparecem nas leituras sem mexer nas linhas reais', () => {
    const e = estadoVazio();
    const reais = [{ id: '1', nome: 'real 1' }, { id: '2', nome: 'real 2' }];
    gravarTeste(e, 'clientes', [{ id: '9', nome: 'novo de teste' }]);                 // incluído
    gravarTeste(e, 'clientes', [{ id: '2', nome: 'real 2 ALTERADO' }]);               // alterado
    apagarTeste(e, 'clientes', [{ id: '1' }]);                                         // apagado
    const lido = misturarLeitura(e, 'clientes', reais, q('order=id.asc'), true);
    expect(lido.map(l => [l.id, l.nome])).toEqual([['2', 'real 2 ALTERADO'], ['9', 'novo de teste']]);
    expect(reais).toEqual([{ id: '1', nome: 'real 1' }, { id: '2', nome: 'real 2' }]);    // o real não foi tocado
  });
  it('linhas novas só entram na última página; filtros valem também para elas', () => {
    const e = estadoVazio();
    gravarTeste(e, 't', [{ id: 'n', om_id: 'a' }, { id: 'm', om_id: 'b' }]);
    expect(misturarLeitura(e, 't', [], q('om_id=eq.a'), false)).toEqual([]);
    expect(misturarLeitura(e, 't', [], q('om_id=eq.a'), true).map(l => l.id)).toEqual(['n']);
  });
  it('chave por colunas (on_conflict) e chaves conhecidas', () => {
    expect(chaveDe('propostas_tc', { ano: 2026, x: 1 })).toBe('[2026]');
    expect(chaveDe('lotacoes_tc', { ano: 2026, om_id: 'a' })).toBe('[2026,"a"]');
    expect(chaveDe('qualquer', { id: 'k' })).toBe('["k"]');
  });
  it('alterar/apagar por filtro atinge reais e de teste', () => {
    const e = estadoVazio();
    gravarTeste(e, 'f', [{ id: 't', cliente: 'A' }]);
    const alvos = alvosDaEscrita(e, 'f', [{ id: 'r', cliente: 'A' }, { id: 'r2', cliente: 'B' }], q('cliente=eq.A'));
    expect(alvos.map(a => a.id).sort()).toEqual(['r', 't']);
  });
  it('porteiro: leitura passa; escrita em tabela vai para o teste; função que escreve e administração são bloqueadas', () => {
    expect(classificar('GET', '/rest/v1/invoices').tipo).toBe('tabela');
    expect(classificar('POST', '/rest/v1/invoices').tipo).toBe('tabela');
    expect(classificar('POST', '/rest/v1/rpc/om_tem_movimento').tipo).toBe('passar');
    expect(classificar('POST', '/rest/v1/rpc/unificar_om').tipo).toBe('bloquear');
    expect(classificar('POST', '/rest/v1/rpc/om_alterar_dados').tipo).toBe('bloquear');
    expect(classificar('POST', '/auth/v1/token').tipo).toBe('passar');
    expect(classificar('POST', '/auth/v1/admin/users').tipo).toBe('bloquear');
    expect(classificar('POST', '/storage/v1/object/anexos/x.pdf').tipo).toBe('bloquear');
  });
});

describe('modo treinamento: o fetch do cliente', () => {
  const enviados: { metodo: string; url: string }[] = [];
  const bancoReal = [{ id: '1', nome: 'real 1' }, { id: '2', nome: 'real 2' }];
  const real = (async (entrada: any, init?: RequestInit) => {
    const url = typeof entrada === 'string' ? entrada : entrada.url ?? String(entrada);
    enviados.push({ metodo: (init?.method || 'GET').toUpperCase(), url });
    return new Response(JSON.stringify(bancoReal), { status: 200, headers: { 'Content-Type': 'application/json', 'Content-Range': `0-${bancoReal.length - 1}/${bancoReal.length}` } });
  }) as typeof fetch;
  const f = criarFetchTreino(real);
  const base = 'https://x.supabase.co/rest/v1/clientes';
  beforeEach(() => { enviados.length = 0; zerarTreino(); ativarTreino(null); });

  it('sem o modo treinamento tudo passa direto ao servidor', async () => {
    await f(base, { method: 'POST', body: JSON.stringify({ id: '7' }) });
    expect(enviados).toHaveLength(1);
  });
  it('no modo treinamento NENHUMA escrita chega ao servidor, e a leitura mostra o que foi lançado de teste', async () => {
    ativarTreino('usuario-teste');
    const r1 = await f(base, { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ id: '9', nome: 'de teste' }) });
    expect(r1.status).toBe(201);
    const r2 = await f(`${base}?id=eq.2`, { method: 'PATCH', body: JSON.stringify({ nome: 'real 2 mudado' }) });
    expect(r2.status).toBe(204);
    const r3 = await f(`${base}?id=eq.1`, { method: 'DELETE' });
    expect(r3.status).toBe(204);
    expect(enviados.filter(x => x.metodo !== 'GET')).toEqual([]);                      // nada de POST/PATCH/DELETE no servidor
    const lido = await (await f(`${base}?select=*&order=id.asc&limit=1000&offset=0`)).json();
    expect(lido.map((l: any) => [l.id, l.nome])).toEqual([['2', 'real 2 mudado'], ['9', 'de teste']]);
    expect(totalLancamentosDeTeste()).toBe(3);
  });
  it('função do banco que escreve devolve erro e não chega ao servidor; a de leitura passa', async () => {
    ativarTreino('usuario-teste');
    const r = await f('https://x.supabase.co/rest/v1/rpc/unificar_om', { method: 'POST', body: '{}' });
    expect(r.status).toBe(400);
    expect((await r.json()).message).toMatch(/Modo treinamento/);
    await f('https://x.supabase.co/rest/v1/rpc/om_tem_movimento', { method: 'POST', body: '{}' });
    expect(enviados.map(x => x.url)).toEqual(['https://x.supabase.co/rest/v1/rpc/om_tem_movimento']);
  });
  it('"zerar meus testes" apaga a cópia e volta a mostrar só o real', async () => {
    ativarTreino('usuario-teste');
    await f(base, { method: 'POST', body: JSON.stringify({ id: '9', nome: 'x' }) });
    zerarTreino();
    const lido = await (await f(`${base}?select=*`)).json();
    expect(lido.map((l: any) => l.id)).toEqual(['1', '2']);
  });
});
