/**
 * Cálculo da taxa condominial de um ano (o mesmo da tela Taxa condominial e diárias) e a RUBRICA CONSOLIDADA:
 * para cada rubrica da taxa, o valor final que será cobrado = soma, entre as OM, da parcela líquida (já tirados
 * os descontos de cada OM) + a parte paga pelos navios. É este valor final que o Fluxo de caixa usa.
 */
import { resolverEmissora } from './emissora';
import { Desconto, PorRubrica, ResultadoRateio, mediaTrienal, montarParticipantes, ratearProposta, valorVigente } from './taxaCondominial';

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Dados mínimos da proposta (os de DadosProposta) para o cálculo. */
export interface DadosCalculoTC {
  rubricas: any[]; lotacoes: any[]; matriz: Set<string>; descontos: Desconto[]; atracacaoAnual: any[]; oms: any[]; classes: { id: string }[];
  proposta?: { baseNavios?: 'VIGENTE' | 'PREVISTO' };
}
/** Linhas que entram na taxa condominial: rubricas (TC) e outros gastos (OG). */
export const linhaDaTaxa = (r: { destino?: string }) => r.destino === 'TC' || r.destino === 'OG';

export function calcularTaxaAno(dados: DadosCalculoTC, ano: number, parametros: { chave: string; valor: string | null }[]): {
  resultado: ResultadoRateio; resultadoDA: ResultadoRateio; descontosPorOM: Map<number, number>; porRubrica: PorRubrica[];
} {
  const medias = new Map(mediaTrienal(dados.atracacaoAnual, ano, dados.classes.map(c => c.id)).map(m => [m.classeId, m.mediaMensal]));
  // OM emissora (BNIC): participa ou não do rateio
  const emissora = resolverEmissora(dados.oms, parametros as any);
  const part = montarParticipantes(dados.oms, dados.lotacoes, medias).filter(p => !(emissora?.omId === p.omId && !emissora.participaRateio));
  const rubTC = dados.rubricas.filter(linhaDaTaxa);
  const terra = part.filter(p => p.tipo === 'TERRA'), navios = part.filter(p => p.tipo === 'NAVIO');
  const r = ratearProposta(rubTC, terra, navios, dados.matriz, dados.descontos, dados.proposta?.baseNavios || 'VIGENTE');
  const descontosPorOM = new Map<number, number>();
  r.tc.oms.forEach(o => o.parcelas.forEach(p => descontosPorOM.set(p.rubrica, r2((descontosPorOM.get(p.rubrica) || 0) + p.desconto))));
  return { resultado: r.tc, resultadoDA: r.da, descontosPorOM, porRubrica: r.porRubrica };
}

export interface RubricaConsolidada {
  numero: number; descricao: string; contaContabil?: string | null;
  /** TC = rubrica da taxa; OG = outros gastos incorporados à taxa */
  tipo: 'TC' | 'OG';
  /** previsto − desconto geral (valor vigente da proposta) */
  vigente: number;
  /** descontos dados às OM nesta rubrica */
  descontosOM: number;
  /** parte da rubrica paga pelo grupo dos navios */
  navios: number;
  /** parcelas líquidas das OM (o que vem nas faturas TC): base do %RUB */
  omLiquido: number;
  /** VALOR FINAL = parcelas líquidas das OM + parte dos navios */
  final: number;
  /** tem valor e nenhuma OM participa (não é cobrada) */
  semParticipante: boolean;
}

export function consolidarRubricas(dados: DadosCalculoTC, calc: ReturnType<typeof calcularTaxaAno>): RubricaConsolidada[] {
  const liquido = new Map<number, number>();
  calc.resultado.oms.forEach(o => o.parcelas.forEach(p => liquido.set(p.rubrica, r2((liquido.get(p.rubrica) || 0) + p.liquido))));
  const nav = new Map(calc.porRubrica.map(p => [p.numero, p.navios]));
  const semPart = new Set(calc.resultado.valorRubricas.filter(v => v.semParticipante).map(v => v.numero));
  return dados.rubricas.filter(linhaDaTaxa).map(r => ({
    numero: r.numero, descricao: r.descricao, contaContabil: r.contaContabil ?? null, tipo: (r.destino === 'OG' ? 'OG' : 'TC') as 'TC' | 'OG',
    vigente: r2(valorVigente(r)), descontosOM: calc.descontosPorOM.get(r.numero) || 0, navios: nav.get(r.numero) || 0,
    omLiquido: liquido.get(r.numero) || 0,
    final: r2((liquido.get(r.numero) || 0) + (nav.get(r.numero) || 0)), semParticipante: semPart.has(r.numero),
  })).sort((a, b) => a.numero - b.numero);
}
