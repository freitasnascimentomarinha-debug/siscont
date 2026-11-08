import { describe, expect, it } from 'vitest';
import { criarClassificador, passaPublico, sufixoPublico } from '../utils/publico';

describe('público MB × Extra-MB', () => {
  const c = criarClassificador([
    { id: 'itau', nome: 'Banco Itaú', tipo: 'EXTRA_MB' },
    { id: 'dim', nome: 'Diretoria Industrial da Marinha', tipo: 'TERRA', nomesAlternativos: ['DIM'] },
  ]);
  it('fatura pela OM ligada (cadastro manda, não o texto)', () => {
    expect(c.faturaExtra({ omId: 'itau', sector: 'DGMM' })).toBe(true);
    expect(c.faturaExtra({ omId: 'dim', sector: 'EXTRA-MB' })).toBe(false);
  });
  it('sem OM ligada: pelo nome do cliente e, por último, pelo texto do setor/comando', () => {
    expect(c.faturaExtra({ client: 'BANCO ITAÚ' })).toBe(true);
    expect(c.faturaExtra({ client: 'Empresa X', sector: 'EXTRA-MB' })).toBe(true);
    expect(c.faturaExtra({ client: 'Empresa X', sector: 'DGMM' })).toBe(false);
  });
  it('documento (ALTCRED/GRU) pelo cliente, inclusive nome alternativo', () => {
    expect(c.docExtra({ client: 'Banco Itaú' })).toBe(true);
    expect(c.docExtra({ client: 'DIM', command: 'EXTRA-MARINHA' })).toBe(false);
    expect(c.docExtra({ client: 'Fulano', command: 'EXTRA-MARINHA' })).toBe(true);
  });
  it('filtro e títulos', () => {
    expect([passaPublico('TODOS', true), passaPublico('MB', true), passaPublico('EXTRA', true), passaPublico('MB', false)]).toEqual([true, false, true, true]);
    expect(sufixoPublico('EXTRA')).toContain('Extra-Marinha');
    expect(sufixoPublico('TODOS')).toBe('');
  });
});
