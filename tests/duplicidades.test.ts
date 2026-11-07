import { describe, expect, it } from 'vitest';
import { iniciais, paresDuplicados, sugerirManter } from '../utils/duplicidades';

const om = (id: string, nome: string, extra: any = {}) => ({ id, nome, codigo: '40000', tipo: 'TERRA', ativo: true, ...extra });

describe('duplicidades no cadastro', () => {
  it('iniciais ignoram preposições e o edifício entre parênteses', () => {
    expect(iniciais('Centro de Perícias Médicas da Marinha (Ed.8)')).toBe('CPMM');
  });
  it('encontra: mesmo nome com acento/edifício, mesma sigla, sigla × extenso, nome cortado, nomes parecidos', () => {
    const lista = [
      om('1', 'Secretaria do Núcleo de Saúde Naval (Ed.23)'), om('2', 'SECRETARIA DO NUCLEO DE SAUDE NAVAL', { codigo: '40002', ativo: false }),
      om('3', 'Diretoria Industrial da Marinha', { sigla: 'DIM' }), om('4', 'DIM', { codigo: '40030' }),
      om('5', 'Centro de Perícias Médicas da Marinha'), om('6', 'CPMM', { ativo: false }),
      om('7', 'Embarcação de Desembarque de Carga Geral - EDCG Classe Guarapari'), om('8', 'Embarcação de Desembarque de Carga Geral - EDCG Cl'),
      om('9', 'Hospital Central da Marinha', { sigla: 'HCM' }), om('10', 'Hospital Central Marinha RJ'),
      om('11', 'Corveta Barroso', { tipo: 'NAVIO' }), om('12', 'Barroso', { tipo: 'TERRA' }),
      om('13', 'Arsenal de Marinha do Rio de Janeiro', { sigla: 'AMRJ' }), om('14', 'Base Naval do Rio de Janeiro', { sigla: 'BNRJ' }),
    ];
    const pares = paresDuplicados(lista);
    const tem = (x: string, y: string) => pares.some(p => [p.a.id, p.b.id].sort().join() === [x, y].sort().join());
    expect(tem('1', '2')).toBe(true);
    expect(tem('3', '4')).toBe(true);
    expect(tem('5', '6')).toBe(true);
    expect(tem('7', '8')).toBe(true);
    expect(tem('9', '10')).toBe(true);
    expect(tem('11', '12')).toBe(false); // navio não se compara com OM de terra
    expect(tem('13', '14')).toBe(false); // nomes diferentes de verdade
    expect(pares[0].pontos).toBe(100);
  });
  it('pares marcados como "não são a mesma" não voltam', () => {
    const l = [om('a', 'DIM'), om('b', 'Diretoria Industrial da Marinha', { sigla: 'DIM' })];
    expect(paresDuplicados(l, new Set(['a|b']))).toHaveLength(0);
  });
  it('sugere manter a ativa e, depois, a com mais faturas', () => {
    const a = om('a', 'X', { ativo: false }), b = om('b', 'X');
    expect(sugerirManter(a, b, new Map())).toBe('b');
    expect(sugerirManter(om('a', 'X'), om('b', 'X'), new Map([['a', 10], ['b', 2]]))).toBe('a');
  });
});

describe('duplicidades: depois de unificar e com muitas OM', () => {
  it('par já unificado (nome da desativada guardado como alternativo) não volta', () => {
    const fica = { id: 'a', nome: 'Diretoria Industrial da Marinha', codigo: '40030', tipo: 'TERRA', ativo: true, nomesAlternativos: ['DIRETORIA INDUSTRIAL DA MARINHA'] };
    const saiu = { id: 'b', nome: 'DIRETORIA INDUSTRIAL DA MARINHA', codigo: '40031', tipo: 'TERRA', ativo: false };
    expect(paresDuplicados([fica, saiu])).toEqual([]);
    expect(paresDuplicados([{ ...fica, nomesAlternativos: [] }, saiu]).length).toBe(1);
  });
  it('duas desativadas não são comparadas', () => {
    expect(paresDuplicados([{ id: 'a', nome: 'Banco do Brasil', codigo: '00994', tipo: 'EXTRA_MB', ativo: false }, { id: 'b', nome: 'BANCO DO BRASIL', codigo: '40015', tipo: 'EXTRA_MB', ativo: false }])).toEqual([]);
  });
  it('3.000 OM em menos de 2 segundos', () => {
    const pal = ['Comando', 'Diretoria', 'Centro', 'Navio', 'Base', 'Hospital', 'Marinha', 'Naval', 'Rio', 'Ilha', 'Cobras', 'Patrulha', 'Fragata', 'Distrito'];
    const oms = Array.from({ length: 3000 }, (_, i) => ({ id: `id${i}`, nome: `${pal[i % 14]} ${pal[(i * 5) % 14]} ${pal[(i * 3) % 14]} ${i}`, codigo: String(10000 + i), tipo: i % 5 ? 'TERRA' : 'NAVIO', ativo: true }));
    const t = Date.now(); paresDuplicados(oms);
    expect(Date.now() - t).toBeLessThan(2000);
  });
});
