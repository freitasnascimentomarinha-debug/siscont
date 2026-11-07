import { describe, it, expect } from 'vitest';
import { NORMAS_PADRAO, PARAM_NORMAS, citarCorrecao, citarPrazo, definirNormas, normasDe, obterNormas } from '../utils/normas';

describe('norma (OI) configurável', () => {
  it('sem parâmetros usa o padrão; com parâmetros usa o cadastrado (vazio volta ao padrão)', () => {
    expect(normasDe([])).toEqual(NORMAS_PADRAO);
    expect(normasDe([{ chave: PARAM_NORMAS.nome, valor: 'OI 41-02' }, { chave: PARAM_NORMAS.itemCorrecao, valor: '7.3' }, { chave: PARAM_NORMAS.itemPrazo, valor: '  ' }]))
      .toEqual({ ...NORMAS_PADRAO, nome: 'OI 41-02', itemCorrecao: '7.3' });
  });
  it('anexos citados nas telas também vêm do cadastro', () => {
    const n = normasDe([{ chave: PARAM_NORMAS.anexoDiaria, valor: 'Anexo M' }, { chave: PARAM_NORMAS.anexoTC, valor: 'Anexo C' }]);
    expect(n.anexoDiaria).toBe('Anexo M'); expect(n.anexoTC).toBe('Anexo C'); expect(n.anexoEstimativa).toBe('Anexo J');
  });
  it('os textos citam a norma carregada', () => {
    definirNormas({ ...NORMAS_PADRAO, nome: 'OI 41-02', itemPrazo: '5.1', itemCorrecao: '7.3' });
    expect(obterNormas().nome).toBe('OI 41-02');
    expect(citarCorrecao()).toBe('OI 41-02, item 7.3');
    expect(citarPrazo()).toBe('OI 41-02, item 5.1');
    definirNormas(NORMAS_PADRAO);
    expect(citarCorrecao()).toBe('OI 40-04, item 6.2');
  });
  it('textos dos pontos de atenção citam a norma carregada', async () => {
    const { TIPOS_PONTO } = await import('../utils/pontosAtencao');
    definirNormas({ ...NORMAS_PADRAO, nome: 'OI 41-02', itemPrazo: '5.1' });
    expect(TIPOS_PONTO.NUMERO_FORA_PADRAO.comoCorrigir).toContain('Padrão da OI 41-02:');
    expect(TIPOS_PONTO.VENCIMENTO_INVALIDO.comoCorrigir).toContain('(OI 41-02, item 5.1)');
    definirNormas(NORMAS_PADRAO);
    expect(TIPOS_PONTO.NUMERO_FORA_PADRAO.comoCorrigir).toContain('Padrão da OI 40-04:');
  });
});
