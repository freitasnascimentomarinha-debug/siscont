import { describe, it, expect } from 'vitest';
import jsPDF from 'jspdf';
import { chavesDoComando, comandosDasLinhas, dadosFicha } from '../utils/fichaPainel';
import { pdfFicha } from '../utils/pdfFicha';
import { definirAssinatura } from '../utils/assinatura';
import { CRITERIOS_PADRAO, FaturaGer, linhasOM } from '../utils/painelGerencial';

const hoje = '2026-11-11';
const f = (id: string, omId: string, cliente: string, comando: string, saldo: number, venc: string, extra: Partial<FaturaGer> = {}): FaturaGer => ({
  id, numero: `N-${id}`, cliente, comando, setor: 'CGCFN', tipo: 'TC', ano: 2026, mes: 5, emissao: '2026-05-15', vencimento: venc, total: saldo, pago: 0, saldo, contestada: false, cancelada: false,
  omId, extra: false, quitadaExterna: false, quitadaEm: null, pontos: 0, ...extra,
} as any);
const fs = [f('1', 'a', 'Batalhão Naval', '31050 - Batalhão Naval', 1000, '2026-06-15'), f('2', 'a', 'Batalhão Naval', '31050 - Batalhão Naval', 500, '2026-12-15'),
  f('3', 'b', 'ARES-MAS', '31050 - Batalhão Naval', 300, '2026-07-01'), f('4', 'c', 'Outra OM', '99999 - Outro comando', 700, '2026-06-01')];
const linhas = linhasOM(fs, new Map(), hoje, CRITERIOS_PADRAO);
const entrada = { hoje, fs, recebimentos: [], linhas, contest: [], cobrancas: [] };

describe('extrato do comando e da OM', () => {
  it('lista os comandos e as OM de cada um', () => {
    expect(comandosDasLinhas(linhas)).toEqual(['31050 - Batalhão Naval', '99999 - Outro comando']);
    expect(chavesDoComando(linhas, '31050 - Batalhão Naval').sort()).toEqual(['a', 'b']);
  });
  it('o comando soma as OM dele (e só elas)', () => {
    const d = dadosFicha(entrada, chavesDoComando(linhas, '31050 - Batalhão Naval'), 'comando', '31050 - Batalhão Naval');
    expect(d.kpis).toMatchObject({ emAberto: 1800, qtdAberto: 3, vencido: 1300, qtdVencidas: 2 });
    expect(d.oms.map(l => l.cliente)).toEqual(['Batalhão Naval', 'ARES-MAS']);          // da maior dívida vencida para a menor
    expect(d.abertas.map(a => a.f.numero)).toEqual(['N-3', 'N-1', 'N-2']);               // por OM e depois por vencimento
    expect(d.abertas.find(a => a.f.numero === 'N-2')!.situacao).toBe('a vencer');
    expect(d.porFaixa['A vencer']).toBe(500);
  });
  it('a OM mostra só as faturas dela', () => {
    const d = dadosFicha(entrada, ['b'], 'om', 'ARES-MAS');
    expect(d.kpis.emAberto).toBe(300); expect(d.abertas).toHaveLength(1); expect(d.oms).toHaveLength(1);
  });
  it('PDF da OM e do comando: assinatura com nome e vencimento em coluna própria', () => {
    definirAssinatura({ nome: 'Jéssica Caroline Queiroz', posto: 'Capitão de Corveta (IM)', cargo: 'Encarregado da Divisão de Contabilidade' });
    const texto = (doc: jsPDF) => String(doc.output()).replace(/\\/g, '');
    const cmd = pdfFicha(dadosFicha(entrada, ['a', 'b'], 'comando', '31050 - Batalhão Naval'));
    const om = pdfFicha(dadosFicha(entrada, ['a'], 'om', 'Batalhão Naval'));
    [cmd, om].forEach(doc => { const t = texto(doc); expect(t).toContain('QUEIROZ'); expect(t).toContain('Vencimento'); expect(t).toContain('ASSINADO DIGITALMENTE'); expect(t).toContain('N-1'); });
    expect(texto(cmd)).toContain('Extrato de situa'); expect(texto(cmd)).toContain('TOTAL DO COMANDO'); expect(texto(cmd)).toContain('ARES-MAS');
    expect(texto(om)).not.toContain('ARES-MAS');
  });
});
