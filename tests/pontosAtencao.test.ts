import { describe, it, expect } from 'vitest';
import { avaliarPontos, marcarResolvido, reabrir, pendentes, FaturaParaPontos, DocumentoParaPontos } from '../utils/pontosAtencao';

const fat = (o: Partial<FaturaParaPontos>): FaturaParaPontos => ({
  id: 'f1', invoiceNumber: '40030-EL-08-2026-010-0', value: 100, issueDate: '2026-09-15', dueDate: '2026-09-29',
  monthCompetence: 8, yearCompetence: 2026, serviceAcronym: 'EL', omId: 'om1', ...o,
});
const doc = (o: Partial<DocumentoParaPontos>): DocumentoParaPontos => ({
  id: 'd1', documentNumber: 'G424.2026.AC.00343', documentType: 'ALTCRED', totalValue: 100, operation: 'PAGAMENTO', ...o,
});
const tipos = (m: Map<string, any[]>, id: string) => (m.get(id) || []).map(p => p.tipo).sort();

describe('pontos de atenção automáticos', () => {
  it('fatura correta não tem ponto', () => {
    const r = avaliarPontos([fat({})], [doc({})], [{ documentId: 'd1', invoiceId: 'f1', amount: 100 }]);
    expect(r.faturas.size).toBe(0);
    expect(r.documentos.size).toBe(0);
  });

  it('pago a maior, adiantamento maior e ALTCRED usada a mais', () => {
    const r = avaliarPontos(
      [fat({})],
      [doc({}), doc({ id: 'd2', documentNumber: 'G424.2026.AC.00016', operation: 'ADIANTAMENTO', totalValue: 500 })],
      [{ documentId: 'd2', invoiceId: 'f1', amount: 150 }, { documentId: 'd1', invoiceId: 'f1', amount: 100 }, { documentId: 'd1', invoiceId: 'f1', amount: 20 }],
    );
    expect(tipos(r.faturas, 'f1')).toEqual(['ADIANTAMENTO_MAIOR', 'PAGO_A_MAIOR']);
    expect(r.faturas.get('f1')!.find(p => p.tipo === 'PAGO_A_MAIOR')!.mensagem).toContain('excedente de R$ 170,00');
    expect(tipos(r.documentos, 'd1')).toEqual(['ALTCRED_ESTOURADA']);
    expect(r.documentos.get('d2')).toBeUndefined();
  });

  it('baixa em fatura cancelada não conta no uso da ALTCRED, mas marca a fatura', () => {
    const r = avaliarPontos([fat({ isCanceled: true })], [doc({ totalValue: 50 })], [{ documentId: 'd1', invoiceId: 'f1', amount: 100 }]);
    expect(tipos(r.faturas, 'f1')).toEqual(['CANCELADA_COM_BAIXA']);
    expect(r.documentos.size).toBe(0);
  });

  it('vencimento, número repetido, fora do padrão, competência e serviço divergentes, sem OM', () => {
    const r = avaliarPontos([
      fat({ dueDate: '2005-10-15' }),
      fat({ id: 'f2' }),
      fat({ id: 'f3', invoiceNumber: '40030-XX-01', omId: null }),
      fat({ id: 'f4', invoiceNumber: '40030-AE-07-2026-004-0' }),
    ], [], []);
    expect(tipos(r.faturas, 'f1')).toEqual(['NUMERO_REPETIDO', 'VENCIMENTO_INVALIDO']);
    expect(tipos(r.faturas, 'f3')).toEqual(['NUMERO_FORA_PADRAO', 'SEM_CADASTRO']);
    expect(tipos(r.faturas, 'f4')).toEqual(['COMPETENCIA_DIVERGENTE', 'SERVICO_DIVERGENTE']);
  });

  it('sem coluna om_id (undefined) não acusa falta de OM', () => {
    expect(avaliarPontos([fat({ omId: undefined })], [], []).faturas.size).toBe(0);
  });

  it('documento repetido ou sem valor', () => {
    const r = avaliarPontos([], [doc({}), doc({ id: 'd2', totalValue: 0 })], []);
    expect(tipos(r.documentos, 'd2')).toEqual(['DOC_NUMERO_REPETIDO', 'DOC_VALOR_INVALIDO']);
  });
});

describe('ciente, resolvido e reabrir', () => {
  it('automático marcado como ciente fica resolvido; se o valor mudar, volta a aparecer', () => {
    const baixas = [{ documentId: 'd1', invoiceId: 'f1', amount: 130 }];
    const ponto = avaliarPontos([fat({})], [doc({ totalValue: 500 })], baixas).faturas.get('f1')![0];
    const regs = marcarResolvido([], ponto, 'CC Admin', 'devolvido por GRU', '2026-11-07');
    const depois = avaliarPontos([fat({ pontosRegistro: regs })], [doc({ totalValue: 500 })], baixas).faturas.get('f1')!;
    expect(pendentes(depois)).toHaveLength(0);
    expect(depois[0].resolvido).toEqual({ em: '2026-11-07', por: 'CC Admin', justificativa: 'devolvido por GRU' });
    const mudou = avaliarPontos([fat({ pontosRegistro: regs })], [doc({ totalValue: 500 })], [{ ...baixas[0], amount: 140 }]).faturas.get('f1')!;
    expect(pendentes(mudou)).toHaveLength(1);
  });

  it('ponto da migração aparece até ser resolvido e pode ser reaberto', () => {
    const regs = [{ tipo: 'VENCIMENTO_CORRIGIDO', mensagem: 'Vencimento recalculado', origem: 'migracao' as const, em: '2026-11-07' }];
    const p = avaliarPontos([fat({ pontosRegistro: regs })], [], []).faturas.get('f1')!;
    expect(p).toHaveLength(1);
    expect(p[0].automatico).toBe(false);
    const resolvidos = marcarResolvido(regs, p[0], 'Fulano', 'conferido no SIPLAD', '2026-11-08');
    expect(pendentes(avaliarPontos([fat({ pontosRegistro: resolvidos })], [], []).faturas.get('f1'))).toHaveLength(0);
    const reaberto = reabrir(resolvidos, p[0]);
    expect(reaberto).toEqual(regs);
  });

  it('registro de tipo automático gravado pela migração não duplica o recalculado', () => {
    const regs = [{ tipo: 'PAGO_A_MAIOR', mensagem: 'antigo', origem: 'migracao' as const, em: '2026-11-07' }];
    expect(avaliarPontos([fat({ pontosRegistro: regs })], [], []).faturas.size).toBe(0);
  });
});
