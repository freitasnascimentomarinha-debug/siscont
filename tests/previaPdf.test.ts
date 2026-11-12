import { describe, it, expect } from 'vitest';
import nodeFs from 'fs';
import { pdfPreviaLote } from '../utils/previaFr172';
import { ItemLote } from '../utils/faturamento';

const om = (nome: string, codigo: string) => ({ id: codigo, codigo, nome, tipo: 'NAVIO', setor: 'COMOPNAV', comando: '81000 - Comando do Grupamento', ativo: true } as any);
const item = (n: string, nome: string, valor: number, extra: Partial<ItemLote> = {}): ItemLote => ({
  chave: n, omId: n, om: om(nome, n.slice(0, 5)), sigla: 'EL', servico: 'Energia elétrica', unidade: 'KWH', quantidade: 100, quantidade2: null, valor, acrescimo: 0, debito: 0,
  base: { regra: 'x' }, avisos: [], numero: n, ...extra,
});
const opcoes = { tipo: 'MENSAL' as const, competencia: '2026-10', emissao: '2026-11-16', limite: '2026-11-30', vencimento: '2026-12-16', servicos: [], params: { codigo_omps: '40015', instrucao_uno: 'X' } };

describe('PDF da prévia do lote', () => {
  it('capa + uma fatura por item, com marca d\'água e faixa em TODAS as páginas', () => {
    const itens = [item('81147-EL-10-2026-001-0', 'Navio Patrulha Gurupi', 1000), item('81148-EL-10-2026-002-0', 'Navio Patrulha Macaé', 2500.5, { venceNaLimite: true })];
    const doc = pdfPreviaLote(itens, opcoes);
    expect(doc.getNumberOfPages()).toBe(3);   // capa + 2 faturas
    const t = String(doc.output()).replace(/\\/g, '');
    expect((t.match(/NÃO EMITIDA|N.O EMITIDA/g) || []).length).toBeGreaterThanOrEqual(3);
    expect(t).toContain('3.500,50');
    if (process.env.SALVAR_PDF) nodeFs.writeFileSync(process.env.SALVAR_PDF, Buffer.from(doc.output('arraybuffer')));
  });
});
