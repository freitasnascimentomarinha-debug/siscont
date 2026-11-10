import { describe, expect, it } from 'vitest';
import { OM, OMHistorico } from '../types';
import { dadosDaOMEm, mudancasAgrupadas } from '../utils/historicoOM';
import { criarResolvedor } from '../utils/documentosOM';
import { clientePorUG, planejarImportacaoSiplad } from '../services/recebimentosService';
import { omsNaData } from '../services/faturamentoService';
import { ItemLote, numerar } from '../utils/faturamento';

const h = (campo: OMHistorico['campo'], ant: string, novo: string, desde: string, extra: Partial<OMHistorico> = {}): OMHistorico =>
  ({ id: `${campo}${desde}`, omId: 'o1', campo, valorAnterior: ant, valorNovo: novo, rotuloAnterior: ant, rotuloNovo: novo, vigenteDesde: desde, ...extra });
// hoje: "Centro Moderno", UG 90020, comando c2 (mudou em 15/09/2026); antes: "Centro Antigo", UG 90010, comando c1
const om = { nome: 'Centro Moderno', codigo: '90020', comandoId: 'c2', setorId: null, sigla: null } as Pick<OM, 'nome' | 'codigo' | 'comandoId' | 'setorId' | 'sigla'>;
const hist = [h('nome', 'Centro Antigo', 'Centro Moderno', '2026-09-15'), h('codigo', '90010', '90020', '2026-09-15'), h('comando_id', 'c1', 'c2', '2026-09-15')];

describe('histórico da OM com vigência', () => {
  it('a OM como era numa data: antes da vigência os dados antigos, a partir dela os novos', () => {
    expect(dadosDaOMEm(om, hist, '2026-09-14')).toMatchObject({ nome: 'Centro Antigo', codigo: '90010', comandoId: 'c1' });
    expect(dadosDaOMEm(om, hist, '2026-09-15')).toMatchObject({ nome: 'Centro Moderno', codigo: '90020', comandoId: 'c2' });
    expect(dadosDaOMEm(om, hist, '2026-12-01')).toMatchObject({ nome: 'Centro Moderno', codigo: '90020' });
    expect(dadosDaOMEm(om, [], '2020-01-01')).toMatchObject({ nome: 'Centro Moderno', codigo: '90020' });
  });
  it('duas mudanças seguidas: cada data devolve o nome da sua época', () => {
    const duas = [h('nome', 'A', 'B', '2025-03-01'), h('nome', 'B', 'C', '2026-06-01')];
    const atual = { nome: 'C', codigo: '1', comandoId: null, setorId: null, sigla: null };
    expect(dadosDaOMEm(atual, duas, '2025-01-01').nome).toBe('A');
    expect(dadosDaOMEm(atual, duas, '2025-12-31').nome).toBe('B');
    expect(dadosDaOMEm(atual, duas, '2026-06-01').nome).toBe('C');
  });
  it('agrupa por data e ato', () => {
    const g = mudancasAgrupadas(hist.map(x => ({ ...x, ato: 'Port. 1', criadoEm: '2026-11-10T10:00:00Z' })));
    expect(g).toHaveLength(1); expect(g[0].campos).toHaveLength(3);
  });
});

describe('nome e UG antigos continuam achando a OM', () => {
  const oms = [{ id: 'o1', nome: 'Centro Moderno', codigo: '90020', ativo: true, nomesAlternativos: ['Centro Antigo'], codigosAnteriores: ['90010'], comandoId: 'c2' }];
  const res = criarResolvedor(oms as any, [{ id: 'c2', nome: 'Comando Novo', codigo: '90002' }], []);
  it('documento com o nome antigo, com a UG antiga ou com a OM gravada', () => {
    expect(res.omDoDocumento({ client: 'Centro Antigo' })?.id).toBe('o1');
    expect(res.omDoDocumento({ client: 'Fulano', ug: '90010' })?.id).toBe('o1');       // UG antiga
    expect(res.omDoDocumento({ client: 'Fulano', ug: '90020' })?.id).toBe('o1');
    expect(res.omDoDocumento({ client: 'qualquer texto', omId: 'o1' })?.id).toBe('o1'); // a OM gravada vale antes do nome
    expect(res.rotuloDoDocumento({ client: 'Centro Antigo' }).comando).toContain('Comando Novo');
  });
  it('PDF do SIPLAD com a UG antiga: liga à OM de hoje e avisa', () => {
    const cad = { oms: oms as any, comandos: [{ id: 'c2', nome: 'Comando Novo', codigo: '90002', ativo: true }] as any, setores: [] };
    const c = clientePorUG('90010', cad) as any;
    expect(c.omId).toBe('o1'); expect(c.ugAntiga).toEqual({ de: '90010', para: '90020' }); expect(c.client).toContain('90020');
    const sol = { numero: 'G1.2026.AC.1', dataCriacao: '2026-11-09', dataSituacao: '2026-11-09', tipoAlteracao: 'x', situacao: 'Processada', ugCliente: '90010 - X', ugClienteCodigo: '90010', observacao: '', celulas: [], valor: 10, faturasCitadas: [], pagina: 1, avisos: [] } as any;
    const [p] = planejarImportacaoSiplad([sol], [], cad);
    expect(p.avisos.join(' ')).toMatch(/UG antiga: 90010 agora é 90020/);
    expect(p.doc.omId).toBe('o1');
  });
});

describe('lote usa a OM como ela era na data da emissão e a sequência continua', () => {
  const ctx: any = {
    comandos: [{ id: 'c1', nome: 'Comando Velho', codigo: '90001', setorId: null }, { id: 'c2', nome: 'Comando Novo', codigo: '90002', setorId: null }], setores: [],
    oms: [{ id: 'o1', ...om }],
    omsFat: [{ id: 'o1', codigo: '90020', nome: 'Centro Moderno', tipo: 'TERRA', comandoId: 'c2', setor: '', comando: '90002 - Comando Novo', ativo: true }],
  };
  it('emissão antes da vigência: dados antigos; depois: dados novos', () => {
    expect(omsNaData(ctx, hist, '2026-09-10')[0]).toMatchObject({ codigo: '90010', nome: 'Centro Antigo', comando: '90001 - Comando Velho' });
    expect(omsNaData(ctx, hist, '2026-10-15')[0]).toMatchObject({ codigo: '90020', nome: 'Centro Moderno', comando: '90002 - Comando Novo' });
    expect(omsNaData(ctx, [], '2026-09-10')).toBe(ctx.omsFat);
  });
  it('a sequência é por serviço e mês (não por UG): a UG nova continua a numeração', () => {
    const item = (codigo: string): ItemLote => ({ chave: codigo, omId: codigo, om: { id: codigo, codigo, nome: codigo, tipo: 'TERRA', setor: 'S', comando: 'C', ativo: true } as any, sigla: 'EL', servico: 'EL', unidade: '', quantidade: null, quantidade2: null, valor: 1, acrescimo: 0, debito: 0, base: { regra: '' }, avisos: [] });
    const r = numerar([item('90020')], ['90010-EL-10-2026-007-0', '41000-EL-10-2026-012-0'], '2026-10');
    expect(r[0].numero).toBe('90020-EL-10-2026-013-0');      // continua do maior número do mês, com a UG nova
  });
});
