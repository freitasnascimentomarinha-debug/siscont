import { describe, it, expect } from 'vitest';
import { NORMAS_PADRAO, PARAM_NORMAS, citarCorrecao, citarPrazo, definirNormas, normasDe, obterNormas } from '../utils/normas';

describe('norma (OI) configurável', () => {
  it('sem parâmetros usa o padrão; com parâmetros usa o cadastrado (vazio volta ao padrão)', () => {
    expect(normasDe([])).toEqual(NORMAS_PADRAO);
    expect(normasDe([{ chave: PARAM_NORMAS.nome, valor: 'OI 41-02' }, { chave: PARAM_NORMAS.itemCorrecao, valor: '7.3' }, { chave: PARAM_NORMAS.itemPrazo, valor: '  ' }]))
      .toEqual({ nome: 'OI 41-02', itemPrazo: '6.1', itemCorrecao: '7.3' });
  });
  it('os textos citam a norma carregada', () => {
    definirNormas({ nome: 'OI 41-02', itemPrazo: '5.1', itemCorrecao: '7.3' });
    expect(obterNormas().nome).toBe('OI 41-02');
    expect(citarCorrecao()).toBe('OI 41-02, item 7.3');
    expect(citarPrazo()).toBe('OI 41-02, item 5.1');
    definirNormas(NORMAS_PADRAO);
    expect(citarCorrecao()).toBe('OI 40-04, item 6.2');
  });
});
