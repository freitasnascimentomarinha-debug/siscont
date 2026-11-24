import { describe, expect, it } from 'vitest';
import { alteracaoLegivel, valorLegivel } from '../utils/auditoriaLegivel';
import type { RegistroAuditoria } from '../utils/auditoria';

const reg = (p: Partial<RegistroAuditoria>): RegistroAuditoria => ({ id: 1, tabela: 'invoices', registroId: 'x', acao: 'UPDATE', em: '2026-11-24T15:56:24Z', usuarioId: 'u', usuarioEmail: 'admin@siscont.com', antes: {}, depois: {}, ...p });

describe('histórico em linguagem simples', () => {
  it('formata datas, dinheiro, sim/não e vazio', () => {
    expect(valorLegivel('due_date', '2025-11-15')).toBe('15/11/2025');
    expect(valorLegivel('value', 19707.4)).toBe('R$ 19.707,40');
    expect(valorLegivel('is_canceled', true)).toBe('Sim');
    expect(valorLegivel('cancelamento_motivo', null)).toBe('em branco');
    expect(valorLegivel('enviada_em', '2026-11-24T15:56:24+00:00')).toMatch(/^24\/11\/2026 \d{2}:\d{2}$/);
  });
  it('troca o nome técnico do campo pelo nome em português', () => {
    const a = alteracaoLegivel(reg({ antes: { value: 19707.4, due_date: '2025-11-15' }, depois: { value: 209093.3, due_date: '2025-11-30' } }));
    expect(a.verbo).toBe('Alterou');
    expect(a.campos).toEqual([
      { rotulo: 'Vencimento', de: '15/11/2025', para: '30/11/2025' },
      { rotulo: 'Valor do serviço (01)', de: 'R$ 19.707,40', para: 'R$ 209.093,30' },
    ]);
  });
  it('cancelamento: motivo e quem cancelou saem com rótulo claro', () => {
    const a = alteracaoLegivel(reg({ antes: { cancelada_por: null, cancelamento_motivo: null }, depois: { cancelada_por: 'Administrador', cancelamento_motivo: 'Cancelada dia 18/09/26 por solicitação do OD' } }));
    expect(a.campos.map(c => c.rotulo).sort()).toEqual(['Cancelada por', 'Motivo do cancelamento']);
  });
  it('pontos de atenção viram frases (resolvido por quem, quando e o motivo)', () => {
    const p = { tipo: 'VALOR_DIVERGENTE_LIVRO', mensagem: 'm', origem: 'migracao', em: '2026-11-07' };
    const a = alteracaoLegivel(reg({ antes: { pontos_atencao: [p] }, depois: { pontos_atencao: [{ ...p, resolvido: true, resolvidoPor: 'Administrador', resolvidoEm: '2026-11-24', justificativa: 'Valor original R$ 209.093,30' }] } }));
    expect(a.frases).toHaveLength(1);
    expect(a.frases[0]).toContain('Valor diferente do livro de emissão');
    expect(a.frases[0]).toContain('resolvido por Administrador em 24/11/2026');
    expect(a.frases[0]).toContain('Valor original R$ 209.093,30');
    expect(a.campos).toEqual([]);
    expect(a.soTecnico).toBe(false);
  });
  it('mudança só de campo técnico é marcada como atualização interna', () => {
    expect(alteracaoLegivel(reg({ antes: { base_calculo: { a: 1 } }, depois: { base_calculo: { a: 2 } } })).soTecnico).toBe(true);
  });
  it('inclusão e exclusão usam os verbos certos', () => {
    expect(alteracaoLegivel(reg({ acao: 'INSERT', antes: null, depois: { invoice_number: '1-AE-01-2026-001-0', value: 10 } })).verbo).toBe('Incluiu');
    expect(alteracaoLegivel(reg({ acao: 'DELETE', antes: { invoice_number: '1' }, depois: null })).verbo).toBe('Excluiu');
  });
});
