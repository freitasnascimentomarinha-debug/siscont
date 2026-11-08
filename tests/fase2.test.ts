import { describe, it, expect } from 'vitest';
import { lerSolicitacao, ItemPdf, valorBR, dataIso } from '../utils/altcredSiplad';
import { proporBaixa, validarBaixa, FaturaCandidata } from '../utils/baixaAssistida';
import { montarExtrato, comSubtotais } from '../utils/extrato';
import { avaliarPontos } from '../utils/pontosAtencao';
import { ehAdiantamento, aceitaAdiantamento } from '../utils/baixas';

// Página no mesmo leiaute do SIPLAD (posições como o pdf.js entrega), com dados fictícios
const item = (s: string, x: number, y: number, w = s.length * 4.5): ItemPdf => ({ s, x, y, w });
function paginaFicticia(obs = 'Quitação das faturas 12346-EL-08-2026-010-0 e 12346-AE-08-2026-004-0.'): ItemPdf[] {
  return [
    item('Solicitações de Alteração de', 180, 794), item('Crédito', 271, 773),
    item('N° da Solicitação', 22, 712), item('Dt. de Criação', 196, 712), item('Tipo Alteração', 396, 712),
    item('Z999.2026.AC.00001', 22, 698), item('10/03/2026', 196, 697), item('Indenização Serviços Prestados', 396, 697),
    item('ID do Usuário', 22, 669), item('Setor de Criação', 196, 669), item('ALTCRED de Origem', 396, 668),
    item('00.0000.00 - FULANO', 22, 654), item('12345 - ComTeste', 196, 654), item('--', 396, 654),
    item('UG Cliente', 196, 626), item('Tipo Tramitação', 23, 625), item('Origem Suplementação', 396, 625),
    item('--', 396, 610), item('Normal', 23, 607), item('12345 - ComTeste', 196, 607),
    item('Destino Destaque', 23, 532), item('UO Favorecida', 196, 532), item('Situação', 398, 532),
    item('--', 23, 517), item('--', 196, 517), item('Processada', 398, 517),
    item('Observação do Solicitante', 23, 495), item(obs, 23, 480),
    item('Célula de Débito (CDD)', 245, 444),
    ...['Moeda:24', 'PTRES:63', 'UO:114', 'Esfera:147', 'FR:201', 'ND:255', 'Plano Interno:305', 'UGR:389', 'UGE:439', 'Valor a Debitar:494'].map(c => { const [s, x] = c.split(':'); return item(s, +x, 427); }),
    item('12345 -', 384, 410, 30), item('1000000000', 181, 405, 45), item('99999 -', 434, 405, 30),
    item('R$', 32, 399, 8), item('111111', 63, 399), item('22222', 108, 399), item('1', 158, 399, 4), item('33903900', 241, 399, 40),
    item('X.1.TESTE.0', 294, 399, 70), item('ComTeste', 375, 399, 35), item('1.234,56', 502, 399, 35), item('UGETESTE', 434, 394, 35),
    item('Células de Crédito (CDC)', 241, 364),
    ...['Moeda:24', 'PTRES:63', 'UO:114', 'Esfera:147', 'FR:201', 'ND:255', 'Plano Interno:305', 'UGR:389', 'UGE:439', 'Valor a Creditar:493'].map(c => { const [s, x] = c.split(':'); return item(s, +x, 347); }),
    item('1000000000', 181, 330, 45), item('40015 -', 384, 330, 30), item('40015 -', 434, 330, 30),
    item('R$', 32, 325, 8), item('111111', 63, 325), item('22222', 108, 325), item('1', 158, 325, 4), item('33903900', 241, 325, 40),
    item('R.TESTE.0', 296, 325, 70), item('1.234,56', 502, 325, 35), item('BNIC', 388, 320, 20), item('BNIC', 438, 320, 20),
    item('Valor Total a Creditar', 383, 305), item('1.234,56', 501, 305, 35),
    item('Histórico Trâmite', 260, 272),
    item('OM', 48, 215), item('FULANO', 227, 215), item('10/03/2026', 300, 215),
    item('DGOM 20', 35, 195), item('Processamento em Batch', 100, 195), item('10/03/2026', 300, 195),
    item('DGOM 20', 35, 175), item('Processada', 128, 175), item('12/03/2026', 300, 175),
  ];
}

describe('PDF de Solicitação de Alteração de Crédito do SIPLAD', () => {
  it('lê cabeçalho, observação, células e data de situação', () => {
    const s = lerSolicitacao(paginaFicticia())!;
    expect(s.numero).toBe('Z999.2026.AC.00001');
    expect(s.dataCriacao).toBe('2026-03-10');
    expect(s.dataSituacao).toBe('2026-03-12');
    expect(s.tipoAlteracao).toBe('Indenização Serviços Prestados');
    expect(s.ugCliente).toBe('12345 - ComTeste');
    expect(s.ugClienteCodigo).toBe('12345');
    expect(s.situacao).toBe('Processada');
    expect(s.altcredOrigem).toBeNull();
    expect(s.valor).toBe(1234.56);
    expect(s.faturasCitadas).toEqual(['12346-EL-08-2026-010-0', '12346-AE-08-2026-004-0']);
    expect(s.celulas).toHaveLength(2);
    expect(s.celulas[0]).toMatchObject({ tipo: 'DEBITO', ptres: '111111', fr: '1000000000', nd: '33903900', pi: 'X.1.TESTE.0', ugr: '12345 - ComTeste', valor: 1234.56 });
    expect(s.celulas[1]).toMatchObject({ tipo: 'CREDITO', ugr: '40015 - BNIC', uge: '40015 - BNIC' });
    expect(s.avisos).toEqual([]);
  });
  it('página que não é solicitação é ignorada', () => {
    expect(lerSolicitacao([item('Relatório qualquer', 10, 10)])).toBeNull();
  });
  it('conversões', () => {
    expect(valorBR('R$ 631.965,15')).toBe(631965.15);
    expect(dataIso('em 08/04/2026')).toBe('2026-04-08');
  });
});

const fat = (o: Partial<FaturaCandidata>): FaturaCandidata => ({ id: o.numero!, numero: '', ug: '12346', cliente: 'OM', vencimento: '2026-09-30', saldo: 100, comandoId: 'c1', ...o });

describe('baixa assistida', () => {
  const faturas = [
    fat({ numero: '12346-EL-08-2026-010-0', vencimento: '2026-09-30', saldo: 500 }),
    fat({ numero: '12346-AE-07-2026-004-0', vencimento: '2026-08-31', saldo: 300 }),
    fat({ numero: '12346-TL-06-2026-001-0', vencimento: '2026-07-31', saldo: 200, contestada: true }),
    fat({ numero: '99999-EL-08-2026-001-0', ug: '99999', comandoId: 'outro', saldo: 50 }),
  ];
  it('sem destinação: faturas do comando, mais antigas primeiro, sem contestadas; sobra calculada', () => {
    const p = proporBaixa({ saldo: 1000, comandoId: 'c1' }, faturas);
    expect(p.itens.map(i => [i.numero, i.valor])).toEqual([['12346-AE-07-2026-004-0', 300], ['12346-EL-08-2026-010-0', 500]]);
    expect(p.sobra).toBe(200);
  });
  it('saldo da ALTCRED menor que as faturas: para no saldo', () => {
    const p = proporBaixa({ saldo: 350, comandoId: 'c1' }, faturas);
    expect(p.itens.map(i => i.valor)).toEqual([300, 50]);
    expect(p.sobra).toBe(0);
  });
  it('com destinação: só as faturas citadas recebem valor; as demais ficam marcadas fora da destinação', () => {
    const p = proporBaixa({ saldo: 1000, comandoId: 'c1', faturasCitadas: ['12346-EL-08-2026-010-0'] }, faturas);
    expect(p.itens[0]).toMatchObject({ numero: '12346-EL-08-2026-010-0', valor: 500, grupo: 'CITADA' });
    expect(p.itens[1]).toMatchObject({ numero: '12346-AE-07-2026-004-0', valor: 0, foraDestinacao: true });
    expect(p.sobra).toBe(500);
  });
  it('validação impede passar do saldo da fatura e do documento', () => {
    expect(validarBaixa([{ numero: 'A', valor: 120, saldoFatura: 100 }], 500)).toHaveLength(1);
    expect(validarBaixa([{ numero: 'A', valor: 100, saldoFatura: 100 }, { numero: 'B', valor: 100, saldoFatura: 100 }], 150)).toHaveLength(1);
    expect(validarBaixa([{ numero: 'A', valor: 100, saldoFatura: 100 }], 100)).toEqual([]);
  });
});

describe('tipo da baixa', () => {
  it('tipo gravado na baixa vale sobre a operação do documento', () => {
    expect(ehAdiantamento({ tipoBaixa: 'ADIANTAMENTO' }, { operation: 'PAGAMENTO' })).toBe(true);
    expect(ehAdiantamento({}, { operation: 'ADIANTAMENTO' })).toBe(true);
    expect(ehAdiantamento({ tipoBaixa: 'PAGAMENTO' }, { operation: 'ADIANTAMENTO' })).toBe(false);
    expect(aceitaAdiantamento({ operation: 'PAGAMENTO', sobraAdiantamento: true })).toBe(true);
  });
});

describe('extrato de conciliação (4 quadros)', () => {
  const docs = [
    { id: 'd1', numero: 'G1.2026.AC.00343', comando: 'DGMM', cliente: '40030 - DIM', data: '2026-08-19', valor: 44000, saldo: 3783.33, sobraAdiantamento: true, operacao: 'PAGAMENTO' },
    { id: 'd2', numero: 'G1.2026.AC.00016', comando: 'DGMM', cliente: '40030 - DIM', data: '2026-02-10', valor: 1000, saldo: 0, operacao: 'ADIANTAMENTO' },
  ];
  const faturas = [
    { id: 'f1', numero: '40030-AE-08-2026-004-0', setor: 'DGMM', cliente: 'DIM', saldo: 0 },
    { id: 'f2', numero: '40030-TC-08-2026-014-0', setor: 'DGMM', cliente: 'DIM', saldo: 0 },
    { id: 'f3', numero: '40032-DA-08-2026-010-0', setor: 'DGMM', cliente: 'NPa Mangaratiba', saldo: 2960.81 },
    { id: 'f4', numero: '40032-RB-07-2026-007-0', setor: 'DGMM', cliente: 'NPa Mangaratiba', saldo: 100, cancelada: true },
  ];
  const baixas = [
    { documentId: 'd1', invoiceId: 'f1', valor: 23542.26, adiantamento: false },
    { documentId: 'd1', invoiceId: 'f2', valor: 16674.41, adiantamento: true },
    { documentId: 'd2', invoiceId: 'f2', valor: 1000, adiantamento: true },
  ];
  it('monta os quadros como os enviados à OM', () => {
    const e = montarExtrato(docs, faturas, baixas);
    expect(e.saldoAltcred.map(x => x.numero)).toEqual(['G1.2026.AC.00016', 'G1.2026.AC.00343']);
    expect(e.totais.saldoAltcred).toBe(3783.33);
    expect(e.adiantamentos).toHaveLength(2);
    // pagamento + linha "ADIANTAMENTO" com a sobra enviada (44.000 − 23.542,26)
    expect(e.pagas).toEqual([
      { data: '2026-08-19', cliente: '40030 - DIM', altcred: 'G1.2026.AC.00343', fatura: '40030-AE-08-2026-004-0', valor: 23542.26 },
      { data: '2026-08-19', cliente: '40030 - DIM', altcred: 'G1.2026.AC.00343', fatura: 'ADIANTAMENTO', valor: 20457.74 },
    ]);
    expect(e.totais.pagas).toBe(44000);
    expect(e.abertas).toEqual([{ setor: 'DGMM', cliente: 'NPa Mangaratiba', fatura: '40032-DA-08-2026-010-0', saldo: 2960.81 }]);
  });
  it('subtotais por chave', () => {
    const l = comSubtotais([{ a: 'X', v: 1 }, { a: 'X', v: 2 }, { a: 'Y', v: 3 }], 'a', 'v', k => `${k} Total`);
    expect(l.filter(x => x._subtotal).map(x => [x.a, x.v])).toEqual([['X Total', 3], ['Y Total', 3]]);
  });
});

describe('auditoria (2.6)', () => {
  const f = (id: string, n: string, omId = 'om1') => ({ id, invoiceNumber: n, value: 100, issueDate: '2026-09-15', dueDate: '2026-09-29', monthCompetence: 8, yearCompetence: 2026, serviceAcronym: n.split('-')[1], omId });
  it('baixa fora da destinação e baixa sem documento', () => {
    const r = avaliarPontos(
      [f('f1', '12346-EL-08-2026-010-0'), f('f2', '12346-AE-08-2026-004-0')],
      [{ id: 'd1', documentNumber: 'Z1', documentType: 'ALTCRED', totalValue: 500, operation: 'PAGAMENTO', destinacao: [{ tipo: 'FATURA', valor: '12346-EL-08-2026-010-0' }] }],
      [{ documentId: 'd1', invoiceId: 'f1', amount: 100 }, { documentId: 'd1', invoiceId: 'f2', amount: 50 }, { documentId: 'sumiu', invoiceId: 'f2', amount: 50 }],
    );
    expect(r.documentos.get('d1')!.map(p => p.tipo)).toEqual(['BAIXA_FORA_DESTINACAO']);
    expect(r.documentos.get('d1')![0].mensagem).toContain('12346-AE-08-2026-004-0');
    expect(r.faturas.get('f2')!.map(p => p.tipo)).toContain('BAIXA_SEM_DOCUMENTO');
  });
});

import { listaAdiantamentos, resumoPorCliente } from '../utils/adiantamentos';
import { planejarMigracao, planilhasVazias } from '../utils/faturasImport';

describe('adiantamentos (abas ADIANTAMENTOS e RESUMO ADIANTAMENTO)', () => {
  const docs = [
    { id: 'a', documentNumber: 'ADT1', client: 'DIM', sector: 'DGMM', command: '40030', date: '2026-02-26', totalValue: 1000, operation: 'ADIANTAMENTO' },
    { id: 'p', documentNumber: 'PAG1', client: 'DIM', sector: 'DGMM', command: '40030', date: '2026-08-19', totalValue: 44000, operation: 'PAGAMENTO', sobraAdiantamento: true },
    { id: 'x', documentNumber: 'PAG2', client: 'ETAM', sector: 'DGMM', command: '40030', date: '2026-08-19', totalValue: 500, operation: 'PAGAMENTO' },
  ];
  const fat = [{ id: 'f1', invoiceNumber: 'F1', client: 'DIM' }, { id: 'f2', invoiceNumber: 'F2', client: 'DIM' }, { id: 'fc', invoiceNumber: 'FC', client: 'DIM', isCanceled: true }];
  const bx = [
    { id: 'b1', documentId: 'p', invoiceId: 'f1', amount: 23542.26, date: '2026-08-19', tipoBaixa: 'PAGAMENTO' as const },
    { id: 'b2', documentId: 'p', invoiceId: 'f2', amount: 16674.41, date: '2026-08-20', tipoBaixa: 'ADIANTAMENTO' as const },
    { id: 'b3', documentId: 'a', invoiceId: 'f2', amount: 300, date: '2026-03-01' },
    { id: 'b4', documentId: 'a', invoiceId: 'fc', amount: 100, date: '2026-03-01' },
  ];
  it('enviado, utilizado e saldo por ALTCRED (sobra = valor − pagamentos; cancelada não conta)', () => {
    const l = listaAdiantamentos(docs, bx, fat);
    expect(l.map(x => x.numero)).toEqual(['ADT1', 'PAG1']);
    expect(l[0]).toMatchObject({ origem: 'ADIANTAMENTO', enviado: 1000, utilizado: 300, saldo: 700 });
    expect(l[1]).toMatchObject({ origem: 'SOBRA', enviado: 20457.74, utilizado: 16674.41, saldo: 3783.33 });
    expect(l[1].usos.map(u => u.fatura)).toEqual(['F2']);
    const g = resumoPorCliente(l);
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ cliente: 'DIM', saldo: 4483.33 });
  });
});

describe('migração: aba ADIANTAMENTOS e livro consolidado', () => {
  const ctx = {
    resolverOM: () => null, resolverComando: () => null, servicos: [], feriados: [], prazoDiasUteis: 10,
    faturasExistentes: new Set<string>(), documentosExistentes: new Set<string>(), hoje: '2026-11-07',
    novoId: (() => { let i = 0; return () => `id${++i}`; })(),
  };
  const montar = () => {
    const p = planilhasVazias();
    p.faturas.push([['SETOR', 'COMANDO', 'Cliente', 'Fatura', 'Valor', 'Data Emis.', 'Data Venc.', 'STATUS'],
      ['DGMM', '40030 - DIM', 'DIM', '40030-EL-08-2026-010-0', 100, 46280, 46295, 'PAGO']]);
    p.altcred.push([['Data de situação', 'COMANDO', 'Cliente', 'NºALTCRED', 'TIPO', 'Valor ALTCRED', 'VALOR UTILIZADO'],
      [46253, 'DGMM', '40030 - DIM', 'G1.2026.AC.00001', 'PAGAMENTO', 500, 500]]);
    p.lancamentos.push([['Data de situação', 'COMANDO', 'CLIENTE', 'NºALTCRED', 'NºFATURA', 'VALOR UTILIZADO'],
      [46253, 'DGMM', '40030 - DIM', 'G1.2026.AC.00001', '40030-EL-08-2026-010-0', 100],
      [46253, 'DGMM', '40030 - DIM', 'G1.2026.AC.00001', 'ADIANTAMENTO', 400]]);
    p.resumoAdiantamento.push([['DATA', 'COMANDO', 'CLIENTE', 'ALTCRED', 'FATURA', 'VALOR'],
      [46260, 'DGMM', '40030 - DIM', 'G1.2026.AC.00001', '40030-TC-05-2026-014-0', 250],
      [46260, 'DGMM', '40030 - DIM', 'G9.2026.AC.00009', '40030-TC-05-2026-014-0', 50]]);
    p.adiantamentos.push([['Data de situação', 'COMANDO', 'Cliente', 'Nº ALTCRED', 'TIPO', 'Valor ALTCRED', 'VALOR UTILIZADO', 'SALDO'],
      [46253, 'DGMM', '40030 - DIM', 'G1.2026.AC.00001', 'ADIANTAMENTO', 400, 250, 150],
      [46300, 'DGMM', '40030 - DIM', 'G8.2026.AC.00008', 'ADIANTAMENTO', 1000, 0, 1000]]);
    // fatura só no consolidado do ano (não está na aba do mês)
    p.livroConsolidado.push([['SETOR', 'COMANDO', 'CLIENTE', 'FATURA', 'Valor serv. prest.', 'Valor do adiantamento', 'Valor final', 'Data Emis.', 'Data Venc.'],
      ['DGMM', '40030 - DIM', 'DIM', '40030-TC-05-2026-014-0', 300, 300, 0, 46188, 46218]]);
    return p;
  };
  it('lê o consolidado, marca a sobra, cria ALTCRED só da aba ADIANTAMENTOS e confere saldos', () => {
    const plano = planejarMigracao(montar(), ctx);
    const tc = plano.faturas.find(f => f.numero === '40030-TC-05-2026-014-0');
    expect(tc).toMatchObject({ valor: 300 });
    expect(plano.documentos.find(d => d.numero === 'G1.2026.AC.00001')!.sobraAdiantamento).toBe(true);
    expect(plano.documentos.find(d => d.numero === 'G8.2026.AC.00008')).toMatchObject({ operacao: 'ADIANTAMENTO', valor: 1000 });
    expect(plano.resumo.conferidasAdiant).toBe(2);
    expect(plano.resumo.saldoAdiantPlanilha).toBe(1150);
    // G9 usada no RESUMO sem constar em ADIANTAMENTOS
    expect(plano.avisos.find(a => a.tipo === 'ADIANTAMENTO_NAO_ENVIADO')!.exemplos).toEqual(['G9.2026.AC.00009']);
  });
  it('migração complementar liga baixas novas a documentos já gravados, sem duplicar', () => {
    const p1 = planejarMigracao(montar(), ctx);
    const docs = new Map(p1.documentos.map(d => [d.numero, d.id]));
    const ja = p1.faturas.filter(f => f.numero !== '40030-TC-05-2026-014-0');
    const p2 = planejarMigracao(montar(), { ...ctx, faturasExistentes: new Set(ja.map(f => f.numero)), documentosExistentes: new Set(docs.keys()), idFaturaExistente: n => ja.find(f => f.numero === n)?.id, idDocumentoExistente: n => docs.get(n) });
    expect(p2.faturas.map(f => f.numero)).toEqual(['40030-TC-05-2026-014-0']);
    expect(p2.baixas.map(b => [b.documentoId, b.valor])).toEqual([[docs.get('G1.2026.AC.00001'), 250], [docs.get('G9.2026.AC.00009'), 50]]);
    expect(p2.resumo.baixasEmExistentes).toBe(2);
  });
});

describe('extrato pelas faturas do escopo (pagador de outra UG)', () => {
  it('o pagamento feito por outro pagador aparece no extrato da OM dona da fatura', () => {
    const docArsenal = { id: 'd1', numero: 'AC-ARSENAL', comando: '41000 - Arsenal', cliente: 'Arsenal', data: '2026-08-01', valor: 1000, saldo: 0, operacao: 'PAGAMENTO' };
    const docRt = { id: 'd2', numero: 'B4D0.2026.AC.00824', comando: '40001 - RT DGMM', cliente: '40001 - RT DGMM', data: '2026-08-19', valor: 5000, saldo: 0, operacao: 'PAGAMENTO' };
    const fat = [{ id: 'f1', numero: '41000-AE-09-2025-001-0', setor: 'DGMM', cliente: 'Arsenal', saldo: 0 }, { id: 'f2', numero: '41000-EL-09-2025-001-0', setor: 'DGMM', cliente: 'Arsenal', saldo: 0 }];
    const bx = [{ documentId: 'd1', invoiceId: 'f1', valor: 1000, adiantamento: false }, { documentId: 'd2', invoiceId: 'f2', valor: 5000, adiantamento: false }, { documentId: 'd2', invoiceId: 'outra-om', valor: 7, adiantamento: false }];
    const antigo = montarExtrato([docArsenal], fat, bx);
    expect(antigo.pagas.map(p => p.altcred)).toEqual(['AC-ARSENAL']); // antes: só a ALTCRED da própria UG
    const novo = montarExtrato([docArsenal], fat, bx, undefined, { porFaturasDoEscopo: true, todosDocs: [docArsenal, docRt] });
    expect(novo.pagas.map(p => [p.altcred, p.cliente, p.valor])).toEqual([['AC-ARSENAL', 'Arsenal', 1000], ['B4D0.2026.AC.00824', '40001 - RT DGMM', 5000]]);
    expect(novo.totais.pagas).toBe(6000);                     // a baixa do RT DGMM em fatura de outra OM não entra
    expect(novo.saldoAltcred.map(x => x.numero)).toEqual(['AC-ARSENAL']); // saldo ALTCRED continua só das ALTCRED da OM
  });
});
