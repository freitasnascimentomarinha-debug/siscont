import { describe, expect, it } from 'vitest';
import { dataMsg, somarDias, trocarDataNoTexto } from '../utils/cobrancaMensagem';

describe('datas da mensagem de cobrança', () => {
  it('formato naval: 18AGO e 18NOV2026', () => {
    expect(dataMsg('2026-08-18')).toBe('18AGO');
    expect(dataMsg('2026-11-18', true)).toBe('18NOV2026');
    expect(dataMsg('2026-01-05')).toBe('05JAN');
  });
  it('soma dias corridos', () => { expect(somarDias('2026-11-10', 30)).toBe('2026-12-10'); expect(somarDias('2026-12-20', 15)).toBe('2027-01-04'); });
  it('trocar a data mantém o resto do texto editado e não confunde 18NOV com 18NOV2026', () => {
    const t = 'texto EDITADO ... até 18NOV; ... prazo até 18NOV2026.';
    expect(trocarDataNoTexto(t, '2026-11-18', '2026-11-25', false)).toBe('texto EDITADO ... até 25NOV; ... prazo até 18NOV2026.');
    expect(trocarDataNoTexto(t, '2026-11-18', '2027-02-03', true)).toBe('texto EDITADO ... até 18NOV; ... prazo até 03FEV2027.');
    expect(trocarDataNoTexto(t, '2026-11-18', '2026-11-18', true)).toBe(t);
  });
});
