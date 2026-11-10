import { describe, expect, it } from 'vitest';
import { classificarSituacao, motivoBloqueio, passaFiltroSituacao, podeBaixar } from '../utils/situacaoSiplad';

describe('situação da ALTCRED no SIPLAD', () => {
  it('reconhece cada situação', () => {
    const c = (t: string | null) => classificarSituacao(t).codigo;
    expect(c('Processada')).toBe('PROCESSADA');
    expect(c('Aguardando processamento')).toBe('AGUARDANDO');
    expect(c('Aguardando Processamento')).toBe('AGUARDANDO');
    expect(c('Devolvido à origem')).toBe('DEVOLVIDA');
    expect(c('Não processada')).toBe('NAO_PROCESSADA');
    expect(c('Nao Processada')).toBe('NAO_PROCESSADA');          // "não processada" não é "processada"
    expect(c('Cancelada')).toBe('CANCELADA');
    expect(c('Em análise')).toBe('EM_ANALISE');
    expect(c('Em tramitação')).toBe('EM_ANALISE');
    expect(c('')).toBe('SEM_INFO');
    expect(c(null)).toBe('SEM_INFO');
    expect(c('Algo novo do SIPLAD')).toBe('OUTRA');
  });
  it('só a processada (ou sem informação, das migradas) conta como recebida; devolvida e cancelada vêm desmarcadas', () => {
    expect(classificarSituacao('Processada').recebido).toBe(true);
    expect(classificarSituacao('Aguardando processamento').recebido).toBe(false);
    expect(classificarSituacao('Devolvido à origem').importarPadrao).toBe(false);
    expect(classificarSituacao('Aguardando processamento').importarPadrao).toBe(true);
  });
  it('filtro da lista', () => {
    expect(passaFiltroSituacao('todas', 'Processada')).toBe(true);
    expect(passaFiltroSituacao('PROCESSADA', 'Aguardando processamento')).toBe(false);
    expect(passaFiltroSituacao('NAO_RECEBIDA', 'Devolvido à origem')).toBe(true);
    expect(passaFiltroSituacao('SEM_INFO', null)).toBe(true);
  });
});

import { planejarImportacaoSiplad } from '../services/recebimentosService';
describe('nova importação atualiza a situação', () => {
  const sol = (situacao: string, dataSituacao: string) => ({ numero: 'G1.2026.AC.00009', dataCriacao: '2026-11-09', dataSituacao, tipoAlteracao: 'Indenização', situacao, ugCliente: '40005 - X', ugClienteCodigo: '40005', observacao: '', celulas: [], valor: 10.13, faturasCitadas: [], pagina: 1, avisos: [] } as any);
  const existente = { id: 'd1', documentNumber: 'G1.2026.AC.00009', totalValue: 10.13, availableValue: 10.13, date: '2026-11-09', situacaoSiplad: 'Aguardando processamento', client: 'X', sector: '', command: '', ug: '40005', documentType: 'ALTCRED', operation: 'PAGAMENTO', observation: '', informedAdvance: false } as any;
  const cad = { oms: [], comandos: [], setores: [] };
  it('aguardando → processada: troca a situação e a data do documento passa a ser a do processamento', () => {
    const [p] = planejarImportacaoSiplad([sol('Processada', '2026-11-12')], [existente], cad);
    expect(p.acao).toBe('COMPLETAR');
    expect(p.doc.situacaoSiplad).toBe('Processada');
    expect(p.doc.date).toBe('2026-11-12');
    expect(p.avisos.join(' ')).toMatch(/Aguardando processamento → Processada/);
  });
  it('já processada: a data do documento não muda', () => {
    const [p] = planejarImportacaoSiplad([sol('Processada', '2026-11-12')], [{ ...existente, situacaoSiplad: 'Processada' }], cad);
    expect(p.doc.date).toBe('2026-11-09');
  });
});

describe('baixa só depois de processada', () => {
  it('trava aguardando, em análise, devolvida, cancelada e não processada; libera processada e as sem situação (planilha)', () => {
    ['Aguardando processamento', 'Em análise', 'Devolvido à origem', 'Cancelada', 'Não processada'].forEach(t => { expect(podeBaixar(t)).toBe(false); expect(motivoBloqueio(t)).toMatch(/só dá para dar baixa/); });
    ['Processada', '', null, undefined].forEach(t => { expect(podeBaixar(t)).toBe(true); expect(motivoBloqueio(t)).toBe(''); });
  });
});
