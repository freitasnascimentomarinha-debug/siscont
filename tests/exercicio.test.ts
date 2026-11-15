import { describe, it, expect } from 'vitest';
import { anoCorrente, desdePadrao, exercicio } from '../services/exercicio';

describe('janela de exercícios', () => {
  it('abre em "todos os anos" e avisa quem ouve ao mudar', () => {
    expect(exercicio.get()).toBeNull();
    let avisos = 0; const parar = exercicio.subscribe(() => { avisos++; });
    exercicio.set(2025); expect(exercicio.get()).toBe(2025);
    exercicio.set(2025); expect(avisos).toBe(1);               // mesmo valor: não avisa de novo
    exercicio.set(null); expect(exercicio.get()).toBeNull(); expect(avisos).toBe(2);
    parar();
  });
  it('incluirAno só amplia a janela, nunca a reduz, e não mexe em "todos"', () => {
    exercicio.set(null); exercicio.incluirAno(2020); expect(exercicio.get()).toBeNull();
    exercicio.set(2025); exercicio.incluirAno(2023); expect(exercicio.get()).toBe(2023);
    exercicio.incluirAno(2024); expect(exercicio.get()).toBe(2023);
    exercicio.set(null);
  });
  it('a janela nunca passa do ano corrente; o padrão recomendado é o ano anterior', () => {
    exercicio.set(anoCorrente() + 5); expect(exercicio.get()).toBe(anoCorrente()); exercicio.set(null);
    expect(desdePadrao()).toBe(anoCorrente() - 1);
  });
});
