import { describe, it, expect } from 'vitest';
import {
  analisarCadastro, chave, extrairClasses, extrairLinhasDeFatura, fimDoMesSeguinte, lerComando,
  lerFatura, mesmoNavio, planejarImportacao, similaridade, LinhaFatura,
} from '../utils/cadastroImport';

const L = (setor: string | null, comando: string | null, cliente: string, fatura: string): LinhaFatura =>
  ({ setor, comando, cliente, fatura, origem: 'teste' });

describe('leitura de campos', () => {
  it('lê o número da fatura e a competência', () => {
    expect(lerFatura('91645-DA-08-2026-011-0')).toMatchObject({ codigo: '91645', sigla: 'DA', competencia: 202608, padrao: true });
    expect(lerFatura(' 41000-AE-01-2026-001-0')?.codigo).toBe('41000');
  });
  it('completa código de 4 dígitos e aceita número fora do padrão', () => {
    expect(lerFatura('0994-EL-2023-07-336-0')).toMatchObject({ codigo: '00994', padrao: false, completado: true });
    expect(lerFatura('ADIANTAMENTO')).toBeNull();
  });
  it('separa código e nome do comando', () => {
    expect(lerComando('41000- Arsenal de Marinha do Rio de Janeiro')).toEqual({ codigo: '41000', nome: 'Arsenal de Marinha do Rio de Janeiro' });
    expect(lerComando('11101 – Centro de Comunicação')).toEqual({ codigo: '11101', nome: 'Centro de Comunicação' });
    expect(lerComando('Comando do 1º Esquadrão de Escolta')).toEqual({ codigo: null, nome: 'Comando do 1º Esquadrão de Escolta' });
    expect(lerComando('EXTRA-MARINHA')).toBeNull();
    expect(lerComando('VT-07-2024-002-0')).toBeNull(); // coluna deslocada
    expect(lerComando('COMOPNAV')).toBeNull();
  });
  it('compara nomes ignorando acento e caixa', () => {
    expect(chave('Corveta Júlio de Noronha')).toBe(chave('CORVETA JULIO DE NORONHA'));
    expect(similaridade('Navio-Tanque Almirante Gastão Motta', 'Navio Tanque Almirante Gastão Mota')).toBeGreaterThan(0.88);
    expect(mesmoNavio('NHo Taurus', 'Navio Hidroceanográfico Taurus')).toBe(true);
    expect(mesmoNavio('Escola Naval', 'Escola Técnica Naval')).toBe(false);
  });
  it('data de desativação sugerida = fim do mês seguinte', () => {
    expect(fimDoMesSeguinte(202601)).toBe('2026-02-28');
    expect(fimDoMesSeguinte(202412)).toBe('2025-01-31');
  });
});

describe('leitura de abas', () => {
  it('extrai faturas e repete comando/cliente nas linhas de grupo (extrato por comando)', () => {
    const m = [
      ['FATURAS EM ABERTO'],
      ['Comando', 'Cliente', 'Fatura', 'Valor'],
      ['91500 - Comando Forca de Submarinos', 'Submarino Tapajó', '91533-RB-05-2026-002-0', 100],
      [null, null, '91533-DA-04-2026-017-0', 50],
      [null, 'Submarino Tapajó Total', null, 150],
    ];
    const r = extrairLinhasDeFatura(m, 'x');
    expect(r).toHaveLength(2);
    expect(r[1]).toMatchObject({ comando: '91500 - Comando Forca de Submarinos', cliente: 'Submarino Tapajó' });
  });
  it('ignora abas de pagamento (com coluna ALTCRED)', () => {
    const m = [['Data', 'COMANDO', 'CLIENTE', 'NºALTCRED', 'NºFATURA'], ['x', 'DGPM', '62200 – CIAW', 'G419', '62200-EL-01-2026-009-0']];
    expect(extrairLinhasDeFatura(m, 'x')).toHaveLength(0);
  });
  it('extrai classe e navio do histórico, repetindo a classe', () => {
    const m = [['título'], ['CLASSE NAVIO', 'NAVIO', 'JAN'], ['Corvetas Classe Barroso', 'Barroso', 31], ['Submarinos Classe Tikuna', 'Tikuna', 2], [null, 'Tapuia', 0], ['TOTAL', null, 33]];
    expect(extrairClasses(m)).toEqual([
      { classe: 'Corvetas Classe Barroso', navio: 'Barroso' },
      { classe: 'Submarinos Classe Tikuna', navio: 'Tikuna' },
      { classe: 'Submarinos Classe Tikuna', navio: 'Tapuia' },
    ]);
  });
});

describe('análise do cadastro', () => {
  const linhas = [
    ...Array.from({ length: 6 }, (_, i) => L('COMOPNAV', '91660-Comando do 1º Esquadrão de Apoio', 'Navio-Tanque Almirante Gastão Motta', `91665-EL-0${i + 1}-2026-01${i}-0`)),
    L('COMOPNAV', '91660 - Comando do 1º Esquadrão de Apoio', 'Navio Tanque Almirante Gastão Mota', '91665-AE-08-2026-001-0'),
    L('COMOPNAV', 'Comando do 1º Esquadrão de Apoio', 'NT Gastão Motta', '91665-VT-09-2026-012-0'),
    ...Array.from({ length: 8 }, (_, i) => L('DGMM', '41000- Arsenal de Marinha do Rio de Janeiro', 'Arsenal de Marinha do Rio de Janeiro', `41000-TC-0${i + 1}-2026-002-0`)),
    L('DGMM', '41000- Arsenal de Marinha do Rio de Janeiro', 'Arsenal de Marinha do Rio de Janeiro - SKM', '41000-AE-02-2026-023-0'),
    L('DGMM', '41000- Arsenal de Marinha do Rio de Janeiro', 'Arsenal de Marinha do Rio de Janeiro - BGL1', '41000-AE-02-2026-024-0'),
    // código digitado errado numa única fatura
    L('DGMM', '41000- Arsenal de Marinha do Rio de Janeiro', 'Arsenal de Marinha do Rio de Janeiro', '41001-TC-03-2026-002-0'),
    // extra-MB: aluguel sai com o código da BNIC, mas é o mesmo banco
    L('EXTRA-MARINHA', 'EXTRA-MARINHA', 'BANCO DO BRASIL', '00994-AE-09-2026-020-0'),
    L('Extra MB', 'EXTRA MB', 'Banco do Brasil', '40015-AL-09-2026-002-0'),
    L('Extra MB', 'EXTRA MB', '00994 - Banco do Brasil', '00994-EL-08-2026-023-0'),
    // OM antiga
    L('DGN', '51200-Grupamento de Navios Hidroceanograficos', 'Navio Polar Almirante Maximiano', '51215-EL-07-2024-035-0'),
    L('CON', '91600 - Comando da Forca de Superficie', 'Corveta Barroso', '91645-TL-01-2023-010-0'),
  ];
  const p = analisarCadastro(linhas, [{ classe: 'Navio-Tanque', navio: 'Gastão Motta' }, { classe: 'Corvetas Classe Barroso', navio: 'Barroso' }, { classe: 'Navio Polar', navio: 'Rio Negro' }]);
  const om = (cod: string) => p.oms.filter(o => o.codigo === cod);

  it('unifica grafias do mesmo navio e escolhe a mais usada', () => {
    expect(om('91665')).toHaveLength(1);
    expect(om('91665')[0]).toMatchObject({ nome: 'Navio-Tanque Almirante Gastão Motta', tipo: 'NAVIO', qtdFaturas: 8, classe: 'Navio-Tanque' });
  });
  it('mantém separados clientes diferentes no mesmo código', () => {
    expect(om('41000').map(o => o.nome).sort()).toEqual([
      'Arsenal de Marinha do Rio de Janeiro', 'Arsenal de Marinha do Rio de Janeiro - BGL1', 'Arsenal de Marinha do Rio de Janeiro - SKM',
    ]);
  });
  it('marca como suspeito o código digitado errado', () => {
    expect(om('41001')[0].suspeita).toMatch(/41000/);
    expect(p.avisos.some(a => a.tipo === 'CODIGO_SUSPEITO')).toBe(true);
  });
  it('identifica extra-MB pelo nome, com o código mais usado', () => {
    const bb = p.oms.filter(o => o.tipo === 'EXTRA_MB');
    expect(bb).toHaveLength(1);
    expect(bb[0]).toMatchObject({ codigo: '00994', nome: 'Banco do Brasil', comandoChave: null, setor: 'EXTRA-MB', qtdFaturas: 3 });
  });
  it('associa comando sem código ao comando com código e unifica nomes', () => {
    const c = p.comandos.find(x => x.codigo === '91660')!;
    expect(c.setor).toBe('COMOPNAV');
    expect(p.comandos.filter(x => x.codigo === null)).toHaveLength(0);
    expect(om('91665')[0].comandoChave).toBe('#91660');
  });
  it('avisa setor desconhecido, OM sem fatura recente e navio sem OM', () => {
    expect(p.avisos.find(a => a.tipo === 'SETOR_DESCONHECIDO')?.mensagem).toMatch(/CON/);
    expect(p.avisos.find(a => a.tipo === 'SEM_FATURA_RECENTE')?.exemplos?.join()).toMatch(/Maximiano/);
    expect(p.avisos.find(a => a.tipo === 'NAVIO_SEM_OM')?.exemplos?.join()).toMatch(/Rio Negro/);
  });

  it('planeja só o que falta, sem duplicar o que já existe', () => {
    const sel = new Set(p.oms.filter(o => !o.suspeita).map(o => o.chave));
    const plano = planejarImportacao(p, {
      setores: [{ id: 's1', sigla: 'DGMM' }],
      comandos: [{ id: 'c1', codigo: '41000', nome: 'AMRJ' }],
      classes: [{ id: 'k1', nome: 'navio-tanque' }],
      oms: [{ id: 'o1', codigo: '41000', nome: 'ARSENAL DE MARINHA DO RIO DE JANEIRO' }, { id: 'o2', codigo: '91665', nome: 'Navio-Tanque Almirante Gastão Motta', tipo: 'NAVIO', classeId: null }],
    }, { selecionadas: sel, desativarSemFaturaRecente: true });
    expect(plano.setores).not.toContain('DGMM');
    expect(plano.comandos.map(c => c.codigo)).not.toContain('41000');
    expect(plano.oms.map(o => o.nome)).not.toContain('Arsenal de Marinha do Rio de Janeiro');
    expect(plano.oms.some(o => o.codigo === '41001')).toBe(false); // suspeito desmarcado
    expect(plano.classesEmOMExistentes).toEqual([{ omId: 'o2', classe: 'Navio-Tanque' }]);
    expect(plano.classes).not.toContain('Navio-Tanque');
    const polar = plano.oms.find(o => o.codigo === '51215')!;
    expect(polar).toMatchObject({ ativo: false, desativadoEm: '2024-08-31' });
    expect(plano.ignorados.naoSelecionadas).toBe(1);
  });
});
