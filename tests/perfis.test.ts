import { describe, expect, it } from 'vitest';
import { MAX_ATRIBUICOES, textoAtribuicoes, FUNCOES_SETOR, ROLE_LABELS, SETORES_DIVISAO, UserRole, podeEditarDados, podeVerPagina } from '../types';

const PAGINAS = ['dashboard', 'painel', 'pontos', 'faturamento', 'invoices', 'contestacoes', 'received', 'conciliacao', 'cobranca', 'extramb', 'cashflow', 'taxa', 'gastos', 'cadastros', 'auditoria', 'admin'];
const vistas = (r: UserRole) => PAGINAS.filter(p => podeVerPagina(r, p));

describe('páginas por perfil', () => {
  it('administrador vê todas', () => expect(vistas(UserRole.ADMIN)).toEqual(PAGINAS));
  it('operador vê todas exceto Administração', () => expect(vistas(UserRole.USER)).toEqual(PAGINAS.filter(p => p !== 'admin')));
  it('consulta vê só o Painel inicial', () => expect(vistas(UserRole.READ_ONLY)).toEqual(['dashboard']));
  it('consulta gerencial vê o Painel inicial e o Painel do Encarregado', () => expect(vistas(UserRole.CONSULTA_GERENCIAL)).toEqual(['dashboard', 'painel']));
  it('encarregado da divisão vê todas exceto Administração', () => expect(vistas(UserRole.ENCARREGADO)).toEqual(PAGINAS.filter(p => p !== 'admin')));
  it('treinamento vê todas exceto Administração', () => expect(vistas(UserRole.TREINAMENTO)).toEqual(PAGINAS.filter(p => p !== 'admin')));
  it('perfil desconhecido é tratado como consulta', () => expect(PAGINAS.filter(p => podeVerPagina(undefined, p))).toEqual(['dashboard']));
  it('só administrador e operador editam (treinamento edita só dados de teste)', () => {
    expect([UserRole.ADMIN, UserRole.USER, UserRole.READ_ONLY, UserRole.CONSULTA_GERENCIAL, UserRole.ENCARREGADO, UserRole.TREINAMENTO].map(podeEditarDados))
      .toEqual([true, true, false, false, false, true]);
  });
  it('nenhum perfil sem escrita vê a Administração', () => {
    for (const r of [UserRole.USER, UserRole.READ_ONLY, UserRole.CONSULTA_GERENCIAL, UserRole.ENCARREGADO, UserRole.TREINAMENTO]) expect(podeVerPagina(r, 'admin')).toBe(false);
  });
});

describe('rótulos, setores e funções', () => {
  it('todo perfil tem rótulo e os novos nomes estão corretos', () => {
    for (const r of Object.values(UserRole)) expect(ROLE_LABELS[r]).toBeTruthy();
    expect(ROLE_LABELS[UserRole.CONSULTA_GERENCIAL]).toBe('Consulta Gerencial');
    expect(ROLE_LABELS[UserRole.ENCARREGADO]).toBe('Encarregado da Divisão');
  });
  it('setores e funções batem com as listas do banco (script 035) e da API', () => {
    expect(Object.keys(SETORES_DIVISAO)).toEqual(['FATURAMENTO', 'ACOMPANHAMENTO_CONTABIL', 'CUSTOS']);
    expect(Object.keys(FUNCOES_SETOR)).toEqual(['ENCARREGADO_SETOR', 'AUXILIAR']);
  });
});

describe('setores e funções do usuário (várias atribuições)', () => {
  it('texto curto das atribuições e limite de 3', () => {
    expect(MAX_ATRIBUICOES).toBe(3);
    expect(textoAtribuicoes([])).toBe('');
    expect(textoAtribuicoes([{ setor: 'FATURAMENTO', funcao: 'ENCARREGADO_SETOR' }, { setor: 'CUSTOS', funcao: 'AUXILIAR' }])).toBe('Faturamento (Encarregado de setor) · Contabilidade de Custos (Auxiliar)');
    expect(textoAtribuicoes([{ setor: 'CUSTOS' }])).toBe('Contabilidade de Custos');
  });
});
