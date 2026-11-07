/**
 * PDF da fatura no modelo FR-172 (OI 40-04, Anexos A–I): cabeçalho da BNIC, número, OM usuária e
 * COMIMSUP, data-limite de certificação no SIPLAD, referência, linhas 01–06, detalhamento do serviço,
 * contato da divisão, "Baixa na ALTCRED", "cancela e substitui", instruções de pagamento e responsável.
 * Textos institucionais vêm dos Parâmetros e do catálogo de Serviços (editáveis em Cadastros).
 */
import jsPDF from 'jspdf';
import { mesesDoAno } from './faturamento';

export interface DadosFr172 {
  numero: string; emissao: string; limite: string; mesCompetencia: number; anoCompetencia: number;
  omUsuaria: string; comimsup?: string | null; sigla: string;
  servicoOficial: string; emitidaDeAcordoCom?: string | null; setorResponsavel?: string | null; telefoneSetor?: string | null;
  valorServico: number; adiantamento: number; acrescimo: number; debito: number;
  consumo?: string | null; unidade?: string | null; base?: Record<string, any> | null;
  altcreds: string[]; substitui?: string | null; acertoDe?: string | null; estimado?: boolean; observacao?: string | null;
  params: Record<string, string>;
}

const brl = (n: number) => `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const br = (iso: string, curto = false) => { if (!iso) return ''; const [y, m, d] = iso.slice(0, 10).split('-'); return `${d}/${m}/${curto ? y.slice(2) : y}`; };
const num = (n: unknown, casas = 0) => (typeof n === 'number' ? n.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: Math.max(casas, 2) }) : '');

/** Linhas do quadro de detalhamento (OBS.) de cada serviço. */
export function detalhamento(d: DadosFr172): [string, string][] {
  const b = d.base || {};
  const total: [string, string] = ['TOTAL (R$)', brl(d.valorServico)];
  if (d.acertoDe && b.tipo === 'CORRECAO') return [
    ['FATURA PAGA COM ATRASO', d.acertoDe], ['DATA-LIMITE DE CERTIFICAÇÃO', String(b.dataLimite || '').split('-').reverse().join('/')],
    ...((b.pagamentos || []) as any[]).map(p => [`PAGO EM ${String(p.data).split('-').reverse().join('/')} (${p.dias} dias): ${brl(p.valor)}`, `+ ${brl(p.correcao)}`] as [string, string]),
    ['CORREÇÃO (POUPANÇA, OI 6.2)', brl(d.acrescimo)],
  ];
  if (d.acertoDe) return [['FATURA ESTIMADA (OND)', d.acertoDe], ['VALOR ESTIMADO', brl(Number(b.estimado) || 0)], ['VALOR REAL (OUT–DEZ)', brl(Number(b.real) || 0)]];
  if (d.estimado) {
    if (d.sigla === 'DA') return [['DIÁRIA DE ATRACAÇÃO (R$)', brl(Number(b.diaria) || 0)], ['DIAS PREVISTOS (OUT–DEZ)', num(b.diasPrevistos)], total];
    return [['ESTIMATIVA OUT–DEZ', String(b.regra || 'média do exercício')], ...(b.mediaMensal ? [['MÉDIA MENSAL', brl(Number(b.mediaMensal))] as [string, string]] : []), total];
  }
  const [q1, q2] = (d.consumo || '').split(' / ');
  switch (d.sigla) {
    case 'EL': return [['CONSUMO DE ENERGIA ELET. (Kwh)', q1 || '-'], ...(q2 ? [['DEMANDA ENERGIA ELET. (Kw)', q2.replace(/\s*kW$/i, '')] as [string, string]] : []), total];
    case 'AE': return [['CONSUMO DE ÁGUA E ESGOTO (m³)', q1 || '-'], total];
    case 'DA': return [['DIÁRIA DE ATRACAÇÃO (R$)', b.diaria != null ? brl(Number(b.diaria)) : '-'], ['DIAS ATRACADO', q1 || num(b.diasAtracado)], total];
    case 'TC': return [['TAXA CONDOMINIAL MENSAL', brl(d.valorServico)]];
    default: return [[`QUANTIDADE${d.unidade ? ` (${d.unidade})` : ''}`, q1 || '-'], ...(b.valorUnitario ? [['VALOR UNITÁRIO', brl(Number(b.valorUnitario))] as [string, string]] : []), total];
  }
}

export function desenharFr172(doc: jsPDF, d: DadosFr172) {
  const W = doc.internal.pageSize.getWidth();
  const M = 15;
  let y = 16;
  const centro = (t: string, tam = 10, negrito = true) => { doc.setFont('helvetica', negrito ? 'bold' : 'normal'); doc.setFontSize(tam); doc.text(t, W / 2, y, { align: 'center' }); y += tam * 0.45; };
  const linha = (t: string, tam = 9, negrito = false, x = M) => { doc.setFont('helvetica', negrito ? 'bold' : 'normal'); doc.setFontSize(tam); const ls = doc.splitTextToSize(t, W - x - M); doc.text(ls, x, y); y += ls.length * tam * 0.45 + 1; };

  centro('MARINHA DO BRASIL', 11); centro('BASE NAVAL DA ILHA DAS COBRAS', 10); centro('DEPARTAMENTO DE INTENDÊNCIA', 9);
  y += 2;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text(`CÓDIGO OMPS-E: ${d.params.codigo_omps || '40015'}`, M, y); doc.text(br(d.emissao, true), W - M, y, { align: 'right' }); y += 6;
  centro('FATURAMENTO PARA SERVIÇOS DE APOIO BASE', 11);
  y += 2;
  doc.setDrawColor(60); doc.rect(M, y, W - 2 * M, d.comimsup ? 15 : 10);
  y += 6;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.text(`Nº ${d.numero}`, M + 3, y);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  if (d.comimsup) { doc.text(`COMIMSUP: ${d.comimsup}`, W / 2, y); y += 5; }
  doc.text(doc.splitTextToSize(`OM USUÁRIA: ${d.omUsuaria}`, W / 2 - M)[0], W / 2, y); y += 9;
  linha(`DATA-LIMITE PARA A CERTIFICAÇÃO DESTA FATURA, A SER FEITA VIA SIPLAD: ${br(d.limite)}`, 9, true);
  linha(`REFERÊNCIA: ${mesesDoAno[d.mesCompetencia - 1]}${String(d.anoCompetencia).slice(2)}${d.estimado ? ' (ESTIMADO OUT–DEZ)' : ''}`, 9);
  linha(`EMITIDA DE ACORDO COM ${(d.emitidaDeAcordoCom || 'O DETALHAMENTO NO CAMPO OBSERVAÇÃO').toUpperCase()}`, 9);
  y += 2;
  doc.setFillColor(235, 238, 242); doc.rect(M, y - 4, W - 2 * M, 7, 'F');
  linha('DETALHAMENTO', 9, true, M + 2);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.text('FR-172', W - M, y, { align: 'right' });
  linha(`SERVIÇO PRESTADO: ${d.servicoOficial.toUpperCase()}`, 9, true);
  y += 2;
  const final = Math.round((d.valorServico - d.adiantamento + d.acrescimo - d.debito) * 100) / 100;
  const linhasFr: [string, number, boolean?][] = [
    ['01 (+) TOTAL SERVIÇO PRESTADO', d.valorServico], ['02 (-) ADIANTAMENTO', d.adiantamento], ['03 (+) ACERTO ACRÉSCIMO', d.acrescimo],
    ['04 (-) ACERTO DÉBITO', d.debito], ['05 TOTAL A PAGAR', Math.max(0, final), true], ['06 TOTAL FATURA (01 – 02 + 03 – 04)', final, true],
  ];
  linhasFr.forEach(([t, v, neg]) => {
    doc.setFont('helvetica', neg ? 'bold' : 'normal'); doc.setFontSize(9);
    doc.text(t, M + 4, y); doc.text(`VALOR: ${brl(v)}`, W - M - 2, y, { align: 'right' });
    doc.setDrawColor(210); doc.line(M + 2, y + 1.5, W - M - 2, y + 1.5); y += 6;
  });
  y += 2;
  linha('OBS.:', 9, true);
  detalhamento(d).forEach(([k, v]) => { doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.text(k, M + 4, y); doc.text(v, W - M - 2, y, { align: 'right' }); y += 5; });
  y += 1;
  if (d.setorResponsavel || d.telefoneSetor) {
    linha(`Dúvidas com relação aos valores apurados deverão ser sanadas com ${d.setorResponsavel || 'a divisão responsável'}${d.telefoneSetor ? ` pelo(s) telefone(s) ${d.telefoneSetor}` : ''}.`, 8);
  }
  d.altcreds.forEach(a => linha(`Baixa na ALTCRED ${a}.`, 8, true));
  if (d.acertoDe) linha((d.base as any)?.tipo === 'CORRECAO'
    ? `Fatura de correção do valor pago com atraso da fatura nº ${d.acertoDe}, pela taxa diária equivalente à da caderneta de poupança (OI 40-04, item 6.2).`
    : `Fatura de acerto do faturamento estimado de fim de exercício (OND) nº ${d.acertoDe}.`, 8, true);
  if (d.substitui) linha(`Esta fatura cancela e substitui a de nº ${d.substitui}.`, 8, true);
  y += 3;
  linha('INSTRUÇÕES PARA O PAGAMENTO DA FATURA:', 9, true);
  if (d.params.instrucao_uno) linha(`UNO) ${d.params.instrucao_uno}`, 8);
  if (d.params.instrucao_dois) linha(`DOIS) ${d.params.instrucao_dois}`, 8);
  y = Math.max(y + 8, 245);
  centro('RESPONSÁVEL PELA EMISSÃO', 9);
  if (d.params.telefone_contabilidade) centro(d.params.telefone_contabilidade, 8, false);
  y += 6;
  centro(d.params.encarregado_nome || '______________________________', 9);
  if (d.params.encarregado_posto) centro(d.params.encarregado_posto, 8, false);
  centro('Encarregado da Divisão de Contabilidade', 8, false);
}

export function pdfFr172(d: DadosFr172): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  desenharFr172(doc, d);
  return doc;
}

/** ZIP com um PDF por fatura, em pastas por comando. */
export async function zipFr172(dados: (DadosFr172 & { pasta: string })[]): Promise<Blob> {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  dados.forEach(d => zip.folder(d.pasta.replace(/[\\/:*?"<>|]/g, '-'))!.file(`${d.numero}.pdf`, pdfFr172(d).output('arraybuffer')));
  return zip.generateAsync({ type: 'blob' });
}
