import { describe, it, expect } from 'vitest';
import nodeFs from 'fs';
import jsPDF from 'jspdf';
import { dataIso, ehDescricaoManobra, lerDescricaoManobra, numeroDoArquivo, valorMoeda } from '../utils/importManobras';
import { DadosFr172, pdfFr172 } from '../utils/fr172';

const E = '';
// mesmo desenho dos arquivos da Divisão Marítima (colunas deslocadas, linhas vazias no meio)
const matriz = (): any[][] => [
  ['BASE NAVAL DA ILHA DAS COBRAS'], ['DESCRIÇÃO DE MANOBRA'], [], ['NAVIOS MANOBRADOS', E, 'NPA GURUPI'], ['DATA', E, '06/10/2026; 14/10/2026'], [],
  ['OM SOLICITANTE', E, 'NPA GURUPI'], [], ['MANOBRAS', E, 'MANOBRAS (377; 927)'], ['LOCAL', E, 'AMRJ'], [],
  ['NAVIO / MEIO', 'DIA', 'MANOBRA REALIZADA', 'CUSTO', 'QUANTIDADE DE REBOCADORES', 'LOCAL'], [],
  ['NPA GURUPI', '06/10/26', 'SAI DIQUE', 'R$ 11,735.61', '3', 'AMRJ'],
  ['NPA GURUPI', '14/10/26', '1/3 MANOBRAS DE', 'R$ 7,823.74', '2', 'AMRJ'], [E, E, 'CHATAS DA PORTA BATEL'],
  [], ['TOTAL', 'R$ 19,559.35'], [], ['VICTOR DA SILVA DIB', E, 'JULIANA BALBI'], ['Segundo-Tenente (AA)', E, 'AGENTE DE MANOBRAS'], ['Encarregado da Divisão Marítima'],
  ['OM / NAVIO SOLICITANTE: NPA GURUPI'],
];

describe('Descrição de Manobra (subsídio e anexo da fatura de rebocador)', () => {
  it('valores em inglês, português e número; datas curtas', () => {
    expect(valorMoeda('R$ 1,880.26')).toBe(1880.26); expect(valorMoeda('R$ 1.880,26')).toBe(1880.26); expect(valorMoeda(940.13)).toBe(940.13); expect(valorMoeda('abc')).toBeNull();
    expect(dataIso('06/10/26')).toBe('2026-10-06'); expect(dataIso(46301)).toBe('2026-10-06'); expect(dataIso('14/10/2026')).toBe('2026-10-14');
    expect(numeroDoArquivo('66-2026 GURUPI.xls')).toBe('66-2026'); expect(numeroDoArquivo('67-2026_Descrição.xls')).toBe('67-2026');
  });
  it('lê navio, solicitante, manobras, linhas, total e assinaturas; a linha quebrada vira uma só', () => {
    expect(ehDescricaoManobra(matriz())).toBe(true);
    const d = lerDescricaoManobra('66-2026 GURUPI.xls', matriz())!;
    expect(d.numero).toBe('66-2026'); expect(d.navio).toBe('NPA GURUPI'); expect(d.solicitante).toBe('NPA GURUPI');
    expect(d.linhas).toHaveLength(2); expect(d.linhas[1].manobra).toBe('1/3 MANOBRAS DE CHATAS DA PORTA BATEL');
    expect(d.total).toBe(19559.35); expect(d.totalArquivo).toBe(19559.35); expect(d.mes).toBe('2026-10'); expect(d.avisos).toEqual([]);
    expect(d.encarregado).toEqual({ nome: 'VICTOR DA SILVA DIB', posto: 'Segundo-Tenente (AA)', cargo: 'Encarregado da Divisão Marítima' });
    expect(d.agente).toEqual({ nome: 'JULIANA BALBI', cargo: 'AGENTE DE MANOBRAS' });
    expect(d.rodapeSolicitante).toBe('NPA GURUPI'); expect(d.linhasEmBranco).toBeGreaterThanOrEqual(0);
  });
  it('avisa quando o TOTAL do arquivo não bate com as linhas', () => {
    const m = matriz(); m[17] = ['TOTAL', 'R$ 19,000.00'];
    expect(lerDescricaoManobra('66-2026 X.xls', m)!.avisos.join(' ')).toMatch(/difere da soma/);
  });
  it('arquivo que não é descrição de manobra é ignorado', () => { expect(ehDescricaoManobra([['Planilha qualquer'], ['a', 'b']])).toBe(false); });

  it('PDF da fatura RB: página 1 é a fatura e a página 2 é a Descrição de Manobra anexa', () => {
    const dm = lerDescricaoManobra('66-2026 GURUPI.xls', matriz())!;
    const d: DadosFr172 = {
      numero: '81147-RB-10-2026-003-0', emissao: '2026-11-13', limite: '2026-11-27', mesCompetencia: 10, anoCompetencia: 2026, omUsuaria: 'Navio Patrulha Gurupi', comimsup: 'Comando do 1º Distrito Naval', sigla: 'RB',
      servicoOficial: 'SERVIÇO DE REBOCADOR', valorServico: dm.total, adiantamento: 0, acrescimo: 0, debito: 0, consumo: null, unidade: 'MANOBRA', base: { manobras: [dm] }, altcreds: [], params: { codigo_omps: '40015', instrucao_uno: 'X' },
    } as any;
    const pdf: jsPDF = pdfFr172(d);
    expect(pdf.getNumberOfPages()).toBe(2);
    const t = String(pdf.output()).replace(/\\/g, '');
    expect(t).toContain('66-2026'); expect(t).toContain('DESCRI'); expect(t).toContain('19.559,35');
    if (process.env.SALVAR_PDF) nodeFs.writeFileSync(process.env.SALVAR_PDF, Buffer.from(pdf.output('arraybuffer')));
    expect(pdfFr172({ ...d, base: {} }).getNumberOfPages()).toBe(1);   // sem subsídio, nada de anexo
  });
});
