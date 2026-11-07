import { describe, it, expect } from 'vitest';
import { data, numero, planejarMigracao, planilhasVazias, criarResolverOM, ContextoImportacao, linhasPorCabecalho } from '../utils/faturasImport';
import { analisarCadastro, lerComando, LinhaFatura } from '../utils/cadastroImport';

describe('conversões', () => {
  it('lê números em vários formatos', () => {
    expect(numero('R$ 1.282,14')).toBe(1282.14);
    expect(numero('223.98')).toBe(223.98);
    expect(numero(19615.73)).toBe(19615.73);
    expect(numero('R$ 0,00')).toBe(0);
    expect(numero('')).toBeNull();
  });
  it('lê datas: serial do Excel, dd/mm/aa e recusa inválidas', () => {
    expect(data(46280)).toBe('2026-09-15');
    expect(data('30/09/26')).toBe('2026-09-30');
    expect(data('31/11/26')).toBeNull(); // 31 de novembro não existe
    expect(data('15/11/02')).toBe('2002-11-15'); // ano errado: lida, e a migração recalcula por ser anterior à emissão
    expect(data('15/11/1999')).toBeNull(); // fora do período
    expect(data(38640)).toBe('2005-10-15'); // data com ano errado: lida, mas recusada depois por ser anterior à emissão
  });
  it('acha o cabeçalho e devolve linhas por nome de coluna', () => {
    const l = linhasPorCabecalho([['x'], ['DATA', 'COMANDO', 'CLIENTE', 'ALTCRED', 'FATURA', 'VALOR'], [46000, 'DGMM', '40030 - DIM', 'A1', '40030-TC-01-2026-014-0', 10]],
      { altcred: ['altcred'], fatura: ['fatura'], valor: ['valor'] }, ['altcred', 'fatura']);
    expect(l).toEqual([{ altcred: 'A1', fatura: '40030-TC-01-2026-014-0', valor: 10 }]);
  });
});

// Mini planilha no formato da "Pagamento 2026" e do livro de emissão
const CAB = ['SETOR', 'COMANDO', 'Cliente', 'Fatura', 'Valor', 'Data Emis.', 'Data Venc.', 'Mês', 'Ano', 'Competência', 'TIPO', 'VALOR PAGO', 'SALDO', 'STATUS', 'QUITADA SIPLAD?', 'OBSERVAÇÕES'];
const fat = (cmd: string, cli: string, n: string, v: number, venc: any, status: string, siplad = false, obs = '') =>
  ['DGMM', cmd, cli, n, v, 46280, venc, '', '', '', '', 0, v, status, siplad, obs];
const DIM = '40030 - Diretoria Industrial da Marinha';

function cenario() {
  const p = planilhasVazias();
  p.faturas.push([CAB,
    fat(DIM, 'Diretoria Industrial da Marinha', '40030-TC-08-2026-014-0', 0, 46295, 'PAGO', true),       // coberta por adiantamento
    fat(DIM, 'Diretoria Industrial da Marinha', '40030-EL-08-2026-010-0', 10134.19, 46295, 'PAGO'),       // paga por ALTCRED
    fat(DIM, 'Navio-Patrulha Mangaratiba', '40032-DA-08-2026-010-1', 2960.81, '31/11/26', 'VENCIDA'),     // vencimento inválido
    fat(DIM, 'Navio-Patrulha Mangaratiba', '40032-RB-07-2026-007-0', 17224.58, 46295, 'CANCELADA'),
    fat(DIM, 'Diretoria Industrial da Marinha', '40030-AE-08-2026-004-0', 8656.28, 46295, 'CONTESTADA', false, 'AGUARDANDO SETOR'),
  ]);
  p.pagas.push([CAB.slice(0, 11), ['DGMM', DIM, 'Diretoria Industrial da Marinha', '40030-TC-01-2025-014-0', 19615.73, 45700, 45716]]);
  p.extra.push([['SETOR', 'Comando', 'CLIENTE', 'FATURA', 'VALOR', 'Data Emis.', 'Data Venc.', 'Mês', 'Ano', 'Comp', 'TIPO', 'Data de pagamento', 'Aut. Bancária', 'Situação'],
    ['EXTRA-MARINHA', 'EXTRA-MARINHA', 'BANCO DO BRASIL', '00994-AE-08-2026-020-0', 223.98, 46280, 46295, '', '', '', '', 46290, 'ABC123', 'PAGA'],
    ['EXTRA-MARINHA', 'EXTRA-MARINHA', 'BANCO DO BRASIL', '00994-EL-08-2026-023-0', 925.10, 46280, 46295, '', '', '', '', 46290, 'ABC123', 'PAGA'],
    ['EXTRA-MARINHA', 'EXTRA-MARINHA', 'BANCO DO BRASIL', '00994-AE-09-2026-020-0', 223.98, 46310, 46326, '', '', '', '', null, null, 'EM ABERTO'],
  ]);
  p.altcred.push([['Data de situação', 'COMANDO', 'Cliente', 'NºALTCRED', 'TIPO', 'Valor ALTCRED', 'VALOR UTILIZADO', 'SALDO', 'OBSERVAÇÃO'],
    [46253, 'DGMM', '40030 - DIM', 'G424.2026.AC.00343', 'PAGAMENTO', 44000, 44000, 0, 'SALDO ENVIADO PARA ADIANTAMENTO'],
    [46179, 'DGMM', '40030 - DIM', 'G424.2026.AC.00016', 'ADIANTAMENTO', 37090, 19615.73, 17474.27, ''],
  ]);
  p.lancamentos.push([['Data de situação', 'COMANDO', 'CLIENTE', 'NºALTCRED', 'NºFATURA', 'VALOR UTILIZADO', 'TIPO'],
    [46253, 'DGMM', '40030 - DIM', 'G424.2026.AC.00343', '40030-EL-08-2026-010-0', 10134.19, 'EL'],
    [46253, 'DGMM', '40030 - DIM', 'G424.2026.AC.00343', 'ADIANTAMENTO', 33865.81, 'ADIANTAMENTO'],
    [46253, 'DGMM', '40030 - DIM', 'X488.2025.AC.03903', '40032-RB-07-2026-007-0', 100, 'RB'],
  ]);
  p.resumoAdiantamento.push([...Array.from({ length: 28 }, () => []), ['DATA', 'COMANDO', 'CLIENTE', 'ALTCRED', 'FATURA', 'VALOR', 'TIPO'],
    [46260, 'DGMM', '40030 - DIM', 'G424.2026.AC.00016', '40030-TC-08-2026-014-0', 19615.73, 'TC'],
    [46260, 'DGMM', '40030 - DIM', 'G424.2026.AC.00343', '40032-DA-08-2026-010-1', 1000, 'DA'],
  ]);
  p.livro.push([['Setor', 'Comando', 'Cliente', 'Fatura', 'Consumo', 'Unid. de medida', 'Valor Serv. Prest.', 'Valor do Adiantamento', 'Acréscimo', 'Débito', 'Valor Final'],
    ['DGMM', DIM, 'Diretoria Industrial da Marinha', '40030-TC-08-2026-014-0', null, null, 19615.73, 19615.73, 0, 0, 0],
    ['DGMM', DIM, 'Diretoria Industrial da Marinha', '40030-EL-08-2026-010-0', 12500, 'Kwh', 10000, 0, 134.19, 0, 10134.19],
    ['DGMM', DIM, 'Navio-Patrulha Mangaratiba', '40032-DA-08-2026-010-1', 31, 'dia', 5000, 0, 0, 0, 5000], // livro desatualizado
  ]);
  return p;
}

const linhasCadastro: LinhaFatura[] = [
  { setor: 'DGMM', comando: DIM, cliente: 'Diretoria Industrial da Marinha', fatura: '40030-TC-08-2026-014-0', origem: 't' },
  { setor: 'DGMM', comando: DIM, cliente: 'Navio-Patrulha Mangaratiba', fatura: '40032-DA-08-2026-010-1', origem: 't' },
  { setor: 'EXTRA-MARINHA', comando: 'EXTRA-MARINHA', cliente: 'BANCO DO BRASIL', fatura: '00994-AE-08-2026-020-0', origem: 't' },
];

function contexto(extra: Partial<ContextoImportacao> = {}): ContextoImportacao {
  const prop = analisarCadastro(linhasCadastro);
  const oms = prop.oms.map((o, i) => ({ id: `om${i}`, codigo: o.codigo, nome: o.nome, tipo: o.tipo, setor: o.setor || '', comando: o.tipo === 'EXTRA_MB' ? '' : DIM }));
  let seq = 0;
  return {
    resolverOM: criarResolverOM(prop.indice, prop.oms, oms),
    resolverComando: t => (lerComando(t)?.codigo === '40030' ? { comandoId: 'c1', codigo: '40030', nome: 'Diretoria Industrial da Marinha', setor: 'DGMM' } : null),
    servicos: [{ sigla: 'TC', nome: 'Taxa Condominial', unidade: '-' }, { sigla: 'EL', nome: 'Eletricidade', unidade: 'KWH' }, { sigla: 'DA', nome: 'Diária de Atracação', unidade: 'DIA' }],
    feriados: ['2026-11-02'], prazoDiasUteis: 10, faturasExistentes: new Set(), documentosExistentes: new Set(),
    hoje: '2026-11-07', novoId: () => `id${++seq}`, ...extra,
  };
}

describe('planejarMigracao', () => {
  const plano = planejarMigracao(cenario(), contexto());
  const F = (n: string) => plano.faturas.find(f => f.numero === n)!;
  const baixasDe = (n: string) => plano.baixas.filter(b => b.faturaId === F(n).id);

  it('reconstrói o valor do serviço: valor final da planilha + adiantamento usado; usa o livro quando bate', () => {
    expect(F('40030-TC-08-2026-014-0')).toMatchObject({ valor: 19615.73, tipo: 'Taxa Condominial', siplad: true });
    expect(F('40030-EL-08-2026-010-0')).toMatchObject({ valor: 10000, acrescimo: 134.19, consumo: '12500', unidade: 'Kwh' });
  });
  it('livro desatualizado: vale o valor vigente da planilha (e avisa)', () => {
    expect(F('40032-DA-08-2026-010-1').valor).toBe(3960.81); // 2960,81 final + 1000 de adiantamento
    expect(plano.avisos.find(a => a.tipo === 'VALOR_DIVERGENTE_LIVRO')?.exemplos?.join()).toMatch(/40032-DA/);
  });
  it('liga ao cadastro e recalcula vencimento inválido pela OI (10 dias úteis)', () => {
    const f = F('40032-DA-08-2026-010-1');
    expect(f.omId).toBeTruthy();
    expect(f.cliente).toBe('Navio-Patrulha Mangaratiba');
    expect(f.vencimento).toBe('2026-09-29'); // emissão 15/09/2026 + 10 dias úteis
    expect(plano.avisos.find(a => a.tipo === 'VENCIMENTO_CORRIGIDO')).toBeTruthy();
  });
  it('baixas: pagamento (LANÇAMENTOS) e adiantamento (RESUMO); sobra "ADIANTAMENTO" não vira baixa', () => {
    expect(baixasDe('40030-EL-08-2026-010-0').map(b => b.valor)).toEqual([10134.19]);
    expect(baixasDe('40030-TC-08-2026-014-0').map(b => b.valor)).toEqual([19615.73]);
    const doc343 = plano.documentos.find(d => d.numero === 'G424.2026.AC.00343')!;
    expect(plano.baixas.filter(b => b.documentoId === doc343.id).reduce((s, b) => s + b.valor, 0)).toBeCloseTo(11134.19);
    expect(doc343).toMatchObject({ operacao: 'PAGAMENTO', valor: 44000, comandoId: 'c1' });
  });
  it('cancelada, contestada e histórico quitado', () => {
    expect(F('40032-RB-07-2026-007-0').cancelada).toBe(true);
    expect(F('40030-AE-08-2026-004-0')).toMatchObject({ contestada: true });
    expect(F('40030-AE-08-2026-004-0').observacao).toMatch(/AGUARDANDO SETOR/);
    expect(F('40030-TC-01-2025-014-0').quitacaoExterna).toMatch(/Quitada antes do SISCONT/);
  });
  it('extra-MB pago vira GRU (uma autenticação para duas faturas soma os valores)', () => {
    const gru = plano.documentos.filter(d => d.tipoDocumento === 'GRU');
    expect(gru).toHaveLength(1);
    expect(gru[0]).toMatchObject({ numero: 'GRU ABC123', valor: 1149.08, data: '2026-09-25' });
    expect(baixasDe('00994-AE-08-2026-020-0')).toHaveLength(1);
    expect(baixasDe('00994-AE-09-2026-020-0')).toHaveLength(0);
  });
  it('cria ALTCRED citada nas baixas e ausente da aba (exercício anterior)', () => {
    const d = plano.documentos.find(x => x.numero === 'X488.2025.AC.03903')!;
    expect(d).toMatchObject({ valor: 100, operacao: 'PAGAMENTO' });
    expect(plano.avisos.find(a => a.tipo === 'ALTCRED_CRIADA')).toBeTruthy();
  });
  it('confere a situação com a planilha e separa o total em aberto', () => {
    expect(plano.resumo.divergentesFaturas).toBe(0);
    expect(plano.resumo.abertoFaturas).toBe(2960.81);
    expect(plano.resumo.abertoContestadas).toBe(8656.28);
    expect(plano.resumo.abertoExtraMB).toBe(223.98);
  });
  it('não duplica o que já existe no sistema', () => {
    const p2 = planejarMigracao(cenario(), contexto({ faturasExistentes: new Set(['40030-EL-08-2026-010-0']), documentosExistentes: new Set(['G424.2026.AC.00343']) }));
    expect(p2.faturas.some(f => f.numero === '40030-EL-08-2026-010-0')).toBe(false);
    expect(p2.documentos.some(d => d.numero === 'G424.2026.AC.00343')).toBe(false);
    expect(p2.resumo.ignoradasExistentes).toBe(2);
  });
});
