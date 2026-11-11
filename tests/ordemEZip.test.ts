import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { compararPorTipoENumero, prefixoTipoNumero } from '../utils/faturamento';
import { DadosFr172, zipFr172 } from '../utils/fr172';

const d = (numero: string, pasta: string): DadosFr172 & { pasta: string } => ({
  numero, pasta, emissao: '2026-11-10', limite: '2026-11-24', mesCompetencia: 10, anoCompetencia: 2026, omUsuaria: 'OM', comimsup: 'DIM', sigla: numero.split('-')[1], servicoOficial: 'Serviço',
  valorServico: 1, adiantamento: 0, acrescimo: 0, debito: 0, consumo: '1', unidade: 'X', base: {}, altcreds: [], params: { codigo_omps: '40015', instrucao_uno: 'X', encarregado_nome: 'N' },
} as any);

describe('ordem por tipo e numeração; ZIP único do OND', () => {
  const numeros = ['40032-EL-10-2026-002-0', '40030-AE-10-2026-010-0', '40031-AE-10-2026-002-0', '40030-EL-10-2026-001-0', '40030-AE-10-2026-002-1', '40030-AE-10-2026-002-0'];
  it('compara por sigla do serviço e depois pela sequência (e versão)', () => {
    expect([...numeros].sort(compararPorTipoENumero)).toEqual(['40030-AE-10-2026-002-0', '40030-AE-10-2026-002-1', '40031-AE-10-2026-002-0', '40030-AE-10-2026-010-0', '40030-EL-10-2026-001-0', '40032-EL-10-2026-002-0']);
    expect(prefixoTipoNumero('40030-AE-10-2026-010-0')).toBe('AE-010');
  });
  it('ZIP único (OND): sem pastas, arquivos com tipo e sequência na frente, em ordem', async () => {
    const blob = await zipFr172(numeros.map(n => d(n, n.startsWith('40030') ? '40030 - Comando A' : '40031 - Comando B')), { unico: true });
    const z = await JSZip.loadAsync(await blob.arrayBuffer());
    const nomes = Object.keys(z.files);
    expect(nomes.every(n => !n.includes('/'))).toBe(true);
    expect(nomes).toEqual(['AE-002_40030-AE-10-2026-002-0.pdf', 'AE-002_40030-AE-10-2026-002-1.pdf', 'AE-002_40031-AE-10-2026-002-0.pdf', 'AE-010_40030-AE-10-2026-010-0.pdf', 'EL-001_40030-EL-10-2026-001-0.pdf', 'EL-002_40032-EL-10-2026-002-0.pdf']);
  });
  it('ZIP padrão (mensal): continua em pastas por comando', async () => {
    const blob = await zipFr172(numeros.map(n => d(n, n.startsWith('40030') ? 'Comando A' : 'Comando B')));
    const z = await JSZip.loadAsync(await blob.arrayBuffer());
    expect(Object.keys(z.files).filter(n => n.endsWith('.pdf')).every(n => /^Comando [AB]\//.test(n))).toBe(true);
  });
});
