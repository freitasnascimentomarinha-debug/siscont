import { describe, expect, it } from 'vitest';
import {
  aplicarObservacoes, avisosAgua, conferirObservacoes, conferirTotais, ehPlanilhaAgua, hidrometroId, ligarLinhaAgua, lerPlanilhaAgua,
} from '../utils/importAgua';

// Planilha fictícia no formato da divisão (colunas A..U; valores como o Excel guarda o resultado das fórmulas)
const P = 21.5, T = 0.02, U = P * 2 * (1 + T);          // preço do m³ com esgoto e taxa
const v = (m3: number) => Math.round(m3 * U * 100) / 100;
const linha = (cols: Record<string, any>) => { const l: any[] = Array(21).fill(null); Object.entries(cols).forEach(([c, x]) => { l[c.charCodeAt(0) - 65] = x; }); return l; };
const cab = linha({ B: 'CONSUMIDOR', E: 'CÓDIGO DA OM', F: 'HIDRÔMETRO', I: 'LEITURA ATUAL', K: 'LEITURA ANTERIOR', N: 'CONSUMO (M³)', Q: 'CONSUMO (DIAS)', R: 'CONSUMO TOTAL (M³)', T: 'TOTAL A PAGAR' });
// medidos: OM 100 + 30 (2 hidrômetros), HCM bruto 500 − (PRESÍDIO 100 + BATALHÃO 50) = 350 na planilha (sem descontar a CPMM, 20), navio 40, sem dono 7
const medidos = 100 + 30 + 20 + 350 + 150 + 40 + 7;
const contaR = 2 * 1000 * U;   // conta: 2.000 m³
const resto = contaR - v(medidos);
const M: any[][] = [
  linha({ B: 'MARINHA DO BRASIL' }),
  linha({ B: 'PLANILHA DE FATURAMENTO DE ÁGUA DOCE E TRATAMENTO DE ESGOTO' }),
  linha({ B: 'DATA DA LEITURA ANTERIOR 28/08/2026', F: 'DATA DA LEITURA ATUAL 28/09/26', L: 'MEDIÇÃO 09/2026', R: 'VENCIMENTO 23/10/2026' }),
  linha({ B: 'OM', F: 'MATRÍCULAS', I: 'VALOR DO CONSUMO  (R$)', L: 'VALOR TOTAL (R$)', O: 'VOLUME  CONSUMIDO (M³)', Q: 'VOLUME CONSUMIDO TOTAL (M³)', R: 'VALOR DO (M³)', U: P }),
  linha({ A: 'BNIC', F: '400000001-0', I: contaR / 2, O: 1000, R: 'RATEIO OM APOIADAS', U: v(medidos) }),
  linha({ F: '400000002-1', I: contaR / 2, O: 1000 }),
  linha({ A: 'ARES-MAS (FORA DO RATEIO)', F: '400000003-2', I: 900, L: 900, O: 20, Q: 20 }),
  linha({ R: 'TAXAS (%)', U: T }),
  linha({ B: 'OMs APOIADAS' }),
  cab,
  linha({ B: 'AMRJ', E: 41000, F: 'Consumidores não hidrometrados', I: '*******', K: '*******', N: 0.38 * (2000 - medidos), R: 0.38 * (2000 - medidos), T: 0.38 * resto }),
  linha({ F: 'H-17 (Ed.17)', I: 1100, K: 1000, N: 100, R: 100, T: v(100) }),
  linha({ F: 'H-55 (Ed.19)', N: 30, R: 30, T: v(30) }),                                           // sem leitura
  linha({ B: 'BNIC', E: 40015, F: 'Consumidores não hidrometrados', N: 0.62 * (2000 - medidos), R: 0.62 * (2000 - medidos), T: 0.62 * resto }),
  linha({ B: 'CPMM', E: 65730, F: 'H-66 (caixa d’água)', I: 320, K: 300, N: 20, R: 20, T: v(20) }),
  linha({ B: 'HCM', E: 65701, F: 'H-67', I: 1500, K: 1000, N: 500, R: 350, T: v(350) }),
  linha({ B: 'PRESÍDIO DA MARINHA', E: 81940, F: 'H-68 (calçada)', I: 200, K: 120, N: 80, R: 100, T: v(100) }),
  linha({ F: 'H-69 (portão)', I: 70, K: 50, N: 20 }),                                             // já somado na linha de cima
  linha({ B: 'BATALHÃO NAVAL', E: 31050, F: 'H-70', I: 150, K: 100, N: 50, R: 50, T: v(50) }),
  linha({ B: 'TOTAL DE CONSUMO DOS NAVIOS/OM COM HIDRÔMETRO COMPARTILHADO' }),
  linha({ A: 'OM', B: 'AMRJ', J: 'NDM Bahia' }),
  linha({ A: 'R$', B: 123, J: 'R$ 716,73' }),
  linha({ B: 'CAIS DA PORTUGUESA' }),
  cab,
  linha({ B: 'NDM Bahia', E: '*******', F: 'H-23', I: 140, K: 100, N: 40, Q: 31, R: 40, T: v(40) }),
  linha({ B: 'SEM CONEXÃO', E: '*******', F: 'H-46 (Ed.51)', I: 17, K: 10, N: 7, R: 7, T: v(7) }),
  linha({ B: 'SEM CONEXÃO', E: '*******', F: 'H-20', I: 5, K: 5, N: 0, R: 0, T: 0 }),
  linha({ A: 'ARES-MAS (FORA DO RATEIO – CONSUMO DESTINADO AO BATALHÃO NAVAL)' }),
  cab,
  linha({ B: 'ARES-MAS (BATALHÃO NAVAL)', E: 31050, F: 'MAT. 400000003-2', I: '*******', R: 20, T: 900 }),
  linha({ A: 'Obs.:' }),
  linha({ A: 'Consumo do HCM = H67 (entrada do HCM) – H66 (CPMM) – H68 – H69 (PRESÍDIO) – H70 (BATALHÃO)' }),
  linha({ D: 'Aprovado por:', L: 'Elaborado por:' }),
];

describe('planilha de água e esgoto', () => {
  const p = lerPlanilhaAgua(M);

  it('reconhece o formato e lê o cabeçalho', () => {
    expect(ehPlanilhaAgua(M)).toBe(true);
    expect(ehPlanilhaAgua([['CÓDIGO', 'CONSUMO', 'VALOR TOTAL']])).toBe(false);
    expect(p.competencia).toBe('2026-09');
    expect(p.vencimento).toBe('2026-10-23');
    expect(p.leituraAnterior).toBe('2026-08-28');
    expect(p.leituraAtual).toBe('2026-09-28');
    expect(p.precoM3).toBe(P);
    expect(p.taxa).toBe(T);
    expect(p.contas.map(c => [c.matricula, c.foraDoRateio])).toEqual([['400000001-0', false], ['400000002-1', false], ['400000003-2', true]]);
  });

  it('lê as seções, herda a OM nas linhas de continuação e ignora resumo, zeros e linhas já somadas', () => {
    const porLinha = (n: number) => p.linhas.find(l => l.linha === n);
    expect(porLinha(12)).toMatchObject({ consumidor: 'AMRJ', codigo: '41000', consumo: 100, secao: 'OMs APOIADAS' });
    expect(porLinha(13)).toMatchObject({ consumidor: 'AMRJ', consumo: 30 });
    expect(porLinha(11)?.tipo).toBe('NAO_HIDROMETRADO');
    expect(porLinha(18)).toBeUndefined();                       // H-69 já está na linha do Presídio
    expect(p.linhas.some(l => l.linha >= 20 && l.linha <= 22)).toBe(false);   // quadro-resumo
    expect(porLinha(27)).toBeUndefined();                       // consumo zero
    expect(porLinha(25)).toMatchObject({ consumidor: 'NDM Bahia', secao: 'CAIS DA PORTUGUESA', dias: 31 });
    expect(porLinha(30)).toMatchObject({ tipo: 'FORA_RATEIO', valor: 900, consumo: 20 });
  });

  it('confere os totais com as contas da concessionária', () => {
    const t = conferirTotais(p);
    expect(Math.abs(t.rateio.planilha.valor - t.rateio.conta.valor)).toBeLessThan(0.05);
    expect(t.rateio.planilha.volume).toBeCloseTo(2000, 4);
    expect(t.fora.planilha).toEqual(t.fora.conta);
  });

  it('confere a observação do HCM e aplica a regra sem mudar o total', () => {
    const [g] = conferirObservacoes(M, p);
    expect(g).toMatchObject({ nome: 'HCM', entrada: 'H67', descontar: ['H66', 'H68', 'H69', 'H70'], consumoPlanilha: 350, consumoRegra: 330, diferencaM3: 20, faltam: [] });
    expect(g.diferencaValor).toBeCloseTo(20 * U, 2);
    const novas = aplicarObservacoes(p.linhas, [g]);
    expect(novas.find(l => l.linha === 16)?.consumo).toBe(330);
    const t0 = conferirTotais(p), t1 = conferirTotais(p, novas);
    expect(t1.rateio.planilha.valor).toBeCloseTo(t0.rateio.planilha.valor, 2);
    expect(t1.rateio.planilha.volume).toBeCloseTo(t0.rateio.planilha.volume, 4);
    const amrj0 = p.linhas.find(l => l.linha === 11)!.valor, amrj1 = novas.find(l => l.linha === 11)!.valor;
    expect(amrj1 - amrj0).toBeCloseTo(g.diferencaValor * 0.38, 1);
  });

  it('aponta consumo sem leitura, valor sem dono e código repetido de clientes diferentes', () => {
    const a = avisosAgua(p);
    expect(a.find(x => x.tipo === 'sem_leitura')?.linha).toBe(13);
    expect(a.find(x => x.tipo === 'sem_dono')).toMatchObject({ linha: 26, valor: v(7) });
    expect(a.filter(x => x.tipo === 'codigo').map(x => x.linha)).toEqual([25]);     // NDM Bahia sem código
    // BATALHÃO NAVAL × ARES-MAS (BATALHÃO NAVAL) é o mesmo cliente: sem aviso
    expect(a.some(x => x.tipo === 'codigo_repetido')).toBe(false);
  });

  it('identifica hidrômetros em textos variados', () => {
    expect(hidrometroId('Compart: H-09 (Ed.16)')).toBe('H9');
    expect(hidrometroId('H67 (entrada do HCM)')).toBe('H67');
    expect(hidrometroId('H-08A (Obra Ed.43)')).toBe('H8A');
    expect(hidrometroId('MAT. 400485344-2')).toBeNull();
  });
});

describe('ligação da linha com o cadastro', () => {
  const oms = [
    { id: 'a', nome: 'Arsenal de Marinha do Rio de Janeiro', codigo: '41000', tipo: 'OM', ativo: true },
    { id: 'b', nome: 'Banco Santander', codigo: '00356', tipo: 'EXTRA_MB', ativo: true },
    { id: 'g', nome: 'Navio-Patrulha Gurupi', codigo: '81147', tipo: 'NAVIO', ativo: true },
    { id: 'n', nome: 'Navio de Desembarque Multipropósito Bahia', codigo: '40015', tipo: 'NAVIO', ativo: true, nomesAlternativos: ['NDM Bahia'] },
    { id: 'c', nome: 'Comando do Grupamento de Patrulha Naval do Sudeste', codigo: '81100', tipo: 'OM', ativo: true },
  ];
  const porNome = (nome: string, lista: typeof oms) => lista.find(o => o.nome.toLowerCase().includes(nome.toLowerCase().replace(/^npa\s+/, '').replace('í', 'i')));

  it('liga pelo código com zeros à esquerda', () => {
    expect(ligarLinhaAgua({ consumidor: 'AMRJ', codigo: '41000' }, oms, porNome)).toEqual({ omId: 'a', como: 'codigo' });
    expect(ligarLinhaAgua({ consumidor: 'BANCO SANTANDER', codigo: '356' }, oms, porNome)).toMatchObject({ omId: 'b', como: 'codigo' });
  });
  it('liga pelo nome alternativo quando não há código', () => {
    expect(ligarLinhaAgua({ consumidor: 'NDM Bahia', codigo: '*******' }, oms, porNome)).toMatchObject({ omId: 'n', como: 'nome' });
  });
  it('código que não existe no cadastro: liga pelo nome e avisa a diferença', () => {
    const r = ligarLinhaAgua({ consumidor: 'Npa GURUPÍ', codigo: '89147' }, oms, porNome);
    expect(r).toMatchObject({ omId: 'g', como: 'codigo_diferente' });
    expect(r.nota).toContain('81147');
  });
  it('"SEM CONEXÃO" sem código fica pendente', () => {
    expect(ligarLinhaAgua({ consumidor: 'SEM CONEXÃO', codigo: '*******' }, oms, porNome)).toEqual({ omId: null, como: 'nenhum' });
  });
});
