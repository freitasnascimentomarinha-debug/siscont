import { describe, it, expect } from 'vitest';
import { FILTRO_VAZIO, filtrarOMs, linhasOMs, linhasClasses } from '../utils/exportarCadastros';
import { OM } from '../types';

const e = {
  setores: [{ id: 's1', sigla: 'DGN', ordem: 1, ativo: true }, { id: 's2', sigla: 'COMOPNAV', ordem: 2, ativo: true }],
  comandos: [{ id: 'c1', nome: 'Com A', ativo: true }],
  classes: [{ id: 'k1', nome: 'Corvetas Classe Barroso', ativo: true }],
};
const om = (p: Partial<OM>): OM => ({ id: 'x', codigo: '1', nome: 'X', tipo: 'TERRA', ativo: true, ...p } as OM);
const oms = [
  om({ id: '1', codigo: '10', nome: 'Centro de Perícias', setorId: 's1', comandoId: 'c1' }),
  om({ id: '2', codigo: '20', nome: 'Corveta Barroso', tipo: 'NAVIO', setorId: 's2', classeId: 'k1', ativo: false, desativadoEm: '2024-01-01' }),
  om({ id: '3', codigo: '30', nome: 'Nextel (Antena)', tipo: 'EXTRA_MB', foraDaIlha: true, nomesAlternativos: ['Claro'] }),
];

describe('exportar cadastros', () => {
  it('sem filtro exporta tudo', () => expect(filtrarOMs(oms, e, FILTRO_VAZIO)).toHaveLength(3));
  it('filtra por situação, tipo, setor, fora da Ilha e busca (inclusive outros nomes e sem acento)', () => {
    expect(filtrarOMs(oms, e, { ...FILTRO_VAZIO, situacao: 'DESATIVADAS' }).map(o => o.id)).toEqual(['2']);
    expect(filtrarOMs(oms, e, { ...FILTRO_VAZIO, situacao: 'ATIVAS' }).map(o => o.id)).toEqual(['1', '3']);
    expect(filtrarOMs(oms, e, { ...FILTRO_VAZIO, tiposExcluidos: new Set(['Navio']) }).map(o => o.id)).toEqual(['1', '3']);
    expect(filtrarOMs(oms, e, { ...FILTRO_VAZIO, setoresExcluidos: new Set(['DGN']) }).map(o => o.id)).toEqual(['2', '3']);
    expect(filtrarOMs(oms, e, { ...FILTRO_VAZIO, foraDaIlha: 'SIM' }).map(o => o.id)).toEqual(['3']);
    expect(filtrarOMs(oms, e, { ...FILTRO_VAZIO, busca: 'pericias' }).map(o => o.id)).toEqual(['1']);
    expect(filtrarOMs(oms, e, { ...FILTRO_VAZIO, busca: 'claro' }).map(o => o.id)).toEqual(['3']);
  });
  it('monta as linhas com cabeçalho e nomes de setor/comando/classe', () => {
    const l = linhasOMs(oms, e);
    expect(l[0][0]).toBe('Código (UG)');
    const barroso = l.find(r => r[1] === 'Corveta Barroso')!;
    expect(barroso).toContain('Corvetas Classe Barroso'); expect(barroso).toContain('Desativado'); expect(barroso).toContain('2024-01-01');
  });
  it('classes listam navios ativos e desativados', () => {
    const c = linhasClasses(e, oms, 'TODAS');
    expect(c[1]).toEqual(['Corvetas Classe Barroso', 'Ativo', '', '', 'Corveta Barroso']);
  });
});
