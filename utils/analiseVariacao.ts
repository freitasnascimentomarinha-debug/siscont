/**
 * Justificativa das variações da taxa condominial: para cada OM e rubrica, por que o valor do ano mudou em relação ao ano anterior.
 *
 * A parte de uma OM numa rubrica é  valor da rubrica × peso da OM ÷ soma dos pesos de quem divide a rubrica  (menos descontos).
 * A diferença entre os dois anos é decomposta em etapas, uma de cada vez, na ordem abaixo; a soma das etapas fecha com a diferença:
 *   1. valor da rubrica mudou;
 *   2. peso (lotação) da própria OM mudou;
 *   3. outras OM deixaram de dividir a rubrica;  4. outras OM passaram a dividir;  5. lotação das demais OM mudou;
 *   6. descontos mudaram.
 * Casos especiais: a OM entrou ou saiu da rubrica (matriz), a rubrica é nova ou foi excluída, a OM é nova ou saiu da taxa.
 */
import { calcularTaxaAno } from './taxaConsolidada';
import { participantesDaRubrica } from './taxaCondominial';

const r2 = (n: number) => Math.round(n * 100) / 100;
const brl = (n: number) => `R$ ${Math.abs(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const sinal = (n: number) => `${n < 0 ? '−' : '+'}${brl(n)}`;

export type Causa = 'VALOR_RUBRICA' | 'LOTACAO_PROPRIA' | 'OUTRAS_SAIRAM' | 'OUTRAS_ENTRARAM' | 'LOTACAO_OUTRAS' | 'DESCONTO'
  | 'ENTROU_RUBRICA' | 'SAIU_RUBRICA' | 'RUBRICA_NOVA' | 'RUBRICA_EXCLUIDA' | 'DESCONTO_TOTAL' | 'AJUSTE';

export const NOME_CAUSA: Record<Causa, string> = {
  VALOR_RUBRICA: 'Valor da rubrica', LOTACAO_PROPRIA: 'Lotação da própria OM', OUTRAS_SAIRAM: 'Outras OM deixaram de dividir', OUTRAS_ENTRARAM: 'Outras OM passaram a dividir',
  LOTACAO_OUTRAS: 'Lotação das demais OM', DESCONTO: 'Descontos', ENTROU_RUBRICA: 'OM entrou na rubrica', SAIU_RUBRICA: 'OM saiu da rubrica',
  RUBRICA_NOVA: 'Rubrica nova', RUBRICA_EXCLUIDA: 'Rubrica excluída', DESCONTO_TOTAL: 'Desconto sobre o total da OM', AJUSTE: 'Arredondamento / outros',
};

export interface Efeito { causa: Causa; valor: number; detalhe: string }
export interface LinhaRubrica { numero: number; descricao: string; anterior: number; atual: number; diferenca: number; efeitos: Efeito[]; texto: string }
export interface AnaliseOM {
  omId: string; nome: string; situacao: 'MANTIDA' | 'NOVA' | 'SAIU';
  lotacaoAnterior: number | null; lotacaoAtual: number | null;
  anualAnterior: number; anualAtual: number; diferenca: number; percentual: number | null;
  porCausa: Partial<Record<Causa, number>>; rubricas: LinhaRubrica[]; resumo: string;
}
export type CalculoAno = ReturnType<typeof calcularTaxaAno>;
export interface EntradaAno { ano: number; calc: CalculoAno; matriz: Set<string>; rubricas: { numero: number; descricao: string; criterio?: string }[] }

const nomeCriterio = (c?: string) => ({ AREA: 'área', IGUAL: 'partes iguais', PESO: 'peso informado' } as Record<string, string>)[c || ''] || 'lotação';

export function analisarVariacoes(ant: EntradaAno, atu: EntradaAno): AnaliseOM[] {
  const omsAnt = new Map(ant.calc.resultado.oms.filter(o => o.tipo === 'TERRA').map(o => [o.omId, o]));
  const omsAtu = new Map(atu.calc.resultado.oms.filter(o => o.tipo === 'TERRA').map(o => [o.omId, o]));
  const nomes = new Map<string, string>([...ant.calc.terra, ...atu.calc.terra].map(p => [p.omId, p.nome]));
  const numeros = [...new Set([...ant.calc.rubTC, ...atu.calc.rubTC].map((r: any) => r.numero as number))].sort((a, b) => a - b);
  const rubAnt = new Map<number, any>(ant.calc.rubTC.map((r: any) => [r.numero, r]));
  const rubAtu = new Map<number, any>(atu.calc.rubTC.map((r: any) => [r.numero, r]));
  const valorAnt = new Map(ant.calc.resultado.valorRubricas.map(v => [v.numero, v.valor]));
  const valorAtu = new Map(atu.calc.resultado.valorRubricas.map(v => [v.numero, v.valor]));
  const lotAnt = new Map(ant.calc.terra.map(p => [p.omId, p.lotacao]));
  const lotAtu = new Map(atu.calc.terra.map(p => [p.omId, p.lotacao]));
  const descr = (n: number) => rubAtu.get(n)?.descricao || rubAnt.get(n)?.descricao || '';
  const nomeLista = (ids: string[]) => ids.map(i => nomes.get(i) || i).slice(0, 4).join(', ') + (ids.length > 4 ? ` e mais ${ids.length - 4}` : '');

  const partsAnt = new Map(numeros.map(n => [n, rubAnt.has(n) ? participantesDaRubrica(rubAnt.get(n), ant.calc.terra, ant.matriz) : []]));
  const partsAtu = new Map(numeros.map(n => [n, rubAtu.has(n) ? participantesDaRubrica(rubAtu.get(n), atu.calc.terra, atu.matriz) : []]));

  const ids = [...new Set([...omsAnt.keys(), ...omsAtu.keys()])];
  const out: AnaliseOM[] = ids.map(id => {
    const oa = omsAnt.get(id), ob = omsAtu.get(id);
    const situacao: AnaliseOM['situacao'] = !oa ? 'NOVA' : !ob ? 'SAIU' : 'MANTIDA';
    const linhas: LinhaRubrica[] = [];
    for (const n of numeros) {
      const pa = partsAnt.get(n)!, pc = partsAtu.get(n)!;
      const wP = pa.find(x => x.omId === id)?.peso ?? 0, wC = pc.find(x => x.omId === id)?.peso ?? 0;
      const parA = oa?.parcelas.find(p => p.rubrica === n), parB = ob?.parcelas.find(p => p.rubrica === n);
      const liqP = parA?.liquido ?? 0, liqC = parB?.liquido ?? 0;
      if (!wP && !wC && !liqP && !liqC) continue;
      const Vp = valorAnt.get(n) ?? 0, Vc = valorAtu.get(n) ?? 0;
      const ef: Efeito[] = [];
      const add = (causa: Causa, valor: number, detalhe: string) => { if (Math.abs(valor) >= 0.005) ef.push({ causa, valor, detalhe }); };
      if (!rubAnt.has(n)) add('RUBRICA_NOVA', liqC - liqP, `rubrica nova em ${atu.ano}, com ${brl(Vc)}`);
      else if (!rubAtu.has(n)) add('RUBRICA_EXCLUIDA', liqC - liqP, `rubrica não existe mais em ${atu.ano} (era ${brl(Vp)})`);
      else if (!wP && wC) add('ENTROU_RUBRICA', liqC - liqP, `a OM não participava da rubrica em ${ant.ano} e passou a participar em ${atu.ano}`);
      else if (wP && !wC) add('SAIU_RUBRICA', liqC - liqP, `a OM participava da rubrica em ${ant.ano} e deixou de participar em ${atu.ano}`);
      else if (wP && wC) {
        const SP = pa.reduce((s, x) => s + x.peso, 0), SC = pc.reduce((s, x) => s + x.peso, 0);
        const idsA = new Set(pa.map(x => x.omId)), idsC = new Set(pc.map(x => x.omId));
        const saiu = pa.filter(x => x.omId !== id && !idsC.has(x.omId)), entrou = pc.filter(x => x.omId !== id && !idsA.has(x.omId));
        const ficou = pc.filter(x => x.omId !== id && idsA.has(x.omId));
        const pesoAntDe = (oid: string) => pa.find(x => x.omId === oid)?.peso ?? 0;
        const S1 = SP - wP + wC;
        const S2 = S1 - saiu.reduce((s, x) => s + x.peso, 0);
        const S3 = S2 + entrou.reduce((s, x) => s + x.peso, 0);
        const S4 = S3 - ficou.reduce((s, x) => s + pesoAntDe(x.omId), 0) + ficou.reduce((s, x) => s + x.peso, 0);
        const e1 = (Vc - Vp) * wP / SP;
        const e2 = Vc * wC / S1 - Vc * wP / SP;
        const e3 = Vc * wC / S2 - Vc * wC / S1;
        const e4 = Vc * wC / S3 - Vc * wC / S2;
        const e5 = Vc * wC / S4 - Vc * wC / S3;
        const descP = parA?.desconto ?? 0, descC = parB?.desconto ?? 0;
        const e6 = -(descC - descP);
        const crit = nomeCriterio(rubAtu.get(n)?.criterio);
        add('VALOR_RUBRICA', e1, `valor da rubrica ${Vc >= Vp ? 'subiu' : 'caiu'} de ${brl(Vp)} para ${brl(Vc)}`);
        add('LOTACAO_PROPRIA', e2, crit === 'lotação'
          ? `lotação da OM ${wC >= wP ? 'subiu' : 'caiu'} de ${lotAnt.get(id) ?? '?'} para ${lotAtu.get(id) ?? '?'}`
          : `peso da OM (${crit}) ${wC >= wP ? 'subiu' : 'caiu'} de ${wP} para ${wC}`);
        add('OUTRAS_SAIRAM', e3, `deixaram de dividir a rubrica: ${nomeLista(saiu.map(x => x.omId))}`);
        add('OUTRAS_ENTRARAM', e4, `passaram a dividir a rubrica: ${nomeLista(entrou.map(x => x.omId))}`);
        const dLot = ficou.reduce((s, x) => s + x.peso, 0) - ficou.reduce((s, x) => s + pesoAntDe(x.omId), 0);
        add('LOTACAO_OUTRAS', e5, `lotação das demais OM ${dLot >= 0 ? 'subiu' : 'caiu'} (peso total das outras ${dLot >= 0 ? '+' : '−'}${Math.abs(Math.round(dLot)).toLocaleString('pt-BR')})`);
        add('DESCONTO', e6, `desconto da OM nesta rubrica foi de ${brl(descP)} para ${brl(descC)}`);
        // diferença de arredondamento: vai para a maior etapa, para a soma fechar com a diferença real
        const resto = r2((liqC - liqP) - ef.reduce((s, x) => s + x.valor, 0));
        if (Math.abs(resto) >= 0.005 && ef.length) { const m = ef.reduce((a, b) => (Math.abs(b.valor) > Math.abs(a.valor) ? b : a)); m.valor = r2(m.valor + resto); }
        else if (Math.abs(resto) >= 0.005) add('AJUSTE', resto, 'arredondamento');
      }
      ef.forEach(x => { x.valor = r2(x.valor); });
      const diferenca = r2(liqC - liqP);
      const texto = diferenca === 0 && !ef.length ? 'sem variação' : ef.map(x => `${NOME_CAUSA[x.causa]}: ${sinal(x.valor)} (${x.detalhe})`).join('; ');
      linhas.push({ numero: n, descricao: descr(n), anterior: liqP, atual: liqC, diferenca, efeitos: ef, texto });
    }
    const porCausa: Partial<Record<Causa, number>> = {};
    linhas.forEach(l => l.efeitos.forEach(e => { porCausa[e.causa] = r2((porCausa[e.causa] || 0) + e.valor); }));
    const anualP = oa?.anual ?? 0, anualC = ob?.anual ?? 0;
    // desconto sobre o total da OM (sem rubrica) e arredondamentos
    const dtP = oa ? oa.anualBruto - oa.anual : 0, dtC = ob ? ob.anualBruto - ob.anual : 0;
    if (Math.abs(dtC - dtP) >= 0.005) porCausa.DESCONTO_TOTAL = r2(-(dtC - dtP));
    const somaCausas = Object.values(porCausa).reduce((s, v) => s + (v || 0), 0);
    const ajuste = r2((anualC - anualP) - somaCausas);
    if (Math.abs(ajuste) >= 0.02) porCausa.AJUSTE = ajuste;
    const diferenca = r2(anualC - anualP);
    const percentual = anualP ? Math.round((diferenca / anualP) * 10000) / 100 : null;
    const base = { omId: id, nome: nomes.get(id) || '', situacao, lotacaoAnterior: oa ? lotAnt.get(id) ?? null : null, lotacaoAtual: ob ? lotAtu.get(id) ?? null : null, anualAnterior: anualP, anualAtual: anualC, diferenca, percentual, porCausa, rubricas: linhas.filter(l => l.diferenca !== 0 || l.efeitos.length) };
    return { ...base, resumo: resumir(base, ant.ano, atu.ano, linhas) };
  });
  return out.sort((a, b) => a.nome.localeCompare(b.nome));
}

function resumir(o: Omit<AnaliseOM, 'resumo'>, anoAnt: number, anoAtu: number, linhas: LinhaRubrica[]): string {
  if (o.situacao === 'NOVA') return `OM sem taxa em ${anoAnt} (não estava na matriz ou na lotação): passa a pagar ${brl(o.anualAtual)} por ano em ${anoAtu}, em ${linhas.filter(l => l.atual > 0).length} rubrica(s).`;
  if (o.situacao === 'SAIU') return `OM com taxa em ${anoAnt} (${brl(o.anualAnterior)}) que não participa do rateio de ${anoAtu}.`;
  if (Math.abs(o.diferenca) < 0.005) return `Sem variação no total anual (${brl(o.anualAtual)}).`;
  const quais = (causa: Causa, n = 3) => linhas.filter(l => l.efeitos.some(e => e.causa === causa && Math.abs(e.valor) >= 0.5)).sort((a, b) => Math.abs(b.efeitos.find(e => e.causa === causa)!.valor) - Math.abs(a.efeitos.find(e => e.causa === causa)!.valor)).slice(0, n).map(l => l.numero);
  const partes: [number, string][] = [];
  const v = (c: Causa) => o.porCausa[c] || 0;
  if (Math.abs(v('VALOR_RUBRICA')) >= 0.5) partes.push([v('VALOR_RUBRICA'), `${sinal(v('VALOR_RUBRICA'))} por ${v('VALOR_RUBRICA') > 0 ? 'aumento' : 'redução'} no valor das rubricas ${quais('VALOR_RUBRICA').join(', ')}`]);
  if (Math.abs(v('LOTACAO_PROPRIA')) >= 0.5) partes.push([v('LOTACAO_PROPRIA'), `${sinal(v('LOTACAO_PROPRIA'))} por ${v('LOTACAO_PROPRIA') > 0 ? 'aumento' : 'redução'} da lotação da OM${o.lotacaoAnterior != null && o.lotacaoAtual != null ? ` (${o.lotacaoAnterior} → ${o.lotacaoAtual})` : ''}`]);
  if (Math.abs(v('OUTRAS_SAIRAM')) >= 0.5) partes.push([v('OUTRAS_SAIRAM'), `${sinal(v('OUTRAS_SAIRAM'))} porque outras OM deixaram de dividir as rubricas ${quais('OUTRAS_SAIRAM').join(', ')}`]);
  if (Math.abs(v('OUTRAS_ENTRARAM')) >= 0.5) partes.push([v('OUTRAS_ENTRARAM'), `${sinal(v('OUTRAS_ENTRARAM'))} porque outras OM passaram a dividir as rubricas ${quais('OUTRAS_ENTRARAM').join(', ')}`]);
  if (Math.abs(v('LOTACAO_OUTRAS')) >= 0.5) partes.push([v('LOTACAO_OUTRAS'), `${sinal(v('LOTACAO_OUTRAS'))} por ${v('LOTACAO_OUTRAS') > 0 ? 'redução' : 'aumento'} da lotação das demais OM`]);
  if (Math.abs(v('ENTROU_RUBRICA')) >= 0.5) partes.push([v('ENTROU_RUBRICA'), `${sinal(v('ENTROU_RUBRICA'))} por passar a participar das rubricas ${quais('ENTROU_RUBRICA', 6).join(', ')}`]);
  if (Math.abs(v('SAIU_RUBRICA')) >= 0.5) partes.push([v('SAIU_RUBRICA'), `${sinal(v('SAIU_RUBRICA'))} por deixar de participar das rubricas ${quais('SAIU_RUBRICA', 6).join(', ')}`]);
  if (Math.abs(v('RUBRICA_NOVA')) >= 0.5) partes.push([v('RUBRICA_NOVA'), `${sinal(v('RUBRICA_NOVA'))} por rubrica(s) nova(s) (${quais('RUBRICA_NOVA', 6).join(', ')})`]);
  if (Math.abs(v('RUBRICA_EXCLUIDA')) >= 0.5) partes.push([v('RUBRICA_EXCLUIDA'), `${sinal(v('RUBRICA_EXCLUIDA'))} por rubrica(s) excluída(s) (${quais('RUBRICA_EXCLUIDA', 6).join(', ')})`]);
  const desc = v('DESCONTO') + v('DESCONTO_TOTAL');
  if (Math.abs(desc) >= 0.5) partes.push([desc, `${sinal(desc)} por mudança nos descontos`]);
  partes.sort((a, b) => Math.abs(b[0]) - Math.abs(a[0]));
  const cab = `${o.diferenca > 0 ? 'Aumento' : 'Redução'} de ${brl(o.diferenca)}${o.percentual !== null ? ` (${o.percentual > 0 ? '+' : ''}${o.percentual.toLocaleString('pt-BR')}%)` : ''} no total anual, de ${brl(o.anualAnterior)} para ${brl(o.anualAtual)}`;
  return partes.length ? `${cab}: ${partes.map(p => p[1]).join('; ')}.` : `${cab}.`;
}
