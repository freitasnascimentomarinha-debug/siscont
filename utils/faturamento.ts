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
 *  - Acerto do OND (ano seguinte): a fatura traz o CONSUMO REAL (OUT+NOV+DEZ) como valor do serviço e abate, na linha 04
 *    (débito), o estimado já faturado. Real menor → crédito da OM (ver creditosAcerto.ts); real maior → a pagar.

 */
import { obterNormas } from './normas';
import { LinhaRegime, Regime, entraNaEstimativa, resolverRegime } from './regimeOnd';
export interface OMFat {
  id: string; codigo: string; nome: string; tipo: 'TERRA' | 'NAVIO' | 'EXTRA_MB'; comandoId?: string | null;
  setor: string; comando: string; ativo: boolean; desativadoEm?: string | null; ativadoEm?: string | null;
}
export interface ServicoFat { sigla: string; nome: string; unidade: string; ordem?: number; /** divisão responsável pelos dados (editável em Cadastros › Serviços) */ responsavel?: string | null; telefone?: string | null }
export interface PrecoFat { ano: number; sigla: string; omId: string | null; valor: number; unidade?: string | null }
export interface MedicaoFat { competencia: string; sigla: string; omId: string; quantidade?: number | null; quantidade2?: number | null; valor?: number | null; estimada?: boolean; /** linhas do detalhe (ex.: meses cobrados da viatura: "ABA · OUT25" e valor) */ detalhe?: { sigla?: string; valor?: number | null }[] | null }
export interface AtracacaoFat { competencia: string; omId: string; previsao: boolean; diasAtracado: number; diasDocado: number }
export interface FaturaHist { id: string; numero: string; omId?: string | null; sigla: string; ano: number; mes: number; valor: number; cancelada?: boolean; estimado?: boolean; acertoDe?: string | null; /** saldo ainda em aberto da fatura (para avisar se o estimado não foi pago) */ saldo?: number | null }
export interface DocAdiantDisp { id: string; numero: string; saldo: number; data: string; comandoId?: string | null; ug?: string | null }

export type TipoLote = 'MENSAL' | 'OND' | 'ACERTO' | 'CORRECAO';

export interface Base { regra: string; [k: string]: unknown }
export interface ItemLote {
  chave: string; omId: string; om: OMFat; sigla: string; servico: string; unidade: string;
  quantidade: number | null; quantidade2: number | null; valor: number; acrescimo: number; debito: number;
  base: Base; avisos: string[]; acertoDe?: string; estimado?: boolean;
  /** impede a emissão enquanto houver: ex. faltam faturas/subsídios sem a marca "sem movimento" (confira ou tire do lote) */
  bloqueio?: string;
  numero?: string; adiantamentos?: { docId: string; numero: string; valor: number }[];
  /** crédito de acerto compensado nesta fatura (já somado ao débito, linha 04) */
  creditos?: { chave: string; numero: string; valor: number }[];
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
  /** Regimes de fim de exercício por serviço e exceções por OM (script 032). Sem linhas = comportamento de antes (nada é excluído). */
  regimesOnd?: LinhaRegime[];
  /** Meses marcados como "sem movimento" (valem zero na média da estimativa e no acerto) e apurações já feitas (script 034). */
  semMovimento?: SemMovimento[];
  apuracoes?: ApuracaoLinha[];
}

export interface SemMovimento { omId: string; sigla: string; ano: number; mes: number }
export type ResultadoApuracao = 'DEBITO' | 'CREDITO' | 'SEM_DIFERENCA';
export interface ApuracaoLinha {
  id?: string; omId: string; sigla: string; exercicio: number; estimadaNumero?: string | null; estimado: number; real: number; diferenca: number;
  resultado: ResultadoApuracao; acertoNumero?: string | null; loteId?: string | null; memoria?: Record<string, unknown> | null;
  criadoPorNome?: string | null; criadoEm?: string | null; canceladaEm?: string | null; canceladaMotivo?: string | null;
}

/** A OM e o serviço entram na estimativa do OND? (regime 1 ou sem regra; regimes 2 e 3 ficam de fora) */
export const participaDoOnd = (d: Pick<DadosLote, 'regimesOnd'>, omId: string, sigla: string, ano: number) =>
  entraNaEstimativa(resolverRegime(d.regimesOnd || [], omId, sigla, ano));

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
      base: { regra: 'Diária × dias atracado (mapa de atracação); dias docado não pagam', diaria: p?.valor ?? null, diasAtracado: a.diasAtracado, diasDocado: a.diasDocado },
    }));
  });

  // Demais serviços: medição/rateio da divisão
  d.medicoes.filter(m => m.competencia === comp && m.sigla !== 'TC' && m.sigla !== 'DA' && quer(m.sigla)).forEach(m => {
    const om = omPorId.get(m.omId);
    if (!om) return;
    const p = precoDe(d.precos, ano, m.sigla, om.id);
    let valor: number, base: Base;
    const avisos: string[] = [];
    if (m.valor != null) {
      valor = m.valor; base = { regra: 'Valor do rateio enviado pela divisão', quantidade: m.quantidade, quantidade2: m.quantidade2 };
      // viatura cobrada com atraso: os meses cobrados saem na fatura (tabela Mês | Valor)
      if (m.sigla === 'VT' && m.detalhe?.length) base.meses = m.detalhe.filter(x => x.valor != null).map(x => ({ mes: String(x.sigla || '').split(' · ').pop() || '', valor: x.valor }));
    }
    else if (p && m.quantidade != null) { valor = p.valor * m.quantidade; base = { regra: 'Quantidade × valor unitário ' + ano, valorUnitario: p.valor, quantidade: m.quantidade }; }
    else { valor = 0; base = { regra: 'Sem valor' }; avisos.push(`Medição de ${m.sigla} sem valor em R$ e sem valor unitário ${ano} cadastrado.`); }
    if (m.estimada) avisos.push('Consumo não mensurável: estimado pela média das 3 últimas medições (' + obterNormas().anexoEstimativa + ').');
    if (valor <= 0 && !avisos.length) return;
    itens.push(item(om, m.sigla, { quantidade: m.quantidade ?? null, quantidade2: m.quantidade2 ?? null, valor, base, avisos }));
  });
  return itens.filter(i => i.valor > 0 || i.avisos.length);
}

/** Já existe fatura de outubro (não cancelada, que não é acerto) deste serviço para a OM no exercício: a estimativa já foi emitida. */
export const jaTemOutubro = (d: Pick<DadosLote, 'historico'>, omId: string, sigla: string, ano: number) =>
  d.historico.some(h => h.ano === ano && h.mes === 10 && !h.cancelada && !h.acertoDe && h.omId === omId && h.sigla === sigla);
const semMov = (d: Pick<DadosLote, 'semMovimento'>, omId: string, sigla: string, ano: number, mes: number) =>
  (d.semMovimento || []).some(x => x.omId === omId && x.sigla === sigla && x.ano === ano && x.mes === mes);

/** Pares (OM, serviço) cuja estimativa de outubro já foi emitida no exercício — a prévia avisa e não os repete. */
export function estimativasJaEmitidas(d: DadosLote): { omId: string; sigla: string }[] {
  const { ano, mes } = partes(d.competencia);
  if (mes !== 10) return [];
  const vistos = new Set<string>(), out: { omId: string; sigla: string }[] = [];
  d.historico.filter(h => h.ano === ano && h.mes >= 1 && h.mes <= 8 && !h.cancelada && !h.acertoDe && h.omId).forEach(h => {
    const k = `${h.omId}|${h.sigla}`; if (vistos.has(k)) return; vistos.add(k);
    if (participaDoOnd(d, h.omId!, h.sigla, ano) && jaTemOutubro(d, h.omId!, h.sigla, ano)) out.push({ omId: h.omId!, sigla: h.sigla });
  });
  return out;
}

/** Quantas OMs ficam fora da estimativa do OND por regra (regime 2 ou 3), por serviço — só para informar na prévia do lote. */
export function foraDoOnd(d: DadosLote): { sigla: string; regime: Regime; qtd: number }[] {
  const { ano, mes } = partes(d.competencia);
  if (mes !== 10) return [];
  const vistos = new Set<string>(), cont = new Map<string, number>();
  d.historico.filter(h => h.ano === ano && h.mes >= 1 && h.mes <= 8 && !h.cancelada && !h.acertoDe && h.omId).forEach(h => {
    const k = `${h.omId}|${h.sigla}`; if (vistos.has(k)) return; vistos.add(k);
    const e = resolverRegime(d.regimesOnd || [], h.omId, h.sigla, ano);
    if (e.regime === 2 || e.regime === 3) { const kk = `${h.sigla}|${e.regime}`; cont.set(kk, (cont.get(kk) || 0) + 1); }
  });
  return [...cont.entries()].map(([k, qtd]) => { const [sigla, r] = k.split('|'); return { sigla, regime: Number(r) as Regime, qtd }; }).sort((a, b) => a.sigla.localeCompare(b.sigla));
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
      if (!participaDoOnd(d, om.id, sigla, ano)) return;      // regime 2 ou 3 (script 032)
      if (jaTemOutubro(d, om.id, sigla, ano)) return;          // a estimativa deste exercício já foi emitida: nunca em duplicidade
      if (sigla === 'TC') return; // TC: 3 × valor mensal da tabela (abaixo)
      const divisor = d.divisorOnd === 'MESES_FATURADOS' ? s.meses.size : nMeses;
      const media = r2(s.total / divisor);
      if (media <= 0) return;
      // mês sem fatura só vale zero se estiver marcado como "sem movimento"; senão é pendência (não se presume consumo zero)
      const marcados = [], faltam: number[] = [];
      for (let m = m1; m <= m2; m++) if (!s.meses.has(m)) (semMov(d, om.id, sigla, ano, m) ? marcados : faltam).push(m);
      itens.push({
        chave: k, omId: om.id, om, sigla, servico: sv.get(sigla)?.nome ?? sigla, unidade: sv.get(sigla)?.unidade ?? '',
        quantidade: null, quantidade2: null, valor: r2(media * 3), acrescimo: 0, debito: 0, estimado: true,
        avisos: [...(faltam.length ? [`Sem fatura em ${faltam.map(m => mesesDoAno[m - 1]).join(', ')} e sem a marca "sem movimento": confira antes de emitir.`] : []),
          ...(marcados.length ? [`Meses sem movimento (valem zero): ${marcados.map(m => mesesDoAno[m - 1]).join(', ')}.`] : [])],
        bloqueio: faltam.length ? `Faltam as faturas de ${faltam.map(m => mesesDoAno[m - 1]).join(', ')}/${ano}: lance ou marque "sem movimento"` : undefined,
        base: { regra: `Estimado OND: 3 × média mensal ${mesesDoAno[m1 - 1]}–${mesesDoAno[m2 - 1]}/${ano} (÷ ${divisor})`, totalPeriodo: r2(s.total), divisor, mesesComFatura: s.meses.size, mesesSemMovimento: marcados, mesesFaltantes: faltam, mediaMensal: media },
      });
    });
    // TC: 3 × valor mensal da tabela do ano (sem tabela, usa a média como os demais)
    if (quer('TC') && participaDoOnd(d, om.id, 'TC', ano) && !jaTemOutubro(d, om.id, 'TC', ano)) {
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
    if (!quer('DA') || !participaDoOnd(d, om.id, 'DA', ano) || jaTemOutubro(d, om.id, 'DA', ano)) return;
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

/** A fatura de outubro é a estimativa do exercício? Marcada como estimativa, ou (importada) a OM está no regime 1 e não tem fatura mensal em nov/dez. */
export function ehEstimativa(d: Pick<DadosLote, 'historico' | 'regimesOnd'>, h: FaturaHist): boolean {
  if (h.cancelada || h.acertoDe || h.mes !== 10 || !h.omId) return false;
  if (h.estimado) return true;
  if (resolverRegime(d.regimesOnd || [], h.omId, h.sigla, h.ano).regime !== 1) return false;
  return !d.historico.some(x => x.ano === h.ano && (x.mes === 11 || x.mes === 12) && !x.cancelada && !x.acertoDe && x.omId === h.omId && x.sigla === h.sigla);
}

export interface LinhaApuracaoOnd {
  chave: string; omId: string; sigla: string; estimativa: FaturaHist; real: number; porMes: Record<string, number>;
  /** OUT, NOV e DEZ: tem subsídio real lançado ou está marcado "sem movimento" */
  lancados: Record<string, boolean>; faltam: number[]; diferenca: number; resultado: ResultadoApuracao | null; jaApurada: boolean;
}
export interface ApuracaoOnd {
  itens: ItemLote[]; semDiferenca: Omit<ApuracaoLinha, 'id'>[]; apuracoes: Omit<ApuracaoLinha, 'id'>[]; jaApuradas: { omId: string; sigla: string; numero: string }[]; linhas: LinhaApuracaoOnd[];
}

/**
 * Apuração do OND: compara a estimativa emitida com o consumo REAL de OUT, NOV e DEZ.
 * Precisa dos três meses (subsídio lançado ou marcado "sem movimento"); sem eles a fatura fica BLOQUEADA, nunca se presume zero.
 * Real maior → fatura de acerto a pagar (débito complementar); real menor → fatura de acerto com crédito da OM; igual → sem fatura
 * (a apuração é registrada como "sem diferença"). Uma apuração por OM, serviço e exercício: o que já foi apurado não se repete.
 */
export function apurarOnd(d: DadosLote & { anoOnd: number }): ApuracaoOnd {
  const reais = new Map<string, { valor: number; quantidade: number | null; porMes: Record<string, number> }>();
  const comps = [10, 11, 12].map(m => competenciaDe(d.anoOnd, m));
  comps.forEach(comp => {
    calcularMes({ ...d, siglas: undefined }, comp, o => o.tipo !== 'EXTRA_MB').forEach(i => {
      const r = reais.get(i.chave) || { valor: 0, quantidade: null, porMes: {} };
      r.valor = r2(r.valor + i.valor); r.porMes[comp] = i.valor;
      if (i.quantidade != null) r.quantidade = r2((r.quantidade ?? 0) + i.quantidade);
      reais.set(i.chave, r);
    });
  });
  const sv = new Map(d.servicos.map(s => [s.sigla, s]));
  const omPorId = new Map(d.oms.map(o => [o.id, o]));
  const ativas = (d.apuracoes || []).filter(a => !a.canceladaEm);
  const out: ApuracaoOnd = { itens: [], semDiferenca: [], apuracoes: [], jaApuradas: [], linhas: [] };
  d.historico.filter(h => h.ano === d.anoOnd && ehEstimativa(d, h)).forEach(h => {
    const om = omPorId.get(h.omId!);
    if (!om || (d.siglas && !d.siglas.includes(h.sigla))) return;
    const chave = `${om.id}|${h.sigla}`;
    const rr = reais.get(chave);
    const real = rr?.valor ?? 0;
    const dif = r2(real - h.valor);
    const lancados: Record<string, boolean> = {}, faltam: number[] = [];
    [10, 11, 12].forEach((m, k) => { const ok = rr?.porMes[comps[k]] !== undefined || semMov(d, om.id, h.sigla, d.anoOnd, m); lancados[comps[k]] = ok; if (!ok) faltam.push(m); });
    const resultado: ResultadoApuracao = Math.abs(dif) < 0.01 ? 'SEM_DIFERENCA' : dif > 0 ? 'DEBITO' : 'CREDITO';
    // já apurada: apuração registrada, ou fatura de acerto (não cancelada) da estimada
    const chaveEst = h.numero.replace(/-\d$/, '');
    const jaApurada = ativas.some(a => a.omId === om.id && a.sigla === h.sigla && a.exercicio === d.anoOnd)
      || d.historico.some(x => !x.cancelada && x.acertoDe && x.acertoDe.replace(/-\d$/, '') === chaveEst);
    out.linhas.push({ chave, omId: om.id, sigla: h.sigla, estimativa: h, real, porMes: rr?.porMes ?? {}, lancados, faltam, diferenca: dif, resultado: faltam.length ? null : resultado, jaApurada });
    if (jaApurada) { out.jaApuradas.push({ omId: om.id, sigla: h.sigla, numero: h.numero }); return; }
    const avisos: string[] = [];
    if (faltam.length) avisos.push(`Faltam os subsídios reais de ${faltam.map(m => mesesDoAno[m - 1]).join(', ')}/${d.anoOnd} (lance ou marque "sem movimento").`);
    if ((h.saldo ?? 0) > 0.01) avisos.push(`A fatura estimada ${h.numero} ainda tem R$ ${(h.saldo as number).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} em aberto: o crédito só existe de fato depois que ela for paga.`);
    const base = {
      regra: `Acerto do OND ${d.anoOnd}: consumo real OUT–DEZ, abatido o estimado já faturado (linha 04), até o valor do consumo real`,
      estimado: h.valor, real, debitado: r2(Math.min(h.valor, real)), diferenca: dif, credito: dif < 0 ? -dif : 0, aPagar: dif > 0 ? dif : 0, porMes: rr?.porMes ?? {}, faturaEstimada: h.numero,
    };
    const memoria = { ...base, mesesSemMovimento: [10, 11, 12].filter(m => semMov(d, om.id, h.sigla, d.anoOnd, m)) };
    if (!faltam.length) out.apuracoes.push({ omId: om.id, sigla: h.sigla, exercicio: d.anoOnd, estimadaNumero: h.numero, estimado: h.valor, real, diferenca: dif, resultado, memoria });
    if (resultado === 'SEM_DIFERENCA' && !faltam.length) { out.semDiferenca.push({ omId: om.id, sigla: h.sigla, exercicio: d.anoOnd, estimadaNumero: h.numero, estimado: h.valor, real, diferenca: 0, resultado, memoria }); return; }
    out.itens.push({
      chave, omId: om.id, om, sigla: h.sigla, servico: sv.get(h.sigla)?.nome ?? h.sigla, unidade: sv.get(h.sigla)?.unidade ?? '-',
      quantidade: rr?.quantidade ?? null, quantidade2: null, valor: real, acrescimo: 0, debito: r2(Math.min(h.valor, real)),
      acertoDe: h.numero, avisos, bloqueio: faltam.length ? `Faltam os subsídios reais de ${faltam.map(m => mesesDoAno[m - 1]).join(', ')}/${d.anoOnd}` : undefined, base: { ...base, mesesFaltantes: faltam },
    });
  });
  return out;
}

/** Itens da fatura de acerto (compatível com o uso anterior). */
export const calcularAcerto = (d: DadosLote & { anoOnd: number }): ItemLote[] => apurarOnd(d).itens;

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

/** Unidade da segunda quantidade da medição (energia: demanda em kW; viatura: km; telefonia: minutos móveis). */
const UNIDADE2: Record<string, string> = { EL: 'kW', VT: 'km', TL: 'min' };
export const unidade2 = (sigla: string) => UNIDADE2[(sigla || '').toUpperCase()] || '';
const qtd = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 2 });

/** Consumo para tela e fatura: "8.000 M³" ou "52.000 KWH / 120 kW". Sem número válido não mostra nada (nunca "NaN"). */
export function textoConsumo(i: { sigla: string; unidade?: string; quantidade: number | null; quantidade2: number | null }): string {
  const ok = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isFinite(n);
  const a = ok(i.quantidade) ? `${qtd(i.quantidade)}${i.unidade && i.unidade !== '-' ? ` ${i.unidade}` : ''}` : '';
  const u2 = unidade2(i.sigla);
  const b = ok(i.quantidade2) ? `${qtd(i.quantidade2)}${u2 ? ` ${u2}` : ''}` : '';
  return [a, b].filter(Boolean).join(' / ') || '-';
}

const ROTULOS_BASE: Record<string, string> = {
  estimado: 'Estimado já faturado', real: 'Consumo real', diferenca: 'Diferença (real − estimado)', credito: 'Crédito da OM', aPagar: 'A pagar',
  faturaEstimada: 'Fatura estimada', quantidade: 'Quantidade', quantidade2: 'Segunda quantidade', media: 'Média', dias: 'Dias', mensal: 'Valor mensal',
  creditoCompensado: 'Crédito compensado', debitado: 'Abatido na linha 04 (débito)', tipo: 'Tipo',
};
const brlTxt = (n: number) => `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const DINHEIRO = new Set(['estimado', 'real', 'diferenca', 'credito', 'aPagar', 'media', 'mensal', 'creditoCompensado', 'debitado']);

/** A base de cálculo em frases curtas ("Estimado já faturado: R$ 100.000,00"), no lugar do texto técnico (JSON). */
export function descreverBase(base: Base | Record<string, unknown>, sigla = ''): string[] {
  const out: string[] = [];
  Object.entries(base || {}).forEach(([k, v]) => {
    if (k === 'regra' || v === null || v === undefined || v === '') return;
    if (k === 'creditos') return;                       // já aparece como "Compensação do crédito do acerto nº ..."
    if (k === 'porMes' && typeof v === 'object') {
      const meses = Object.entries(v as Record<string, number>).map(([m, x]) => `${m.slice(5)}/${m.slice(0, 4)} ${brlTxt(Number(x))}`);
      if (meses.length) out.push(`Consumo real por mês: ${meses.join(' · ')}`);
      return;
    }
    if (typeof v === 'object') return;
    const rotulo = ROTULOS_BASE[k] || k;
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) return;
      const u2 = k === 'quantidade2' ? unidade2(sigla) : '';
      out.push(`${k === 'quantidade2' && u2 ? 'Demanda / segunda quantidade' : rotulo}: ${DINHEIRO.has(k) ? brlTxt(v) : qtd(v) + (u2 ? ' ' + u2 : '')}`);
    } else out.push(`${rotulo}: ${String(v)}`);
  });
  return out;
}
