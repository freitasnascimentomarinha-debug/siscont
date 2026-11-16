import { describe, it, expect } from 'vitest';
import { agruparPorMes, etiquetaDaClasse, precisaAtencao, separarOrigem } from '../utils/fluxoCaixa';
import { CashFlowItem } from '../types';

const it_ = (o: Partial<CashFlowItem>): CashFlowItem => ({ id: 'x', date: '2026-03-10', documentNumber: 'N', client: 'C', type: 'EXIT', value: 100, balanceAfter: 0, ...o });

describe('separarOrigem', () => {
  it('tira a anotação do sistema e deixa só o que o usuário escreveu', () => {
    expect(separarOrigem('Importada de fluxo.xlsx › Página1')).toEqual({ origem: 'fluxo.xlsx › Página1', texto: '' });
    expect(separarOrigem('Reforço de empenho — Importada de a.xlsx › Aba 2')).toEqual({ origem: 'a.xlsx › Aba 2', texto: 'Reforço de empenho' });
    expect(separarOrigem('Conferir com o fornecedor')).toEqual({ origem: '', texto: 'Conferir com o fornecedor' });
    expect(separarOrigem(null)).toEqual({ origem: '', texto: '' });
  });
});

describe('etiquetaDaClasse', () => {
  it('rubrica numérica usa a descrição da rubrica; categoria usa o nome padronizado', () => {
    const rub = [{ numero: 7, descricao: 'Extintores' }];
    expect(etiquetaDaClasse('R7', rub)).toMatchObject({ texto: '7 — Extintores', cor: 'verde' });
    expect(etiquetaDaClasse('R9', rub).texto).toBe('Rubrica 9');
    expect(etiquetaDaClasse('AGUA')).toMatchObject({ texto: 'Água e esgoto', cor: 'azul' });
    expect(etiquetaDaClasse('EXPEDIENTE').texto).toBe('Expediente e limpeza');
    expect(etiquetaDaClasse('')).toMatchObject({ texto: 'Sem classificação', cor: 'vermelho' });
  });
  it('só pede atenção a saída ativa sem classificação; "Outros" é categoria como as demais', () => {
    expect(precisaAtencao(it_({}), '')).toBe(true);
    expect(precisaAtencao(it_({}), 'OUTROS')).toBe(false);
    expect(precisaAtencao(it_({}), 'ENERGIA')).toBe(false);
    expect(precisaAtencao(it_({ isCanceled: true }), 'OUTROS')).toBe(false);
    expect(precisaAtencao(it_({ type: 'ENTRY' }), '')).toBe(false);
  });
});

describe('agruparPorMes', () => {
  it('soma entradas e saídas por mês (canceladas fora) e usa o saldo corrido do fim do mês', () => {
    const todos = [
      it_({ id: '1', date: '2026-02-10', type: 'ENTRY', value: 1000, balanceAfter: 1000 }),
      it_({ id: '2', date: '2026-02-20', value: 300, balanceAfter: 700 }),
      it_({ id: '3', date: '2026-03-05', value: 200, isCanceled: true, balanceAfter: 700 }),
      it_({ id: '4', date: '2026-03-06', value: 100, balanceAfter: 600 }),
    ];
    const g = agruparPorMes(todos);
    expect(g.map(x => [x.rotulo, x.entradas, x.saidas, x.saldoFim])).toEqual([['Fevereiro/2026', 1000, 300, 700], ['Março/2026', 0, 100, 600]]);
    // com filtro (só saídas), o saldo do fim do mês continua o saldo real
    const so = agruparPorMes(todos.filter(i => i.type === 'EXIT'), todos);
    expect(so[0]).toMatchObject({ entradas: 0, saidas: 300, saldoFim: 700 });
  });
});
