import { describe, expect, it } from 'vitest';
import { numeroDigitado } from '../utils/numeroDigitado';

describe('número digitado/mostrado nos campos', () => {
  it('valor vindo do banco com ponto decimal (antes 23.65 virava 2365)', () => {
    expect(numeroDigitado('23.65')).toBe(23.65);
    expect(numeroDigitado('882029.79')).toBe(882029.79);
  });
  it('formato brasileiro', () => {
    expect(numeroDigitado('23,65')).toBe(23.65);
    expect(numeroDigitado('1.234,56')).toBe(1234.56);
    expect(numeroDigitado('1.234.567')).toBe(1234567);
  });
  it('vazio e inteiros', () => {
    expect(numeroDigitado('')).toBeNull();
    expect(numeroDigitado('  ')).toBeNull();
    expect(numeroDigitado('28')).toBe(28);
  });
});
