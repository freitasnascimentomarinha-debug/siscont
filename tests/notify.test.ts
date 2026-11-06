import { describe, it, expect } from 'vitest';
import { friendlyError, notify } from '../utils/notify';

describe('friendlyError', () => {
  it('traduz bloqueio de RLS', () => {
    expect(friendlyError({ code: '42501', message: 'new row violates row-level security policy' })).toMatch(/Sem permissão/);
  });
  it('traduz duplicidade e rede', () => {
    expect(friendlyError({ code: '23505', message: 'duplicate key' })).toMatch(/duplicado/);
    expect(friendlyError(new Error('Failed to fetch'))).toMatch(/Sem conexão/);
  });
  it('mantém mensagens desconhecidas', () => {
    expect(friendlyError(new Error('xyz'))).toBe('xyz');
  });
});

describe('notify', () => {
  it('entrega avisos aos assinantes', () => {
    const got: string[] = [];
    const off = notify.subscribe(t => got.push(`${t.type}:${t.text}`));
    notify.success('ok');
    notify.error('falhou');
    off();
    notify.info('ignorado');
    expect(got).toEqual(['success:ok', 'error:falhou']);
  });
});
