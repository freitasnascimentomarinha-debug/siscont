import { describe, it, expect } from 'vitest';
import { NORMAS_PADRAO, PARAM_NORMAS, citarCorrecao, citarPrazo, definirNormas, normasDe, obterNormas } from '../utils/normas';

describe('norma (OI) configurável', () => {
  it('sem parâmetros usa o padrão; com parâmetros usa o cadastrado (vazio volta ao padrão)', () => {
    expect(normasDe([])).toEqual(NORMAS_PADRAO);
    expect(normasDe([{ chave: PARAM_NORMAS.nome, valor: 'OI 41-02' }, { chave: PARAM_NORMAS.itemCorrecao, valor: '7.3' }, { chave: PARAM_NORMAS.itemPrazo, valor: '  ' }]))
      .toEqual({ ...NORMAS_PADRAO, nome: 'OI 41-02', itemCorrecao: '7.3' });
  });
  it('anexos citados nas telas também vêm do cadastro', () => {
    const n = normasDe([{ chave: PARAM_NORMAS.anexoDiaria, valor: 'Anexo M' }, { chave: PARAM_NORMAS.anexoTC, valor: 'Anexo C' }]);
    expect(n.anexoDiaria).toBe('Anexo M'); expect(n.anexoTC).toBe('Anexo C'); expect(n.anexoEstimativa).toBe('Anexo J');
  });
  it('os textos citam a norma carregada', () => {
    definirNormas({ ...NORMAS_PADRAO, nome: 'OI 41-02', itemPrazo: '5.1', itemCorrecao: '7.3' });
    expect(obterNormas().nome).toBe('OI 41-02');
    expect(citarCorrecao()).toBe('OI 41-02, item 7.3');
    expect(citarPrazo()).toBe('OI 41-02, item 5.1');
    definirNormas(NORMAS_PADRAO);
    expect(citarCorrecao()).toBe('OI 40-04, item 6.2');
  });
  it('textos dos pontos de atenção citam a norma carregada', async () => {
    const { TIPOS_PONTO } = await import('../utils/pontosAtencao');
    definirNormas({ ...NORMAS_PADRAO, nome: 'OI 41-02', itemPrazo: '5.1' });
    expect(TIPOS_PONTO.NUMERO_FORA_PADRAO.comoCorrigir).toContain('Padrão da OI 41-02:');
    expect(TIPOS_PONTO.VENCIMENTO_INVALIDO.comoCorrigir).toContain('(OI 41-02, item 5.1)');
    definirNormas(NORMAS_PADRAO);
    expect(TIPOS_PONTO.NUMERO_FORA_PADRAO.comoCorrigir).toContain('Padrão da OI 40-04:');
  });
});

describe('pontos de atenção registrados por quem confere os dados', () => {
  it('o ponto informativo aparece na fatura cancelada junto do automático "cancelada com baixa", com gravidade baixa', async () => {
    const { avaliarPontos } = await import('../utils/pontosAtencao');
    const fatura: any = { id: 'f1', invoiceNumber: '41000-TC-09-2025-002-0', value: 19707.4, issueDate: '2025-10-15', dueDate: '2025-11-15', monthCompetence: 9, yearCompetence: 2025, serviceAcronym: 'TC', isCanceled: true, omId: 'o1',
      pontosRegistro: [{ tipo: 'CANCELAMENTO_A_VERIFICAR', mensagem: 'verificar', origem: 'usuario', em: '2026-11-08' }] };
    const doc: any = { id: 'd1', documentNumber: 'B4D0.2026.AC.00824', documentType: 'ALTCRED', totalValue: 5210.74, operation: 'PAGAMENTO',
      pontosRegistro: [{ tipo: 'CREDITO_DE_FATURA_CANCELADA', mensagem: 'crédito do Arsenal', origem: 'usuario', em: '2026-11-08' }] };
    const r = avaliarPontos([fatura], [doc], [{ documentId: 'd1', invoiceId: 'f1', amount: 5210.74 }]);
    const pf = r.faturas.get('f1')!;
    expect(pf.map(p => p.tipo)).toEqual(['CANCELADA_COM_BAIXA', 'CANCELAMENTO_A_VERIFICAR']);
    expect(pf[1]).toMatchObject({ gravidade: 'baixa', automatico: false, titulo: 'Cancelamento a verificar' });
    expect(r.documentos.get('d1')!.map(p => p.tipo)).toContain('CREDITO_DE_FATURA_CANCELADA');
  });
});
