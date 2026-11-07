import { describe, it, expect } from 'vitest';
import { proximaVersao, fatorCorrecao, calcularCorrecao, situacaoContestacao, Contestacao } from '../utils/fase4';
import { candidatosCorrecao } from '../services/fase4Service';

describe('cancela e substitui', () => {
  it('próxima versão, pulando as que já existem', () => {
    expect(proximaVersao('40032-DA-08-2026-010-0')).toBe('40032-DA-08-2026-010-1');
    expect(proximaVersao('40032-DA-08-2026-010-0', ['40032-DA-08-2026-010-1'])).toBe('40032-DA-08-2026-010-2');
    expect(() => proximaVersao('SEM-VERSAO')).toThrow();
  });
});

describe('correção por atraso (OI 6.2)', () => {
  const taxas = new Map([['2026-09', 0.6], ['2026-10', 0.6], ['2026-11', 0.55]]);
  it('um mês inteiro à taxa do mês = taxa mensal (base 30)', () => {
    const f = fatorCorrecao('2026-09-01', '2026-10-01', taxas);
    expect(f.dias).toBe(30);
    expect(Math.round((f.fator - 1) * 1e6) / 1e6).toBe(0.006);
  });
  it('só corrige pagamento feito depois da data-limite (6.1), da data-limite até o pagamento', () => {
    const c = calcularCorrecao('2026-09-29', [{ data: '2026-09-29', valor: 1000 }, { data: '2026-10-29', valor: 10000 }], taxas);
    expect(c.pagamentos).toHaveLength(1);
    expect(c.pagamentos[0].dias).toBe(30);
    expect(c.total).toBe(60); // 10.000 × 0,6% (1 dia de setembro + 29 de outubro, mesma taxa)
    expect(c.semTaxa).toEqual([]);
  });
  it('mês sem taxa cadastrada é apontado', () => {
    expect(calcularCorrecao('2026-11-20', [{ data: '2026-12-10', valor: 100 }], taxas).semTaxa).toEqual(['2026-12']);
  });
  it('candidatos: ignora adiantamento, cancelada, histórico e faturas já corrigidas', () => {
    const f = (id: string, o: any = {}) => ({ id, invoiceNumber: `40030-EL-08-2026-00${id}-0`, dueDate: '2026-09-29', value: 1000, isCanceled: false, ...o }) as any;
    const inv = [f('1'), f('2', { isCanceled: true }), f('3', { quitacaoExterna: 'x' }), f('4'), f('5', { acertoDe: '40030-EL-08-2026-004-0', baseCalculo: { tipo: 'CORRECAO' } })];
    const docs = [{ id: 'p', operation: 'PAGAMENTO' }, { id: 'a', operation: 'ADIANTAMENTO' }] as any;
    const bx = [
      { invoiceId: '1', documentId: 'p', amount: 1000, date: '2026-10-29' }, { invoiceId: '1', documentId: 'a', amount: 500, date: '2026-11-29' },
      { invoiceId: '2', documentId: 'p', amount: 1000, date: '2026-10-29' }, { invoiceId: '3', documentId: 'p', amount: 1000, date: '2026-10-29' },
      { invoiceId: '4', documentId: 'p', amount: 1000, date: '2026-10-29' },
    ] as any;
    const c = candidatosCorrecao(inv, bx, docs, taxas, 30);
    expect(c.map(x => [x.fatura.id, x.correcao.total, x.jaCorrigida ?? null])).toEqual([['1', 6, null], ['4', 6, '40030-EL-08-2026-005-0']]);
  });
});

describe('contestação', () => {
  const c: Contestacao = { id: '1', invoiceId: 'f', numeroFatura: 'X', abertaEm: '2026-04-10', origem: 'SIPLAD', justificativa: 'docado', status: 'ENCAMINHADA', prazo: '2026-04-24', anexos: [], historico: [{ em: '2026-04-10', por: 'a', acao: 'ABERTA' }, { em: '2026-04-11', por: 'a', acao: 'ENCAMINHADA' }] };
  it('dias parada e prazo vencido (caso D7: sem resposta por meses)', () => {
    const s = situacaoContestacao(c, '2026-09-10');
    expect(s).toMatchObject({ aberta: true, diasParada: 152, prazoVencido: true, proximoPasso: 'Registrar a resposta do setor' });
    expect(situacaoContestacao({ ...c, status: 'ENCERRADA', decididaEm: '2026-05-10' }, '2026-09-10')).toMatchObject({ aberta: false, diasAberta: 30, prazoVencido: false });
  });
});
