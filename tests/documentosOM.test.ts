import { describe, it, expect } from 'vitest';
import { criarResolvedor } from '../utils/documentosOM';

const setores = [{ id: 's1', sigla: 'DGMM' }, { id: 's2', sigla: 'SGM' }];
const comandos = [{ id: 'c1', codigo: '41000', nome: 'Arsenal de Marinha do Rio de Janeiro', setorId: 's1' }, { id: 'c2', codigo: '73200', nome: 'Pagadoria de Pessoal da Marinha', setorId: 's2' }];
const oms = [
  { id: 'amrj', nome: 'Arsenal de Marinha do Rio de Janeiro', codigo: '41000', comandoId: 'c1', ativo: true },
  { id: 'skm', nome: 'SKM', codigo: '41000', comandoId: 'c1', ativo: true, tipo: 'EXTRA_MB' },
  { id: 'papem', nome: 'Pagadoria de Pessoal da Marinha', codigo: '73200', comandoId: 'c2', ativo: true, nomesAlternativos: ['73202 - 73202'] },
];
const r = criarResolvedor(oms, comandos, setores);

describe('a OM de cada documento (cadastro, não o texto)', () => {
  it('pelo nome, sem diferenciar acento e maiúsculas; pelos outros nomes', () => {
    expect(r.omDoDocumento({ client: 'ARSENAL DE MARINHA DO RIO DE JANEIRO', ug: '41000' })?.id).toBe('amrj');
    expect(r.omDoDocumento({ client: '73202 - 73202', ug: '73202' })?.id).toBe('papem');
  });
  it('pela UG só quando o código é de uma OM só (41000 é de várias)', () => {
    expect(r.omDoDocumento({ client: 'nome desconhecido', ug: '73200' })?.id).toBe('papem');
    expect(r.omDoDocumento({ client: 'nome desconhecido', ug: '41000' })).toBeNull();
    expect(r.codigoUnico('41000')).toBe(false); expect(r.codigoUnico('73200')).toBe(true);
  });
  it('setor e comando vêm do cadastro', () => {
    expect(r.rotuloDoDocumento({ client: 'Pagadoria de Pessoal da Marinha', sector: 'texto', command: 'outro texto' }))
      .toEqual({ omId: 'papem', setor: 'SGM', comando: '73200 - Pagadoria de Pessoal da Marinha', cliente: 'Pagadoria de Pessoal da Marinha', comandoId: 'c2' });
  });
  it('sem OM: usa o comando ligado ao documento; sem nada, o texto digitado', () => {
    expect(r.rotuloDoDocumento({ client: '40001 - RT DGMM', comandoId: 'c1', sector: 'X', command: 'Y' })).toMatchObject({ omId: null, setor: 'DGMM', comando: '41000 - Arsenal de Marinha do Rio de Janeiro', cliente: '40001 - RT DGMM' });
    expect(r.rotuloDoDocumento({ client: '40001 - RT DGMM', sector: 'DGMM', command: '40001 - RT DGMM' })).toMatchObject({ omId: null, setor: 'DGMM', comando: '40001 - RT DGMM' });
  });
});

describe('cobrança: setor e comando pelo cadastro da OM', () => {
  it('duas grafias do mesmo comando viram uma só; fatura sem OM mantém o texto', async () => {
    const { rotularPeloCadastro } = await import('../services/relatoriosService');
    const f = (id: string, omId: string | null, comando: string) => ({ id, numero: id, setor: 'texto', comando, cliente: 'x', omId, tipo: 'TC', ano: 2026, mes: 1, vencimento: '2026-01-01', saldo: 1 });
    const r2 = rotularPeloCadastro([f('1', 'amrj', '41000 - Arsenal'), f('2', 'amrj', 'Arsenal de Marinha'), f('3', null, 'texto livre')],
      { oms, comandos: comandos as any, setores });
    expect(r2.map(x => [x.setor, x.comando, x.cliente])).toEqual([
      ['DGMM', '41000 - Arsenal de Marinha do Rio de Janeiro', 'Arsenal de Marinha do Rio de Janeiro'],
      ['DGMM', '41000 - Arsenal de Marinha do Rio de Janeiro', 'Arsenal de Marinha do Rio de Janeiro'],
      ['texto', 'texto livre', 'x'],
    ]);
  });
});
