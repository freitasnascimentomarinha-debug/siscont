import { describe, it, expect } from 'vitest';
import nodeFs from 'fs';
import jsPDF from 'jspdf';
import { tabelaPdf } from '../utils/pdfCabecalho';
import { dadosFicha } from '../utils/fichaPainel';
import { pdfFicha } from '../utils/pdfFicha';
import { CRITERIOS_PADRAO, linhasOM } from '../utils/painelGerencial';

/** Linhas de texto de todas as células da última tabela desenhada (depois do ajuste de largura). */
const linhasDasCelulas = (doc: jsPDF): string[] => {
  const t = (doc as any).lastAutoTable;
  return [...t.head, ...t.body, ...t.foot].flatMap((r: any) => Object.values(r.cells).flatMap((c: any) => c.text as string[]));
};

describe('PDF: o valor em reais nunca se divide em duas linhas', () => {
  it('tabela estreita com valores grandes: "R$" e o número ficam juntos', () => {
    const doc = new jsPDF();
    tabelaPdf(doc, {
      head: [['Em aberto', 'Vencido', 'Contestado', 'Variação']],
      body: [['R$ 2.704.887,35\n24 fatura(s)', 'R$ 1.685.257,74\n18 fatura(s)', 'R$ 0,00', '+R$ 272.477,93']],
      foot: [['R$ 2.704.887,35', 'R$ 1.685.257,74', '', '']],
    });
    const linhas = linhasDasCelulas(doc);
    expect(linhas.some(l => /R\$ [\d.]+,\d{2}/.test(l))).toBe(true);
    expect(linhas.filter(l => /^R\$$/.test(l.trim()) || /R\$\s*$/.test(l))).toEqual([]);      // nenhuma linha termina em "R$"
    expect(linhas.filter(l => /^[\d.]+,\d{2}$/.test(l.trim()))).toEqual([]);                  // nem começa só com o número
  });

  it('extrato da OM com valores de milhões: os quatro quadros do topo não quebram o valor', () => {
    const hoje = '2026-11-11';
    const f = (id: string, v: number, venc: string) => ({ id, numero: `N-${id}`, cliente: 'Batalhão Naval', comando: '31050 - Batalhão Naval', setor: 'CGCFN', tipo: 'TC', ano: 2026, mes: 5, emissao: '2026-05-15', vencimento: venc, total: v, pago: 0, saldo: v, contestada: false, cancelada: false, omId: 'a', extra: false, quitadaExterna: false, quitadaEm: null, pontos: 0 } as any);
    const fs = [f('1', 1685257.74, '2026-06-15'), f('2', 1019629.61, '2026-12-15')];
    const linhas = linhasOM(fs, new Map(), hoje, CRITERIOS_PADRAO);
    const d = dadosFicha({ hoje, fs, recebimentos: [], linhas, contest: [], cobrancas: [] }, ['a'], 'om', 'Batalhão Naval');
    const doc = pdfFicha(d);
    const texto = String(doc.output()).replace(/\\/g, '');
    expect(texto).toContain('2.704.887,35');
    // nenhuma célula (de nenhuma das tabelas do PDF) com "R$" sozinho no fim da linha
    // (opcional) salva o PDF para conferir a olho: SALVAR_PDF=/caminho/arquivo.pdf npx vitest run tests/pdfValores.test.ts
    if (process.env.SALVAR_PDF) nodeFs.writeFileSync(process.env.SALVAR_PDF, Buffer.from(doc.output('arraybuffer')));
  });
});
