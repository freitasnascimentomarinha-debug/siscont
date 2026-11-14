import { describe, it, expect } from 'vitest';
import { deveRegistrar } from '../services/errosService';

describe('deveRegistrar', () => {
  it('registra erro real e ignora ruído de navegador/conexão', () => {
    const m = new Map<string, number>();
    expect(deveRegistrar('Cannot read properties of undefined', 1000, m, 0)).toBe(true);
    expect(deveRegistrar('ResizeObserver loop completed with undelivered notifications.', 1000, m, 0)).toBe(false);
    expect(deveRegistrar('Failed to fetch', 1000, m, 0)).toBe(false);
    expect(deveRegistrar('', 1000, m, 0)).toBe(false);
  });
  it('não repete o mesmo erro em 60 s, mas repete depois', () => {
    const m = new Map<string, number>();
    expect(deveRegistrar('erro X', 0, m, 0)).toBe(true);
    expect(deveRegistrar('erro X', 30000, m, 0)).toBe(false);
    expect(deveRegistrar('erro X', 61000, m, 0)).toBe(true);
  });
  it('limita 20 por sessão', () => {
    expect(deveRegistrar('erro Y', 0, new Map(), 20)).toBe(false);
  });
});
