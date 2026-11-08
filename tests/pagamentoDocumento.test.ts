import { describe, it, expect } from 'vitest';
import { distribuirPagamento, resumoPagamento, saldoDaFatura } from '../utils/pagamentoDocumento';

const fs = [{ id: 'a', saldo: 600 }, { id: 'b', saldo: 300 }, { id: 'c', saldo: 500 }];
describe('pagar faturas ao incluir o documento', () => {
  it('distribui o valor na ordem escolhida, até o saldo de cada fatura', () => {
    expect(distribuirPagamento(1000, fs)).toEqual([{ id: 'a', valor: 600 }, { id: 'b', valor: 300 }, { id: 'c', valor: 100 }]);
    expect(distribuirPagamento(2000, fs).map(x => x.valor)).toEqual([600, 300, 500]);
  });
  it('valor digitado é respeitado (até o saldo) e o resto vai para as outras', () => {
    expect(distribuirPagamento(1000, fs, { b: 100 })).toEqual([{ id: 'a', valor: 600 }, { id: 'b', valor: 100 }, { id: 'c', valor: 300 }]);
    expect(distribuirPagamento(1000, fs, { a: 9999 }).map(x => x.valor)).toEqual([600, 300, 100]);
  });
  it('resumo: selecionado, sobra no documento e excesso', () => {
    expect(resumoPagamento(1000, distribuirPagamento(1000, fs))).toEqual({ selecionado: 1000, sobra: 0, excedeu: false });
    expect(resumoPagamento(1000, [{ id: 'a', valor: 600 }])).toEqual({ selecionado: 600, sobra: 400, excedeu: false });
    expect(resumoPagamento(500, distribuirPagamento(500, fs, { a: 600 })).excedeu).toBe(true);
  });
  it('saldo da fatura usa o calculado pelo sistema (quitada fora do sistema = 0)', () => {
    expect(saldoDaFatura({ saldoAPagar: 0, value: 1000 })).toBe(0);
    expect(saldoDaFatura({ value: 1000, adjustmentAddition: 10 }, 400)).toBe(610);
  });
});
