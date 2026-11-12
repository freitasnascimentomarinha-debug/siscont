import { describe, it, expect } from 'vitest';
import { DocAdiantDisp, ItemLote, adiantamentoDoCliente, aplicarAdiantamentos, saldosRestantes } from '../utils/faturamento';

const om = (id: string, extra: any = {}) => ({ id, codigo: id, nome: `OM ${id}`, tipo: 'NAVIO', setor: 'S', comando: '81000 - Comando do 1º Distrito Naval', comandoId: 'cmdA', ativo: true, ...extra } as any);
const item = (chave: string, valor: number, o: any): ItemLote => ({ chave, omId: o.id, om: o, sigla: 'EL', servico: 'Energia', unidade: 'KWH', quantidade: 1, quantidade2: null, valor, acrescimo: 0, debito: 0, base: { regra: 'x' }, avisos: [], numero: chave });
const doc = (id: string, saldo: number, extra: Partial<DocAdiantDisp> = {}): DocAdiantDisp => ({ id, numero: id, saldo, data: '2026-01-01', comandoId: null, ug: '99999', ...extra });

describe('adiantamento: regra de "mesmo comando" e escolha manual', () => {
  it('reconhece o mesmo comando por código, pela OM do documento ou pelo NOME (comando repetido no cadastro)', () => {
    const o = om('a');
    expect(adiantamentoDoCliente(o, doc('d1', 10, { comandoId: 'cmdA' }))).toBe(true);
    expect(adiantamentoDoCliente(o, doc('d2', 10, { omComandoId: 'cmdA' }))).toBe(true);
    // mesmo comando cadastrado duas vezes (ids e códigos diferentes): vale pelo nome
    expect(adiantamentoDoCliente(o, doc('d3', 10, { comandoId: 'cmdB', comandoNome: 'COMANDO DO 1º DISTRITO NAVAL' }))).toBe(true);
    expect(adiantamentoDoCliente(o, doc('d4', 10, { comandoId: 'cmdB', comandoNome: 'Outro Comando' }))).toBe(false);
    expect(adiantamentoDoCliente(o, doc('d5', 10, { ug: 'a' }))).toBe(true);        // mesma UG
  });
  it('automático usa só o do cliente; o manual aceita ALTCRED de outro comando e consome o saldo antes do automático', () => {
    const a = om('a'), b = om('b', { comandoId: 'cmdZ', comando: 'Comando Z' });
    const docs = [doc('d-outro', 100, { comandoId: 'cmdZ', comandoNome: 'Comando Z' }), doc('d-a', 50, { comandoId: 'cmdA' })];
    const auto = aplicarAdiantamentos([item('fa', 80, a), item('fb', 30, b)], docs);
    expect(auto[0].adiantamentos).toEqual([{ docId: 'd-a', numero: 'd-a', valor: 50 }]);
    expect(auto[1].adiantamentos).toEqual([{ docId: 'd-outro', numero: 'd-outro', valor: 30 }]);
    // o usuário manda a ALTCRED "d-outro" (R$ 40) para a fatura da OM A, que é de outro comando
    const man = aplicarAdiantamentos([item('fa', 80, a), item('fb', 90, b)], docs, { manuais: { fa: [{ docId: 'd-outro', valor: 40 }] } });
    expect(man[0].adiantamentos).toEqual([{ docId: 'd-outro', numero: 'd-outro', valor: 40, manual: true }, { docId: 'd-a', numero: 'd-a', valor: 40 }]);
    expect(man[1].adiantamentos).toEqual([{ docId: 'd-outro', numero: 'd-outro', valor: 60 }]);   // sobrou 100 − 40 para a OM B
  });
  it('manual funciona mesmo com o abatimento automático desligado; nunca passa do saldo nem do valor da fatura', () => {
    const a = om('a');
    const r = aplicarAdiantamentos([item('fa', 30, a)], [doc('d', 500, { comandoId: 'cmdZ' })], { automatico: false, manuais: { fa: [{ docId: 'd', valor: 999 }] } });
    expect(r[0].adiantamentos).toEqual([{ docId: 'd', numero: 'd', valor: 30, manual: true }]);
    expect(aplicarAdiantamentos([item('fa', 30, a)], [doc('d', 500, { comandoId: 'cmdA' })], { automatico: false })[0].adiantamentos).toEqual([]);
  });
  it('saldos restantes: o que sobrou de cada ALTCRED depois do lote', () => {
    const a = om('a');
    const docs = [doc('d1', 100, { comandoId: 'cmdA' }), doc('d2', 20, { comandoId: 'cmdA' })];
    const itens = aplicarAdiantamentos([item('fa', 60, a)], docs);
    expect(saldosRestantes(docs, itens).map(x => [x.id, x.restante])).toEqual([['d1', 40], ['d2', 20]]);
  });
});
