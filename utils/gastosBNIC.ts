/**
 * Gastos da BNIC — agrupamento e totais (funções puras).
 *
 * De onde vem cada número (nada é digitado nem inventado):
 *  - PREVISTO: valor vigente de cada rubrica da taxa condominial (rubricas 1–33) e dos outros gastos (34–37) do exercício,
 *    depois do desconto geral. É anual: não muda com o período escolhido.
 *  - EMPENHADO: saídas (NE) do Fluxo de caixa dentro do período, sem as canceladas e anuladas (a anulação parcial entra
 *    como valor negativo). Saída com rubrica entra no grupo da rubrica; saída sem rubrica fica em "Empenhos sem rubrica",
 *    por categoria. Assim nenhum valor é contado duas vezes.
 *  - CONSUMO DA BASE: medições do mês lançadas para a própria BNIC (água, energia, telefonia, gás...), em R$.
 *  - PARTE DA BNIC NO RATEIO: quanto da taxa fica com a OM emissora (só controle; não é gasto a mais).
 *  - FORNECEDOR: outro recorte do mesmo dinheiro empenhado (não se soma aos grupos).
 */
const r2 = (n: number) => Math.round(n * 100) / 100;
const sem = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
export const mesDe = (iso: string) => iso.slice(0, 7);
const somaMeses = (ym: string, n: number) => { const [a, m] = ym.split('-').map(Number); return new Date(Date.UTC(a, m - 1 + n, 1)).toISOString().slice(0, 7); };
export const mesesDe = (de: string, ate: string) => { const out: string[] = []; for (let m = de; m <= ate && out.length < 600; m = somaMeses(m, 1)) out.push(m); return out; };

// ------------------------------------------------------------------ grupos das rubricas
export type SubgrupoId = 'infra' | 'limpeza' | 'seguranca' | 'portuaria' | 'tecnologia' | 'hospital' | 'outros';
export const SUBGRUPOS: { id: SubgrupoId; rotulo: string; cor: string; exemplo: string }[] = [
  { id: 'limpeza', rotulo: 'Limpeza, coleta e controle de pragas', cor: '#0d9488', exemplo: 'varrição, coleta de lixo e de resíduos, entulho, poda, dedetização' },
  { id: 'infra', rotulo: 'Infraestrutura e manutenção predial', cor: '#2a78d6', exemplo: 'telhados, vias, fachadas, subestações, água, esgoto, elevadores, caldeiras' },
  { id: 'portuaria', rotulo: 'Operação portuária', cor: '#7c3aed', exemplo: 'agentes de manobra, defensas' },
  { id: 'seguranca', rotulo: 'Segurança e incêndio', cor: '#dc2626', exemplo: 'rede de incêndio, controle de acesso, seguro' },
  { id: 'hospital', rotulo: 'Hospital', cor: '#db2777', exemplo: 'instalações, equipamentos, material, serviços e limpeza hospitalares' },
  { id: 'tecnologia', rotulo: 'Tecnologia, comunicações e viaturas', cor: '#d97706', exemplo: 'TI, centrais telefônicas, viaturas compartilhadas' },
  { id: 'outros', rotulo: 'Outros gastos da BNIC', cor: '#475569', exemplo: 'linhas 34 a 37: material permanente, ar-condicionado, estoque' },
];
export const ROTULO_SUBGRUPO = Object.fromEntries(SUBGRUPOS.map(s => [s.id, s.rotulo])) as Record<SubgrupoId, string>;

/** Subgrupo da rubrica pela descrição (as rubricas 34–37 são "outros gastos"). A ordem dos testes resolve os casos mistos. */
export function subgrupoDaRubrica(r: { descricao: string; tipo?: 'TC' | 'OG' }): SubgrupoId {
  if (r.tipo === 'OG') return 'outros';
  const d = sem(r.descricao);
  if (/hospital|medic|remedio|laboratorial/.test(d)) return 'hospital';
  if (/incendio|acesso|monitoramento|seguro/.test(d)) return 'seguranca';
  if (/manobra|defensa/.test(d)) return 'portuaria';
  if (/coleta|residuo|varricao|entulho|poda|dedetiz|desrat|limpeza/.test(d)) return 'limpeza';
  if (/tecnologia|telefonia|central|centrais|viatura/.test(d)) return 'tecnologia';
  return 'infra';
}

// ------------------------------------------------------------------ entradas
export interface RubricaGasto { numero: number; descricao: string; tipo: 'TC' | 'OG'; vigente: number }
export interface SaidaGasto { id: string; date: string; value: number; client: string; documentNumber: string; rubricaNumero: number | null; categoria: string | null }
export interface MedicaoGasto { competencia: string; sigla: string; omId: string; quantidade: number | null; valor: number | null }

export const CATEGORIAS_SEM_RUBRICA: Record<string, string> = {
  ENERGIA: 'Energia elétrica', AGUA: 'Água e esgoto', TELEFONIA: 'Telefonia', CONDOMINIO: 'Condomínio/diária/viatura (sem rubrica)', SEM_INDICACAO: 'Sem indicação de rubrica ou categoria',
};
const categoriaDe = (s: SaidaGasto) => (s.categoria && CATEGORIAS_SEM_RUBRICA[s.categoria] ? s.categoria : 'SEM_INDICACAO');

// ------------------------------------------------------------------ saída
export interface LinhaGasto { numero: number; descricao: string; subgrupo: SubgrupoId; previsto: number; empenhado: number; saldo: number; execucao: number | null }
export interface GrupoGasto { id: SubgrupoId; rotulo: string; cor: string; previsto: number; empenhado: number; saldo: number; execucao: number | null; pctDoPrevisto: number; linhas: LinhaGasto[] }
export interface SemRubrica { categoria: string; rotulo: string; empenhado: number; qtd: number }
export interface Fornecedor { nome: string; qtd: number; valor: number; rubricas: number[]; categorias: string[] }
export interface ResultadoGastos {
  grupos: GrupoGasto[]; semRubrica: SemRubrica[]; fornecedores: Fornecedor[];
  totais: { previsto: number; empenhado: number; empenhadoRubricas: number; empenhadoSemRubrica: number; saldo: number; execucao: number | null; qtdEmpenhos: number };
  porMes: { mes: string; [grupo: string]: number | string }[];
}

const exec = (emp: number, prev: number) => (prev > 0 ? Math.round((emp / prev) * 1000) / 10 : null);

export function montarGastos(rubricas: RubricaGasto[], saidas: SaidaGasto[], periodo: { de: string; ate: string }): ResultadoGastos {
  const noPeriodo = saidas.filter(s => mesDe(s.date) >= periodo.de && mesDe(s.date) <= periodo.ate);
  const porRubrica = new Map<number, number>();
  const semRub = new Map<string, SemRubrica>();
  const rubExiste = new Set(rubricas.map(r => r.numero));
  noPeriodo.forEach(s => {
    if (s.rubricaNumero && rubExiste.has(s.rubricaNumero)) porRubrica.set(s.rubricaNumero, r2((porRubrica.get(s.rubricaNumero) || 0) + s.value));
    else { const c = s.rubricaNumero ? 'SEM_INDICACAO' : categoriaDe(s); const x = semRub.get(c) || { categoria: c, rotulo: CATEGORIAS_SEM_RUBRICA[c], empenhado: 0, qtd: 0 }; x.empenhado = r2(x.empenhado + s.value); x.qtd++; semRub.set(c, x); }
  });
  const totalPrevisto = r2(rubricas.reduce((s, r) => s + r.vigente, 0));
  const grupos: GrupoGasto[] = SUBGRUPOS.map(g => {
    const linhas: LinhaGasto[] = rubricas.filter(r => subgrupoDaRubrica(r) === g.id).sort((a, b) => a.numero - b.numero).map(r => {
      const emp = porRubrica.get(r.numero) || 0;
      return { numero: r.numero, descricao: r.descricao, subgrupo: g.id, previsto: r2(r.vigente), empenhado: emp, saldo: r2(r.vigente - emp), execucao: exec(emp, r.vigente) };
    });
    const previsto = r2(linhas.reduce((s, l) => s + l.previsto, 0)), empenhado = r2(linhas.reduce((s, l) => s + l.empenhado, 0));
    return { id: g.id, rotulo: g.rotulo, cor: g.cor, previsto, empenhado, saldo: r2(previsto - empenhado), execucao: exec(empenhado, previsto), pctDoPrevisto: totalPrevisto > 0 ? Math.round((previsto / totalPrevisto) * 1000) / 10 : 0, linhas };
  }).filter(g => g.linhas.length > 0);

  const empRub = r2(grupos.reduce((s, g) => s + g.empenhado, 0));
  const empSem = r2([...semRub.values()].reduce((s, x) => s + x.empenhado, 0));

  // fornecedor: mesmo dinheiro, outro recorte
  const forn = new Map<string, Fornecedor>();
  noPeriodo.forEach(s => {
    const nome = (s.client || '').trim() || '(sem fornecedor informado)';
    const k = sem(nome).replace(/\s+/g, ' ');
    const f = forn.get(k) || { nome, qtd: 0, valor: 0, rubricas: [], categorias: [] };
    f.qtd++; f.valor = r2(f.valor + s.value);
    if (s.rubricaNumero && !f.rubricas.includes(s.rubricaNumero)) f.rubricas.push(s.rubricaNumero);
    if (!s.rubricaNumero) { const c = CATEGORIAS_SEM_RUBRICA[categoriaDe(s)]; if (!f.categorias.includes(c)) f.categorias.push(c); }
    forn.set(k, f);
  });

  // empenhado por mês, por grupo (rubricas) e por categoria sem rubrica
  const grupoDaRub = new Map(rubricas.map(r => [r.numero, subgrupoDaRubrica(r)]));
  const meses = mesesDe(periodo.de, periodo.ate);
  const porMes = meses.map(mes => ({ mes } as { mes: string; [k: string]: number | string }));
  const idx = new Map(porMes.map(p => [p.mes, p]));
  noPeriodo.forEach(s => {
    const p = idx.get(mesDe(s.date)); if (!p) return;
    const chave = s.rubricaNumero && grupoDaRub.has(s.rubricaNumero) ? grupoDaRub.get(s.rubricaNumero)! : 'semRubrica';
    p[chave] = r2(((p[chave] as number) || 0) + s.value);
  });

  return {
    grupos, semRubrica: [...semRub.values()].sort((a, b) => b.empenhado - a.empenhado), fornecedores: [...forn.values()].sort((a, b) => b.valor - a.valor), porMes,
    totais: { previsto: totalPrevisto, empenhado: r2(empRub + empSem), empenhadoRubricas: empRub, empenhadoSemRubrica: empSem, saldo: r2(totalPrevisto - empRub), execucao: exec(empRub, totalPrevisto), qtdEmpenhos: noPeriodo.length },
  };
}

// ------------------------------------------------------------------ consumo da própria base
export interface Utilidade { sigla: string; nome: string; valor: number; quantidade: number; unidade: string; totalComplexo: number; pct: number | null; porMes: Record<string, number> }
/** Consumo medido da OM emissora no período, por serviço, e quanto isso representa do total medido para todas as OM. */
export function utilidadesDaBase(medicoes: MedicaoGasto[], omId: string | null, periodo: { de: string; ate: string }, servicos: { sigla: string; nome: string; unidade?: string }[]): Utilidade[] {
  const doPeriodo = medicoes.filter(m => mesDe(m.competencia) >= periodo.de && mesDe(m.competencia) <= periodo.ate);
  const nome = new Map(servicos.map(s => [s.sigla, s]));
  const m = new Map<string, Utilidade>();
  doPeriodo.forEach(x => {
    const u = m.get(x.sigla) || { sigla: x.sigla, nome: nome.get(x.sigla)?.nome || x.sigla, valor: 0, quantidade: 0, unidade: nome.get(x.sigla)?.unidade || '', totalComplexo: 0, pct: null, porMes: {} };
    const v = Number(x.valor) || 0;
    u.totalComplexo = r2(u.totalComplexo + v);
    if (omId && x.omId === omId) { u.valor = r2(u.valor + v); u.quantidade = r2(u.quantidade + (Number(x.quantidade) || 0)); u.porMes[x.competencia] = r2((u.porMes[x.competencia] || 0) + v); }
    m.set(x.sigla, u);
  });
  return [...m.values()].filter(u => u.valor > 0 || u.quantidade > 0).map(u => ({ ...u, pct: u.totalComplexo > 0 ? Math.round((u.valor / u.totalComplexo) * 1000) / 10 : null })).sort((a, b) => b.valor - a.valor);
}
