import { describe, it, expect } from 'vitest';
import { CreditoMapa, FaturaMapa, OMRef, idsDoMapa, linhasMapa, montarMapa } from '../utils/mapaAnalitico';

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
