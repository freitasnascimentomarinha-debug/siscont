/**
 * Fase 6 — rotinas anuais: taxa condominial (modelo da "Proposta 4") e diária de atracação (média trienal).
 *
 * Rateio de cada rubrica entre as OM que participam dela (matriz OM × rubrica):
 *   peso = lotação × dias   (OM de terra: 30; navio: média mensal trienal de dias atracados da sua classe)
 *   parcela = peso ÷ Σ pesos das participantes × valor da rubrica (já com os descontos gerais)
 * Descontos por OM (% ou R$, numa rubrica ou no total) reduzem a parcela daquela OM.
 * Navio: participa da rubrica "Navios" (valor destinado às diárias; na proposta 2026, R$ 1.236.100,00).
 *   Diária = custo por militar-dia × lotação, onde custo por militar-dia = Σ parcelas dos navios ÷
 *   Σ (lotação × dias/mês × 12). Navio de classe sem histórico (média 0) fica fora do rateio e recebe a diária
 *   alternativa = (média das diárias dos navios com histórico ÷ média da lotação desses navios) × lotação,
 *   que é o mesmo custo por militar-dia × lotação ("diária a ser considerada com base na lotação" da planilha).
 * Conferido com a Proposta 4 (2026): SecNSNQ R$ 120.688,36, BNIC R$ 3.053.471,44, Corveta Barroso R$ 403,86/dia,
 *   custo por militar-dia R$ 2,7288.
 * Média trienal (por classe, para o exercício N): para cada ano N−3..N−1, dias atracados ("A") da classe ÷ navios
 *   ativos da classe naquele ano; soma ÷ 3 = média anual; ÷ 12 = média mensal (dias por mês).
 */
const r2 = (n: number) => Math.round(n * 100) / 100;

// ------------------------------------------------------------------ média trienal
export interface AnoClasse { ano: number; classeId: string; dias: number; navios: number }
export interface MediaClasse { classeId: string; anos: { ano: number; dias: number; navios: number; porNavio: number }[]; total: number; mediaAnual: number; mediaMensal: number }

export function mediaTrienal(dados: AnoClasse[], exercicio: number, classes: string[]): MediaClasse[] {
  const anos = [exercicio - 3, exercicio - 2, exercicio - 1];
  return classes.map(c => {
    const det = anos.map(a => {
      const d = dados.find(x => x.ano === a && x.classeId === c);
      const dias = d?.dias ?? 0, navios = d?.navios ?? 0;
      return { ano: a, dias, navios, porNavio: navios > 0 ? Math.round((dias / navios) * 10) / 10 : 0 };
    });
    const total = Math.round(det.reduce((s, x) => s + x.porNavio, 0) * 10) / 10;
    return { classeId: c, anos: det, total, mediaAnual: Math.round((total / 3) * 10) / 10, mediaMensal: Math.round((total / 3 / 12) * 100) / 100 };
  });
}

/** Navios ativos de uma classe num ano (ativos em algum momento do ano). */
export function naviosAtivos(oms: { classeId?: string | null; tipo: string; ativadoEm?: string | null; desativadoEm?: string | null }[], classeId: string, ano: number) {
  return oms.filter(o => o.tipo === 'NAVIO' && o.classeId === classeId
    && (!o.ativadoEm || o.ativadoEm.slice(0, 4) <= String(ano)) && (!o.desativadoEm || o.desativadoEm.slice(0, 4) >= String(ano))).length;
}

// ------------------------------------------------------------------ rateio
/** Como a parte das OM de uma rubrica é dividida entre elas. */
export type Criterio = 'LOTACAO' | 'AREA' | 'IGUAL' | 'PESO';
export const CRITERIOS: Record<Criterio, string> = {
  LOTACAO: 'Por pessoa (lotação × dias)', AREA: 'Por área ocupada (m²)', IGUAL: 'Partes iguais', PESO: 'Peso informado (outro critério)',
};
/** SEPARADO: OM e navios pagam, cada grupo, a sua % do valor (um não afeta o outro). CONJUNTO: um só valor dividido entre OM e navios. */
export type ModoNavios = 'SEPARADO' | 'CONJUNTO';
export interface RubricaTC {
  numero: number; descricao: string; valorPrevisto: number; descontoGeral: number;
  criterio?: Criterio; percentualOM?: number | null; percentualNavios?: number | null; modoNavios?: ModoNavios;
  /** valor efetivamente rateado entre as OM (calculado por ratearProposta) */
  valorRateio?: number;
}
export interface Participante { omId: string; nome: string; tipo: 'TERRA' | 'NAVIO'; lotacao: number; dias: number; semHistorico?: boolean; area?: number | null; pesoManual?: number | null }
export interface Desconto { id: string; omId: string | null; rubrica: number | null; tipo: 'PERCENTUAL' | 'VALOR'; valor: number; justificativa: string }

export interface ParcelaRubrica { rubrica: number; bruto: number; desconto: number; liquido: number }
export interface ResultadoOM {
  omId: string; nome: string; tipo: 'TERRA' | 'NAVIO'; lotacao: number; dias: number; peso: number;
  parcelas: ParcelaRubrica[]; anualBruto: number; descontos: number; anual: number; mensal: number; percentual: number;
  diaria?: number; regraDiaria?: 'CLASSE' | 'SEM_HISTORICO';
}
export interface ResultadoRateio { oms: ResultadoOM[]; valorRubricas: { numero: number; valor: number; distribuido: number; semParticipante: boolean }[]; total: number; custoMilitarDia: number }

export const valorVigente = (r: RubricaTC) => r2(Math.max(0, r.valorPrevisto - r.descontoGeral));

export function ratear(rubricas: RubricaTC[], participantes: Participante[], matriz: Set<string>, descontos: Desconto[]): ResultadoRateio {
  const chave = (rub: number, om: string) => `${rub}|${om}`;
  const peso = (p: Participante) => (p.semHistorico ? 0 : p.lotacao * p.dias);
  // peso de cada participante na rubrica, conforme o critério da rubrica
  const pesoRub = (r: RubricaTC, p: Participante) => {
    switch (r.criterio || 'LOTACAO') {
      case 'AREA': return Math.max(0, p.area || 0);
      case 'IGUAL': return p.tipo === 'NAVIO' && p.semHistorico ? 0 : 1;
      case 'PESO': return Math.max(0, p.pesoManual || 0);
      default: return peso(p);
    }
  };
  const res = new Map<string, ResultadoOM>(participantes.map(p => [p.omId, {
    omId: p.omId, nome: p.nome, tipo: p.tipo, lotacao: p.lotacao, dias: p.dias, peso: r2(peso(p)), parcelas: [], anualBruto: 0, descontos: 0, anual: 0, mensal: 0, percentual: 0,
  }]));
  const valorRubricas = rubricas.map(r => {
    const valor = r.valorRateio !== undefined ? r2(r.valorRateio) : valorVigente(r);
    const part = participantes.filter(p => matriz.has(chave(r.numero, p.omId)) && pesoRub(r, p) > 0);
    const soma = part.reduce((s, p) => s + pesoRub(r, p), 0);
    let distribuido = 0;
    part.forEach(p => {
      const bruto = soma ? r2((pesoRub(r, p) / soma) * valor) : 0;
      const desc = descontos.filter(d => d.omId === p.omId && d.rubrica === r.numero)
        .reduce((s, d) => s + (d.tipo === 'PERCENTUAL' ? bruto * d.valor / 100 : d.valor), 0);
      const liquido = r2(Math.max(0, bruto - desc));
      res.get(p.omId)!.parcelas.push({ rubrica: r.numero, bruto, desconto: r2(bruto - liquido), liquido });
      distribuido += bruto;
    });
    return { numero: r.numero, valor, distribuido: r2(distribuido), semParticipante: valor > 0 && !part.length };
  });
  res.forEach(o => {
    o.anualBruto = r2(o.parcelas.reduce((s, p) => s + p.liquido, 0));
    // descontos da OM sobre o total (rubrica vazia)
    const dt = descontos.filter(d => d.omId === o.omId && d.rubrica === null)
      .reduce((s, d) => s + (d.tipo === 'PERCENTUAL' ? o.anualBruto * d.valor / 100 : d.valor), 0);
    o.anual = r2(Math.max(0, o.anualBruto - dt));
    o.descontos = r2(o.parcelas.reduce((s, p) => s + p.desconto, 0) + (o.anualBruto - o.anual));
    o.mensal = r2(o.anual / 12);
  });
  const total = r2([...res.values()].reduce((s, o) => s + o.anual, 0));
  res.forEach(o => { o.percentual = total ? Math.round((o.anual / total) * 10000) / 100 : 0; });

  // diárias dos navios
  const navios = [...res.values()].filter(o => o.tipo === 'NAVIO');
  const comHist = navios.filter(o => o.peso > 0);
  const militarDias = comHist.reduce((s, o) => s + o.lotacao * o.dias * 12, 0);
  const custoMilitarDia = militarDias ? comHist.reduce((s, o) => s + o.anual, 0) / militarDias : 0;
  comHist.forEach(o => { o.diaria = r2(custoMilitarDia * o.lotacao); o.regraDiaria = 'CLASSE'; });
  const mediaDiaria = comHist.length ? comHist.reduce((s, o) => s + (o.diaria || 0), 0) / comHist.length : 0;
  const mediaLotacao = comHist.length ? comHist.reduce((s, o) => s + o.lotacao, 0) / comHist.length : 0;
  navios.filter(o => o.peso === 0).forEach(o => { o.diaria = mediaLotacao ? r2((mediaDiaria / mediaLotacao) * o.lotacao) : 0; o.regraDiaria = 'SEM_HISTORICO'; });
  return { oms: [...res.values()].sort((a, b) => Number(a.tipo === 'NAVIO') - Number(b.tipo === 'NAVIO') || a.nome.localeCompare(b.nome)), valorRubricas, total, custoMilitarDia: Math.round(custoMilitarDia * 10000) / 10000 };
}

/** Quadro comparativo (Anexo B): taxa do ano anterior × proposta, por OM. */
export function comparativo(oms: ResultadoOM[], anterior: Map<string, number>) {
  return oms.filter(o => o.tipo === 'TERRA').map(o => {
    const ant = anterior.get(o.omId) || 0;
    return { omId: o.omId, nome: o.nome, anteriorAnual: r2(ant * 12), anteriorMensal: ant, propostaAnual: o.anual, propostaMensal: o.mensal, variacao: ant ? Math.round(((o.mensal - ant) / ant) * 10000) / 100 : null };
  });
}

/**
 * Participantes do rateio: OM com lotação informada no ano. Navio usa os dias informados na lotação (se houver)
 * ou a média mensal trienal da sua classe; OM de terra (e extra-MB) usa 30 dias.
 */
export function montarParticipantes(
  oms: { id: string; nome: string; tipo: string; classeId?: string | null }[],
  lotacoes: { omId: string; lotacao: number; dias?: number | null; area?: number | null; peso?: number | null }[],
  mediaMensalDaClasse: Map<string, number>,
): Participante[] {
  const porId = new Map(oms.map(o => [o.id, o]));
  return lotacoes.filter(l => porId.has(l.omId) && (l.lotacao > 0 || (l.area ?? 0) > 0 || (l.peso ?? 0) > 0)).map(l => {
    const o = porId.get(l.omId)!;
    const navio = o.tipo === 'NAVIO';
    const dias = l.dias !== null && l.dias !== undefined ? l.dias : navio ? (o.classeId ? mediaMensalDaClasse.get(o.classeId) ?? 0 : 0) : 30;
    return { omId: o.id, nome: o.nome, tipo: navio ? 'NAVIO' : 'TERRA', lotacao: l.lotacao, dias, semHistorico: navio && !(dias > 0), area: l.area ?? null, pesoManual: l.peso ?? null };
  });
}

/**
 * Taxa condominial e diárias numa passada, com o critério de cada rubrica:
 *  - parte das OM = (valor previsto − desconto geral) × %OM; dividida entre as OM marcadas na matriz pelo critério
 *    (lotação × dias, área, partes iguais ou peso informado);
 *  - parte dos navios: SEPARADO → valor previsto × %navios (não mexe na parte das OM; é o modelo da planilha 2026);
 *    CONJUNTO → a parte das OM é dividida entre OM e o grupo dos navios pela lotação × dias, e o que cabe aos navios
 *    sai da conta das OM;
 *  - a soma das partes dos navios é rateada entre os navios (lotação × dias) e vira a diária de cada um.
 */
export interface PorRubrica { numero: number; baseOM: number; navios: number }
export function ratearProposta(rubricas: RubricaTC[], terra: Participante[], navios: Participante[], matriz: Set<string>, descontos: Desconto[]) {
  const pesoNav = navios.filter(n => !n.semHistorico).reduce((s, n) => s + n.lotacao * n.dias, 0);
  const porRubrica: PorRubrica[] = rubricas.map(r => {
    let base = r2(valorVigente(r) * (r.percentualOM ?? 100) / 100);
    let nav = 0;
    if ((r.modoNavios || 'SEPARADO') === 'CONJUNTO') {
      if (pesoNav > 0 && (r.percentualNavios ?? 0) > 0) {
        const pesoOM = terra.filter(t => matriz.has(`${r.numero}|${t.omId}`)).reduce((s, t) => s + t.lotacao * t.dias, 0);
        nav = r2(base * pesoNav / (pesoNav + pesoOM));
        base = r2(base - nav);
      }
    } else nav = r2(r.valorPrevisto * (r.percentualNavios ?? 0) / 100);
    return { numero: r.numero, baseOM: base, navios: nav };
  });
  const tc = ratear(rubricas.map((r, i) => ({ ...r, valorRateio: porRubrica[i].baseOM })), terra, matriz, descontos);
  const totalNavios = r2(porRubrica.reduce((s, x) => s + x.navios, 0));
  const da = ratear([{ numero: 0, descricao: 'Navios (soma das partes dos navios nas rubricas)', valorPrevisto: totalNavios, descontoGeral: 0 }],
    navios, new Set(navios.map(n => `0|${n.omId}`)), []);
  return { tc, da, porRubrica, totalNavios };
}

