/**
 * Acompanhamento do encerramento do exercício (funções puras): para cada OM e serviço, em que ponto está a estimativa de outubro,
 * os subsídios reais de OUT–DEZ, a apuração em janeiro e o crédito ou débito que resultou. Sem gravar nada.
 */
import { ApuracaoLinha, ApuracaoOnd, FaturaHist, SemMovimento, ehEstimativa } from './faturamento';
import { LinhaRegime, Regime, RegimeEfetivo, resolverRegime } from './regimeOnd';
import { MovCredito, saldoPorOm } from './creditosOm';

const r2 = (n: number) => Math.round(n * 100) / 100;

export const SITUACOES = [
  'Não configurado', 'Pendente de estimativa', 'Estimativa gerada', 'Aguardando subsídios reais', 'Subsídios parcialmente lançados', 'Pronto para apuração',
  'Apuração realizada', 'Fatura complementar gerada', 'Crédito registrado', 'Sem diferença', 'Apuração cancelada',
] as const;
export type Situacao = typeof SITUACOES[number] | 'Mensal normal (fora da estimativa)' | 'Não participa';

export interface LinhaEncerramento {
  chave: string; omId: string; omNome: string; ug: string; sigla: string; servico: string;
  regime: Regime | null; regimeEfetivo: RegimeEfetivo;
  /** valor faturado de JAN a AGO (índice 1 a 8), sem canceladas nem acertos */
  janAgo: Record<number, number>; totalJanAgo: number; mediaMensal: number; estimadoCalculado: number;
  estimativa?: FaturaHist; estimado: number | null;
  /** OUT, NOV e DEZ: valor real lançado (null = falta lançar); semMov = marcado "sem movimento" */
  reais: { mes: number; valor: number | null; semMov: boolean }[]; lancados: number; totalReal: number | null;
  diferenca: number | null; resultado: 'DEBITO' | 'CREDITO' | 'SEM_DIFERENCA' | null;
  situacao: Situacao; apuracao?: ApuracaoLinha; apuracaoCancelada?: ApuracaoLinha;
}

export interface EntradaEncerramento {
  ano: number; oms: { id: string; codigo: string; nome: string }[]; servicos: { sigla: string; nome: string }[];
  regimes: LinhaRegime[]; historico: FaturaHist[]; apuracao: ApuracaoOnd; apuracoes: ApuracaoLinha[]; semMovimento: SemMovimento[];
}

/** Uma linha por OM e serviço com faturamento de JAN a AGO do exercício, estimativa de outubro ou regime cadastrado. */
export function linhasEncerramento(e: EntradaEncerramento): LinhaEncerramento[] {
  const om = new Map(e.oms.map(o => [o.id, o])), sv = new Map(e.servicos.map(s => [s.sigla, s]));
  const pares = new Map<string, { omId: string; sigla: string }>();
  e.historico.filter(h => h.ano === e.ano && !h.cancelada && !h.acertoDe && h.omId && h.mes <= 10).forEach(h => pares.set(`${h.omId}|${h.sigla}`, { omId: h.omId!, sigla: h.sigla }));
  e.regimes.filter(l => l.escopo === 'OM' && l.omId).forEach(l => { if (resolverRegime(e.regimes, l.omId, l.sigla, e.ano).regime === 1) pares.set(`${l.omId}|${l.sigla}`, { omId: l.omId!, sigla: l.sigla }); });
  const linhaApur = new Map(e.apuracao.linhas.map(l => [l.chave, l]));
  const out: LinhaEncerramento[] = [];
  pares.forEach(({ omId, sigla }, chave) => {
    const o = om.get(omId); if (!o) return;
    const efetivo = resolverRegime(e.regimes, omId, sigla, e.ano);
    const hist = e.historico.filter(h => h.ano === e.ano && !h.cancelada && !h.acertoDe && h.omId === omId && h.sigla === sigla);
    const janAgo: Record<number, number> = {};
    hist.filter(h => h.mes >= 1 && h.mes <= 8).forEach(h => { janAgo[h.mes] = r2((janAgo[h.mes] || 0) + h.valor); });
    const totalJanAgo = r2(Object.values(janAgo).reduce((s, v) => s + v, 0)), media = r2(totalJanAgo / 8);
    const estimativa = hist.find(h => ehEstimativa(e, h));
    const ap = linhaApur.get(chave);
    const marcados = new Set(e.semMovimento.filter(x => x.omId === omId && x.sigla === sigla && x.ano === e.ano).map(x => x.mes));
    const reais = [10, 11, 12].map(mes => {
      const comp = `${e.ano}-${String(mes).padStart(2, '0')}`, v = ap?.porMes[comp];
      return { mes, valor: v !== undefined ? v : marcados.has(mes) ? 0 : null, semMov: marcados.has(mes) && v === undefined };
    });
    const lancados = reais.filter(r => r.valor !== null).length;
    const totalReal = estimativa && lancados === 3 ? r2(reais.reduce((s, r) => s + (r.valor || 0), 0)) : null;
    const dif = totalReal !== null && estimativa ? r2(totalReal - estimativa.valor) : null;
    const registradas = e.apuracoes.filter(a => a.omId === omId && a.sigla === sigla && a.exercicio === e.ano);
    const ativa = registradas.find(a => !a.canceladaEm), cancelada = registradas.find(a => a.canceladaEm);
    // apuração feita antes do registro (fatura de acerto emitida): vale a fatura
    const faturaAcerto = estimativa ? e.historico.find(h => !h.cancelada && h.acertoDe && h.acertoDe.replace(/-\d$/, '') === estimativa.numero.replace(/-\d$/, '')) : undefined;
    let situacao: Situacao; let resultado: LinhaEncerramento['resultado'] = dif === null ? null : Math.abs(dif) < 0.01 ? 'SEM_DIFERENCA' : dif > 0 ? 'DEBITO' : 'CREDITO';
    if (efetivo.regime === null) situacao = 'Não configurado';
    else if (efetivo.regime === 2) situacao = 'Mensal normal (fora da estimativa)';
    else if (efetivo.regime === 3) situacao = 'Não participa';
    else if (!estimativa) situacao = 'Pendente de estimativa';
    else if (ativa) { resultado = ativa.resultado; situacao = ativa.resultado === 'DEBITO' ? 'Fatura complementar gerada' : ativa.resultado === 'CREDITO' ? 'Crédito registrado' : 'Sem diferença'; }
    else if (faturaAcerto) { resultado = faturaAcerto.valor > 0 ? 'DEBITO' : 'CREDITO'; situacao = resultado === 'DEBITO' ? 'Fatura complementar gerada' : 'Crédito registrado'; }
    else if (cancelada && lancados === 3) situacao = 'Apuração cancelada';
    else if (lancados === 3) situacao = 'Pronto para apuração';
    else if (lancados === 0) situacao = 'Aguardando subsídios reais';
    else situacao = 'Subsídios parcialmente lançados';
    out.push({
      chave, omId, omNome: o.nome, ug: o.codigo, sigla, servico: sv.get(sigla)?.nome || sigla, regime: efetivo.regime, regimeEfetivo: efetivo,
      janAgo, totalJanAgo, mediaMensal: media, estimadoCalculado: r2(media * 3), estimativa, estimado: estimativa ? estimativa.valor : null,
      reais, lancados, totalReal, diferenca: dif, resultado, situacao, apuracao: ativa, apuracaoCancelada: cancelada,
    });
  });
  return out.sort((a, b) => a.omNome.localeCompare(b.omNome, 'pt-BR') || a.sigla.localeCompare(b.sigla));
}

export interface FiltroEncerramento { om?: string; servico?: string; regime?: string; situacao?: string; subsidios?: string; acerto?: string }
export function filtrarEncerramento(ls: LinhaEncerramento[], f: FiltroEncerramento): LinhaEncerramento[] {
  return ls.filter(l =>
    (!f.om || l.omId === f.om) && (!f.servico || l.sigla === f.servico) &&
    (!f.regime || (f.regime === 'x' ? l.regime === null : String(l.regime) === f.regime)) && (!f.situacao || l.situacao === f.situacao) &&
    (!f.subsidios || (f.subsidios === 'pendentes' ? l.regime === 1 && !!l.estimativa && l.lancados < 3 : f.subsidios === 'completos' ? l.lancados === 3 : l.lancados > 0 && l.lancados < 3)) &&
    (!f.acerto || (f.acerto === 'feito' ? !!l.apuracao || l.situacao === 'Fatura complementar gerada' || l.situacao === 'Crédito registrado' || l.situacao === 'Sem diferença' : l.regime === 1 && !!l.estimativa && !l.apuracao && l.situacao !== 'Fatura complementar gerada' && l.situacao !== 'Crédito registrado' && l.situacao !== 'Sem diferença')));
}

export interface IndicadoresEncerramento {
  omsParticipantes: number; servicosEstimados: number; faturasEstimativas: number; valorEstimado: number; subsidiosPendentes: number;
  apuracoesConcluidas: number; creditosGerados: number; debitosComplementares: number; saldoCreditos: number;
}
export function indicadoresEncerramento(ls: LinhaEncerramento[], livro: MovCredito[]): IndicadoresEncerramento {
  const r1 = ls.filter(l => l.regime === 1);
  const com = r1.filter(l => l.estimativa);
  const concl = r1.filter(l => l.situacao === 'Fatura complementar gerada' || l.situacao === 'Crédito registrado' || l.situacao === 'Sem diferença');
  const dif = (l: LinhaEncerramento) => l.apuracao ? l.apuracao.diferenca : l.diferenca ?? 0;
  return {
    omsParticipantes: new Set(r1.map(l => l.omId)).size, servicosEstimados: com.length, faturasEstimativas: com.length, valorEstimado: r2(com.reduce((s, l) => s + (l.estimado || 0), 0)),
    subsidiosPendentes: com.reduce((s, l) => s + (3 - l.lancados), 0) - concl.reduce((s, l) => s + (3 - l.lancados), 0),
    apuracoesConcluidas: concl.length,
    creditosGerados: r2(concl.filter(l => l.resultado === 'CREDITO').reduce((s, l) => s + Math.abs(dif(l)), 0)),
    debitosComplementares: r2(concl.filter(l => l.resultado === 'DEBITO').reduce((s, l) => s + Math.abs(dif(l)), 0)),
    saldoCreditos: r2([...saldoPorOm(livro).values()].reduce((s, v) => s + v, 0)),
  };
}
