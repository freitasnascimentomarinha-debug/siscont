import { describe, it, expect } from 'vitest';
import { conferirNovasBaixas, executarUmaVez } from '../utils/travaBaixa';

const fat = (id: string, valor: number) => ({ id, invoiceNumber: `FAT-${id}`, value: valor });
const doc = { id: 'd1', documentNumber: 'G471.2026.AC.03499', operation: 'PAGAMENTO', totalValue: 1000 };

describe('conferência antes de gravar baixas', () => {
  it('baixa que cabe no saldo da fatura e da ALTCRED passa', () => {
    expect(conferirNovasBaixas({ doc, itens: [{ faturaId: 'a', valor: 300 }, { faturaId: 'b', valor: 200 }], faturas: [fat('a', 300), fat('b', 500)], baixasAtuais: [] })).toEqual([]);
  });
  it('a mesma baixa gravada de novo (clique duplo) é recusada: a fatura já foi baixada', () => {
    const jaGravada = [{ invoiceId: 'a', documentId: 'd1', amount: 300 }];
    const erros = conferirNovasBaixas({ doc, itens: [{ faturaId: 'a', valor: 300 }], faturas: [fat('a', 300)], baixasAtuais: jaGravada });
    expect(erros[0]).toMatch(/FAT-a já tem baixa gravada.*saldo dela agora é R\$ 0,00/);
  });
  it('fatura paga em parte por outra ALTCRED: só cabe o saldo', () => {
    const erros = conferirNovasBaixas({ doc, itens: [{ faturaId: 'a', valor: 300 }], faturas: [fat('a', 300)], baixasAtuais: [{ invoiceId: 'a', documentId: 'outra', amount: 100 }] });
    expect(erros[0]).toMatch(/saldo dela agora é R\$ 200,00/);
  });
  it('baixas que passam do saldo da ALTCRED são recusadas', () => {
    const erros = conferirNovasBaixas({ doc, itens: [{ faturaId: 'a', valor: 600 }, { faturaId: 'b', valor: 600 }], faturas: [fat('a', 600), fat('b', 600)], baixasAtuais: [] });
    expect(erros.join(' ')).toMatch(/só tem R\$ 1000,00 disponíveis/);
  });
  it('baixas já gravadas na ALTCRED diminuem o disponível', () => {
    const erros = conferirNovasBaixas({ doc, itens: [{ faturaId: 'b', valor: 200 }], faturas: [fat('b', 500)], baixasAtuais: [{ invoiceId: 'x', documentId: 'd1', amount: 900 }] });
    expect(erros[0]).toMatch(/só tem R\$ 100,00 disponíveis/);
  });
});

describe('uma gravação por vez', () => {
  it('a segunda chamada igual enquanto a primeira roda é recusada; depois que termina, libera', async () => {
    let n = 0;
    const lenta = () => new Promise<void>(r => setTimeout(() => { n++; r(); }, 20));
    const [a, b] = await Promise.allSettled([executarUmaVez('k', lenta), executarUmaVez('k', lenta)]);
    expect(a.status).toBe('fulfilled'); expect(b.status).toBe('rejected'); expect(n).toBe(1);
    await executarUmaVez('k', lenta); expect(n).toBe(2);
  });
  it('chaves diferentes (ALTCRED diferentes) não se atrapalham', async () => {
    const r = await Promise.all([executarUmaVez('x', async () => 1), executarUmaVez('y', async () => 2)]);
    expect(r).toEqual([1, 2]);
  });
});
