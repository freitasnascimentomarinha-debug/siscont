import { describe, expect, it } from 'vitest';
import { ehErroDeVersaoNova, podeRecarregar } from '../utils/novaVersao';

describe('versão nova publicada com a aba aberta', () => {
  it('reconhece o erro de arquivo de tela que sumiu (Chrome, Firefox e Safari)', () => {
    expect(ehErroDeVersaoNova(new Error('Failed to fetch dynamically imported module: https://x/assets/ReceivedBalances-abc.js'))).toBe(true);
    expect(ehErroDeVersaoNova(new Error('error loading dynamically imported module: https://x/assets/Contestacoes-1.js'))).toBe(true);
    expect(ehErroDeVersaoNova(new Error('Importing a module script failed.'))).toBe(true);
    expect(ehErroDeVersaoNova(new Error('Cannot read properties of undefined (reading "x")'))).toBe(false);
  });
  it('recarrega a cada nova versão, com trava de 30 s contra laço', () => {
    expect(podeRecarregar(100000, null)).toBe(true);        // nunca recarregou
    expect(podeRecarregar(100000, 90000)).toBe(false);      // recarregou há 10 s: não repete
    expect(podeRecarregar(100000, 60000)).toBe(true);       // há 40 s: pode (outra publicação na mesma sessão)
    expect(podeRecarregar(100000, Number.NaN)).toBe(true);  // valor antigo "1" ou lixo no storage
  });
});
