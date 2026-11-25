import { describe, expect, it } from 'vitest';
import { calcularTaxaAno } from '../utils/taxaConsolidada';
import { analisarVariacoes } from '../utils/analiseVariacao';

const oms = ['A', 'B', 'C'].map(id => ({ id, nome: `OM ${id}`, tipo: 'TERRA', ativo: true }));
const rub = (numero: number, valor: number, extra: any = {}) => ({ numero, descricao: `Rubrica ${numero}`, destino: 'TC', valorPrevisto: valor, descontoGeral: 0, criterio: 'LOTACAO', percentualOM: 100, naviosModo: 'NAO', ...extra });
const ano = (a: number, rubricas: any[], lot: Record<string, number>, matriz: string[], descontos: any[] = []) => {
  const m = new Set(matriz);
  const dados: any = { rubricas, lotacoes: Object.entries(lot).map(([omId, lotacao]) => ({ omId, lotacao })), matriz: m, descontos, atracacaoAnual: [], oms, classes: [] };
  return { ano: a, calc: calcularTaxaAno(dados, a, []), matriz: m, rubricas };
};
const soma = (o: { porCausa: Record<string, number | undefined> }) => Object.values(o.porCausa).reduce((s, v) => s + (v || 0), 0);

describe('Justificativa das variações', () => {
  it('valor da rubrica, lotação própria, entrada de outra OM e lotação das outras: a soma das causas fecha com a diferença', () => {
    const ant = ano(2026, [rub(1, 1000)], { A: 100, B: 100 }, ['1|A', '1|B']);
    const atu = ano(2027, [rub(1, 1200)], { A: 150, B: 100, C: 50 }, ['1|A', '1|B', '1|C']);
    const a = analisarVariacoes(ant, atu).find(o => o.omId === 'A')!;
    expect(a.anualAnterior).toBe(500);
    expect(a.diferenca).toBe(a.anualAtual - 500);
    expect(Math.abs(soma(a) - a.diferenca)).toBeLessThan(0.05);
    expect(a.porCausa.VALOR_RUBRICA).toBe(100);          // (1200 − 1000) × 50%
    expect(a.porCausa.LOTACAO_PROPRIA!).toBeGreaterThan(0);
    expect(a.porCausa.OUTRAS_ENTRARAM!).toBeLessThan(0);  // C passou a dividir
    expect(a.resumo).toMatch(/Aumento de/);
    expect(a.resumo).toMatch(/valor das rubricas 1/);
    expect(a.resumo).toMatch(/lotação da OM \(100 → 150\)/);
    expect(a.rubricas[0].efeitos.find(e => e.causa === 'OUTRAS_ENTRARAM')!.detalhe).toContain('OM C');
  });
  it('OM que entra na rubrica, OM nova e OM que sai', () => {
    const ant = ano(2026, [rub(1, 1000), rub(2, 600)], { A: 100, B: 100 }, ['1|A', '1|B', '2|A']);
    const atu = ano(2027, [rub(1, 1000), rub(2, 600)], { A: 100, B: 100 }, ['1|A', '2|A', '2|B']);
    const r = analisarVariacoes(ant, atu);
    const b = r.find(o => o.omId === 'B')!;
    expect(b.rubricas.find(l => l.numero === 1)!.efeitos[0].causa).toBe('SAIU_RUBRICA');
    expect(b.rubricas.find(l => l.numero === 2)!.efeitos[0].causa).toBe('ENTROU_RUBRICA');
    expect(b.rubricas.find(l => l.numero === 2)!.efeitos[0].detalhe).toMatch(/NÃO fazia parte desta rubrica em 2026.*PASSOU A FAZER PARTE em 2027/);
    expect(b.resumo).toMatch(/PASSOU A FAZER PARTE das rubricas 2/);
    expect(b.resumo).toMatch(/DEIXOU DE FAZER PARTE das rubricas 1/);
    expect(Math.abs(soma(b) - b.diferenca)).toBeLessThan(0.05);
    const novo = analisarVariacoes(ant, ano(2027, [rub(1, 1000)], { A: 100, B: 100, C: 10 }, ['1|A', '1|B', '1|C'])).find(o => o.omId === 'C')!;
    expect(novo.situacao).toBe('NOVA');
    expect(novo.resumo).toMatch(/OM NOVA na taxa condominial — não há dados de 2026/);
    expect(novo.motivoSemAnterior).toMatch(/não constava na lotação nem na matriz/);
    expect(novo.rubricas[0].efeitos[0].detalhe).toMatch(/OM nova na taxa: passou a fazer parte desta rubrica/);
    // tinha lotação mas não estava na matriz
    const semMatriz = analisarVariacoes(ano(2026, [rub(1, 1000)], { A: 100, C: 10 }, ['1|A']), ano(2027, [rub(1, 1000)], { A: 100, C: 10 }, ['1|A', '1|C'])).find(o => o.omId === 'C')!;
    expect(semMatriz.motivoSemAnterior).toMatch(/tinha lotação em 2026, mas não estava marcada em nenhuma rubrica/);
    const saiu = analisarVariacoes(ant, ano(2027, [rub(1, 1000)], { A: 100 }, ['1|A'])).find(o => o.omId === 'B')!;
    expect(saiu.situacao).toBe('SAIU');
  });
  it('rubrica nova, rubrica excluída e mudança de desconto', () => {
    const ant = ano(2026, [rub(1, 1000), rub(3, 400)], { A: 100 }, ['1|A', '3|A'], [{ id: 'd', omId: 'A', rubrica: 1, tipo: 'VALOR', valor: 100, justificativa: '' }]);
    const atu = ano(2027, [rub(1, 1000), rub(4, 300)], { A: 100 }, ['1|A', '4|A'], [{ id: 'd', omId: 'A', rubrica: 1, tipo: 'VALOR', valor: 250, justificativa: '' }]);
    const a = analisarVariacoes(ant, atu)[0];
    expect(a.porCausa.RUBRICA_NOVA).toBe(300);
    expect(a.porCausa.RUBRICA_EXCLUIDA).toBe(-400);
    expect(a.porCausa.DESCONTO).toBe(-150);
    expect(Math.abs(soma(a) - a.diferenca)).toBeLessThan(0.05);
  });
});
