import { describe, expect, it } from 'vitest';
import { UserRole, podeEditarDados, podeVerPagina } from '../types';

const PAGINAS = ['dashboard', 'painel', 'pontos', 'faturamento', 'invoices', 'contestacoes', 'received', 'conciliacao', 'cobranca', 'cashflow', 'taxa', 'cadastros', 'auditoria', 'admin'];
const vistas = (r: UserRole) => PAGINAS.filter(p => podeVerPagina(r, p));

describe('páginas por perfil', () => {
  it('administrador vê todas', () => expect(vistas(UserRole.ADMIN)).toEqual(PAGINAS));
  it('operador vê todas exceto Administração', () => expect(vistas(UserRole.USER)).toEqual(PAGINAS.filter(p => p !== 'admin')));
  it('consulta vê só o Painel inicial', () => expect(vistas(UserRole.READ_ONLY)).toEqual(['dashboard']));
  it('encarregado vê Painel inicial e Painel do Encarregado', () => expect(vistas(UserRole.ENCARREGADO)).toEqual(['dashboard', 'painel']));
  it('perfil desconhecido é tratado como consulta', () => expect(PAGINAS.filter(p => podeVerPagina(undefined, p))).toEqual(['dashboard']));
  it('só administrador e operador editam', () => {
    expect([UserRole.ADMIN, UserRole.USER, UserRole.READ_ONLY, UserRole.ENCARREGADO].map(podeEditarDados)).toEqual([true, true, false, false]);
  });
});
