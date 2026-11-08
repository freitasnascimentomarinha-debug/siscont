import { describe, it, expect } from 'vitest';
import { CreditoMapa, FaturaMapa, OMRef, clientesDoMapa, creditosDoMapa, creditosDoMapaLista, faturasDaFaixaMapa, faturasDoMapa, idadeDaDivida, idsDoMapa, linhasMapa, maioresOMs, montarMapa } from '../utils/mapaAnalitico';

const oms: OMRef[] = [
  { omId: 'a', nome: 'Diretoria Industrial da Marinha', setor: 'DGMM', comando: '40030 - Diretoria Industrial da Marinha' },
  { omId: 'b', nome: 'Arsenal de Marinha do Rio de Janeiro', setor: 'DGMM', comando: '41000 - Arsenal de Marinha do Rio de Janeiro' },
  { omId: 'c', nome: 'Comando Alfa', setor: 'COMOPNAV', comando: '81000 - Comando Alfa' },
];
const f = (id: string, omId: string | null, client: string, saldo: number, venc: string, extra: Partial<FaturaMapa> = {}): FaturaMapa =>
  ({ id, omId, client, sector: 'DGMM', command: 'texto livre da fatura', numero: `N-${id}`, tipo: 'TC', vencimento: venc, saldo, ...extra });
const cr = (id: string, client: string, valor: number, extra: Partial<CreditoMapa> = {}): CreditoMapa =>
  ({ id, client, sector: 'DGMM', command: 'outro texto do documento', numero: `AC-${id}`, valor, ...extra });
const hoje = '2026-11-10';

describe('mapa analítico', () => {
  it('o crédito encontra a dívida da mesma OM mesmo com setor/comando diferentes no texto', () => {
    const m = montarMapa([f('1', 'a', 'Diretoria Industrial da Marinha', 1000, '2026-10-01')], [cr('1', 'Diretoria Industrial da Marinha', 400)], oms, { hoje });
    const cli = m.setores[0].filhos[0].filhos[0];
    expect(m.setores).toHaveLength(1);                          // um só ramo (não separa crédito em outro comando)
    expect(m.setores[0].filhos[0].nome).toBe('40030 - Diretoria Industrial da Marinha'); // comando do cadastro
    expect(cli).toMatchObject({ divida: 1000, credito: 400, liquido: 600, sobra: 0 });
  });
  it('crédito de uma OM não abate a dívida de outra; o que sobra é informado', () => {
    const m = montarMapa([f('1', 'a', 'Diretoria Industrial da Marinha', 1000, '2026-10-01')], [cr('1', 'Arsenal de Marinha do Rio de Janeiro', 5000)], oms, { hoje });
    expect(m.total).toMatchObject({ divida: 1000, credito: 5000, liquido: 1000, sobra: 5000 });
  });
  it('cada nível é a soma dos filhos e o total é a soma do que cada OM deve', () => {
    const m = montarMapa([f('1', 'a', 'x', 1000, '2026-10-01'), f('2', 'b', 'x', 300, '2026-12-01'), f('3', 'c', 'x', 50, '2026-10-02')],
      [cr('1', 'Diretoria Industrial da Marinha', 400), cr('2', 'Arsenal de Marinha do Rio de Janeiro', 1000)], oms, { hoje });
    const dgmm = m.setores.find(s => s.nome === 'DGMM')!;
    expect(dgmm.liquido).toBe(dgmm.filhos.reduce((s, c) => s + c.liquido, 0));
    expect(m.total.liquido).toBe(m.setores.reduce((s, x) => s + x.liquido, 0));
    expect(m.total).toMatchObject({ divida: 1350, credito: 1400, liquido: 650, sobra: 700 }); // DIM 600 + Arsenal 0 (sobra 700) + Alfa 50
  });
  it('separa vencido de a vencer e calcula o atraso', () => {
    const m = montarMapa([f('1', 'a', 'x', 100, '2026-11-01'), f('2', 'a', 'x', 40, '2026-11-30')], [], oms, { hoje });
    const cli = m.setores[0].filhos[0].filhos[0];
    expect(cli).toMatchObject({ vencido: 100, aVencer: 40, qtd: 2 });
    expect(cli.faturas!.map(x => x.atraso)).toEqual([9, 0]);
  });
  it('crédito de nome desconhecido fica em nó próprio, marcado como sem cadastro', () => {
    const m = montarMapa([], [cr('1', '40001 - RT DGMM', 5210.74)], oms, { hoje });
    expect(m.setores[0].filhos[0].filhos[0]).toMatchObject({ semCadastro: true, sobra: 5210.74, liquido: 0 });
  });
  it('fatura sem vínculo é ligada pelo nome do cliente à OM do cadastro', () => {
    const m = montarMapa([f('1', null, 'Arsenal de Marinha do Rio de Janeiro', 10, '2026-12-01')], [], oms, { hoje });
    expect(m.setores[0].filhos[0].nome).toBe('41000 - Arsenal de Marinha do Rio de Janeiro');
  });
  it('ordena por valor a pagar (padrão), dívida ou nome; busca e só com valor', () => {
    const fs = [f('1', 'a', 'x', 100, '2026-12-01'), f('2', 'b', 'x', 900, '2026-12-01'), f('3', 'c', 'x', 500, '2026-12-01')];
    const nomes = (m: ReturnType<typeof montarMapa>) => m.setores.flatMap(s => s.filhos.flatMap(c => c.filhos.map(x => x.nome)));
    expect(nomes(montarMapa(fs, [], oms, { hoje }))).toEqual(['Arsenal de Marinha do Rio de Janeiro', 'Diretoria Industrial da Marinha', 'Comando Alfa']);
    expect(nomes(montarMapa(fs, [], oms, { hoje, ordem: 'nome' }))).toEqual(['Comando Alfa', 'Diretoria Industrial da Marinha', 'Arsenal de Marinha do Rio de Janeiro']); // comandos em ordem de nome (com o código: 40030 antes de 41000)
    expect(nomes(montarMapa(fs, [], oms, { hoje, busca: 'alfa' }))).toEqual(['Comando Alfa']);
    expect(nomes(montarMapa(fs, [], oms, { hoje, busca: 'n-2' }))).toEqual(['Arsenal de Marinha do Rio de Janeiro']);
    expect(nomes(montarMapa(fs, [cr('1', 'Comando Alfa', 500)], oms, { hoje, soComValor: true }))).not.toContain('Comando Alfa');
  });
  it('linhas para o Excel e ids para expandir tudo', () => {
    const m = montarMapa([f('1', 'a', 'x', 100, '2026-12-01')], [], oms, { hoje });
    const l = linhasMapa(m);
    expect(l[0][0]).toBe('Setor'); expect(l[l.length - 1][0]).toBe('TOTAL'); expect(l[1][6]).toBe(100);
    expect(idsDoMapa(m, 'cliente')).toHaveLength(3); expect(idsDoMapa(m, 'setor')).toHaveLength(1);
  });
});

describe('crédito devolvido por fatura cancelada pertence à OM da fatura', () => {
  const doc = (id: string, client: string, available: number) => ({ id, client, sector: 'DGMM', command: client, numero: `AC-${id}`, availableValue: available });
  const fat = [{ id: 'f1', invoiceNumber: '41000-TC-09-2025-002-0', omId: 'b', client: 'Arsenal de Marinha do Rio de Janeiro', isCanceled: true }, { id: 'f2', omId: 'a', client: 'Diretoria Industrial da Marinha', isCanceled: false }];
  it('RT DGMM (sem OM) paga fatura do Arsenal que foi cancelada: o crédito é do Arsenal', () => {
    const c = creditosDoMapa([doc('d1', '40001 - RT DGMM', 5210.74)], [{ documentId: 'd1', invoiceId: 'f1', amount: 5210.74 }], fat, oms);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ client: 'Arsenal de Marinha do Rio de Janeiro', valor: 5210.74 });
    expect(c[0].origem).toContain('41000-TC-09-2025-002-0');
    const m = montarMapa([], c, oms, { hoje });
    expect(m.setores[0].filhos[0].filhos[0]).toMatchObject({ nome: 'Arsenal de Marinha do Rio de Janeiro', sobra: 5210.74, semCadastro: false });
  });
  it('parte devolvida vai para a OM da fatura e o resto continua com o cliente do documento', () => {
    const c = creditosDoMapa([doc('d1', 'Comando Alfa', 100)], [{ documentId: 'd1', invoiceId: 'f1', amount: 60 }, { documentId: 'd1', invoiceId: 'f2', amount: 500 }], fat, oms);
    expect(c.map(x => [x.client, x.valor])).toEqual([['Arsenal de Marinha do Rio de Janeiro', 60], ['Comando Alfa', 40]]);
  });
  it('sem baixa em fatura cancelada o crédito fica todo com o cliente do documento; nunca passa do saldo', () => {
    expect(creditosDoMapa([doc('d1', 'Comando Alfa', 70)], [{ documentId: 'd1', invoiceId: 'f2', amount: 10 }], fat, oms).map(x => [x.client, x.valor])).toEqual([['Comando Alfa', 70]]);
    const c = creditosDoMapa([doc('d1', 'Comando Alfa', 30)], [{ documentId: 'd1', invoiceId: 'f1', amount: 60 }], fat, oms);
    expect(c.map(x => [x.client, x.valor])).toEqual([['Arsenal de Marinha do Rio de Janeiro', 30]]);
  });
});

describe('mapa interativo: listas, foco e gráficos', () => {
  const fs = [f('1', 'a', 'x', 1000, '2026-10-01'), f('2', 'a', 'x', 300, '2026-12-01'), f('3', 'b', 'x', 700, '2026-05-01'), f('4', 'c', 'x', 50, '2026-12-31')];
  const crs = [cr('1', 'Diretoria Industrial da Marinha', 400)];
  const m = montarMapa(fs, crs, oms, { hoje });

  it('lista todas as faturas e só as vencidas, com OM, setor e atraso', () => {
    expect(faturasDoMapa(m)).toHaveLength(4);
    const venc = faturasDoMapa(m, x => x.vencimento < hoje);
    expect(venc.map(x => x.numero).sort()).toEqual(['N-1', 'N-3']);
    expect(venc.find(x => x.numero === 'N-3')).toMatchObject({ om: 'Arsenal de Marinha do Rio de Janeiro', setor: 'DGMM', atraso: 193 });
  });
  it('lista os créditos com a OM dona', () => {
    expect(creditosDoMapaLista(m)).toEqual([expect.objectContaining({ om: 'Diretoria Industrial da Marinha', numero: 'AC-1', valor: 400 })]);
  });
  it('idade da dívida soma por faixa e fecha com a dívida total', () => {
    const idade = idadeDaDivida(m);
    expect(idade.reduce((s, x) => s + x.valor, 0)).toBe(m.total.divida);
    expect(idade.find(x => x.faixa === 'A vencer')).toMatchObject({ valor: 350, qtd: 2 });
    expect(idade.find(x => x.faixa === '31–90 dias')).toMatchObject({ valor: 1000, qtd: 1 });
    expect(idade.find(x => x.faixa === '181–365 dias')).toMatchObject({ valor: 700, qtd: 1 });
    expect(faturasDaFaixaMapa(m, '181–365 dias').map(x => x.numero)).toEqual(['N-3']);
  });
  it('maiores OM por valor a pagar', () => {
    expect(maioresOMs(m, 2).map(x => [x.nome, x.liquido])).toEqual([['Arsenal de Marinha do Rio de Janeiro', 700], ['Diretoria Industrial da Marinha', 900]].sort((a: any, b: any) => b[1] - a[1]));
    expect(maioresOMs(m, 10)).toHaveLength(3);
  });
  it('foco por setor ou por OM, e só com vencido', () => {
    expect(clientesDoMapa(montarMapa(fs, crs, oms, { hoje, setor: 'COMOPNAV' })).map(x => x.nome)).toEqual(['Comando Alfa']);
    expect(clientesDoMapa(montarMapa(fs, crs, oms, { hoje, om: 'Arsenal de Marinha do Rio de Janeiro' })).map(x => x.nome)).toEqual(['Arsenal de Marinha do Rio de Janeiro']);
    expect(clientesDoMapa(montarMapa(fs, crs, oms, { hoje, soVencido: true })).map(x => x.nome).sort()).toEqual(['Arsenal de Marinha do Rio de Janeiro', 'Diretoria Industrial da Marinha']);
    expect(montarMapa(fs, crs, oms, { hoje, setor: 'COMOPNAV' }).total.divida).toBe(50);
  });
});

describe('cartões como filtros da árvore', () => {
  const fs = [f('1', 'a', 'x', 1000, '2026-10-01'), f('2', 'a', 'x', 300, '2026-12-01'), f('3', 'b', 'x', 700, '2026-05-01', { contestada: true }), f('4', 'c', 'x', 50, '2026-12-31')];
  const crs = [cr('1', 'Diretoria Industrial da Marinha', 400), cr('2', 'Arsenal de Marinha do Rio de Janeiro', 5000)];
  const nomes = (m: ReturnType<typeof montarMapa>) => clientesDoMapa(m).map(x => x.nome).sort();
  it('"vencidas" deixa na árvore só as faturas vencidas e sem as contestadas', () => {
    const m = montarMapa(fs, crs, oms, { hoje, faturas: 'vencidas', semContestadas: true });
    expect(faturasDoMapa(m).map(x => x.numero)).toEqual(['N-1']);
    expect(nomes(m)).toEqual(['Diretoria Industrial da Marinha']); // Arsenal (só contestada + crédito) e Alfa (a vencer) saem
    expect(m.total).toMatchObject({ divida: 1000, vencido: 1000, aVencer: 0, credito: 400, liquido: 600 });
  });
  it('com as contestadas, a vencida contestada volta', () => {
    const m = montarMapa(fs, crs, oms, { hoje, faturas: 'vencidas' });
    expect(faturasDoMapa(m).map(x => x.numero).sort()).toEqual(['N-1', 'N-3']);
  });
  it('"a vencer" e uma faixa de atraso', () => {
    expect(faturasDoMapa(montarMapa(fs, crs, oms, { hoje, faturas: 'aVencer' })).map(x => x.numero).sort()).toEqual(['N-2', 'N-4']);
    expect(faturasDoMapa(montarMapa(fs, crs, oms, { hoje, faturas: '31–90 dias' })).map(x => x.numero)).toEqual(['N-1']);
  });
  it('sem contestadas sem filtro de faturas: a OM com só crédito continua (mostra a sobra)', () => {
    const m = montarMapa(fs, crs, oms, { hoje, semContestadas: true });
    expect(nomes(m)).toContain('Arsenal de Marinha do Rio de Janeiro');
    expect(m.total.divida).toBe(1350);
  });
  it('só com crédito / só com sobra', () => {
    expect(nomes(montarMapa(fs, crs, oms, { hoje, soComCredito: true }))).toEqual(['Arsenal de Marinha do Rio de Janeiro', 'Diretoria Industrial da Marinha']);
    expect(nomes(montarMapa(fs, crs, oms, { hoje, semContestadas: true, soSobra: true }))).toEqual(['Arsenal de Marinha do Rio de Janeiro']);
  });
});
