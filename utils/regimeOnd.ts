/**
 * Regime de fim de exercício (OND) por serviço, com exceções por OM (script 032). Funções puras.
 *
 *  1 = estimativa de outubro (OUT–DEZ) + acerto em janeiro
 *  2 = faturamento mensal normal em out, nov e dez (sem estimativa)
 *  3 = não participa da estimativa nem do acerto
 *
 * Ordem de decisão para uma OM e um serviço em um exercício:
 *  1. exceção da OM com vigência (ano de início) até o exercício — vale a mais recente; se ela diz "seguir a regra", passa para o 2;
 *  2. regra geral do serviço com vigência até o exercício — vale a mais recente;
 *  3. sem regra: "não configurado" → o faturamento segue como era antes (nada muda).
 * Uma mudança só vale a partir do exercício informado: exercícios anteriores nunca são recalculados.
 */
export type Regime = 1 | 2 | 3;
export type OrigemRegime = 'EXCECAO' | 'SERVICO' | 'NAO_CONFIGURADO';

export interface LinhaRegime {
  id?: string; escopo: 'SERVICO' | 'OM'; sigla: string; omId?: string | null; anoInicio: number;
  /** nulo (só em exceção de OM) = volta a seguir a regra do serviço */
  regime: Regime | null; motivo?: string | null; origem?: 'USUARIO' | 'MIGRACAO'; criadoPorNome?: string | null; criadoEm?: string | null;
}
export interface RegimeEfetivo { regime: Regime | null; origem: OrigemRegime; desde?: number; linha?: LinhaRegime }

export const ROTULO_REGIME: Record<Regime, string> = { 1: 'Estimativa e acerto', 2: 'Mensal normal', 3: 'Não participa' };
export const DESCRICAO_REGIME: Record<Regime, string> = {
  1: 'Uma fatura estimada em outubro (OUT–DEZ) e acerto com o consumo real em janeiro.',
  2: 'Continua faturando todo mês, inclusive out, nov e dez. Sem estimativa nem acerto.',
  3: 'Não entra na estimativa de outubro nem no acerto de janeiro.',
};
export const rotuloRegime = (r: Regime | null | undefined) => (r ? `${r} – ${ROTULO_REGIME[r]}` : 'Sem regra');

/** A linha mais recente (maior ano de início; empate: a gravada por último). */
const maisRecente = (ls: LinhaRegime[]) => ls.reduce<LinhaRegime | undefined>((a, b) =>
  !a || b.anoInicio > a.anoInicio || (b.anoInicio === a.anoInicio && String(b.criadoEm || '') >= String(a.criadoEm || '')) ? b : a, undefined);

export function resolverRegime(linhas: LinhaRegime[], omId: string | null | undefined, sigla: string, ano: number): RegimeEfetivo {
  const doServico = linhas.filter(l => l.sigla === sigla && l.anoInicio <= ano);
  if (omId) {
    const exc = maisRecente(doServico.filter(l => l.escopo === 'OM' && l.omId === omId));
    if (exc && exc.regime) return { regime: exc.regime, origem: 'EXCECAO', desde: exc.anoInicio, linha: exc };
  }
  const reg = maisRecente(doServico.filter(l => l.escopo === 'SERVICO'));
  if (reg && reg.regime) return { regime: reg.regime, origem: 'SERVICO', desde: reg.anoInicio, linha: reg };
  return { regime: null, origem: 'NAO_CONFIGURADO' };
}

/**
 * A OM entra na estimativa de outubro? Regime 1 entra; regimes 2 e 3 não; sem regra continua como era antes (entra se tiver histórico).
 */
export const entraNaEstimativa = (e: RegimeEfetivo) => e.regime === null || e.regime === 1;

// ---------------------------------------------------------------- impacto de uma mudança (antes de confirmar)
export interface FatImpacto { omId?: string | null; sigla: string; ano: number; mes: number; estimado?: boolean; acertoDe?: string | null; cancelada?: boolean }
export interface MudancaRegime { escopo: 'SERVICO' | 'OM'; sigla: string; omId?: string | null; anoInicio: number; regime: Regime | null }
export interface ItemImpacto { omId: string; atual: RegimeEfetivo; novo: RegimeEfetivo; mudou: boolean; bloqueio?: string }
export interface Impacto { itens: ItemImpacto[]; mudam: number; bloqueios: string[]; erros: string[] }

const reais = (f: FatImpacto) => !f.cancelada && !f.acertoDe;

/**
 * O que a mudança provoca em cada OM do serviço (as que têm fatura desse serviço nos últimos anos + as com exceção).
 * Bloqueia o que levaria a duplicidade ou a estimativa sem acerto no exercício de início:
 *  - passar para regime 1 com faturamento mensal de nov ou dez já emitido nesse exercício (a estimativa cobriria o mesmo período);
 *  - sair do regime 1 com estimativa (fatura estimada ou fatura de outubro sem nov/dez) já emitida nesse exercício;
 *  - vigência em exercício que já acabou.
 */
export function impactoDaMudanca(linhas: LinhaRegime[], mudanca: MudancaRegime, omsDoServico: string[], faturas: FatImpacto[], anoAtual: number): Impacto {
  const erros: string[] = [];
  if (!Number.isInteger(mudanca.anoInicio)) erros.push('Informe o exercício a partir do qual a regra vale.');
  else if (mudanca.anoInicio < anoAtual) erros.push(`A regra só pode valer a partir de ${anoAtual}: exercícios anteriores não são recalculados.`);
  if (mudanca.escopo === 'SERVICO' && !mudanca.regime) erros.push('Escolha o regime do serviço.');
  if (mudanca.escopo === 'OM' && !mudanca.omId) erros.push('Escolha a OM.');

  const novas: LinhaRegime[] = [...linhas, { escopo: mudanca.escopo, sigla: mudanca.sigla, omId: mudanca.omId ?? null, anoInicio: mudanca.anoInicio, regime: mudanca.regime, criadoEm: '9999' }];
  const alvo = mudanca.escopo === 'OM' ? (mudanca.omId ? [mudanca.omId] : []) : [...new Set(omsDoServico)];
  const itens: ItemImpacto[] = alvo.map(omId => {
    const atual = resolverRegime(linhas, omId, mudanca.sigla, mudanca.anoInicio), novo = resolverRegime(novas, omId, mudanca.sigla, mudanca.anoInicio);
    const mudou = atual.regime !== novo.regime;
    let bloqueio: string | undefined;
    if (mudou) {
      const fs = faturas.filter(f => reais(f) && f.omId === omId && f.sigla === mudanca.sigla && f.ano === mudanca.anoInicio);
      const meses = new Set(fs.map(f => f.mes));
      const mensalNovDez = meses.has(11) || meses.has(12);
      const estimativaEmitida = fs.some(f => f.estimado) || (meses.has(10) && !mensalNovDez);
      if (novo.regime === 1 && mensalNovDez) bloqueio = `já tem faturamento mensal de nov/dez de ${mudanca.anoInicio}: a estimativa cobriria o mesmo período (duplicidade)`;
      else if (atual.regime === 1 && novo.regime !== 1 && estimativaEmitida) bloqueio = `já tem estimativa emitida em ${mudanca.anoInicio}: ela precisa do acerto em janeiro`;
    }
    return { omId, atual, novo, mudou, bloqueio };
  });
  return { itens, mudam: itens.filter(i => i.mudou).length, bloqueios: itens.filter(i => i.bloqueio).map(i => i.omId), erros };
}
