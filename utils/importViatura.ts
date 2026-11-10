/**
 * Planilha de FATURAS DE VIATURA (VT) da divisão de transportes: uma aba por OM, cada aba é a fatura FR-172 do mês.
 *  - "Nº 64100-VT-09-2026-011-0" (código da OM, serviço VT, mês, ano, sequência) e "OM USUÁRIA: ..."
 *  - REFERÊNCIA: SET26
 *  - "01 (+) TOTAL SERVIÇO PRESTADO  VALOR: 92,93" = valor da fatura
 *  - tabela "Mês | Valor (R$)": a fatura é cobrada com atraso e pode juntar vários meses (ex.: MAR26 = OUT25 + NOV25 + DEZ25 + JAN26);
 *    o total da fatura é a soma dessa tabela — guardada como detalhe.
 *  - aba sem valor = sem fatura de viatura no mês; a aba MODELO é ignorada.
 * Os dados vão para as Medições do serviço VT (valor em R$ por OM), que o lote mensal transforma em fatura.
 */
import { chave, limpar } from './cadastroImport';
import { numero } from './faturasImport';

type Celula = string | number | boolean | Date | null | undefined;
type Matriz = Celula[][];
export interface AbaVT { nome: string; m: Matriz }

export interface LinhaVT {
  aba: string; numeroFatura: string; codigo: string; omNome: string; referencia: string | null; competencia: string; valor: number;
  meses: { mes: string; valor: number }[]; adiantamento: number | null; linha: number;
}
export interface PlanilhaVT { competencia: string | null; linhas: LinhaVT[]; semValor: { aba: string; omNome: string }[]; avisos: string[] }

const RE_NUM = /N[º°o]?\s*([0-9A-Z]{4,5})-VT-(\d{2})-(\d{4})-(\d{3})-(\d)/i;
const RE_MES = /^(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)\d{2}$/;
const r2 = (n: number) => Math.round(n * 100) / 100;
const texto = (c: Celula) => (c instanceof Date ? '' : limpar(c));

function numeroDaFatura(m: Matriz): { r: number; match: RegExpMatchArray } | null {
  for (let r = 0; r < Math.min(m.length, 25); r++) for (const c of m[r] || []) {
    const t = texto(c), x = t.match(RE_NUM);
    if (x) return { r, match: x };
  }
  return null;
}

/** É a planilha de faturas de viatura? (várias abas com "Nº ...-VT-MM-AAAA-SSS-V" e o serviço "ALUGUEL DE VIATURAS") */
export function ehPlanilhaViatura(abas: AbaVT[]): boolean {
  const com = abas.filter(a => numeroDaFatura(a.m));
  const aluguel = abas.some(a => a.m.slice(0, 30).some(l => (l || []).some(c => /aluguel de viaturas/i.test(texto(c)))));
  return com.length >= 3 && aluguel;
}

export function lerPlanilhaViatura(abas: AbaVT[]): PlanilhaVT {
  const linhas: LinhaVT[] = [], semValor: PlanilhaVT['semValor'] = [], avisos: string[] = [];
  for (const a of abas) {
    if (/^modelo$/i.test(a.nome.trim())) continue;
    const num = numeroDaFatura(a.m);
    if (!num) continue;
    const [, codigo, mm, aaaa] = num.match;
    const todas = a.m.flatMap((l, r) => (l || []).map((c, i) => ({ t: texto(c), r, i })));
    const om = todas.map(x => x.t.match(/OM USU[ÁA]RIA:\s*(.+)$/i)).find(Boolean)?.[1]?.trim() || a.nome;
    const ref = todas.find(x => x.r < 20 && RE_MES.test(x.t))?.t ?? null;
    // valor da fatura: o número depois de "VALOR:" na linha "TOTAL SERVIÇO PRESTADO"
    const linhaTotal = a.m.findIndex(l => (l || []).some(c => /total servi[çc]o prestado/i.test(texto(c))));
    // só as células À DIREITA do rótulo (o número do item "01" fica à esquerda e não é valor)
    const iRot = linhaTotal >= 0 ? (a.m[linhaTotal] || []).findIndex(c => /total servi[çc]o prestado/i.test(texto(c))) : -1;
    const nums = iRot >= 0 ? (a.m[linhaTotal] || []).slice(iRot + 1).filter(c => typeof c === 'number' || (typeof c === 'string' && /^-?\d[\d.]*,\d{2}$/.test(c.trim()))).map(c => numero(c)) : [];
    const valor = nums.length ? nums[nums.length - 1] : null;
    const adLinha = a.m.findIndex(l => (l || []).some(c => /^adiantamento$/i.test(texto(c))));
    const iAd = adLinha >= 0 ? (a.m[adLinha] || []).findIndex(c => /^adiantamento$/i.test(texto(c))) : -1;
    const ad = iAd >= 0 ? (a.m[adLinha] || []).slice(iAd + 1).filter(c => typeof c === 'number').map(Number).pop() ?? null : null;
    const omLimpa = om.replace(/^[^:]{2,20}:\s*/, '');   // "COMIMSUP: Comando da Força..." → "Comando da Força..."
    if (valor === null || valor <= 0) { semValor.push({ aba: a.nome, omNome: om }); continue; }
    // tabela Mês | Valor (coluna B/C): detalhe e conferência com o total
    const meses: LinhaVT['meses'] = [];
    a.m.forEach(l => {
      const i = (l || []).findIndex(c => RE_MES.test(texto(c)));
      if (i < 0) return;
      const v = (l || []).slice(i + 1).find(c => typeof c === 'number');
      if (typeof v === 'number') meses.push({ mes: texto(l[i]), valor: r2(v) });
    });
    const somaMeses = r2(meses.reduce((s, x) => s + x.valor, 0));
    const tabela = meses;
    if (tabela.length && Math.abs(somaMeses - valor) > 0.05 && !tabela.some(x => Math.abs(x.valor - valor) < 0.01))
      avisos.push(`${a.nome}: o total da fatura (${valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}) não bate com a soma dos meses da tabela (${somaMeses.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}).`);
    const competencia = `${aaaa}-${mm}`;
    linhas.push({ aba: a.nome, numeroFatura: `${codigo}-VT-${mm}-${aaaa}-${num.match[4]}-${num.match[5]}`, codigo, omNome: omLimpa, referencia: ref, competencia, valor: r2(valor), meses: tabela, adiantamento: ad, linha: num.r + 1 });
  }
  // fatura de viatura cobrada com atraso é normal, mas meses muito antigos numa fatura recente podem ser sobra da planilha do mês anterior
  const idxMes = (m: string) => { const x = m.match(/^([A-Z]{3})(\d{2})$/); return x ? (2000 + Number(x[2])) * 12 + MESES.indexOf(x[1]) : null; };
  const atrasadas = linhas.filter(l => l.meses.some(x => { const i = idxMes(x.mes); return i !== null && Number(l.competencia.slice(0, 4)) * 12 + Number(l.competencia.slice(5, 7)) - 1 - i > 2; }));
  if (atrasadas.length) avisos.push(`${atrasadas.length} aba(s) cobram meses atrasados (mais de 2 meses antes da competência): ${atrasadas.map(l => l.aba).join(', ')}. Confira se esses meses já não foram faturados antes ou se a tabela é sobra do mês anterior.`);
  const cont = new Map<string, number>();
  linhas.forEach(l => cont.set(l.competencia, (cont.get(l.competencia) || 0) + 1));
  const competencia = [...cont.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null;
  if (cont.size > 1) avisos.push(`A planilha mistura competências: ${[...cont.entries()].map(([c, n]) => `${c.slice(5)}/${c.slice(0, 4)} (${n} aba(s))`).join(', ')}.`);
  linhas.forEach(l => { if (l.referencia && l.competencia && chave(l.referencia).slice(0, 3) && !referenciaBate(l.referencia, l.competencia)) avisos.push(`${l.aba}: a REFERÊNCIA da aba (${l.referencia}) está desatualizada — o número da fatura é de ${l.competencia.slice(5)}/${l.competencia.slice(0, 4)} (${l.numeroFatura}). Corrija a aba antes de gerar o PDF.`); });
  return { competencia, linhas, semValor, avisos };
}

const MESES = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
function referenciaBate(ref: string, comp: string): boolean {
  const m = ref.match(/^([A-Z]{3})(\d{2})$/); if (!m) return true;
  return MESES.indexOf(m[1]) + 1 === Number(comp.slice(5, 7)) && m[2] === comp.slice(2, 4);
}
