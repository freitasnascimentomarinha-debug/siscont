import { describe, expect, it } from 'vitest';
import { iniciais, paresDuplicados, sugerirComandoPorComplemento, sugerirManter } from '../utils/duplicidades';
import { partesDoNome, resolverEmissora } from '../utils/emissora';

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
    expect(pares[0].pontos).toBeGreaterThanOrEqual(90);
    expect(pares.find(p => [p.a.id, p.b.id].sort().join() === '1,2')?.pontos).toBe(75);   // só um indica o edifício: confira
  });
  it('complemento e edifício identificam clientes diferentes', () => {
    const l = [
      om('a', 'Arsenal de Marinha do Rio de Janeiro'), om('b', 'Arsenal de Marinha do Rio de Janeiro - BGL1', { tipo: 'EXTRA_MB' }),
      om('c', 'ARSENAL DE MARINHA DO RIO DE JANEIRO - SKM'),
      om('d', 'Diretoria de Patrimônio Histórico e Documentação da Marinha'), om('e', 'Diretoria de Patrimônio Histórico e Documentação da Marinha - ILHA FISCAL'),
      om('f', 'Policlínica Naval (Ed.16)'), om('g', 'POLICLINICA NAVAL (ED.32)'), om('h', 'Policlinica Naval (Ed. 16)'),
    ];
    const pares = paresDuplicados(l).map(p => [p.a.id, p.b.id].sort().join(''));
    expect(pares).toEqual(['fh']);      // só o mesmo nome no mesmo edifício
  });
  it('sugere o comando do responsável para o cliente com complemento', () => {
    const oms = [
      { ...om('a', 'Arsenal de Marinha do Rio de Janeiro', { sigla: 'AMRJ' }), comandoId: 'cA' },
      { ...om('b', 'AMRJ - BGL1', { tipo: 'EXTRA_MB' }), comandoId: null },
      { ...om('d', 'Diretoria de Patrimônio Histórico e Documentação da Marinha'), comandoId: 'cD' },
      { ...om('e', 'Diretoria de Patrimônio Histórico e Documentação da Marinha - ILHA FISCAL'), comandoId: 'cD' },
      { ...om('x', 'Comando do 1º Distrito Naval - Oficina'), comandoId: null },
    ];
    const s = sugerirComandoPorComplemento(oms, [{ id: 'c1', nome: 'Comando do 1º Distrito Naval', sigla: 'Com1DN' }]);
    expect(s.map(x => [x.om.id, x.comandoId, x.complemento])).toEqual([['b', 'cA', 'BGL1'], ['x', 'c1', 'Oficina']]);   // Ilha Fiscal já está certa
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

describe('OM emissora e partes do nome', () => {
  const oms = [
    { id: '1', nome: 'Base Naval da Ilha das Cobras', codigo: '40015', sigla: 'BNIC', tipo: 'TERRA', ativo: true },
    { id: '2', nome: 'Arsenal de Marinha do Rio de Janeiro', codigo: '41000', tipo: 'TERRA', ativo: true },
  ];
  it('acha a BNIC sem parâmetro e respeita o parâmetro quando gravado', () => {
    expect(resolverEmissora(oms, [])).toMatchObject({ omId: '1', participaRateio: true, definidaNosParametros: false });
    expect(resolverEmissora(oms, [{ chave: 'om_emissora_id', valor: '2' }, { chave: 'om_emissora_rateio', valor: 'NAO' }])).toMatchObject({ omId: '2', participaRateio: false, definidaNosParametros: true });
  });
  it('separa responsável, complemento e edifício', () => {
    expect(partesDoNome('Arsenal de Marinha do Rio de Janeiro - BGL1')).toEqual({ responsavel: 'Arsenal de Marinha do Rio de Janeiro', complemento: 'BGL1', edificio: null });
    expect(partesDoNome('DGePM-RIO (ed.16)')).toEqual({ responsavel: 'DGePM-RIO', complemento: null, edificio: '16' });
    expect(partesDoNome('CMS – CAM (Ed. 7B)')).toEqual({ responsavel: 'CMS', complemento: 'CAM', edificio: '7B' });
  });
});
