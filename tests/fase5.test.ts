import { describe, it, expect } from 'vitest';
import {
  FaturaAberta, pivo, quadroAberto, dividaPorCondomino, faixaDe, mensagemCobranca, condominioPorRubrica, percentuais,
  entradasPorCategoria, categoriaDaSaida, saldoMensal, lerNE, classificarRubrica,
} from '../utils/relatorios';

const f = (o: Partial<FaturaAberta>): FaturaAberta => ({ id: o.numero!, numero: '', setor: 'DGMM', comando: '40030 - DIM', cliente: 'DIM', tipo: 'ELETRICIDADE', ano: 2026, mes: 8, vencimento: '2026-09-29', saldo: 100, ...o });

describe('quadro de faturas em aberto (5.1)', () => {
  const fs = [
    f({ numero: 'a', setor: 'CGCFN', tipo: 'TAXA CONDOMINIAL', ano: 2025, vencimento: '2025-11-30', saldo: 190445.34 }),
    f({ numero: 'b', setor: 'COMOPNAV', tipo: 'ÁGUA E ESGOTO', ano: 2025, vencimento: '2025-02-28', saldo: 9221.56 }),
    f({ numero: 'c', ano: 2026, vencimento: '2026-09-29', saldo: 1000 }),
    f({ numero: 'd', ano: 2026, vencimento: '2026-11-30', saldo: 500 }),
  ];
  it('vencidas por exercício, a vencer e total; pivô setor × tipo', () => {
    const q = quadroAberto(fs, '2026-11-05');
    expect(q.porExercicio.map(e => [e.ano, e.faturas.length])).toEqual([[2025, 2], [2026, 1]]);
    expect(q.aVencer.map(x => x.numero)).toEqual(['d']);
    const p = pivo(q.porExercicio[0].faturas, x => x.setor, x => x.tipo);
    expect(p.valores.CGCFN['TAXA CONDOMINIAL']).toBe(190445.34);
    expect(p.total).toBe(199666.9);
    expect(p.colunas).toEqual(['TAXA CONDOMINIAL', 'ÁGUA E ESGOTO']);
  });
  it('idade da dívida por condômino', () => {
    expect([faixaDe(-3), faixaDe(10), faixaDe(200), faixaDe(400)]).toEqual(['A vencer', '1–30 dias', '181–365 dias', 'Mais de 1 ano']);
    const d = dividaPorCondomino(fs, '2026-11-05');
    expect(d[0]).toMatchObject({ cliente: 'DIM', total: 201166.9, qtd: 4 });
    expect(d[0].porFaixa['Mais de 1 ano']).toBe(9221.56);       // 28/02/2025: 615 dias
    expect(d[0].porFaixa['181–365 dias']).toBe(190445.34);      // 30/11/2025: 340 dias
    expect(d[0].porFaixa['A vencer']).toBe(500);
    expect(d[0].maisAntiga).toBe('2025-02-28');
  });
  it('mensagem de cobrança no padrão da Base Naval, com as datas da posição e do prazo', () => {
    const t = mensagemCobranca({ nome: 'DIM', indicativo: 'DIMRJ' }, [fs[2]], '2026-08-18', '2026-11-18');
    expect(t).toMatch(/^PARA: DIMRJ\nDE: BNIC\nBT\nA fim de auxiliar no controle das faturas em aberto das OM apoiadas por esta Base Naval, PTC:/);
    expect(t).toContain('ALFA) Enviado, anexo a esta mensagem, extrato das dívidas em aberto até 18AGO; e');
    expect(t).toContain('BRAVO) Indicar recurso na AI R.901.16 / ND33.90.39 / AO 2000 (administração da unidade) ou 21A0 (aprestamento das forças), conforme observada a Circular nº 7/2026 da SGM.');
    expect(t).toContain('CHARLIE) A indicação dos respectivos créditos deverá ser realizada até 18NOV2026.');
    expect(t).toContain('- CC (IM) Caroline - Tel: 8110-4790;');
    expect(t).toContain('- 2º SG-AD Tamara / 3º SG-EN Marcele La Cerda - Tel: 8110-3764; ou');
    expect(t).toContain('com cópia para tamara.nascimento@marinha.mil.br e marcele.campello@marinha.mil.br\nBT');
  });
  it('prazo padrão: 30 dias depois da posição', () => {
    expect(mensagemCobranca({ nome: 'DIM', indicativo: 'DIMRJ' }, [], '2026-11-10')).toContain('realizada até 10DEZ2026.');
  });
});

describe('condomínio por rubrica (5.4 / 5A.4)', () => {
  const rs = [{ ano: 2026, numero: 1, descricao: 'Telhados', valorAnual: 146096.92 }, { ano: 2026, numero: 12, descricao: 'Varrição', valorAnual: 3410647.40 }, { ano: 2026, numero: 2, descricao: 'Marquises', valorAnual: 0 }];
  it('%RUB = participação no total; TC recebida distribuída; saldo em conta e a receber', () => {
    const p = percentuais(rs);
    expect(Math.round(p.get(1)! * 100) / 100).toBe(4.11);
    const r = condominioPorRubrica(rs, 100000, new Map([[12, 340722.60]]));
    const v = r.linhas.find(l => l.numero === 12)!;
    expect(v.tcRecebida).toBe(95892.4);
    expect(v.saldoEmConta).toBeCloseTo(95892.4 - 340722.60, 2);
    expect(v.aReceber).toBeCloseTo(3410647.40 - 95892.4, 2);
    expect(r.total.tcRecebida).toBe(100000);
  });
});

describe('disponível R.901.16 e saldo mensal (5A)', () => {
  it('entradas por categoria pelas faturas pagas; sobra sem indicação', () => {
    const e = entradasPorCategoria([{ id: 'd1', valor: 1000 }, { id: 'd2', valor: 300 }], [
      { documentId: 'd1', amount: 600, sigla: 'EL' }, { documentId: 'd1', amount: 100, sigla: 'TC' }, { documentId: 'd2', amount: 300, sigla: 'AE' }, { documentId: 'outro', amount: 999, sigla: 'EL' },
    ]);
    expect(e).toEqual({ ENERGIA: 600, AGUA: 300, TELEFONIA: 0, CONDOMINIO: 100, SEM_INDICACAO: 300 });
    expect([categoriaDaSaida({ rubricaNumero: 14 }), categoriaDaSaida({ categoria: 'AGUA' }), categoriaDaSaida({ categoria: 'OUTROS' })]).toEqual(['CONDOMINIO', 'AGUA', 'SEM_INDICACAO']);
  });
  it('saldo mensal: transporta entre os meses e zera na virada do ano (janeiro começa do zero)', () => {
    const movs = [{ data: '2025-12-10', tipo: 'ENTRADA' as const, valor: 1000 }, { data: '2026-01-05', tipo: 'SAIDA' as const, valor: 300 }, { data: '2026-03-01', tipo: 'ENTRADA' as const, valor: 50 }];
    expect(saldoMensal(movs, '2026-01', '2026-03').map(x => [x.mes, x.saldoAnterior, x.saldo])).toEqual([['2026-01', 0, -300], ['2026-02', -300, -300], ['2026-03', -300, -250]]);
    // começando no meio do ano: traz só o saldo do próprio exercício
    expect(saldoMensal(movs, '2026-02', '2026-03')[0].saldoAnterior).toBe(-300);
    // período que atravessa o ano: dezembro termina com 1000 e janeiro recomeça do zero
    expect(saldoMensal(movs, '2025-12', '2026-01').map(x => [x.mes, x.saldoAnterior, x.saldo])).toEqual([['2025-12', 0, 1000], ['2026-01', 0, -300]]);
  });
});

describe('notas de empenho', () => {
  it('valida o número e classifica a rubrica digitada', () => {
    expect(lerNE('740015000012026NE000122')).toEqual({ ug: '740015', gestao: '00001', ano: 2026, numero: '000122' });
    expect(lerNE('2026NE122')).toBeNull();
    expect(classificarRubrica('14')).toEqual({ rubricaNumero: 14, categoria: 'CONDOMINIO' });
    expect(classificarRubrica('Água e Esgoto')).toEqual({ rubricaNumero: null, categoria: 'AGUA' });
    expect(classificarRubrica('Energia Elétrica').categoria).toBe('ENERGIA');
  });
});
