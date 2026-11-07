/**
 * Planilha de faturamento de ÁGUA DOCE E TRATAMENTO DE ESGOTO enviada pela divisão (uma aba por mês).
 *
 *  - Cabeçalho: datas das leituras, MEDIÇÃO mm/aaaa, VENCIMENTO, contas da concessionária (matrículas, R$ e m³),
 *    valor do m³ e taxa (%). A conta "FORA DO RATEIO" (ARES-MAS) é cobrada à parte de uma OM.
 *  - Seções (OM apoiadas, Extra-Marinha, Cais, Diques...): cada uma com o cabeçalho CONSUMIDOR | CÓDIGO DA OM |
 *    HIDRÔMETRO | LEITURA ATUAL | LEITURA ANTERIOR | CONSUMO (M³) | CONSUMO (DIAS) | CONSUMO TOTAL (M³) | TOTAL A PAGAR.
 *    Linha sem consumidor e sem código continua a OM da linha de cima (vários hidrômetros da mesma OM).
 *  - Consumidores não hidrometrados (AMRJ e BNIC) ficam com o que sobra da conta, em percentuais fixos.
 *  - Observações do rodapé do tipo "Consumo do HCM = H67 – H66 – H68 – H69 – H70" são conferidas com as leituras.
 */
import { chave, limpar } from './cadastroImport';
import { numero } from './faturasImport';

type Celula = string | number | boolean | Date | null | undefined;
type Matriz = Celula[][];

export type TipoLinhaAgua = 'HIDROMETRO' | 'NAO_HIDROMETRADO' | 'FORA_RATEIO';
export interface LinhaAgua {
  linha: number; secao: string; consumidor: string; codigo: string; hidrometro: string;
  atual: number | null; anterior: number | null; medido: number | null; dias: number | null;
  consumo: number; valor: number; tipo: TipoLinhaAgua;
}
export interface ContaAgua { descricao: string; matricula: string; valor: number; volume: number; foraDoRateio: boolean }
export interface RegraObservacao {
  texto: string; nome: string; entrada: string; descontar: string[];
  linha: number;            // linha da planilha do consumidor da regra (ex.: HCM)
  consumidor: string;
  consumoPlanilha: number; consumoRegra: number; diferencaM3: number; diferencaValor: number;
  faltam: string[];         // hidrômetros citados que não estão na planilha
}
export interface AvisoAgua { tipo: 'sem_leitura' | 'leitura_menor' | 'sem_dono' | 'codigo' | 'codigo_repetido' | 'resumo_digitado'; linha?: number; texto: string; valor?: number }
export interface PlanilhaAgua {
  competencia: string | null; vencimento: string | null; leituraAnterior: string | null; leituraAtual: string | null;
  precoM3: number | null; taxa: number | null; contas: ContaAgua[]; linhas: LinhaAgua[]; observacoes: string[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 10000) / 10000;
const textoLinha = (l: Celula[] = []) => l.map(c => (c instanceof Date ? c.toLocaleDateString('pt-BR') : limpar(c))).filter(Boolean).join(' ');
const naoVazias = (l: Celula[] = []) => l.filter(c => c !== null && c !== undefined && limpar(c) !== '');
/** "H-67", "Compart: H-09 (Ed.16)", "H67 (entrada do HCM)" → "H67"; "H-08A" → "H8A". */
export const hidrometroId = (t: Celula): string | null => {
  const m = limpar(t).toUpperCase().match(/\bH\s*-?\s*0*(\d+)([A-Z]?)\b/);
  return m ? `H${m[1]}${m[2]}` : null;
};
const dataBr = (t: string) => { const m = t.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/); if (!m) return null; const a = m[3].length === 2 ? `20${m[3]}` : m[3]; return `${a}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; };

/** A planilha é a de água e esgoto da divisão? (título "ÁGUA ... ESGOTO" e cabeçalho CONSUMIDOR / TOTAL A PAGAR) */
export function ehPlanilhaAgua(m: Matriz): boolean {
  const titulo = m.slice(0, 15).some(l => /agua.*esgoto/.test(chave(textoLinha(l))));
  const cab = m.slice(0, 80).some(l => { const k = (l || []).map(chave); return k.includes('consumidor') && k.some(c => c.startsWith('totalapagar')); });
  return titulo && cab;
}

export function lerPlanilhaAgua(m: Matriz): PlanilhaAgua {
  const out: PlanilhaAgua = { competencia: null, vencimento: null, leituraAnterior: null, leituraAtual: null, precoM3: null, taxa: null, contas: [], linhas: [], observacoes: [] };
  const primeiroCab = m.findIndex(l => (l || []).map(chave).includes('consumidor'));
  const fimCab = primeiroCab < 0 ? Math.min(m.length, 25) : primeiroCab;

  // ---- cabeçalho: datas, contas e parâmetros
  const aDireita = (l: Celula[], i: number) => { for (let j = i + 1; j < l.length; j++) { const n = typeof l[j] === 'number' ? (l[j] as number) : null; if (n !== null) return n; } return null; };
  let colValor = -1, colVolume = -1, descricao = '';
  for (let r = 0; r < fimCab; r++) {
    const l = m[r] || [];
    l.forEach((c, i) => {
      const t = limpar(c), k = chave(c);
      if (/leituraanterior/.test(k)) out.leituraAnterior = dataBr(t) ?? (l[i + 1] instanceof Date ? (l[i + 1] as Date).toISOString().slice(0, 10) : dataBr(limpar(l[i + 1])));
      if (/leituraatual/.test(k)) out.leituraAtual = dataBr(t) ?? dataBr(limpar(l[i + 1]));
      const med = t.match(/MEDI[ÇC][ÃA]O\s*:?\s*(\d{1,2})\s*\/\s*(\d{4})/i);
      if (med) out.competencia = `${med[2]}-${med[1].padStart(2, '0')}`;
      if (/^vencimento/.test(k)) out.vencimento = dataBr(t) ?? dataBr(limpar(l[i + 1]));
      if (k.startsWith('valordom')) out.precoM3 = aDireita(l, i);
      if (k.startsWith('taxas') || k === 'taxa') { const n = aDireita(l, i); if (n !== null) out.taxa = n > 1 ? n / 100 : n; }
      if (k.startsWith('valordoconsumo')) colValor = i;
      if (k.startsWith('volumeconsumidom')) colVolume = i;
    });
    const mat = l.map(c => limpar(c)).find(t => /\d{6,}-\d/.test(t));
    if (mat) {
      if (typeof l[0] === 'string' && limpar(l[0])) descricao = limpar(l[0]);
      out.contas.push({
        descricao, matricula: mat.match(/\d{6,}-\d/)![0],
        valor: colValor >= 0 ? numero(l[colValor]) ?? 0 : 0, volume: colVolume >= 0 ? numero(l[colVolume]) ?? 0 : 0,
        foraDoRateio: /foradorateio/.test(chave(descricao)),
      });
    }
  }

  // ---- seções de consumidores
  type Cols = { cons: number; cod: number; hid: number; atual: number; ant: number; med: number; dias: number; total: number; valor: number };
  let cols: Cols | null = null, secao = '', titulo = '', antCons = '', antCod = '';
  // começa um pouco antes do 1º cabeçalho para pegar o título da 1ª seção ("OMs APOIADAS")
  for (let r = Math.max(0, fimCab - 3); r < m.length; r++) {
    const l = m[r] || [];
    const k = l.map(chave);
    const cheias = naoVazias(l);
    if (k.includes('consumidor')) {
      const acha = (f: (c: string) => boolean) => k.findIndex(f);
      cols = {
        cons: k.indexOf('consumidor'), cod: acha(c => c.startsWith('codigo')), hid: acha(c => c.startsWith('hidrometro')),
        atual: acha(c => c.startsWith('leituraatual')), ant: acha(c => c.startsWith('leituraanterior')),
        med: acha(c => c.startsWith('consumo') && !c.startsWith('consumototal') && !c.includes('dias')),
        dias: acha(c => c.includes('dias')), total: acha(c => c.startsWith('consumototal')), valor: acha(c => c.startsWith('totalapagar') || c.startsWith('valor')),
      };
      secao = titulo; antCons = ''; antCod = '';
      continue;
    }
    // título de seção, observação ou quadro-resumo encerram a seção atual
    if (cheias.length === 1 && typeof cheias[0] === 'string' && /[a-z]{3}/i.test(limpar(cheias[0])) && !/^\*+$/.test(limpar(cheias[0]))) {
      titulo = limpar(cheias[0]); cols = null;
      if (/^obs/.test(chave(titulo))) out.observacoes.push(...m.slice(r).map(x => textoLinha(x)).filter(t => /=/.test(t) && /\bH\s*-?\d/i.test(t)));
      continue;
    }
    if (['om', 'r', 'm3'].includes(k[0] || '') || /totaldeconsumo/.test(chave(textoLinha(l)))) { cols = null; continue; }
    if (!cols || !cheias.length) continue;
    const pega = (i: number) => (i >= 0 ? l[i] : null);
    let consumidor = limpar(pega(cols.cons)), codigo = limpar(pega(cols.cod));
    if (!consumidor && !codigo) { consumidor = antCons; codigo = antCod; } else { antCons = consumidor; antCod = codigo; }
    const hidrometro = limpar(pega(cols.hid));
    const atual = numero(pega(cols.atual) as Celula), anterior = numero(pega(cols.ant) as Celula);
    const medido = numero(pega(cols.med) as Celula), dias = numero(pega(cols.dias) as Celula);
    // com a coluna CONSUMO TOTAL, só ela vale (linha de hidrômetro já somado na linha de cima fica vazia)
    const consumo = cols.total >= 0 ? numero(pega(cols.total) as Celula) ?? 0 : medido ?? 0;
    const valor = numero(pega(cols.valor) as Celula) ?? 0;
    if (!consumo && !valor && !(atual !== null && anterior !== null && atual < anterior)) continue;
    const tipo: TipoLinhaAgua = /foradorateio/.test(chave(secao)) ? 'FORA_RATEIO' : /naohidrometrad/.test(chave(hidrometro)) ? 'NAO_HIDROMETRADO' : 'HIDROMETRO';
    out.linhas.push({ linha: r + 1, secao, consumidor, codigo, hidrometro, atual, anterior, medido, dias, consumo: r4(consumo), valor: r2(valor), tipo });
  }
  return out;
}

/** Leitura medida de um hidrômetro no mês (atual − anterior), procurando em todas as linhas da planilha. */
function medidoDo(m: Matriz, p: PlanilhaAgua, id: string): number | null {
  const l = p.linhas.find(x => hidrometroId(x.hidrometro) === id && x.atual !== null && x.anterior !== null);
  if (l) return r4(l.atual! - l.anterior!);
  // hidrômetro com consumo zero não vira linha: procura direto na matriz
  for (const row of m) {
    const i = (row || []).findIndex(c => typeof c === 'string' && hidrometroId(c) === id);
    if (i < 0) continue;
    const nums = (row || []).slice(i + 1).filter(c => typeof c === 'number') as number[];
    if (nums.length >= 2) return r4(nums[0] - nums[1]);
  }
  return null;
}

/** Confere as observações "Consumo do X = Hnn – Hnn – ..." com as leituras do mês. */
export function conferirObservacoes(m: Matriz, p: PlanilhaAgua): RegraObservacao[] {
  const out: RegraObservacao[] = [];
  const unit = p.precoM3 !== null ? p.precoM3 * 2 * (1 + (p.taxa ?? 0)) : null;
  for (const texto of p.observacoes) {
    const mm = limpar(texto).match(/consumo d[oa]s?\s+(.+?)\s*=\s*(.+)$/i);
    if (!mm) continue;
    const partes = mm[2].split(/\s-\s/).map(hidrometroId).filter(Boolean) as string[];
    if (partes.length < 2) continue;
    const [entrada, ...descontar] = partes;
    const linha = p.linhas.find(x => hidrometroId(x.hidrometro) === entrada);
    if (!linha) continue;
    const faltam: string[] = [];
    const med = (id: string) => { const v = medidoDo(m, p, id); if (v === null) faltam.push(id); return v ?? 0; };
    const consumoRegra = r4(med(entrada) - descontar.reduce((s, id) => s + med(id), 0));
    const diferencaM3 = r4(linha.consumo - consumoRegra);
    const u = unit ?? (linha.consumo ? linha.valor / linha.consumo : 0);
    out.push({ texto: limpar(texto), nome: limpar(mm[1]), entrada, descontar, linha: linha.linha, consumidor: linha.consumidor, consumoPlanilha: linha.consumo, consumoRegra, diferencaM3, diferencaValor: r2(diferencaM3 * u), faltam });
  }
  return out;
}

/**
 * Aplica as regras das observações: o consumidor da regra passa a ter o consumo da regra, e a diferença (m³ e R$)
 * volta para os consumidores não hidrometrados (AMRJ/BNIC), na mesma proporção em que já dividem o que sobra.
 * O total da planilha continua igual à conta da concessionária.
 */
export function aplicarObservacoes(linhas: LinhaAgua[], regras: RegraObservacao[]): LinhaAgua[] {
  const novas = linhas.map(l => ({ ...l }));
  for (const g of regras) {
    if (Math.abs(g.diferencaM3) < 0.0001) continue;
    const alvo = novas.find(l => l.linha === g.linha);
    if (!alvo) continue;
    alvo.consumo = r4(alvo.consumo - g.diferencaM3); alvo.valor = r2(alvo.valor - g.diferencaValor);
    const resto = novas.filter(l => l.tipo === 'NAO_HIDROMETRADO');
    const sv = resto.reduce((s, l) => s + l.valor, 0), sc = resto.reduce((s, l) => s + l.consumo, 0);
    let dv = 0, dc = 0;
    resto.forEach((l, i) => {
      const ultimo = i === resto.length - 1;
      const v = ultimo ? r2(g.diferencaValor - dv) : r2(g.diferencaValor * (sv ? l.valor / sv : 1 / resto.length));
      const c = ultimo ? r4(g.diferencaM3 - dc) : r4(g.diferencaM3 * (sc ? l.consumo / sc : 1 / resto.length));
      l.valor = r2(l.valor + v); l.consumo = r4(l.consumo + c); dv += v; dc += c;
    });
  }
  return novas;
}

/** Totais da planilha × contas da concessionária. */
export function conferirTotais(p: PlanilhaAgua, linhas: LinhaAgua[] = p.linhas) {
  const soma = (f: (l: LinhaAgua) => boolean) => ({ valor: r2(linhas.filter(f).reduce((s, l) => s + l.valor, 0)), volume: r4(linhas.filter(f).reduce((s, l) => s + l.consumo, 0)) });
  const contas = (fora: boolean) => ({ valor: r2(p.contas.filter(c => c.foraDoRateio === fora).reduce((s, c) => s + c.valor, 0)), volume: r4(p.contas.filter(c => c.foraDoRateio === fora).reduce((s, c) => s + c.volume, 0)) });
  return {
    rateio: { planilha: soma(l => l.tipo !== 'FORA_RATEIO'), conta: contas(false) },
    fora: { planilha: soma(l => l.tipo === 'FORA_RATEIO'), conta: contas(true) },
    naoHidrometrados: linhas.filter(l => l.tipo === 'NAO_HIDROMETRADO'),
  };
}

const SEM_DONO = new Set(['', 'semconexao', 'semconexão']);
/** Pontos de atenção da planilha (não impedem a importação). */
export function avisosAgua(p: PlanilhaAgua): AvisoAgua[] {
  const av: AvisoAgua[] = [];
  const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  for (const l of p.linhas) {
    const nome = l.consumidor || '(sem nome)';
    if (l.tipo === 'HIDROMETRO' && hidrometroId(l.hidrometro) && l.atual === null && l.anterior === null && l.consumo > 0)
      av.push({ tipo: 'sem_leitura', linha: l.linha, valor: l.valor, texto: `${nome} — ${l.hidrometro}: ${l.consumo} m³ (${brl(l.valor)}) digitados sem leitura atual/anterior. Peça a justificativa à divisão (hidrômetro parado? média?).` });
    if (l.atual !== null && l.anterior !== null && l.atual < l.anterior)
      av.push({ tipo: 'leitura_menor', linha: l.linha, texto: `${nome} — ${l.hidrometro}: leitura atual (${l.atual}) menor que a anterior (${l.anterior}).` });
    const dig = l.codigo.replace(/\D/g, '');
    if (l.valor > 0 && !dig && SEM_DONO.has(chave(l.consumidor)))
      av.push({ tipo: 'sem_dono', linha: l.linha, valor: l.valor, texto: `${l.hidrometro || 'Hidrômetro'} (${l.secao}): ${l.consumo} m³ = ${brl(l.valor)} em nome de "${nome}", sem código de OM — ninguém seria cobrado.` });
    else if (l.valor > 0 && dig && dig.length > 5)
      av.push({ tipo: 'codigo', linha: l.linha, texto: `${nome}: código "${l.codigo}" tem ${dig.length} dígitos (o padrão é 5).` });
    else if (l.valor > 0 && !dig)
      av.push({ tipo: 'codigo', linha: l.linha, texto: `${nome}: sem código de OM na planilha ("${l.codigo || 'vazio'}") — ligado pelo nome.` });
  }
  // mesmo código para consumidores de nomes bem diferentes (ex.: comando e navio)
  const porCod = new Map<string, Set<string>>();
  p.linhas.filter(l => l.codigo.replace(/\D/g, '') && l.consumidor).forEach(l => {
    const c = l.codigo.replace(/\D/g, '').padStart(5, '0');
    const s = porCod.get(c) || new Set<string>(); s.add(l.consumidor); porCod.set(c, s);
  });
  porCod.forEach((nomes, c) => {
    const lista = [...nomes];
    // "BNIC" × "RANCHO (BNIC)" é o mesmo cliente: algum nome de um aparece no outro
    const palavras = (n: string) => limpar(n).split(/[\s()[\]/,.-]+/).map(chave).filter(t => t.length >= 3);
    const ligados = (a: string, b: string) => palavras(a).some(t => chave(b).includes(t)) || palavras(b).some(t => chave(a).includes(t));
    const distintos = lista.some((a, i) => lista.slice(i + 1).some(b => !ligados(a, b)));
    if (lista.length > 1 && distintos) av.push({ tipo: 'codigo_repetido', texto: `Código ${c} usado por consumidores diferentes: ${lista.join(' · ')}. Confira se é o mesmo cliente.` });
  });
  return av;
}

// ------------------------------------------------------------------ ligação com o cadastro
export interface OMLigavel { id: string; nome: string; codigo: string; sigla?: string | null; tipo: string; ativo?: boolean; codigoProprio?: boolean; nomesAlternativos?: string[] }
export type ComoLigou = 'codigo' | 'nome' | 'codigo_diferente' | 'nenhum';
export interface Ligacao { omId: string | null; como: ComoLigou; nota?: string }

/**
 * Liga a linha da planilha a uma OM: pelo código (com zeros à esquerda) e pelo nome (nome, nomes alternativos,
 * navios). Quando código e nome apontam para OM diferentes, prevalece o nome se o código da planilha não existir
 * no cadastro; senão prevalece o código, com nota para conferir.
 */
export function ligarLinhaAgua<T extends OMLigavel>(
  l: Pick<LinhaAgua, 'consumidor' | 'codigo'>, oms: T[],
  porNome: (nome: string, oms: T[]) => T | null | undefined,
): Ligacao {
  const dig = l.codigo.replace(/\D/g, '');
  const cod = dig && dig.length <= 5 ? dig.padStart(5, '0') : dig;
  const cand = cod ? oms.filter(o => o.codigo === cod) : [];
  const porCodigo = cand.find(o => o.ativo !== false && o.codigoProprio !== false) ?? cand.find(o => o.ativo !== false) ?? cand[0];
  const k = chave(l.consumidor);
  const alt = k ? oms.find(o => (o.nomesAlternativos || []).some(n => chave(n) === k)) : undefined;
  const nomeOk = !SEM_DONO.has(k) && k.length >= 2 && !/^\*+$/.test(l.consumidor);
  const porNomeOm = alt ?? (nomeOk ? porNome(l.consumidor, oms) ?? undefined : undefined);
  if (porCodigo && porNomeOm && porNomeOm.id !== porCodigo.id) {
    if (cand.some(o => o.id === porNomeOm.id)) return { omId: porNomeOm.id, como: 'codigo' };
    if (alt) return { omId: alt.id, como: 'nome' };
    return { omId: porCodigo.id, como: 'codigo_diferente', nota: `Código ${cod} é de ${porCodigo.nome}; pelo nome seria ${porNomeOm.nome} (${porNomeOm.codigo}).` };
  }
  if (porCodigo) return { omId: porCodigo.id, como: 'codigo' };
  if (porNomeOm) {
    const nota = cod && porNomeOm.codigo !== cod ? `Código da planilha ${l.codigo} não está no cadastro; ${porNomeOm.nome} tem ${porNomeOm.codigo}.` : undefined;
    return { omId: porNomeOm.id, como: nota ? 'codigo_diferente' : 'nome', nota };
  }
  return { omId: null, como: 'nenhum' };
}
