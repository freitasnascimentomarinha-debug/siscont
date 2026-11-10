import { describe, expect, it } from 'vitest';
import { aplicarCreditos, calcularCreditos, chaveCredito, creditoCompensadoNaFatura, resumoCreditos } from '../utils/creditosAcerto';
import type { ItemLote, OMFat } from '../utils/faturamento';

const inv = (numero: string, extra: any = {}): any => ({
  id: `id-${numero}`, invoiceNumber: numero, value: 0, adjustmentAddition: 0, adjustmentDeduction: 0, isCanceled: false, omId: 'om1', client: 'HCM', serviceAcronym: 'AE',
  issueDate: '2027-01-15', acertoDe: '65701-AE-10-2026-001-0', baseCalculo: { regra: 'x' }, ...extra,
});
const om = (id: string): OMFat => ({ id, codigo: '65701', nome: id, tipo: 'TERRA', setor: 'DGMM', comando: 'c', ativo: true });
const item = (omId: string, sigla: string, valor: number, extra: Partial<ItemLote> = {}): ItemLote =>
  ({ chave: `${omId}|${sigla}`, omId, om: om(omId), sigla, servico: sigla, unidade: '', quantidade: null, quantidade2: null, valor, acrescimo: 0, debito: 0, base: { regra: '' }, avisos: [], ...extra });

describe('créditos de acerto', () => {
  it('estimado 100.000 e real 80.000: crédito de 20.000, no formato novo (serviço 80.000 − débito 100.000) e no antigo (0 − débito 20.000)', () => {
    const novo = calcularCreditos([inv('65701-AE-01-2027-001-0', { value: 80000, adjustmentDeduction: 100000 })], []);
    const antigo = calcularCreditos([inv('65701-AE-01-2027-002-0', { value: 0, adjustmentDeduction: 20000 })], []);
    expect(novo[0]).toMatchObject({ valor: 20000, saldo: 20000, servico: 'AE', cliente: 'HCM', original: '65701-AE-10-2026-001-0' });
    expect(antigo[0]).toMatchObject({ valor: 20000, saldo: 20000 });
  });
  it('real maior (a pagar), correção por atraso, cancelada e fatura comum não geram crédito; a retificação (-1) mantém um só', () => {
    expect(calcularCreditos([
      inv('A-AE-01-2027-001-0', { value: 120000, adjustmentDeduction: 100000 }),
      inv('B-AE-01-2027-001-0', { value: 0, adjustmentAddition: 500, baseCalculo: { tipo: 'CORRECAO', regra: 'c' } }),
      inv('C-AE-01-2027-001-0', { value: 0, adjustmentDeduction: 900, isCanceled: true }),
      inv('D-AE-01-2027-001-0', { value: -5, acertoDe: null }),
    ], [])).toEqual([]);
    const r = calcularCreditos([inv('E-AE-01-2027-001-0', { value: 0, adjustmentDeduction: 700, isCanceled: true }), inv('E-AE-01-2027-001-1', { value: 0, adjustmentDeduction: 650 })], []);
    expect(r).toHaveLength(1); expect(r[0]).toMatchObject({ numero: 'E-AE-01-2027-001-1', valor: 650, chave: 'E-AE-01-2027-001' });
  });
  it('compensado e devolvido reduzem o saldo; compensação em fatura cancelada deixa de valer', () => {
    const ac = inv('65701-AE-01-2027-001-0', { value: 80000, adjustmentDeduction: 100000 });
    const k = chaveCredito(ac.invoiceNumber);
    const usos = [
      { chave: k, tipo: 'COMPENSACAO' as const, valor: 5000, data: '2027-02-15', faturaNumero: '65701-AE-02-2027-001-0' },
      { chave: k, tipo: 'DEVOLUCAO' as const, valor: 3000, data: '2027-03-01', documento: 'G424.AC.1' },
      { chave: k, tipo: 'COMPENSACAO' as const, valor: 2000, data: '2027-03-15', faturaNumero: '65701-AE-03-2027-001-0' },
    ];
    const faturas = [ac, inv('65701-AE-02-2027-001-0', { acertoDe: null, value: 9000 }), inv('65701-AE-03-2027-001-0', { acertoDe: null, value: 9000, isCanceled: true })];
    const [c] = calcularCreditos(faturas, usos);
    expect(c).toMatchObject({ compensado: 5000, devolvido: 3000, saldo: 12000 });         // os 2.000 da fatura cancelada voltam ao saldo
    expect(resumoCreditos([c])).toMatchObject({ total: 20000, compensado: 5000, devolvido: 3000, saldo: 12000, abertos: 1 });
    // retificação da fatura onde foi compensado (-1): a compensação continua valendo
    const [c2] = calcularCreditos([ac, inv('65701-AE-03-2027-001-0', { acertoDe: null, isCanceled: true }), inv('65701-AE-03-2027-001-1', { acertoDe: null, value: 9000 })], usos);
    expect(c2.compensado).toBe(7000);
  });

  const cred = (saldo: number, extra: any = {}) => calcularCreditos([inv(extra.numero || '65701-AE-01-2027-001-0', { value: 0, adjustmentDeduction: saldo, omId: extra.omId || 'om1', serviceAcronym: extra.sigla || 'AE', issueDate: extra.data || '2027-01-15' })], [])[0];
  it('compensa só na mesma OM e no mesmo serviço, na linha 04, sem passar do valor da fatura', () => {
    const r = aplicarCreditos([item('om1', 'AE', 15000), item('om1', 'EL', 8000), item('om2', 'AE', 8000)], [cred(20000)]);
    expect(r[0]).toMatchObject({ debito: 15000, creditos: [{ numero: '65701-AE-01-2027-001-0', valor: 15000 }] });
    expect(r[0].valor + r[0].acrescimo - r[0].debito).toBe(0);
    expect(r[0].base).toMatchObject({ creditoCompensado: 15000 });
    expect(r[1].debito).toBe(0); expect(r[2].debito).toBe(0);              // outro serviço / outra OM: não mexe
  });
  it('o saldo vai acabando entre as faturas do lote, do crédito mais antigo para o mais novo', () => {
    const cs = [cred(1000, { numero: 'X-AE-02-2027-001-0', data: '2027-02-15' }), cred(5000, { numero: 'X-AE-01-2027-001-0', data: '2027-01-15' })];
    const r = aplicarCreditos([item('om1', 'AE', 4000), item('om1', 'AE', 3000, { chave: 'k2' })], cs);
    expect(r[0].creditos).toEqual([{ chave: 'X-AE-01-2027-001', numero: 'X-AE-01-2027-001-0', valor: 4000 }]);
    expect(r[1].creditos).toEqual([{ chave: 'X-AE-01-2027-001', numero: 'X-AE-01-2027-001-0', valor: 1000 }, { chave: 'X-AE-02-2027-001', numero: 'X-AE-02-2027-001-0', valor: 1000 }]);
    expect(r[1].debito).toBe(2000);
  });
  it('não compensa fatura estimada (OND), de acerto, nem item sem valor a pagar', () => {
    const r = aplicarCreditos([item('om1', 'AE', 100, { estimado: true }), item('om1', 'AE', 100, { acertoDe: 'X' }), item('om1', 'AE', 0)], [cred(500)]);
    expect(r.every(i => i.debito === 0 && !(i.creditos || []).length)).toBe(true);
  });
  it('o valor compensado na fatura volta ao bruto para a média do OND e para o acerto', () => {
    expect(creditoCompensadoNaFatura({ baseCalculo: { creditos: [{ valor: 1000 }, { valor: 250.5 }] } as any })).toBe(1250.5);
    expect(creditoCompensadoNaFatura({ baseCalculo: { regra: 'x' } as any })).toBe(0);
  });
});
