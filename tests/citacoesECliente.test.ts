import { describe, expect, it } from 'vitest';
import { extrairCitacoesParciais, extrairFaturas } from '../utils/altcredSiplad';
import { proporBaixa } from '../utils/baixaAssistida';
import { planejarImportacaoSiplad } from '../services/recebimentosService';

describe('fatura citada pela OM com formato errado', () => {
  it('texto colado antes do número não esconde a fatura', () => {
    expect(extrairFaturas('Pagamento FAT71000-AE-09-2026-008-0 e NF:71000-TC-09-2026-014-0.')).toEqual(['71000-AE-09-2026-008-0', '71000-TC-09-2026-014-0']);
    expect(extrairFaturas('123471000-AE-09-2026-008-0')).toEqual([]);   // dígitos colados não viram UG
  });
  it('sem a UG e/ou com o serviço colado ao mês: vira sufixo para achar a fatura do cliente', () => {
    expect(extrairCitacoesParciais('quitar RB10-2026-002-0 e rb-11-2026-003-1').map(p => p.sufixo)).toEqual(['RB-10-2026-002-0', 'RB-11-2026-003-1']);
    expect(extrairCitacoesParciais('fatura 41000-RB-10-2026-002-0').length).toBe(0);   // completa: não é parcial
    expect(extrairCitacoesParciais('RB 10-2026-002-0')[0].sufixo).toBe('RB-10-2026-002-0');
  });
  const f = (id: string, numero: string, ug: string, saldo: number, comandoId: string | null = null) => ({ id, numero, ug, cliente: 'Cliente ' + ug, vencimento: '2026-10-30', saldo, comandoId });
  it('baixa assistida: a citação parcial acha a fatura DO CLIENTE (e só dele) e a trata como citada', () => {
    const faturas = [f('a', '41000-RB-10-2026-002-0', '41000', 500), f('b', '41000-TC-10-2026-001-0', '41000', 300), f('c', '99999-RB-10-2026-002-0', '99999', 700)];
    const p = proporBaixa({ saldo: 600, ug: '41000', faturasCitadasParciais: [{ sufixo: 'RB-10-2026-002-0', original: 'RB10-2026-002-0' }] }, faturas);
    const rb = p.itens.find(i => i.numero === '41000-RB-10-2026-002-0')!;
    expect(rb.grupo).toBe('CITADA'); expect(rb.valor).toBe(500); expect(rb.citadaComo).toBe('RB10-2026-002-0');
    expect(p.itens.find(i => i.numero === '41000-TC-10-2026-001-0')!.foraDestinacao).toBe(true);   // há indicação: as demais ficam fora dela
    expect(p.itens.some(i => i.numero.startsWith('99999'))).toBe(false);                          // outro cliente com o mesmo sufixo não entra
  });
});

describe('importação do SIPLAD: cliente do extrato', () => {
  const cad = { oms: [], comandos: [], setores: [] } as any;
  const sol = (over: any) => ({ numero: 'B417.2026.AC.00102', dataCriacao: '2026-11-24', tipoAlteracao: 'Remanejamento', setorCriacao: '64003 - DPM-BSB', altcredOrigem: null, ugCliente: '', ugClienteCodigo: null, situacao: 'Processada', dataSituacao: '2026-11-24', observacao: '', celulas: [{ tipo: 'DEBITO', ugr: '64003 - DPM-BSB', uge: '64003 - DPM-BSB', valor: 20000 }, { tipo: 'CREDITO', ugr: '40015 - BNIC', uge: '40015 - BNIC', valor: 20000 }], valor: 20000, faturasCitadas: [], pagina: 1, avisos: [], ...over });
  it('cliente não cadastrado: mostra o do extrato (UG Cliente ou, se vazia, a UG debitada) e avisa', () => {
    const [vazio] = planejarImportacaoSiplad([sol({})], [], cad);
    expect(vazio.clienteCadastrado).toBe(false);
    expect(vazio.clienteSiplad).toBe('64003 - DPM-BSB');
    expect(vazio.doc.client).toBe('64003 - DPM-BSB');
    expect(vazio.avisos.some(a => /Cliente não cadastrado: 64003 - DPM-BSB/.test(a))).toBe(true);
    const [comUg] = planejarImportacaoSiplad([sol({ ugCliente: '40030 - DIM', ugClienteCodigo: '40030' })], [], cad);
    expect(comUg.clienteSiplad).toBe('40030 - DIM'); expect(comUg.doc.client).toBe('40030 - DIM');
  });
  it('UG cliente vazia, mas a UG debitada está cadastrada: usa o cadastro', () => {
    const cad2 = { oms: [], comandos: [{ id: 'c1', codigo: '64003', nome: 'Diretoria de Pessoal', sigla: 'DPM-BSB', setorId: null }], setores: [] } as any;
    const [p] = planejarImportacaoSiplad([sol({})], [], cad2);
    expect(p.clienteCadastrado).toBe(true); expect(p.doc.client).toBe('64003 - DPM-BSB'); expect(p.doc.ug).toBe('64003');
    expect(p.avisos.some(a => /UG debitada/.test(a))).toBe(true);
  });
});
