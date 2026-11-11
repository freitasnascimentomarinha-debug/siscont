import { describe, it, expect } from 'vitest';
import { MovCredito, aplicarCreditosOm, creditosDaOm, estornaveisManuais, extratoDaOm, planejarUso, resumoCreditosOm, saldoDaOm, saldoPorOm } from '../utils/creditosOm';
import { ItemLote, OMFat } from '../utils/faturamento';

let seq = 0;
const M = (o: Partial<MovCredito> & Pick<MovCredito, 'omId' | 'tipo' | 'valor'>): MovCredito => ({ id: `m${++seq}`, data: '2026-01-10', criadoEm: `2026-01-10T10:00:${String(seq).padStart(2, '0')}Z`, ...o });
const om = (id: string): OMFat => ({ id, codigo: id.toUpperCase().padStart(5, '4'), nome: `OM ${id}`, tipo: 'TERRA', comandoId: 'c1', setor: 'DGMM', comando: '40030 - DIM', ativo: true });
const item = (omId: string, sigla: string, valor: number, extra: Partial<ItemLote> = {}): ItemLote =>
  ({ chave: `${omId}|${sigla}`, omId, om: om(omId), sigla, servico: sigla, unidade: '', quantidade: null, quantidade2: null, valor, acrescimo: 0, debito: 0, base: { regra: '' }, avisos: [], ...extra });

describe('livro de créditos da OM', () => {
  const entradaAE = M({ id: 'eAE', omId: 'a', tipo: 'ENTRADA_ACERTO', valor: 300, data: '2026-01-10', servicoOrigem: 'AE', exercicioOrigem: 2025, origemNumero: '4000A-AE-01-2026-001-0', origemChave: '4000A-AE-01-2026-001' });
  const entradaEL = M({ id: 'eEL', omId: 'a', tipo: 'ENTRADA_ACERTO', valor: 200, data: '2026-02-10', servicoOrigem: 'EL', exercicioOrigem: 2026, origemNumero: '4000A-EL-02-2026-001-0', origemChave: '4000A-EL-02-2026-001' });
  const outraOm = M({ id: 'eB', omId: 'b', tipo: 'ABERTURA', valor: 1000, data: '2026-01-05', documento: 'ALTCRED G1' });

  it('a OM tem um saldo só, somando créditos de serviços e exercícios diferentes', () => {
    const l = [entradaAE, entradaEL, outraOm];
    expect(saldoDaOm(l, 'a')).toBe(500);
    expect(saldoPorOm(l).get('b')).toBe(1000);
    expect(creditosDaOm(l, 'a').map(c => [c.servico, c.exercicio, c.saldo])).toEqual([['AE', 2025, 300], ['EL', 2026, 200]]);
  });

  it('crédito de um serviço paga a fatura de OUTRO serviço da mesma OM (FIFO: o mais antigo primeiro)', () => {
    const r = aplicarCreditosOm([item('a', 'TL', 400)], creditosDaOm([entradaAE, entradaEL], 'a'));
    expect(r[0].creditos).toEqual([{ chave: 'eAE', numero: '4000A-AE-01-2026-001-0', valor: 300 }, { chave: 'eEL', numero: '4000A-EL-02-2026-001-0', valor: 100 }]);
    expect(r[0].debito).toBe(400);     // linha 04; o valor do serviço (linha 01) fica como está
    expect(r[0].valor).toBe(400);
  });

  it('crédito suficiente quita a fatura: aplica o valor da fatura e o resto fica com a OM', () => {
    const r = aplicarCreditosOm([item('a', 'AE', 150)], creditosDaOm([entradaAE], 'a'));
    expect(r[0].debito).toBe(150); expect(r[0].valor - r[0].debito).toBe(0);
    const usos = [M({ omId: 'a', tipo: 'UTILIZACAO', valor: -150, creditoRef: 'eAE', destinoNumero: 'x' })];
    expect(saldoDaOm([entradaAE, ...usos], 'a')).toBe(150);
    expect(creditosDaOm([entradaAE, ...usos], 'a')[0].saldo).toBe(150);
  });

  it('crédito parcial: abate só o que há; crédito maior que a fatura: aplica só o da fatura', () => {
    const parcial = aplicarCreditosOm([item('a', 'EL', 800)], creditosDaOm([entradaEL], 'a'));
    expect(parcial[0].debito).toBe(200); expect(parcial[0].valor - parcial[0].debito).toBe(600);
    const maior = aplicarCreditosOm([item('a', 'EL', 120)], creditosDaOm([entradaAE], 'a'));
    expect(maior[0].debito).toBe(120);
  });

  it('o mesmo crédito não é usado duas vezes no mesmo lote (duas faturas da OM dividem o saldo)', () => {
    const r = aplicarCreditosOm([item('a', 'AE', 200), item('a', 'EL', 200)], creditosDaOm([entradaAE], 'a'));
    expect(r.map(i => i.debito)).toEqual([200, 100]);
  });

  it('crédito de outra OM nunca é aplicado', () => {
    const r = aplicarCreditosOm([item('a', 'AE', 500)], creditosDaOm([outraOm], undefined));
    expect(r[0].creditos).toEqual([]); expect(r[0].debito).toBe(0);
  });

  it('não se aplica a estimativa nem a acerto', () => {
    const r = aplicarCreditosOm([item('a', 'AE', 500, { estimado: true }), item('a', 'AE', 500, { acertoDe: 'x' })], creditosDaOm([entradaAE], 'a'));
    expect(r.every(i => i.debito === 0)).toBe(true);
  });

  it('estorno (fatura cancelada) devolve o crédito ao saldo e ao crédito de origem; não conta duas vezes', () => {
    const uso = M({ id: 'u1', omId: 'a', tipo: 'UTILIZACAO', valor: -250, creditoRef: 'eAE', destinoNumero: '4000A-TL-03-2026-001-0' });
    const est = M({ omId: 'a', tipo: 'ESTORNO', valor: 250, creditoRef: 'eAE', estornoDe: 'u1', destinoNumero: '4000A-TL-03-2026-001-0' });
    expect(saldoDaOm([entradaAE, uso], 'a')).toBe(50);
    expect(saldoDaOm([entradaAE, uso, est], 'a')).toBe(300);
    expect(creditosDaOm([entradaAE, uso, est], 'a')[0].saldo).toBe(300);
  });

  it('planejarUso (devolução) tira do crédito mais antigo e não passa do que existe', () => {
    const ab = creditosDaOm([entradaAE, entradaEL], 'a');
    expect(planejarUso(ab, 350).map(p => [p.entradaId, p.valor])).toEqual([['eAE', 300], ['eEL', 50]]);
    expect(planejarUso(ab, 900).reduce((s, p) => s + p.valor, 0)).toBe(500);
  });

  it('extrato recalcula o saldo depois de cada movimento; resumo separa entradas, usado e devolvido', () => {
    const uso = M({ omId: 'a', tipo: 'UTILIZACAO', valor: -100, creditoRef: 'eAE', destinoNumero: 'f1', data: '2026-03-01' });
    const dev = M({ id: 'd1', omId: 'a', tipo: 'DEVOLUCAO', valor: -50, creditoRef: 'eEL', documento: 'G424.1', data: '2026-03-05' });
    const l = [entradaAE, entradaEL, uso, dev];
    expect(extratoDaOm(l, 'a').map(x => x.saldoApos)).toEqual([300, 500, 400, 350]);
    expect(resumoCreditosOm(l)).toMatchObject({ saldo: 350, entradas: 500, utilizado: 100, devolvido: 50 });
    expect(estornaveisManuais(l, 'a').map(m => m.id)).toEqual(['d1']);
    expect(estornaveisManuais([...l, M({ omId: 'a', tipo: 'ESTORNO', valor: 50, creditoRef: 'eEL', estornoDe: 'd1' })], 'a')).toEqual([]);
  });

  it('o livro começa zerado', () => {
    expect(resumoCreditosOm([])).toMatchObject({ saldo: 0, oms: 0, abertos: 0, entradas: 0 });
  });
});
