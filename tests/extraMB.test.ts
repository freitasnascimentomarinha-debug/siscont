import { describe, expect, it } from 'vitest';
import { FaturaEx, GruEx, TEXTO_EMAIL_ENVIO, alertaGru, emailEnvio, resumoExtraMB, situacaoEx } from '../utils/extraMB';

const f = (p: Partial<FaturaEx>): FaturaEx => ({ id: Math.random().toString(36), numero: 'X', omId: 'itau', cliente: 'Banco Itaú', tipo: 'Aluguel', ano: 2026, mes: 8, emissao: '2026-08-15', vencimento: '2026-09-15', valor: 100, pago: 0, saldo: 100, cancelada: false, contestada: false, grus: [], ...p });
const g = (p: Partial<GruEx>): GruEx => ({ id: Math.random().toString(36), numero: 'GRU 1', dataPagamento: '2026-03-10', cliente: 'Banco Itaú', omId: 'itau', valor: 100, disponivel: 0, faturas: [], ...p });
const hoje = '2026-11-08';

describe('Extra-Marinha', () => {
  it('situação da fatura', () => {
    expect(situacaoEx(f({}), hoje)).toBe('vencida');
    expect(situacaoEx(f({ vencimento: '2026-12-15' }), hoje)).toBe('a vencer');
    expect(situacaoEx(f({ saldo: 0 }), hoje)).toBe('paga');
    expect(situacaoEx(f({ contestada: true }), hoje)).toBe('contestada');
    expect(situacaoEx(f({ cancelada: true }), hoje)).toBe('cancelada');
  });
  it('resumo por cliente: faturado no ano, recebido por GRU, em aberto sem contestadas e crédito sem fatura', () => {
    const r = resumoExtraMB([
      f({ valor: 32900, saldo: 0, pago: 32900 }), f({ valor: 32900, saldo: 32900 }), f({ valor: 500, saldo: 500, contestada: true }),
      f({ ano: 2025, valor: 1000, saldo: 1000, vencimento: '2025-10-15' }), f({ valor: 999, saldo: 0, cancelada: true }),
      f({ omId: 'bb', cliente: 'Banco do Brasil', valor: 200, saldo: 200, vencimento: '2026-12-10' }),
    ], [g({ valor: 32900, dataPagamento: '2026-09-10' }), g({ valor: 35093.33, disponivel: 35093.33, dataPagamento: '2026-03-10' }), g({ valor: 50, dataPagamento: '2025-12-01' })], 2026, hoje);
    const itau = r.linhas.find(l => l.cliente === 'Banco Itaú')!;
    expect(itau.faturado).toBe(66300);
    expect(itau.recebido).toBe(67993.33);
    expect(itau.emAberto).toBe(33900);
    expect(itau.vencido).toBe(33900);
    expect(itau.contestado).toBe(500);
    expect(itau.creditoGru).toBe(35093.33);
    expect(itau.maisAntiga).toBe('2025-10-15');
    expect(r.linhas[0].cliente).toBe('Banco Itaú');
    expect(r.total.aVencer).toBe(200);
  });
  it('alerta das GRU', () => {
    expect(alertaGru(g({ disponivel: 35093.33, faturas: [{ numero: '40015-AL-02-2026-005-0', valor: 35093.33, cancelada: true }] }))).toMatch(/fatura cancelada/);
    expect(alertaGru(g({ disponivel: 100 }))).toBe('sem fatura vinculada');
    expect(alertaGru(g({ faturas: [{ numero: 'A', valor: 100, cancelada: false }] }))).toBe('');
  });
  it('e-mail de envio: texto do modelo, assunto com a competência e lista opcional', () => {
    const m = emailEnvio('Banco Itaú', [f({ numero: '40015-AL-08-2026-005-0', valor: 32900, saldo: 32900 })], { incluirLista: true });
    expect(m.texto.startsWith(TEXTO_EMAIL_ENVIO)).toBe(true);
    expect(m.texto).toContain('Prezado Sr (a) Gerente,');
    expect(m.texto).toContain('Solicito confirmar o recebimento deste e-mail');
    expect(m.texto).toContain('- 40015-AL-08-2026-005-0 · Aluguel · competência 08/2026 · vencimento 15/09/2026 · R$ 32.900,00');
    expect(m.assunto).toBe('Faturas BNIC — Banco Itaú — competência 08/2026');
    expect(emailEnvio('Banco Itaú', [f({})], { incluirLista: false }).texto).toBe(TEXTO_EMAIL_ENVIO);
  });
});

import { ContratoEx, alertasContratos, alertasGru } from '../utils/extraMB';
describe('contratos Extra-MB: alertas', () => {
  const c = (p: Partial<ContratoEx>): ContratoEx => ({ id: 'c', omId: 'itau', numero: '01/2024', servico: 'AL', inicio: '2024-01-01', fim: '2027-12-31', valorMensal: 32900, ativo: true, ...p });
  const nome = () => 'Banco Itaú';
  const fats = [f({ numero: '40015-AL-09-2026-005-0', mes: 9, valor: 32900 }), f({ numero: '40015-AL-10-2026-005-0', mes: 10, valor: 32900 })];
  it('contrato em dia: nenhum alerta', () => expect(alertasContratos([c({})], fats, nome, hoje)).toEqual([]));
  it('vencido, vencendo, reajuste e desativado', () => {
    expect(alertasContratos([c({ fim: '2026-10-31' })], fats, nome, hoje).map(a => a.tipo)).toContain('Contrato vencido');
    expect(alertasContratos([c({ fim: '2026-12-20' })], fats, nome, hoje).map(a => [a.tipo, a.gravidade])).toContainEqual(['Contrato vencendo', 'media']);
    expect(alertasContratos([c({ mesReajuste: 12, indiceReajuste: 'IPCA' })], fats, nome, hoje)[0].mensagem).toMatch(/IPCA em dezembro/);
    expect(alertasContratos([c({ fim: '2020-01-01', ativo: false })], fats, nome, hoje)).toEqual([]);
  });
  it('valor faturado diferente do contrato e competência sem fatura', () => {
    expect(alertasContratos([c({ valorMensal: 35093.33 })], fats, nome, hoje)[0].mensagem).toMatch(/Competência 10\/2026: faturado R\$ 32\.900,00; o contrato prevê R\$ 35\.093,33/);
    const outro = [...fats, f({ omId: 'bb', cliente: 'BB', numero: '40015-AL-11-2026-001-0', mes: 11, valor: 10 })];
    expect(alertasContratos([c({})], outro, nome, hoje).map(a => a.tipo)).toContain('Sem fatura na competência');
    // vários contratos do mesmo serviço (Itaú com 3 aluguéis): basta o valor existir na competência
    const tres = [f({ numero: '40015-AL-10-2026-005-0', mes: 10, valor: 32900 }), f({ numero: '40015-AL-10-2026-006-0', mes: 10, valor: 35093.33 })];
    expect(alertasContratos([c({}), c({ id: 'd', numero: '02/2024', valorMensal: 35093.33 })], tres, nome, hoje)).toEqual([]);
  });
  it('GRU no mesmo formato', () => {
    const a = alertasGru([g({ disponivel: 35093.33, valor: 35093.33, faturas: [{ numero: '40015-AL-02-2026-005-0', valor: 35093.33, cancelada: true }] })]);
    expect(a[0]).toMatchObject({ gravidade: 'alta', tipo: 'GRU', cliente: 'Banco Itaú' });
  });
});
