import { describe, expect, it } from 'vitest';
import { comparativo, mediaTrienal, montarParticipantes, naviosAtivos, ratear, valorVigente } from '../utils/taxaCondominial';
import { acharPorNome, lerDespesas, lerHistorico, lerLotacoes, lerMatriz, lerProposta, ligarOMs } from '../utils/taxaCondominialImport';
import { backupAtrasado, diasSemBackup, diferencas, resumo } from '../utils/auditoria';
import { acharNavio } from '../utils/importMedicoes';

describe('Fase 6 — média trienal', () => {
  it('Corvetas Classe Barroso (planilha 2026): 355 + 288 + 0 em 1 navio → 214,3/ano e 17,86/mês', () => {
    const [m] = mediaTrienal([
      { ano: 2023, classeId: 'B', dias: 355, navios: 1 }, { ano: 2024, classeId: 'B', dias: 288, navios: 1 }, { ano: 2025, classeId: 'B', dias: 0, navios: 1 },
    ], 2026, ['B']);
    expect(m.total).toBe(643);
    expect(m.mediaAnual).toBe(214.3);
    expect(m.mediaMensal).toBe(17.86);
  });
  it('divide pelos navios ativos de cada ano e ignora ano sem navio', () => {
    const [m] = mediaTrienal([{ ano: 2023, classeId: 'E', dias: 330, navios: 2 }, { ano: 2024, classeId: 'E', dias: 187, navios: 1 }, { ano: 2025, classeId: 'E', dias: 50, navios: 0 }], 2026, ['E']);
    expect(m.anos.map(a => a.porNavio)).toEqual([165, 187, 0]);
    expect(m.total).toBe(352);
  });
  it('navios ativos no ano pelo cadastro (ativação/desativação)', () => {
    const oms = [
      { tipo: 'NAVIO', classeId: 'C', ativadoEm: '2020-01-01', desativadoEm: null },
      { tipo: 'NAVIO', classeId: 'C', ativadoEm: '2020-01-01', desativadoEm: '2024-06-30' },
      { tipo: 'NAVIO', classeId: 'C', ativadoEm: '2025-03-01', desativadoEm: null },
      { tipo: 'TERRA', classeId: 'C' },
    ];
    expect(naviosAtivos(oms, 'C', 2024)).toBe(2);
    expect(naviosAtivos(oms, 'C', 2025)).toBe(2);
    expect(naviosAtivos(oms, 'C', 2023)).toBe(2);
  });
});

describe('Fase 6 — rateio da taxa condominial', () => {
  const rub = (numero: number, valorPrevisto: number, descontoGeral = 0) => ({ numero, descricao: `R${numero}`, valorPrevisto, descontoGeral });
  it('peso = lotação × dias; parcela proporcional; mensal = anual ÷ 12', () => {
    const r = ratear([rub(1, 190000)], [
      { omId: 'a', nome: 'AMRJ', tipo: 'TERRA', lotacao: 1010, dias: 30 },
      { omId: 'b', nome: 'BNIC', tipo: 'TERRA', lotacao: 812, dias: 30 },
    ], new Set(['1|a', '1|b']), []);
    const a = r.oms.find(o => o.omId === 'a')!;
    expect(a.peso).toBe(30300);
    expect(a.anual).toBeCloseTo(190000 * 1010 / 1822, 1);
    expect(a.mensal).toBeCloseTo(a.anual / 12, 2);
    expect(r.total).toBeCloseTo(190000, 0);
  });
  it('só participa quem está marcado na matriz; rubrica sem participante é sinalizada', () => {
    const r = ratear([rub(1, 1000), rub(2, 500)], [{ omId: 'a', nome: 'A', tipo: 'TERRA', lotacao: 10, dias: 30 }, { omId: 'b', nome: 'B', tipo: 'TERRA', lotacao: 10, dias: 30 }], new Set(['1|a']), []);
    expect(r.oms.find(o => o.omId === 'a')!.anual).toBe(1000);
    expect(r.oms.find(o => o.omId === 'b')!.anual).toBe(0);
    expect(r.valorRubricas.find(v => v.numero === 2)!.semParticipante).toBe(true);
  });
  it('desconto geral reduz a rubrica para todos; vigente = previsto − desconto', () => {
    expect(valorVigente(rub(1, 200000, 53903.08))).toBe(146096.92);
    const r = ratear([rub(1, 1200, 200)], [{ omId: 'a', nome: 'A', tipo: 'TERRA', lotacao: 1, dias: 30 }], new Set(['1|a']), []);
    expect(r.total).toBe(1000);
  });
  it('SecNSNQ: 23,5% no total → R$ 157.762,56 vira R$ 120.688,36', () => {
    const r = ratear([rub(1, 157762.56)], [{ omId: 's', nome: 'SecNSNQ', tipo: 'TERRA', lotacao: 140, dias: 30 }], new Set(['1|s']),
      [{ id: 'd', omId: 's', rubrica: null, tipo: 'PERCENTUAL', valor: 23.5, justificativa: 'edifício' }]);
    expect(r.oms[0].anual).toBe(120688.36);
    expect(r.oms[0].descontos).toBe(37074.2);
  });
  it('desconto da OM numa rubrica (R$) não é redistribuído', () => {
    const r = ratear([rub(1, 1000)], [{ omId: 'a', nome: 'A', tipo: 'TERRA', lotacao: 1, dias: 30 }, { omId: 'b', nome: 'B', tipo: 'TERRA', lotacao: 1, dias: 30 }], new Set(['1|a', '1|b']),
      [{ id: 'd', omId: 'a', rubrica: 1, tipo: 'VALOR', valor: 100, justificativa: 'x' }]);
    expect(r.oms.find(o => o.omId === 'a')!.anual).toBe(400);
    expect(r.oms.find(o => o.omId === 'b')!.anual).toBe(500);
    expect(r.total).toBe(900);
  });
  it('navio: diária = custo por militar-dia × lotação; classe sem histórico usa a regra alternativa', () => {
    const r = ratear([rub(1, 120000)], [
      { omId: 't', nome: 'Terra', tipo: 'TERRA', lotacao: 100, dias: 30 },
      { omId: 'n1', nome: 'Navio 1', tipo: 'NAVIO', lotacao: 100, dias: 10 },
      { omId: 'n2', nome: 'Navio 2', tipo: 'NAVIO', lotacao: 50, dias: 20 },
      { omId: 'n3', nome: 'Navio novo', tipo: 'NAVIO', lotacao: 80, dias: 0, semHistorico: true },
    ], new Set(['1|t', '1|n1', '1|n2', '1|n3']), []);
    const n1 = r.oms.find(o => o.omId === 'n1')!, n2 = r.oms.find(o => o.omId === 'n2')!, n3 = r.oms.find(o => o.omId === 'n3')!;
    // pesos 3000, 1000, 1000 → navios recebem 24.000 cada; militar-dias/ano = (100×10 + 50×20) × 12 = 24.000 → R$ 2/militar-dia
    expect(n1.anual).toBe(24000);
    expect(r.custoMilitarDia).toBe(2);
    expect(n1.diaria).toBe(200);
    expect(n2.diaria).toBe(100);
    expect(n3.anual).toBe(0);
    expect(n3.regraDiaria).toBe('SEM_HISTORICO');
    // média das diárias 150 ÷ média da lotação 75 = 2 → × 80
    expect(n3.diaria).toBe(160);
  });
  it('participantes: terra 30 dias, navio pela média da classe ou pelos dias informados', () => {
    const p = montarParticipantes(
      [{ id: 't', nome: 'T', tipo: 'TERRA' }, { id: 'x', nome: 'X', tipo: 'EXTRA_MB' }, { id: 'n', nome: 'N', tipo: 'NAVIO', classeId: 'C' }, { id: 'm', nome: 'M', tipo: 'NAVIO', classeId: 'C' }, { id: 'z', nome: 'Z', tipo: 'NAVIO', classeId: 'Z' }],
      [{ omId: 't', lotacao: 10 }, { omId: 'x', lotacao: 5 }, { omId: 'n', lotacao: 20 }, { omId: 'm', lotacao: 20, dias: 9 }, { omId: 'z', lotacao: 7 }, { omId: 'fora', lotacao: 3 }],
      new Map([['C', 17.86]]),
    );
    expect(p.map(x => [x.omId, x.tipo, x.dias, !!x.semHistorico])).toEqual([['t', 'TERRA', 30, false], ['x', 'TERRA', 30, false], ['n', 'NAVIO', 17.86, false], ['m', 'NAVIO', 9, false], ['z', 'NAVIO', 0, true]]);
  });
  it('comparativo (Anexo B) com variação %', () => {
    const r = ratear([rub(1, 1200)], [{ omId: 'a', nome: 'A', tipo: 'TERRA', lotacao: 1, dias: 30 }], new Set(['1|a']), []);
    expect(comparativo(r.oms, new Map([['a', 80]]))[0]).toMatchObject({ anteriorAnual: 960, propostaMensal: 100, variacao: 25 });
  });
});

describe('Fase 6 — leitura das planilhas', () => {
  it('Despesas_NOVO: número, conta, despesa, previsto e gasto do ano anterior', () => {
    const r = lerDespesas([
      ['Nº DE ORDEM', 'Conta Contábil', 'DESCRIÇÃO CONTAS CONTÁBEIS', 'DESPESAS', 'VALOR PARA 2026 (R$)', '%RUB', 'VALOR 2025( R$)', 'VARIAÇÃO', 'DESCONTOS'],
      [],
      [1, '8.9.9.1.1.08.02 ', 'DEMAIS', 'Manutenção de Telhados', 200000, 0.02, 391421.64, -0.48, 53903.07],
      [2, '8.9.9.1.1.08.02', '', 'Recuperação de Marquises', 0, 0, 0],
      ['TOTAL', '', '', '', 200000],
    ]);
    expect(r).toEqual([
      { numero: 1, descricao: 'Manutenção de Telhados', contaContabil: '8.9.9.1.1.08.02', valorPrevisto: 200000, gastoAnterior: 391421.64, descontoPlanilha: 53903.07, atualizadoPlanilha: null, destino: 'TC' },
      { numero: 2, descricao: 'Recuperação de Marquises', contaContabil: '8.9.9.1.1.08.02', valorPrevisto: 0, gastoAnterior: 0, descontoPlanilha: null, atualizadoPlanilha: null, destino: 'TC' },
    ]);
  });
  it('Matriz_NOVO: X (maiúsculo ou minúsculo) por rubrica; ignora título de grupo', () => {
    const m = lerMatriz([
      ['', 'CLIENTES', 'GRUPO DE DESPESAS'],
      ['', '', 1, 2, 3, 4],
      ['', '1 – Parte baixa da Ilha'],
      ['', 'AMRJ', 'x', '', 'X', ''],
      ['', 'BNIC', 'X', 'X', '', 'x'],
    ]);
    expect(m).toEqual([{ nome: 'AMRJ', rubricas: [1, 3] }, { nome: 'BNIC', rubricas: [1, 2, 4] }]);
  });
  it('RATEIO: terra e navios separados pelo título NAVIOS; para no TOTAL GERAL', () => {
    const l = lerLotacoes([
      ['CLIENTES', 'CRITÉRIO'], ['OM DE TERRA', '(A)', 'Lotação Anterior', '(B)'], ['', 'LOTAÇÃO', '', 'DIAS', '(A)x(B)'],
      ['SecNSNQ (Ed.23)', 140, 76, 30], ['AMAZUL (Ed.23)', 9, '- ', 30], ['SUB TOTAL', 149, 76, 60],
      ['NAVIOS', '(A)', 'Lotação Anterior', '(B)'], ['', 'LOTAÇÃO', '', 'Nº MÉDIO DIAS'],
      ['CORVETA CLASSE BARROSO', 148, 125, 28], ['REBOCADOR CLASSE – REBOCADOR TRINTÃO', 49, 46, 0.74],
      ['SUB TOTAL', 197], ['TOTAL GERAL', 346], ['COLUNA (A) = ...'],
    ]);
    expect(l).toEqual([
      { nome: 'SecNSNQ (Ed.23)', lotacao: 140, lotacaoAnterior: 76, dias: 30, navio: false },
      { nome: 'AMAZUL (Ed.23)', lotacao: 9, lotacaoAnterior: null, dias: 30, navio: false },
      { nome: 'CORVETA CLASSE BARROSO', lotacao: 148, lotacaoAnterior: 125, dias: 28, navio: true },
      { nome: 'REBOCADOR CLASSE – REBOCADOR TRINTÃO', lotacao: 49, lotacaoAnterior: 46, dias: 0.74, navio: true },
    ]);
  });
  it('proposta sem alguma aba: avisa em vez de falhar', () => {
    const p = lerProposta([{ nome: 'TAXA CONDOMINIAL', linhas: [] }]);
    expect(p.avisos).toHaveLength(3);
    expect(p.rubricas).toEqual([]);
  });
  it('histórico: classe repetida em branco, navios com dias > 0 contados; aba por navio prevalece no mesmo ano', () => {
    const cab = ['CLASSE NAVIO', 'NAVIO', 'JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ', 'TOTAL'];
    const h = lerHistorico([
      { nome: '2023', linhas: [['TÍTULO'], ['CLASSE NAVIO', 'JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ', 'TOTAL'], ['Classe Marlim', 47, 64, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 111]] },
      { nome: '2023_2', linhas: [cab, ['Classe Marlim', 'Albacora', 10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 10], ['', 'Anequim', 5, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 10], ['', 'Marlim', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], ['TOTAL']] },
      { nome: 'LISTA DE NAVIOS', linhas: [] },
    ]);
    expect(h).toEqual([{ ano: 2023, classe: 'Classe Marlim', dias: 20, navios: 2, aba: '2023_2' }]);
  });
  it('liga nomes ao cadastro: exato, sem parênteses, sigla, prefixo (corte de 50 caracteres) e navio após o travessão', () => {
    const oms = [
      { id: '1', nome: 'SecNSNQ', sigla: null, tipo: 'TERRA' },
      { id: '2', nome: 'Diretoria de Abastecimento da Marinha', sigla: 'DAbM', tipo: 'TERRA' },
      { id: '3', nome: 'Embarcação de Desembarque de Carga Geral - EDCG Classe Guarapari', tipo: 'TERRA' },
      { id: '4', nome: 'Rebocador Trintão', tipo: 'NAVIO', ativo: true },
    ];
    expect(acharPorNome('SecNSNQ (Ed.23)', oms)?.id).toBe('1');
    expect(acharPorNome('DAbM (Ed.Gastão Motta – Ed.28)', oms)?.id).toBe('2');
    expect(acharPorNome('Embarcação de Desembarque de Carga Geral - EDCG Cl', oms)?.id).toBe('3');
    const m = ligarOMs([{ nome: 'REBOCADOR CLASSE – REBOCADOR TRINTÃO', navio: true }, { nome: 'Inexistente', navio: false }], oms, acharNavio);
    expect(m.get('REBOCADOR CLASSE – REBOCADOR TRINTÃO')).toBe('4');
    expect(m.get('Inexistente')).toBeNull();
  });
});

describe('Fase 7 — auditoria e backup', () => {
  it('diferenças: só os campos que mudaram, sem updated_at', () => {
    const d = diferencas({ acao: 'UPDATE', antes: { status: 'PENDENTE', value: 10, updated_at: 'a' }, depois: { status: 'PAGO', value: 10, updated_at: 'b' } });
    expect(d).toEqual([{ campo: 'status', de: 'PENDENTE', para: 'PAGO' }]);
  });
  it('inclusão lista os campos preenchidos; resumo legível', () => {
    expect(diferencas({ acao: 'INSERT', antes: null, depois: { a: 1, b: null, c: '' } })).toEqual([{ campo: 'a', de: null, para: 1 }]);
    expect(resumo({ id: 1, tabela: 'invoices', registroId: 'x', acao: 'UPDATE', em: '', usuarioId: null, usuarioEmail: null, antes: { status: 'PENDENTE' }, depois: { status: 'PAGO' } })).toBe('status: PENDENTE → PAGO');
    expect(resumo({ id: 1, tabela: 'invoices', registroId: 'x', acao: 'DELETE', em: '', usuarioId: null, usuarioEmail: null, antes: { invoice_number: '40030-TC-09-2025-014-0' }, depois: null })).toBe('excluído (40030-TC-09-2025-014-0)');
  });
  it('lembrete de backup: nunca feito ou há mais de 7 dias', () => {
    const hoje = new Date('2026-11-07T12:00:00Z');
    expect(diasSemBackup(null, hoje)).toBeNull();
    expect(diasSemBackup('2026-11-01T12:00:00Z', hoje)).toBe(6);
    expect(backupAtrasado(null)).toBe(true);
    expect(backupAtrasado(6)).toBe(false);
    expect(backupAtrasado(8)).toBe(true);
  });
});
