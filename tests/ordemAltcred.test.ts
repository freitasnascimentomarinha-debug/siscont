import { describe, expect, it } from 'vitest';
import { ordenarPorAntiguidade } from '../utils/altcredSiplad';

describe('ALTCRED importadas: do mais antigo para o mais novo', () => {
  it('ordena pela data de criação; empate pela data da situação e pelo número; sem data de criação usa a da situação; sem nenhuma data vai para o fim', () => {
    const s = (numero: string, dataCriacao: string | null, dataSituacao: string | null = null) => ({ numero, dataCriacao, dataSituacao });
    const r = ordenarPorAntiguidade([
      s('G424.2026.AC.00010', '2026-11-18'), s('G424.2026.AC.00002', '2026-09-03'), s('B4D0.2026.AC.00009', null, null),
      s('G424.2026.AC.00003', '2026-09-03', '2026-09-10'), s('G424.2026.AC.00001', '2026-09-03', '2026-09-05'), s('P3MA.2026.AC.00007', null, '2026-10-01'),
    ]);
    expect(r.map(x => x.numero)).toEqual(['G424.2026.AC.00001', 'G424.2026.AC.00003', 'G424.2026.AC.00002', 'P3MA.2026.AC.00007', 'G424.2026.AC.00010', 'B4D0.2026.AC.00009']);
  });
});
