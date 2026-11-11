import { describe, it, expect, beforeEach } from 'vitest';
import jsPDF from 'jspdf';
import { CARGO_PADRAO, assinaturaDe, definirAssinatura, obterAssinatura } from '../utils/assinatura';
import { cabecalhoCompacto, finalizarPdf, tabelaPdf, tituloRelatorio } from '../utils/pdfCabecalho';
import { DadosFr172, pdfFr172 } from '../utils/fr172';

const texto = (d: jsPDF) => String(d.output()).replace(/\\/g, '');
function relatorio(opts: Parameters<typeof finalizarPdf>[1] = {}) {
  const doc = new jsPDF(); cabecalhoCompacto(doc);
  const y = tituloRelatorio(doc, 'Teste', 'Posição'); tabelaPdf(doc, { startY: y, head: [['a']], body: [['1']] });
  return finalizarPdf(doc, opts);
}

describe('assinatura dos PDFs: mesma regra das faturas, com nome, posto e cargo editáveis', () => {
  beforeEach(() => definirAssinatura({ nome: '', posto: '', cargo: CARGO_PADRAO }));

  it('lê os parâmetros: cargo vazio volta ao padrão "Encarregado da Divisão de Contabilidade"', () => {
    expect(assinaturaDe([{ chave: 'encarregado_nome', valor: ' Jéssica ' }, { chave: 'encarregado_posto', valor: 'Capitão de Corveta (IM)' }]))
      .toEqual({ nome: 'Jéssica', posto: 'Capitão de Corveta (IM)', cargo: CARGO_PADRAO });
    expect(assinaturaDe({ encarregado_cargo: 'Chefe da Divisão' }).cargo).toBe('Chefe da Divisão');
  });
  it('relatório: nome em maiúsculas, posto/graduação, cargo e "ASSINADO DIGITALMENTE"', () => {
    definirAssinatura({ nome: 'Jéssica Caroline da S. Sampaio Queiroz', posto: 'Capitão de Corveta (IM)', cargo: CARGO_PADRAO });
    const t = texto(relatorio());
    expect(t).toContain('SAMPAIO QUEIROZ'); expect(t).toContain('Capit'); expect(t).toContain(CARGO_PADRAO); expect(t).toContain('ASSINADO DIGITALMENTE');
    expect(obterAssinatura().posto).toBe('Capitão de Corveta (IM)');
  });
  it('o cargo pode ser alterado e vale nos relatórios', () => {
    definirAssinatura({ nome: 'Fulano', posto: '1º Tenente', cargo: 'Chefe da Divisão de Contabilidade' });
    const t = texto(relatorio());
    expect(t).toContain('Chefe da Divisão de Contabilidade'); expect(t).not.toContain('Encarregado da Divisão de Contabilidade');
  });
  it('sem nome cadastrado a linha de assinatura fica em branco, como nas faturas', () => {
    expect(texto(relatorio())).toContain('______________________________');
  });
  it('a fatura usa o cargo dos parâmetros (padrão idêntico ao de sempre)', () => {
    const d: DadosFr172 = {
      numero: '40030-EL-10-2026-001-0', emissao: '2026-11-10', limite: '2026-11-24', mesCompetencia: 10, anoCompetencia: 2026, omUsuaria: 'OM', comimsup: 'DIM', sigla: 'EL', servicoOficial: 'Energia',
      valorServico: 1, adiantamento: 0, acrescimo: 0, debito: 0, consumo: '1', unidade: 'KWH', base: {}, altcreds: [],
      params: { codigo_omps: '40015', instrucao_uno: 'X', encarregado_nome: 'Jéssica', encarregado_posto: 'CC (IM)' },
    };
    expect(texto(pdfFr172(d))).toContain('Encarregado da Divisão de Contabilidade');
    expect(texto(pdfFr172({ ...d, params: { ...d.params, encarregado_cargo: 'Chefe da Divisão' } }))).toContain('Chefe da Divisão');
  });
});
