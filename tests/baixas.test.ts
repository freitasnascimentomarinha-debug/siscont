import { describe, it, expect } from 'vitest';

import { saldoDisponivelDoc } from '../utils/baixas';
import { comoRecebimentoOutros, ItemImportacao } from '../services/recebimentosService';

describe('ALTCRED "Outros" (outros serviços: não paga fatura)', () => {
  it('não oferece saldo para baixa de fatura; as demais continuam como antes', () => {
    expect(saldoDisponivelDoc({ operation: 'OUTROS', totalValue: 5000 }, 0)).toBe(0);
    expect(saldoDisponivelDoc({ operation: 'PAGAMENTO', totalValue: 5000 }, 1200.5)).toBe(3799.5);
    expect(saldoDisponivelDoc({ operation: 'ADIANTAMENTO', totalValue: 100 }, 100)).toBe(0);
  });
  it('comoRecebimentoOutros troca a operação, tira o "aguardando" e a destinação, e deixa a nota; estorno e ignorar ficam como estão', () => {
    const base: any = { sol: {}, avisos: [], doc: { operation: 'PAGAMENTO', aguardando: true, informedAdvance: false, destinacao: [{ tipo: 'FATURA', valor: 'X' }], observation: 'obs' } };
    const novo = comoRecebimentoOutros({ ...base, acao: 'NOVA' } as ItemImportacao);
    expect(novo.doc).toMatchObject({ operation: 'OUTROS', aguardando: false, destinacao: [] });
    expect(novo.doc.observation).toBe('obs | Recebida na R.901.16 para outros serviços (não paga fatura).');
    const est = { ...base, acao: 'ESTORNO' } as ItemImportacao, ign = { ...base, acao: 'IGNORAR' } as ItemImportacao;
    expect(comoRecebimentoOutros(est)).toBe(est); expect(comoRecebimentoOutros(ign)).toBe(ign);
  });
});
