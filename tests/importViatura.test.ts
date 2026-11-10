import { describe, expect, it } from 'vitest';
import { ehPlanilhaViatura, lerPlanilhaViatura, AbaVT } from '../utils/importViatura';

const L = (c: Record<string, any>) => { const l: any[] = Array(12).fill(null); Object.entries(c).forEach(([k, x]) => { l[k.charCodeAt(0) - 65] = x; }); return l; };
/** Aba no leiaute da divisão: cabeçalho, número da fatura, serviço, quadro 01–06 e tabela Mês | Valor. */
const aba = (nome: string, numero: string, om: string, total: number | null, tabela: [string, number][], ref: string | null = 'SET26', ad = 0): AbaVT => ({
  nome, m: [
    L({ B: 'MARINHA DO BRASIL' }), L({ B: 'BASE NAVAL DA ILHA DAS COBRAS' }), [], L({ B: 'FATURAMENTO PARA SERVIÇOS DE APOIO BASE' }),
    L({ A: `Nº ${numero}`, D: `OM USUÁRIA: ${om}` }), [], L({ A: 'REFERÊNCIA:', C: ref }), [], L({ A: '   SERVIÇO PRESTADO: ALUGUEL DE VIATURAS' }),
    L({ D: 1, E: '(+)', F: 'TOTAL SERVIÇO PRESTADO', H: ' VALOR:', I: total }), L({ D: 2, E: '(-)', F: 'ADIANTAMENTO', H: ' VALOR:', I: ad }),
    L({ B: 'OBS.:' }), L({ B: 'Mês', C: 'Valor (R$)' }), ...tabela.map(([mes, v]) => L({ B: mes, C: v })),
  ],
});

describe('planilha de faturas de viatura', () => {
  const abas: AbaVT[] = [
    { nome: 'MODELO', m: aba('MODELO', '00000-VT-09-2026-000-0', 'modelo', 1, []).m },
    aba('SIM', '64100-VT-09-2026-011-0', 'Serviço de Identificação da Marinha', 92.93, [['SET26', 92.93]]),
    aba('CCEM', '11101-VT-09-2026-001-0', 'Centro de Comunicação Estratégica da Marinha', 4499.06, [['OUT25', 363.64], ['NOV25', 1669.37], ['DEZ25', 434.82], ['JAN26', 2031.23]]),
    aba('Tikuna', '91534-VT-09-2026-012-0', 'COMIMSUP: Comando da Força de Submarinos', null, [], null),
    aba('HCM', '65730-VT-09-2026-015-0', 'Hospital Central da Marinha', 100, [['SET26', 100]], 'ABR24', 100),
  ];
  it('reconhece a planilha e ignora a aba MODELO', () => {
    expect(ehPlanilhaViatura(abas)).toBe(true);
    expect(ehPlanilhaViatura([abas[1]])).toBe(false);
    expect(ehPlanilhaViatura([{ nome: 'x', m: [['CÓDIGO', 'CONSUMO']] }, { nome: 'y', m: [] }, { nome: 'z', m: [] }])).toBe(false);
    expect(lerPlanilhaViatura(abas).linhas.map(l => l.aba)).toEqual(['SIM', 'CCEM', 'HCM']);
  });
  it('valor = TOTAL SERVIÇO PRESTADO; competência pelo número; código da OM no número da fatura', () => {
    const r = lerPlanilhaViatura(abas);
    expect(r.competencia).toBe('2026-09');
    expect(r.linhas[0]).toMatchObject({ aba: 'SIM', numeroFatura: '64100-VT-09-2026-011-0', codigo: '64100', valor: 92.93, omNome: 'Serviço de Identificação da Marinha', competencia: '2026-09' });
  });
  it('fatura cobrada com atraso junta vários meses: o total é a soma da tabela, guardada como detalhe', () => {
    const c = lerPlanilhaViatura(abas).linhas.find(l => l.aba === 'CCEM')!;
    expect(c.valor).toBe(4499.06);
    expect(c.meses.map(m => m.mes)).toEqual(['OUT25', 'NOV25', 'DEZ25', 'JAN26']);
    expect(c.meses.reduce((s, m) => s + m.valor, 0)).toBeCloseTo(4499.06, 2);
  });
  it('aba sem valor vai para "sem fatura"; "COMIMSUP:" sai do nome; adiantamento é lido', () => {
    const r = lerPlanilhaViatura(abas);
    expect(r.semValor).toEqual([{ aba: 'Tikuna', omNome: 'COMIMSUP: Comando da Força de Submarinos' }]);
    expect(lerPlanilhaViatura([...abas.slice(0, 3), aba('T', '91534-VT-09-2026-012-0', 'COMIMSUP: Comando da Força de Submarinos', 50, [['SET26', 50]])]).linhas.at(-1)!.omNome).toBe('Comando da Força de Submarinos');
    expect(r.linhas.find(l => l.aba === 'HCM')!.adiantamento).toBe(100);
  });
  it('avisa a REFERÊNCIA desatualizada e o total que não bate com a tabela', () => {
    const r = lerPlanilhaViatura([...abas, aba('X', '11111-VT-09-2026-020-0', 'OM X', 500, [['AGO26', 100], ['SET26', 100]])]);
    expect(r.avisos.some(a => /HCM: a REFERÊNCIA da aba \(ABR24\) está desatualizada/.test(a))).toBe(true);
    expect(r.avisos.some(a => /^X: o total da fatura \(500,00\) não bate com a soma dos meses da tabela \(200,00\)/.test(a))).toBe(true);
  });
  it('avisa quando a fatura cobra meses muito atrasados (pode ser sobra do mês anterior), sem bloquear', () => {
    const r = lerPlanilhaViatura(abas);   // CCEM: OUT25 numa fatura de SET26
    expect(r.avisos.some(a => /1 aba\(s\) cobram meses atrasados.*: CCEM\./.test(a))).toBe(true);
    expect(r.linhas.find(l => l.aba === 'CCEM')!.valor).toBe(4499.06);
    expect(lerPlanilhaViatura(abas.filter(a => a.nome !== 'CCEM')).avisos.some(a => /meses atrasados/.test(a))).toBe(false);
  });
  it('planilha com meses diferentes nos números avisa a mistura', () => {
    const r = lerPlanilhaViatura([...abas, aba('Y', '22222-VT-08-2026-001-0', 'OM Y', 10, [['AGO26', 10]], 'AGO26')]);
    expect(r.competencia).toBe('2026-09'); expect(r.avisos.some(a => /mistura competências/.test(a))).toBe(true);
  });
});
