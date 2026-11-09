import { describe, expect, it } from 'vitest';
import {
  BaixaGer, CRITERIOS_PADRAO, FaturaGer, LinhaAtividade, SEM_USUARIO, agregarAtividade, agruparFR, analisarContestacoes, atrasoDe, baixasPorFatura, criteriosDe, faixaDeDias,
  faturadoRecebido, fimDoMes, gerarAlertas, indicadores, linhasOM, mesesEntre, ordenarOM, recuperacao, resumoContestacoes, saldoNaData, serieInadimplencia, situacoesDaOM, somaDias,
} from '../utils/painelGerencial';
import { Contestacao } from '../utils/fase4';

const HOJE = '2026-11-10';
const C = CRITERIOS_PADRAO;
let n = 0;
const fat = (o: Partial<FaturaGer> & { total: number }): FaturaGer => ({
  id: `f${++n}`, numero: `N${n}`, cliente: 'OM A', setor: 'S1', comando: 'CMD1', tipo: 'EL', ano: 2026, mes: 1, emissao: '2026-01-10', vencimento: '2026-02-10',
  pago: 0, saldo: o.total, cancelada: false, contestada: false, omId: 'a', extra: false, quitadaExterna: false, quitadaEm: null, pontos: 0, ...o,
});
const bx = (invoiceId: string, valor: number, data: string, extra: Partial<BaixaGer> = {}): BaixaGer => ({ invoiceId, docId: `d-${invoiceId}-${data}`, valor, data, adiantamento: false, ...extra });

describe('faixas e datas', () => {
  it('faixas de atraso', () => {
    expect([0, 1, 30, 31, 90, 91, 180, 181, 365, 366].map(faixaDeDias)).toEqual(['A vencer', '1–30 dias', '1–30 dias', '31–90 dias', '31–90 dias', '91–180 dias', '91–180 dias', '181–365 dias', '181–365 dias', 'Mais de 365 dias']);
    expect(atrasoDe({ vencimento: '2026-11-01' }, HOJE)).toBe(9);
    expect(atrasoDe({ vencimento: '2026-12-01' }, HOJE)).toBe(0);
  });
  it('meses e fim de mês', () => {
    expect(mesesEntre('2025-11', '2026-02')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
    expect(fimDoMes('2026-02')).toBe('2026-02-28'); expect(fimDoMes('2024-02')).toBe('2024-02-29'); expect(somaDias('2026-03-01', -1)).toBe('2026-02-28');
  });
  it('critérios: usa os parâmetros e cai no padrão quando vazios ou inválidos', () => {
    expect(criteriosDe({}).diasCritico).toBe(365);
    expect(criteriosDe({ painel_dias_critico: '200', painel_crescimento_minimo: '5000,5', dias_saldo_parado: 'x' })).toMatchObject({ diasCritico: 200, crescimentoMinimo: 5000.5, diasSaldoParado: 60 });
  });
});

describe('saldo numa data (histórico)', () => {
  const f = fat({ total: 1000, saldo: 0, vencimento: '2026-03-10' });
  const idx = baixasPorFatura([bx(f.id, 400, '2026-04-05'), bx(f.id, 600, '2026-06-20')]);
  it('reconstrói pelo calendário das baixas; de hoje em diante vale o saldo real', () => {
    expect(saldoNaData(f, '2026-03-31', idx, HOJE)).toBe(1000);
    expect(saldoNaData(f, '2026-04-30', idx, HOJE)).toBe(600);
    expect(saldoNaData(f, '2026-06-30', idx, HOJE)).toBe(0);
    expect(saldoNaData({ ...f, saldo: 123 }, HOJE, idx, HOJE)).toBe(123);
  });
  it('fatura ainda não emitida, cancelada e quitada externamente', () => {
    expect(saldoNaData(fat({ total: 500, emissao: '2026-05-01' }), '2026-04-30', new Map(), HOJE)).toBe(0);
    expect(saldoNaData(fat({ total: 500, cancelada: true, saldo: 0 }), '2026-04-30', new Map(), HOJE)).toBe(0);
    const q = fat({ total: 500, saldo: 0, quitadaExterna: true, quitadaEm: '2026-05-10', vencimento: '2026-03-01' });
    expect(saldoNaData(q, '2026-05-09', new Map(), HOJE)).toBe(500);
    expect(saldoNaData(q, '2026-05-10', new Map(), HOJE)).toBe(0);
    const sem = fat({ total: 500, saldo: 0, quitadaExterna: true, quitadaEm: null, vencimento: '2026-03-01' }); // sem data: pago no vencimento
    expect(saldoNaData(sem, '2026-03-15', new Map(), HOJE)).toBe(0);
  });
});

describe('evolução da inadimplência: o último ponto é a posição de hoje', () => {
  const a = fat({ total: 1000, saldo: 600, vencimento: '2026-05-10', ano: 2026, mes: 4 });
  const b = fat({ total: 200, saldo: 200, vencimento: '2026-12-10', mes: 10 });
  const c = fat({ total: 300, saldo: 300, vencimento: '2026-08-10', contestada: true });
  const idx = baixasPorFatura([bx(a.id, 400, '2026-07-15')]);
  const serie = serieInadimplencia([a, b, c], idx, HOJE, '2026-11', 6);
  it('seis meses até novembro', () => expect(serie.map(s => s.mes)).toEqual(['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11']));
  it('antes do pagamento o vencido era 1000; depois, 600; contestada nunca entra', () => {
    expect(serie.find(s => s.mes === '2026-06')!.vencido).toBe(1000);
    expect(serie.find(s => s.mes === '2026-07')!.vencido).toBe(600);
    expect(serie.every(s => s.vencido <= 1000)).toBe(true);
  });
  it('último ponto = hoje (mesmo valor do painel: só a "a" está vencida e em aberto)', () => {
    const u = serie[serie.length - 1];
    expect(u.data).toBe(HOJE); expect(u.vencido).toBe(600); expect(u.emAberto).toBe(800); // 600 vencida + 200 a vencer; contestada fora
  });
});

describe('faturado × recebido', () => {
  const f1 = fat({ total: 1000, ano: 2026, mes: 1 }), f2 = fat({ total: 500, ano: 2026, mes: 2 }), f3 = fat({ total: 999, ano: 2026, mes: 2, cancelada: true, saldo: 0 });
  // dinheiro que entrou (ALTCRED/GRU pela data do documento): o de março paga fatura de janeiro; o de fevereiro inclui um adiantamento ainda não usado
  const rec = [{ id: 'd1', valor: 1000, data: '2026-03-05', omId: 'a' }, { id: 'd2', valor: 200, data: '2026-02-20', omId: 'a' }, { id: 'd3', valor: 50, data: '2026-02-21', omId: 'a' }];
  const s = faturadoRecebido([f1, f2, f3], rec, '2026-01', '2026-04');
  it('faturado pela competência (sem canceladas) e recebido pela data do documento (pagamento de competência anterior entra no mês do recebimento)', () => {
    expect(s.map(p => p.faturado)).toEqual([1000, 500, 0, 0]);
    expect(s.map(p => p.recebido)).toEqual([0, 250, 1000, 0]);
    expect(s[2].diferenca).toBe(-1000);
    expect(s[1].qtdRecebimentos).toBe(2);
  });
  it('trimestral e anual somam', () => {
    expect(agruparFR(s, 'trimestral').map(p => [p.mes, p.faturado, p.recebido])).toEqual([['2026 T1', 1500, 1250], ['2026 T2', 0, 0]]);
    expect(agruparFR(s, 'anual')[0]).toMatchObject({ mes: '2026', faturado: 1500, recebido: 1250 });
  });
});

describe('recuperação do estoque vencido', () => {
  const a = fat({ total: 1000, saldo: 500, vencimento: '2026-08-01' });
  const b = fat({ total: 400, saldo: 400, vencimento: '2026-10-20' }); // venceu depois do início: fora do estoque
  const c = fat({ total: 300, saldo: 300, vencimento: '2026-07-01', contestada: true });
  const bs = [bx(a.id, 500, '2026-10-15'), bx(b.id, 100, '2026-10-25')];
  const idx = baixasPorFatura(bs);
  it('só conta o que já estava vencido na véspera do período', () => {
    const r = recuperacao([a, b, c], bs, idx, '2026-10-01', '2026-10-31', HOJE);
    expect(r).toEqual({ elegivel: 1000, recuperado: 500, pct: 50 });
  });
  it('baixa com adiantamento também reduz a dívida vencida e conta como recuperação', () => {
    const bs2 = [bx(a.id, 300, '2026-10-15'), bx(a.id, 200, '2026-10-16', { adiantamento: true })];
    expect(recuperacao([a], bs2, baixasPorFatura(bs2), '2026-10-01', '2026-10-31', HOJE)).toMatchObject({ elegivel: 1000, recuperado: 500, pct: 50 });
  });
  it('sem estoque, percentual indefinido', () => expect(recuperacao([b], bs, idx, '2026-10-01', '2026-10-31', HOJE).pct).toBeNull());
});

describe('indicadores e situação das OM', () => {
  const venc400 = fat({ total: 1000, saldo: 1000, vencimento: '2025-09-01', ano: 2025, mes: 8, omId: 'a', cliente: 'OM A' });   // > 365 dias
  const venc100 = fat({ total: 500, saldo: 500, vencimento: '2026-07-20', mes: 6, omId: 'b', cliente: 'OM B' });                  // ~113 dias
  const venc10 = fat({ total: 200, saldo: 200, vencimento: '2026-10-31', mes: 10, omId: 'c', cliente: 'OM C' });                  // 10 dias
  const aVencer = fat({ total: 300, saldo: 300, vencimento: '2026-12-10', mes: 11, omId: 'c', cliente: 'OM C' });
  const contest = fat({ total: 700, saldo: 700, vencimento: '2026-01-10', contestada: true, omId: 'd', cliente: 'OM D' });
  const paga = fat({ total: 900, saldo: 0, pago: 900, mes: 3, omId: 'e', cliente: 'OM E' });
  const cancel = fat({ total: 150, saldo: 0, cancelada: true, mes: 3, omId: 'e', cliente: 'OM E' });
  const fs = [venc400, venc100, venc10, aVencer, contest, paga, cancel];
  const bs = [bx(paga.id, 900, '2026-04-10')];
  const idx = baixasPorFatura(bs);
  const rec = [{ id: 'd1', valor: 900, data: '2026-04-10', omId: 'e' }, { id: 'd2', valor: 100, data: '2025-12-10', omId: 'e' }]; // o de dezembro/2025 fica fora do período
  const ind = indicadores(fs, bs, idx, { de: '2026-01', ate: '2026-11' }, HOJE, C, rec);

  it('em aberto e vencido seguem o painel inicial: contestada fora, % = vencido ÷ em aberto', () => {
    expect(ind.faturamento.emAberto).toEqual({ valor: 2000, qtd: 4 });
    expect(ind.cobranca.vencido).toEqual({ valor: 1700, qtd: 3 });
    expect(ind.cobranca.pctInadimplencia).toBe(85); expect(ind.cobranca.omInadimplentes).toBe(3);
    expect(ind.contestadas).toEqual({ valor: 700, qtd: 1 });
  });
  it('faixas, > 90 e > 365 dias', () => {
    const f = Object.fromEntries(ind.cobranca.faixas.map(x => [x.faixa, x.valor]));
    expect(f['Mais de 365 dias']).toBe(1000); expect(f['91–180 dias']).toBe(500); expect(f['1–30 dias']).toBe(200); expect(f['A vencer']).toBe(300);
    expect(ind.cobranca.mais90.valor).toBe(1500); expect(ind.cobranca.mais365.valor).toBe(1000);
    expect(ind.cobranca.prazoMedio).toBe(Math.round((1000 * atrasoDe(venc400, HOJE) + 500 * atrasoDe(venc100, HOJE) + 200 * 10) / 1700));
  });
  it('faturado do período (sem canceladas), canceladas à parte e recebido pela data do documento', () => {
    expect(ind.faturamento.canceladas).toEqual({ valor: 150, qtd: 1 });
    expect(ind.faturamento.faturado.qtd).toBe(5); // 7 faturas menos a cancelada e a de competência 2025
    expect(ind.recebimentos.recebido).toEqual({ valor: 900, qtd: 1 });
  });

  const linhas = linhasOM(fs, idx, HOJE, C, f => (f.cliente === 'OM B' ? 250 : 0));
  const por = (nome: string) => linhas.find(l => l.cliente === nome)!;
  it('linha por OM: vencido, faixas, contestado, atraso médio e saldo parado', () => {
    expect(por('OM A')).toMatchObject({ emAberto: 1000, vencido: 1000, qtdVencidas: 1, v365: 1000, v90: 1000 });
    expect(por('OM C')).toMatchObject({ emAberto: 500, vencido: 200, pctInad: 40, atrasoMedio: 10 });
    expect(por('OM D')).toMatchObject({ emAberto: 0, vencido: 0, contestado: 700, qtdContestadas: 1 });
    expect(por('OM B').saldoParado).toBe(250);
    expect(linhas.find(l => l.cliente === 'OM E')!.emAberto).toBe(0); // cancelada não entra
  });
  it('ordenação por critérios', () => {
    expect(ordenarOM(linhas, 'vencido')[0].cliente).toBe('OM A');
    expect(ordenarOM(linhas, 'contestado')[0].cliente).toBe('OM D');
    expect(ordenarOM(linhas, 'saldoParado')[0].cliente).toBe('OM B');
    expect(ordenarOM(linhas, 'atrasoMedio')[0].cliente).toBe('OM A');
    expect(ordenarOM(linhas, 'cliente', true)[0].cliente).toBe('OM A');
  });
  it('situações não exclusivas', () => {
    const s = (nome: string) => situacoesDaOM(por(nome), C);
    expect(s('OM A')).toMatchObject({ criticos: true, recentes: false, semVencidos: false });
    expect(s('OM C')).toMatchObject({ recentes: true, criticos: false });
    expect(s('OM D')).toMatchObject({ semVencidos: true, contestacoes: true });
    expect(s('OM B')).toMatchObject({ criticos: true, pendencias: true }); // vencida há > 90 dias e com saldo parado: duas situações ao mesmo tempo
  });
  it('variação em 30 dias', () => {
    const antes = somaDias(HOJE, -30);
    const l = linhasOM([fat({ total: 1000, saldo: 1000, vencimento: '2026-10-25', omId: 'z', cliente: 'OM Z' })], new Map(), HOJE, C)[0];
    expect(antes).toBe('2026-10-11');
    expect(l).toMatchObject({ vencido: 1000, vencidoAntes: 0, variacao: 1000, variacaoPct: null }); // venceu depois de 11/10: não era vencida antes
  });

  describe('alertas', () => {
    const cobr = [{ faturas: [venc400.numero], enviadaEm: '2026-11-01' }];
    const al = gerarAlertas({ fs, linhas, hoje: HOJE, c: C, contest: [], parados: [{ cliente: 'OM B', valor: 250, dias: 80, ultimo: '2026-08-20' }], cobrancas: cobr });
    it('classifica por prioridade e traz OM, valor, quantidade, tempo e última movimentação', () => {
      const v365 = al.find(a => a.id === 'venc365')!;
      expect(v365).toMatchObject({ prioridade: 'critico', om: 'OM A', valor: 1000, qtd: 1 }); expect(v365.dias).toBe(atrasoDe(venc400, HOJE)); expect(v365.ultimaMov).toBeTruthy();
      expect(al.find(a => a.id === 'venc90')).toMatchObject({ prioridade: 'atencao', om: 'OM B', valor: 500 });
      expect(al.find(a => a.id === 'maior')).toMatchObject({ prioridade: 'info', om: 'OM A' });
      expect(al.find(a => a.id === 'parados')).toMatchObject({ prioridade: 'atencao', valor: 250, qtd: 1 });
      expect(al[0].prioridade).toBe('critico');
    });
    it('"sem cobrança registrada" só aparece quando já existe cobrança registrada no sistema', () => {
      expect(al.find(a => a.id === 'sem-cobranca')).toMatchObject({ qtd: 1, om: 'OM B' }); // venc400 foi cobrada; venc100 (> 30 dias) não
      expect(gerarAlertas({ fs, linhas, hoje: HOJE, c: C, contest: [], parados: [], cobrancas: [] }).some(a => a.id === 'sem-cobranca')).toBe(false);
    });
    it('critérios configuráveis mudam o resultado', () => {
      const alto = gerarAlertas({ fs, linhas, hoje: HOJE, c: { ...C, diasCritico: 500, diasAtencao: 200 }, contest: [], parados: [], cobrancas: [] });
      expect(alto.find(a => a.id === 'venc365')).toBeUndefined(); expect(alto.find(a => a.id === 'venc90')).toMatchObject({ valor: 1000 });
    });
  });
});

describe('contestações', () => {
  const f1 = fat({ id: 'i1', total: 1000, saldo: 1000, contestada: true, cliente: 'OM A' });
  const f2 = fat({ id: 'i2', total: 500, saldo: 0, cliente: 'OM B' });
  const f3 = fat({ id: 'i3', total: 300, saldo: 300, contestada: true, cliente: 'OM C' });
  const mapa = new Map([f1, f2, f3].map(f => [f.id, f]));
  const ev = (em: string, acao: string) => ({ em, por: 'x', acao });
  const base = { anexos: [], justificativa: 'j', origem: 'o', numeroFatura: 'n' };
  const cs: Contestacao[] = [
    { ...base, id: 'c1', invoiceId: 'i1', abertaEm: '2026-08-01', status: 'ENCAMINHADA', prazo: '2026-09-01', historico: [ev('2026-08-01', 'ABERTA'), ev('2026-08-10', 'ENCAMINHADA')] },
    { ...base, id: 'c2', invoiceId: 'i2', abertaEm: '2026-09-01', status: 'ENCERRADA', decididaEm: '2026-09-11', decisao: 'RATIFICADA', historico: [ev('2026-09-01', 'ABERTA'), ev('2026-09-11', 'DECIDIDA')] },
    { ...base, id: 'c3', invoiceId: 'i3', abertaEm: '2026-11-05', status: 'ABERTA', historico: [ev('2026-11-05', 'ABERTA')] },
    { ...base, id: 'c4', invoiceId: 'sumiu', abertaEm: '2026-11-05', status: 'ABERTA', historico: [] },
  ];
  const l = analisarContestacoes(cs, mapa, HOJE);
  const p = { de: '2026-01', ate: '2026-11' };
  const r = resumoContestacoes(l, p, C);
  it('ignora contestação de fatura fora do recorte; calcula dias, parada e prazo', () => {
    expect(l.length).toBe(3);
    const a = l.find(x => x.c.id === 'c1')!;
    expect(a).toMatchObject({ aberta: true, diasAberta: 101, diasParada: 92, prazoVencido: true, faixa: 'Mais de 60 dias', valor: 1000, ultimoMov: '2026-08-10' });
    expect(l.find(x => x.c.id === 'c3')).toMatchObject({ diasAberta: 5, faixa: 'Até 7 dias', prazoVencido: false });
  });
  it('resumo: abertas, valor, tempo médio de resolução e resolvidas no período', () => {
    expect(r.abertas.length).toBe(2); expect(r.valor).toBe(1300); // = saldo das faturas contestadas, como o Painel inicial expect(r.resolvidas.length).toBe(1); expect(r.tempoMedio).toBe(10);
    expect(r.semMovimento.map(x => x.c.id)).toEqual(['c1']); expect(r.longa.map(x => x.c.id)).toEqual(['c1']); expect(r.prazoVencido.length).toBe(1);
    expect(r.porFaixa.map(f => f.qtd)).toEqual([1, 0, 0, 0, 1]); expect(r.maisAntigas[0].c.id).toBe('c1');
  });
  it('resolvida fora do período não entra', () => expect(resumoContestacoes(l, { de: '2026-01', ate: '2026-08' }, C).tempoMedio).toBeNull());
  it('alertas de contestação', () => {
    const al = gerarAlertas({ fs: [f1, f3], linhas: [], hoje: HOJE, c: C, contest: l, parados: [], cobrancas: [] });
    expect(al.find(a => a.id === 'c-prazo')).toMatchObject({ prioridade: 'critico', qtd: 1 });
    expect(al.find(a => a.id === 'c-longa')).toMatchObject({ prioridade: 'critico', qtd: 1 });
    expect(al.find(a => a.id === 'c-parada')).toMatchObject({ prioridade: 'atencao', qtd: 1 });
  });
});

describe('atividade por usuário', () => {
  const ls: LinhaAtividade[] = [
    { usuario: 'ana@mb.br', tabela: 'invoices', acao: 'INSERT', qtd: 10, ultima: '2026-11-01T10:00:00Z' },
    { usuario: 'ana@mb.br', tabela: 'invoices', acao: 'UPDATE', qtd: 4, ultima: '2026-11-03T10:00:00Z' },
    { usuario: 'ana@mb.br', tabela: 'payment_allocations', acao: 'INSERT', qtd: 7, ultima: '2026-11-02T10:00:00Z' },
    { usuario: 'bia@mb.br', tabela: 'contestacoes', acao: 'UPDATE', qtd: 3, ultima: '2026-11-04T10:00:00Z' },
    { usuario: SEM_USUARIO, tabela: 'invoices', acao: 'UPDATE', qtd: 500, ultima: '2026-11-05T10:00:00Z' },
  ];
  it('soma por categoria, em ordem alfabética (sem ranking) e deixa o "sem usuário" por último', () => {
    const r = agregarAtividade(ls);
    expect(r.map(u => u.usuario)).toEqual(['ana@mb.br', 'bia@mb.br', SEM_USUARIO]);
    expect(r[0]).toMatchObject({ faturasEmitidas: 10, faturasAlteradas: 4, baixas: 7, total: 21, ultima: '2026-11-03T10:00:00Z' });
    expect(r[1]).toMatchObject({ contestacoes: 3, total: 3 });
    expect(r[2].semUsuario).toBe(true);
  });
});
