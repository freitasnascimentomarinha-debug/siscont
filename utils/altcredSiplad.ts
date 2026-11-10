/**
 * Leitura do PDF "Solicitações de Alteração de Crédito" do SIPLAD (uma solicitação por página).
 *
 * O pdf.js entrega cada pedaço de texto com a posição (x, y). Os campos do cabeçalho são lidos pelo
 * rótulo: o valor é o texto logo abaixo, na mesma coluna. As células de débito/crédito são lidas pela
 * linha que começa com "R$", atribuindo cada valor à coluna cujo título está mais próximo (os valores
 * vêm centralizados e às vezes quebrados em duas linhas, como "91600 -" / "ComForSup").
 */
import type { CelulaCredito } from '../types';
import { classificarSituacao } from './situacaoSiplad';

export interface ItemPdf { s: string; x: number; y: number; w: number }

export interface SolicitacaoAltcred {
  numero: string;
  dataCriacao: string | null;
  tipoAlteracao: string;
  setorCriacao: string;
  altcredOrigem: string | null;
  ugCliente: string;
  ugClienteCodigo: string | null;
  situacao: string;
  dataSituacao: string | null;
  observacao: string;
  celulas: CelulaCredito[];
  valor: number;
  faturasCitadas: string[];
  pagina: number;
  avisos: string[];
}

/** Nº da solicitação: sigla do setor (G424, R, B4D0, P3MA, P3X3...), ano, AC e sequência. */
export const RE_ALTCRED = /\b[A-Z][A-Z0-9]{0,4}\.\d{4}\.AC\.\d{5}\b/;
export const RE_FATURA_TEXTO = /\b\d{4,5}-[A-Z]{2}-\d{2}-\d{4}-\d{3}-\d\b/g;

const limpo = (s: string) => s.replace(/\s+/g, ' ').trim();
const vazio = (s: string) => !s || /^-+$/.test(s.trim());
const centro = (i: ItemPdf) => i.x + i.w / 2;
const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function dataIso(s: string | null | undefined): string | null {
  const m = (s || '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}
export function valorBR(s: string | null | undefined): number | null {
  const m = (s || '').match(/-?\d{1,3}(?:\.\d{3})*,\d{2}|-?\d+,\d{2}/);
  return m ? Number(m[0].replace(/\./g, '').replace(',', '.')) : null;
}

/** Junta os itens de uma página em linhas (y parecido), da esquerda para a direita. */
export function linhas(itens: ItemPdf[], tolerancia = 2.5): { y: number; itens: ItemPdf[] }[] {
  const ord = itens.filter(i => i.s.trim()).sort((a, b) => b.y - a.y || a.x - b.x);
  const out: { y: number; itens: ItemPdf[] }[] = [];
  ord.forEach(i => {
    const l = out.find(o => Math.abs(o.y - i.y) <= tolerancia);
    if (l) l.itens.push(i); else out.push({ y: i.y, itens: [i] });
  });
  out.forEach(l => l.itens.sort((a, b) => a.x - b.x));
  return out;
}

function acharRotulo(itens: ItemPdf[], rotulo: string): ItemPdf | undefined {
  const alvo = semAcento(rotulo);
  return itens.find(i => semAcento(limpo(i.s)) === alvo) || itens.find(i => semAcento(limpo(i.s)).startsWith(alvo));
}

/** Valor do campo: texto logo abaixo do rótulo, na faixa de colunas do rótulo. */
function campo(itens: ItemPdf[], rotulo: string): string {
  const r = acharRotulo(itens, rotulo);
  if (!r) return '';
  // limite da coluna: próximo rótulo à direita na mesma altura
  const vizinhos = itens.filter(i => Math.abs(i.y - r.y) <= 3 && i.x > r.x + 5).sort((a, b) => a.x - b.x);
  const fim = vizinhos.length ? vizinhos[0].x - 8 : Infinity;
  const abaixo = itens.filter(i => i.y < r.y - 4 && i.y >= r.y - 24 && i.x >= r.x - 12 && i.x < fim);
  if (!abaixo.length) return '';
  const yTopo = Math.max(...abaixo.map(i => i.y));
  return limpo(abaixo.filter(i => Math.abs(i.y - yTopo) <= 3).sort((a, b) => a.x - b.x).map(i => i.s).join(' '));
}

const COLUNAS: [keyof CelulaCredito | 'moeda', string][] = [
  ['moeda', 'moeda'], ['ptres', 'ptres'], ['uo', 'uo'], ['esfera', 'esfera'], ['fr', 'fr'], ['nd', 'nd'],
  ['pi', 'plano interno'], ['ugr', 'ugr'], ['uge', 'uge'], ['valor', 'valor a'],
];

function celulasDoBloco(itens: ItemPdf[], tipo: CelulaCredito['tipo'], yIni: number, yFim: number): CelulaCredito[] {
  const bloco = itens.filter(i => i.y < yIni && i.y > yFim);
  const cab = bloco.find(i => semAcento(limpo(i.s)) === 'moeda');
  if (!cab) return [];
  const titulos = COLUNAS.map(([k, r]) => {
    const t = bloco.find(i => Math.abs(i.y - cab.y) <= 3 && semAcento(limpo(i.s)).startsWith(r));
    return t ? { k, c: centro(t) } : null;
  }).filter(Boolean) as { k: string; c: number }[];
  const corpo = bloco.filter(i => i.y < cab.y - 4 && !/^valor total/i.test(limpo(i.s)));
  const totalRot = bloco.find(i => /^valor total/i.test(limpo(i.s)));
  // a linha começa pela moeda: R$ ou US$ (compras no exterior vêm em dólar)
  const reais = corpo.filter(i => /^(R|US)\$$/.test(limpo(i.s)) && (!totalRot || i.y > totalRot.y + 3)).sort((a, b) => b.y - a.y);
  return reais.map((rs, n) => {
    const acima = n === 0 ? cab.y - 4 : (reais[n - 1].y + rs.y) / 2;
    const abaixo = n === reais.length - 1 ? (totalRot ? totalRot.y + 3 : rs.y - 12) : (rs.y + reais[n + 1].y) / 2;
    const linha = corpo.filter(i => i.y < acima && i.y > abaixo && i !== rs);
    const cel: Record<string, string[]> = {};
    linha.sort((a, b) => b.y - a.y || a.x - b.x).forEach(i => {
      const melhor = titulos.reduce((m, t) => (Math.abs(t.c - centro(i)) < Math.abs(m.c - centro(i)) ? t : m));
      (cel[melhor.k] ||= []).push(limpo(i.s));
    });
    const j = (k: string) => limpo((cel[k] || []).join(' ').replace(/ - (?=\S)/, ' - '));
    return {
      tipo, ptres: j('ptres') || undefined, uo: j('uo') || undefined, esfera: j('esfera') || undefined, fr: j('fr') || undefined,
      nd: j('nd') || undefined, pi: j('pi') || undefined, ugr: j('ugr') || undefined, uge: j('uge') || undefined,
      valor: valorBR(j('valor')) ?? 0,
    };
  });
}

/** Lê uma página do PDF. Devolve null se a página não for uma solicitação. */
export function lerSolicitacao(itens: ItemPdf[], pagina = 1): SolicitacaoAltcred | null {
  const avisos: string[] = [];
  const numCampo = campo(itens, 'N° da Solicitação') || campo(itens, 'Nº da Solicitação');
  const numero = (numCampo.match(RE_ALTCRED) || itens.map(i => i.s.match(RE_ALTCRED)).find(Boolean) || [''])[0];
  if (!numero) return null;

  const obsRot = acharRotulo(itens, 'Observação do Solicitante');
  const cdd = itens.find(i => /^c[eé]lula de d[eé]bito/i.test(limpo(i.s)));
  const cdc = itens.find(i => /^c[eé]lulas? de cr[eé]dito/i.test(limpo(i.s)));
  const hist = itens.find(i => /^hist[oó]rico tr[aâ]mite/i.test(limpo(i.s)));
  const observacao = obsRot
    ? limpo(linhas(itens.filter(i => i.y < obsRot.y - 3 && i.y > (cdd?.y ?? cdc?.y ?? -Infinity) + 3)).map(l => l.itens.map(i => i.s).join(' ')).join(' '))
    : '';

  const celulas = [
    ...(cdd ? celulasDoBloco(itens, 'DEBITO', cdd.y, cdc?.y ?? hist?.y ?? -Infinity) : []),
    ...(cdc ? celulasDoBloco(itens, 'CREDITO', cdc.y, hist?.y ?? -Infinity) : []),
  ];
  const totalRot = itens.find(i => /^valor total a creditar/i.test(limpo(i.s)));
  const totalItem = totalRot ? itens.filter(i => Math.abs(i.y - totalRot.y) <= 3 && i.x > totalRot.x).sort((a, b) => a.x - b.x).pop() : undefined;
  const somaCredito = celulas.filter(c => c.tipo === 'CREDITO').reduce((s, c) => s + c.valor, 0);
  const valor = valorBR(totalItem?.s) ?? (somaCredito || celulas.filter(c => c.tipo === 'DEBITO').reduce((s, c) => s + c.valor, 0));
  if (!valor) avisos.push('Valor a creditar não encontrado no PDF.');
  else if (somaCredito && Math.abs(somaCredito - valor) > 0.01) avisos.push(`Soma das células de crédito (${somaCredito.toFixed(2)}) difere do total (${valor.toFixed(2)}).`);
  const creditoBNIC = celulas.filter(c => c.tipo === 'CREDITO');
  if (creditoBNIC.length && !creditoBNIC.some(c => /40015/.test(`${c.ugr} ${c.uge}`))) avisos.push('A célula de crédito não é da BNIC (UG 40015).');

  // Histórico: a data em que ficou "Processada" é a data de situação
  let dataSituacao: string | null = null;
  if (hist) {
    linhas(itens.filter(i => i.y < hist.y)).forEach(l => {
      const txt = l.itens.map(i => i.s).join(' ');
      const d = dataIso(txt);
      if (d && /processad/i.test(txt) && !/batch/i.test(txt)) dataSituacao = d;
    });
  }
  const situacao = campo(itens, 'Situação');
  const ugCliente = campo(itens, 'UG Cliente');
  const origem = campo(itens, 'ALTCRED de Origem');
  const dataCriacao = dataIso(campo(itens, 'Dt. de Criação'));
  if (!dataSituacao && /processad/i.test(situacao)) avisos.push('Data em que a solicitação foi processada não encontrada no histórico; usada a data de criação.');
  { const st = classificarSituacao(situacao); if (situacao && !st.recebido) avisos.push(`Situação no SIPLAD: ${st.rotulo}. ${st.explicacao}`); }

  return {
    numero, dataCriacao, tipoAlteracao: campo(itens, 'Tipo Alteração'), setorCriacao: campo(itens, 'Setor de Criação'),
    altcredOrigem: vazio(origem) ? null : (origem.match(RE_ALTCRED)?.[0] ?? origem), ugCliente: vazio(ugCliente) ? '' : ugCliente,
    ugClienteCodigo: ugCliente.match(/\b\d{5}\b/)?.[0] ?? null, situacao: vazio(situacao) ? '' : situacao,
    dataSituacao: dataSituacao ?? dataCriacao, observacao, celulas, valor: Math.round(valor * 100) / 100,
    faturasCitadas: [...new Set(observacao.match(RE_FATURA_TEXTO) || [])], pagina, avisos,
  };
}

/** Extrai os itens de texto de cada página (no navegador; o pdf.js é carregado só quando usado). */
export async function itensDoPdf(buffer: ArrayBuffer): Promise<ItemPdf[][]> {
  const pdfjs: any = await import('pdfjs-dist');
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    const worker: any = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  }
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
  const paginas: ItemPdf[][] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const conteudo = await (await doc.getPage(p)).getTextContent();
    paginas.push(conteudo.items
      .filter((i: any) => typeof i.str === 'string' && i.str.trim())
      .map((i: any) => ({ s: i.str, x: i.transform[4], y: i.transform[5], w: i.width })));
  }
  return paginas;
}

/**
 * A BNIC é a favorecida? Recebimento = crédito na UGR da BNIC (40015) ou, na "Indenização de Serviços Prestados", crédito na UGE
 * da BNIC (o estorno de uma OM credita a UGE da BNIC com a UGR do cliente). Fora disso é movimento interno ou pagamento da BNIC a
 * outra UG (compras no exterior, ALT de ND, repatriação, pagamento ao AMRJ...). Sem células de crédito lidas não dá para afirmar: mantém.
 */
export const creditaBNIC = (s: Pick<SolicitacaoAltcred, 'celulas' | 'tipoAlteracao'>) => {
  const cred = s.celulas.filter(c => c.tipo === 'CREDITO');
  if (!cred.length) return true;
  const indeniza = /indeniza/i.test(s.tipoAlteracao || '');
  return cred.some(c => /\b40015\b/.test(String(c.ugr || '')) || (indeniza && /\b40015\b/.test(String(c.uge || ''))));
};
/** Separa o que a BNIC recebeu do que não é recebimento dela (compras no exterior, pagamentos da própria BNIC a outras UG...). */
export function separarCreditoBNIC<T extends Pick<SolicitacaoAltcred, 'celulas' | 'tipoAlteracao'>>(sols: T[]) {
  return { lidas: sols.filter(creditaBNIC), descartadas: sols.filter(s => !creditaBNIC(s)) };
}

export interface LeituraSiplad { lidas: SolicitacaoAltcred[]; descartadas: SolicitacaoAltcred[]; continuacoes: number[] }
/**
 * Lê todas as páginas: o que credita a BNIC fica em `lidas`; o resto em `descartadas` (informado na tela). Página que continua a
 * solicitação anterior (sem cabeçalho, só com mais células) vira aviso na solicitação: o total lido pode estar incompleto.
 */
export function lerSolicitacoesDetalhado(paginas: ItemPdf[][]): LeituraSiplad {
  const todas: SolicitacaoAltcred[] = [];
  const continuacoes: number[] = [];
  paginas.forEach((it, n) => {
    const s = lerSolicitacao(it, n + 1);
    if (s) { todas.push(s); return; }
    if (todas.length && it.some(i => /^moeda$/i.test(limpo(i.s)))) {
      continuacoes.push(n + 1);
      const ant = todas[todas.length - 1];
      ant.avisos.push(`A solicitação continua na página ${n + 1} do PDF (mais células): o valor lido pode estar incompleto — confira o total no SIPLAD.`);
    }
  });
  return { ...separarCreditoBNIC(todas), continuacoes };
}

export function lerSolicitacoes(paginas: ItemPdf[][]): SolicitacaoAltcred[] {
  return lerSolicitacoesDetalhado(paginas).lidas;
}
