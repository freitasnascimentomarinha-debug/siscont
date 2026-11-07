/**
 * Ciclo de faturamento mensal (Fase 3): cálculo do lote, numeração, OND estimado, acerto do OND e
 * abatimento automático de adiantamento. Funções puras: a tela e o serviço só juntam os dados.
 *
 * Regras (OI 40-04 + respostas do usuário):
 *  - Número: OM-SIGLA-MM-AAAA-SEQ-V. SEQ = 001…N por serviço e competência, na ordem do lote, continuando
 *    do maior já usado (faturas avulsas). V = 0 (a -1 cancela e substitui, Fase 4).
 *  - TC: valor mensal da tabela anual da OM. DA: diária do navio × dias ATRACADO (docado não paga).
 *  - AE/EL e demais: valor do rateio enviado pela divisão (R$) ou quantidade × valor unitário do ano.
 *  - OND (competência OUT): OM da Marinha = 3 × média mensal JAN–AGO de cada serviço; DA = diária × dias
 *    previstos de OUT–DEZ; extra-MB segue o mensal.
 *  - Acerto do OND (ano seguinte): real (OUT+NOV+DEZ) − estimado → acréscimo (linha 03) ou débito (linha 04).
 */
export interface OMFat {
  id: string; codigo: string; nome: string; tipo: 'TERRA' | 'NAVIO' | 'EXTRA_MB'; comandoId?: string | null;
  setor: string; comando: string; ativo: boolean; desativadoEm?: string | null; ativadoEm?: string | null;
}
export interface ServicoFat { sigla: string; nome: string; unidade: string; ordem?: number; /** divisão responsável pelos dados (editável em Cadastros › Serviços) */ responsavel?: string | null; telefone?: string | null }
export interface PrecoFat { ano: number; sigla: string; omId: string | null; valor: number; unidade?: string | null }
export interface MedicaoFat { competencia: string; sigla: string; omId: string; quantidade?: number | null; quantidade2?: number | null; valor?: number | null; estimada?: boolean }
export interface AtracacaoFat { competencia: string; omId: string; previsao: boolean; diasAtracado: number; diasDocado: number }
export interface FaturaHist { id: string; numero: string; omId?: string | null; sigla: string; ano: number; mes: number; valor: number; cancelada?: boolean; estimado?: boolean; acertoDe?: string | null }
export interface DocAdiantDisp { id: string; numero: string; saldo: number; data: string; comandoId?: string | null; ug?: string | null }

export type TipoLote = 'MENSAL' | 'OND' | 'ACERTO' | 'CORRECAO';

export interface Base { regra: string; [k: string]: unknown }
export interface ItemLote {
  chave: string; omId: string; om: OMFat; sigla: string; servico: string; unidade: string;
  quantidade: number | null; quantidade2: number | null; valor: number; acrescimo: number; debito: number;
  base: Base; avisos: string[]; acertoDe?: string; estimado?: boolean;
  numero?: string; adiantamentos?: { docId: string; numero: string; valor: number }[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;
export const pad = (n: number, t = 2) => String(n).padStart(t, '0');
export const competenciaDe = (ano: number, mes: number) => `${ano}-${pad(mes)}`;
export const partes = (comp: string) => ({ ano: Number(comp.slice(0, 4)), mes: Number(comp.slice(5, 7)) });
export const mesesDoAno = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
export const referencia = (comp: string) => { const { ano, mes } = partes(comp); return `${mesesDoAno[mes - 1]}${String(ano).slice(2)}`; };
export const diasNoMes = (comp: string) => { const { ano, mes } = partes(comp); return new Date(Date.UTC(ano, mes, 0)).getUTCDate(); };

// ------------------------------------------------------------------ numeração
export const montarNumero = (codigo: string, sigla: string, comp: string, seq: number, versao = 0) => {
  const { ano, mes } = partes(comp);
  return `${codigo}-${sigla}-${pad(mes)}-${ano}-${pad(seq, 3)}-${versao}`;
};
const RE_NUM = /^(\d{4,5})-([A-Z]{2})-(\d{2})-(\d{4})-(\d{3})-(\d)$/;

/** Maior SEQ já usado por serviço na competência (qualquer OM). */
export function maioresSequenciais(numeros: string[], comp: string): Map<string, number> {
  const { ano, mes } = partes(comp);
  const m = new Map<string, number>();
  numeros.forEach(n => {
    const x = (n || '').trim().toUpperCase().match(RE_NUM);
    if (!x || Number(x[3]) !== mes || Number(x[4]) !== ano) return;
    m.set(x[2], Math.max(m.get(x[2]) || 0, Number(x[5])));
  });
  return m;
}

/** Ordem do lote (como no livro de emissão): extra-MB primeiro, depois setor, comando e cliente. */
export const ordemLote = (a: ItemLote, b: ItemLote) =>
  Number(a.om.tipo !== 'EXTRA_MB') - Number(b.om.tipo !== 'EXTRA_MB')
  || a.om.setor.localeCompare(b.om.setor) || a.om.comando.localeCompare(b.om.comando) || a.om.nome.localeCompare(b.om.nome) || a.sigla.localeCompare(b.sigla);

/** Dá número a cada item, em sequência por serviço, sem lacunas, continuando do maior SEQ existente. */
export function numerar(itens: ItemLote[], existentes: string[], comp: string): ItemLote[] {
  const seq = maioresSequenciais(existentes, comp);
  return [...itens].sort(ordemLote).map(i => {
    const s = (seq.get(i.sigla) || 0) + 1;
    seq.set(i.sigla, s);
    return { ...i, numero: montarNumero(i.om.codigo, i.sigla, comp, s) };
  });
}

// ------------------------------------------------------------------ cálculo
export interface DadosLote {
  competencia: string; tipo: TipoLote;
  oms: OMFat[]; servicos: ServicoFat[]; precos: PrecoFat[]; medicoes: MedicaoFat[]; atracacoes: AtracacaoFat[];
  historico: FaturaHist[];
  /** Serviços incluídos no lote (padrão: todos). */
  siglas?: string[];
  mesesMediaOnd?: [number, number];
  /** Divisor da média do OND: meses do período (padrão: 8 = JAN–AGO) ou só os meses com fatura. */
  divisorOnd?: 'PERIODO' | 'MESES_FATURADOS';
}

const ativaNa = (om: OMFat, comp: string) => {
  const ini = `${comp}-01`;
  if (om.ativadoEm && om.ativadoEm.slice(0, 7) > comp) return false;
  return om.ativo || (!!om.desativadoEm && om.desativadoEm >= ini);
};

function precoDe(precos: PrecoFat[], ano: number, sigla: string, omId: string) {
  return precos.find(p => p.ano === ano && p.sigla === sigla && p.omId === omId)
    ?? precos.find(p => p.ano === ano && p.sigla === sigla && !p.omId);
}

/** Itens de um mês (valores reais), usado no lote mensal, no extra-MB do OND e no acerto. */
export function calcularMes(d: DadosLote, comp: string, filtroOm?: (o: OMFat) => boolean): ItemLote[] {
  const { ano } = partes(comp);
  const sv = new Map(d.servicos.map(s => [s.sigla, s]));
  const quer = (s: string) => !d.siglas || d.siglas.includes(s);
  const oms = d.oms.filter(o => ativaNa(o, comp) && (!filtroOm || filtroOm(o)));
  const omPorId = new Map(oms.map(o => [o.id, o]));
  const itens: ItemLote[] = [];
  const item = (om: OMFat, sigla: string, x: Partial<ItemLote> & { valor: number; base: Base }): ItemLote => ({
    chave: `${om.id}|${sigla}`, omId: om.id, om, sigla, servico: sv.get(sigla)?.nome ?? sigla, unidade: sv.get(sigla)?.unidade ?? '',
    quantidade: null, quantidade2: null, acrescimo: 0, debito: 0, avisos: [], ...x, valor: r2(x.valor),
  });

  // TC: tabela anual da OM
  if (quer('TC')) oms.forEach(om => {
    const p = d.precos.find(x => x.ano === ano && x.sigla === 'TC' && x.omId === om.id);
    if (p && p.valor > 0) itens.push(item(om, 'TC', { valor: p.valor, unidade: '-', base: { regra: 'Taxa condominial mensal da tabela ' + ano, valorMensal: p.valor } }));
  });

  // DA: diária × dias atracado (docado não paga)
  if (quer('DA')) d.atracacoes.filter(a => a.competencia === comp && !a.previsao && a.diasAtracado > 0).forEach(a => {
    const om = omPorId.get(a.omId);
    if (!om) return;
    const p = d.precos.find(x => x.ano === ano && x.sigla === 'DA' && x.omId === om.id);
    const avisos = p ? [] : [`Sem diária de atracação ${ano} cadastrada para ${om.nome}.`];
    itens.push(item(om, 'DA', {
      quantidade: a.diasAtracado, unidade: 'DIA', valor: (p?.valor ?? 0) * a.diasAtracado, avisos,
      base: { regra: 'Diária × dias atracado (BNIC-35); dias docado não pagam', diaria: p?.valor ?? null, diasAtracado: a.diasAtracado, diasDocado: a.diasDocado },
    }));
  });

  // Demais serviços: medição/rateio da divisão
  d.medicoes.filter(m => m.competencia === comp && m.sigla !== 'TC' && m.sigla !== 'DA' && quer(m.sigla)).forEach(m => {
    const om = omPorId.get(m.omId);
    if (!om) return;
    const p = precoDe(d.precos, ano, m.sigla, om.id);
    let valor: number, base: Base;
    const avisos: string[] = [];
    if (m.valor != null) { valor = m.valor; base = { regra: 'Valor do rateio enviado pela divisão', quantidade: m.quantidade, quantidade2: m.quantidade2 }; }
    else if (p && m.quantidade != null) { valor = p.valor * m.quantidade; base = { regra: 'Quantidade × valor unitário ' + ano, valorUnitario: p.valor, quantidade: m.quantidade }; }
    else { valor = 0; base = { regra: 'Sem valor' }; avisos.push(`Medição de ${m.sigla} sem valor em R$ e sem valor unitário ${ano} cadastrado.`); }
    if (m.estimada) avisos.push('Consumo não mensurável: estimado pela média das 3 últimas medições (Anexo J).');
    if (valor <= 0 && !avisos.length) return;
    itens.push(item(om, m.sigla, { quantidade: m.quantidade ?? null, quantidade2: m.quantidade2 ?? null, valor, base, avisos }));
  });
  return itens.filter(i => i.valor > 0 || i.avisos.length);
}

/** Lote OND (competência OUT): estimativa de fim de exercício. */
export function calcularOnd(d: DadosLote): ItemLote[] {
  const { ano, mes } = partes(d.competencia);
  if (mes !== 10) throw new Error('O lote OND é da competência de outubro.');
  const [m1, m2] = d.mesesMediaOnd ?? [1, 8];
  const nMeses = m2 - m1 + 1;
  const sv = new Map(d.servicos.map(s => [s.sigla, s]));
  const quer = (s: string) => !d.siglas || d.siglas.includes(s);
  const mb = d.oms.filter(o => o.tipo !== 'EXTRA_MB' && ativaNa(o, d.competencia));
  const itens: ItemLote[] = [];

  // média JAN–AGO por OM e serviço (faturas não canceladas, sem acertos)
  const soma = new Map<string, { total: number; meses: Set<number> }>();
  d.historico.filter(h => h.ano === ano && h.mes >= m1 && h.mes <= m2 && !h.cancelada && !h.acertoDe && h.omId && h.sigla !== 'DA')
    .forEach(h => {
      const k = `${h.omId}|${h.sigla}`;
      const s = soma.get(k) || { total: 0, meses: new Set<number>() };
      s.total += h.valor; s.meses.add(h.mes);
      soma.set(k, s);
    });
  mb.forEach(om => {
    soma.forEach((s, k) => {
      const [omId, sigla] = k.split('|');
      if (omId !== om.id || !quer(sigla)) return;
      if (sigla === 'TC') return; // TC: 3 × valor mensal da tabela (abaixo)
      const divisor = d.divisorOnd === 'MESES_FATURADOS' ? s.meses.size : nMeses;
      const media = r2(s.total / divisor);
      if (media <= 0) return;
      itens.push({
        chave: k, omId: om.id, om, sigla, servico: sv.get(sigla)?.nome ?? sigla, unidade: sv.get(sigla)?.unidade ?? '',
        quantidade: null, quantidade2: null, valor: r2(media * 3), acrescimo: 0, debito: 0, estimado: true,
        avisos: s.meses.size < nMeses ? [`Só ${s.meses.size} de ${nMeses} meses com fatura no período: confira a média.`] : [],
        base: { regra: `Estimado OND: 3 × média mensal ${mesesDoAno[m1 - 1]}–${mesesDoAno[m2 - 1]}/${ano} (÷ ${divisor})`, totalPeriodo: r2(s.total), divisor, mesesComFatura: s.meses.size, mediaMensal: media },
      });
    });
    // TC: 3 × valor mensal da tabela do ano (sem tabela, usa a média como os demais)
    if (quer('TC')) {
      const p = d.precos.find(x => x.ano === ano && x.sigla === 'TC' && x.omId === om.id);
      const s = soma.get(`${om.id}|TC`);
      const mensal = p?.valor ?? (s ? r2(s.total / (d.divisorOnd === 'MESES_FATURADOS' ? s.meses.size : nMeses)) : 0);
      if (mensal > 0) itens.push({
        chave: `${om.id}|TC`, omId: om.id, om, sigla: 'TC', servico: sv.get('TC')?.nome ?? 'TC', unidade: '-',
        quantidade: null, quantidade2: null, valor: r2(mensal * 3), acrescimo: 0, debito: 0, estimado: true, avisos: p ? [] : ['Sem tabela de TC do ano: usada a média faturada.'],
        base: { regra: p ? `Estimado OND: 3 × taxa condominial mensal da tabela ${ano}` : 'Estimado OND: 3 × média faturada', valorMensal: mensal },
      });
    }
    // DA: diária × dias previstos OUT–DEZ
    if (!quer('DA')) return;
    const prev = d.atracacoes.filter(a => a.omId === om.id && a.previsao && partes(a.competencia).ano === ano && partes(a.competencia).mes >= 10);
    const dias = prev.reduce((s, a) => s + a.diasAtracado, 0);
    if (!dias) return;
    const p = d.precos.find(x => x.ano === ano && x.sigla === 'DA' && x.omId === om.id);
    itens.push({
      chave: `${om.id}|DA`, omId: om.id, om, sigla: 'DA', servico: sv.get('DA')?.nome ?? 'DA', unidade: 'DIA',
      quantidade: dias, quantidade2: null, valor: r2((p?.valor ?? 0) * dias), acrescimo: 0, debito: 0, estimado: true,
      avisos: p ? [] : [`Sem diária de atracação ${ano} cadastrada para ${om.nome}.`],
      base: { regra: 'Estimado OND: diária × dias previstos de atracação OUT–DEZ', diaria: p?.valor ?? null, diasPrevistos: dias, meses: prev.map(a => a.competencia) },
    });
  });
  // extra-MB: faturamento mensal normal
  itens.push(...calcularMes(d, d.competencia, o => o.tipo === 'EXTRA_MB'));
  return itens;
}

/** Acerto do OND: compara o estimado (faturas OND do ano) com o real de OUT, NOV e DEZ. */
export function calcularAcerto(d: DadosLote & { anoOnd: number }): ItemLote[] {
  const reais = new Map<string, { valor: number; porMes: Record<string, number> }>();
  [10, 11, 12].forEach(mes => {
    const comp = competenciaDe(d.anoOnd, mes);
    calcularMes({ ...d, siglas: undefined }, comp, o => o.tipo !== 'EXTRA_MB').forEach(i => {
      const r = reais.get(i.chave) || { valor: 0, porMes: {} };
      r.valor = r2(r.valor + i.valor); r.porMes[comp] = i.valor;
      reais.set(i.chave, r);
    });
  });
  const sv = new Map(d.servicos.map(s => [s.sigla, s]));
  const omPorId = new Map(d.oms.map(o => [o.id, o]));
  const estimadas = d.historico.filter(h => h.ano === d.anoOnd && h.mes === 10 && h.estimado && !h.cancelada && h.omId);
  const itens: ItemLote[] = [];
  estimadas.forEach(h => {
    const om = omPorId.get(h.omId!);
    if (!om || (d.siglas && !d.siglas.includes(h.sigla))) return;
    const chave = `${om.id}|${h.sigla}`;
    const real = reais.get(chave)?.valor ?? 0;
    const dif = r2(real - h.valor);
    if (Math.abs(dif) < 0.01) return;
    itens.push({
      chave, omId: om.id, om, sigla: h.sigla, servico: sv.get(h.sigla)?.nome ?? h.sigla, unidade: '-',
      quantidade: null, quantidade2: null, valor: 0, acrescimo: dif > 0 ? dif : 0, debito: dif < 0 ? -dif : 0,
      acertoDe: h.numero, avisos: real === 0 ? ['Sem medição real de OUT–DEZ: confira antes de emitir (o débito devolve todo o estimado).'] : [],
      base: { regra: `Acerto do OND ${d.anoOnd}: real OUT–DEZ − estimado`, estimado: h.valor, real, porMes: reais.get(chave)?.porMes ?? {}, faturaEstimada: h.numero },
    });
  });
  return itens;
}

// ------------------------------------------------------------------ adiantamento
/**
 * Abate o adiantamento disponível do cliente (mesmo comando ou mesma UG), ALTCRED mais antigas primeiro,
 * até o valor da fatura (linha 02 do FR-172).
 */
export function aplicarAdiantamentos(itens: ItemLote[], docs: DocAdiantDisp[]): ItemLote[] {
  const saldo = new Map(docs.map(d => [d.id, r2(d.saldo)]));
  const ordenados = [...docs].sort((a, b) => a.data.localeCompare(b.data) || a.numero.localeCompare(b.numero));
  return itens.map(i => {
    let resta = r2(i.valor + i.acrescimo - i.debito);
    if (resta <= 0) return { ...i, adiantamentos: [] };
    const usados: { docId: string; numero: string; valor: number }[] = [];
    ordenados.forEach(d => {
      if (resta <= 0) return;
      const doCliente = (i.om.comandoId && d.comandoId === i.om.comandoId) || d.ug === i.om.codigo;
      const s = saldo.get(d.id) || 0;
      if (!doCliente || s <= 0) return;
      const v = r2(Math.min(s, resta));
      usados.push({ docId: d.id, numero: d.numero, valor: v });
      saldo.set(d.id, r2(s - v)); resta = r2(resta - v);
    });
    return { ...i, adiantamentos: usados };
  });
}

/** Totais do lote (linhas do FR-172). */
export function totaisLote(itens: ItemLote[]) {
  const t = { qtd: itens.length, servico: 0, adiantamento: 0, acrescimo: 0, debito: 0, final: 0 };
  itens.forEach(i => {
    const ad = (i.adiantamentos || []).reduce((s, a) => s + a.valor, 0);
    t.servico += i.valor; t.adiantamento += ad; t.acrescimo += i.acrescimo; t.debito += i.debito;
    t.final += i.valor - ad + i.acrescimo - i.debito;
  });
  (Object.keys(t) as (keyof typeof t)[]).forEach(k => { if (k !== 'qtd') t[k] = r2(t[k]); });
  return t;
}
