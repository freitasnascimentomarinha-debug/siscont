/**
 * PDF da fatura no modelo FR-172 (OI 40-04, Anexos A–I): cabeçalho da BNIC, número, OM usuária e
 * COMIMSUP, data-limite de certificação no SIPLAD, referência, linhas 01–06, detalhamento do serviço,
 * contato da divisão, "Baixa na ALTCRED", "cancela e substitui", instruções de pagamento e responsável.
 * Textos institucionais vêm dos Parâmetros e do catálogo de Serviços (editáveis em Cadastros).
 */
import { citarCorrecao, obterNormas } from './normas';
import jsPDF from 'jspdf';
import { mesesDoAno } from './faturamento';
import { cabecalhoInstitucional } from './pdfCabecalho';

export interface DadosFr172 {
  numero: string; emissao: string; limite: string; vencimento?: string | null; mesCompetencia: number; anoCompetencia: number;
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
    ['FATURA PAGA COM ATRASO', d.acertoDe], ['VENCIMENTO DA FATURA', String(b.dataLimite || '').split('-').reverse().join('/')],
    ...((b.pagamentos || []) as any[]).map(p => [`PAGO EM ${String(p.data).split('-').reverse().join('/')} (${p.dias} dias): ${brl(p.valor)}`, `+ ${brl(p.correcao)}`] as [string, string]),
    [`CORREÇÃO (POUPANÇA, ${obterNormas().nome}, ${obterNormas().itemCorrecao})`, brl(d.acrescimo)],
  ];
  if (d.acertoDe) {
    const est = Number(b.estimado) || 0, real = Number(b.real) || 0, cred = Number(b.credito) || 0, pagar = Number(b.aPagar) || 0;
    return [
      ['FATURA ESTIMADA (OND) JÁ EMITIDA', d.acertoDe], ['CONSUMO REAL (OUT–DEZ) — VALOR DO SERVIÇO', brl(real)],
      ['VALOR ESTIMADO JÁ FATURADO (04 - DÉBITO)', brl(est)],
      ...(cred > 0 ? [['CRÉDITO DA OM (A COMPENSAR OU DEVOLVER)', brl(cred)] as [string, string]] : pagar > 0 ? [['DIFERENÇA A PAGAR', brl(pagar)] as [string, string]] : []),
    ];
  }
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
  const ML = 8, MR = W - 14; // moldura (mm)
  const tx = ML + 3;         // texto interno
  doc.setTextColor(0); doc.setDrawColor(0); doc.setLineWidth(0.25);
  const txt = (t: string, x: number, y: number, tam = 9.5, neg = false, align: 'left' | 'center' | 'right' = 'left') => {
    doc.setFont('helvetica', neg ? 'bold' : 'normal'); doc.setFontSize(tam); doc.text(t, x, y, { align });
  };
  const par = (t: string, x: number, y: number, larg: number, tam = 9, neg = false) => {
    doc.setFont('helvetica', neg ? 'bold' : 'normal'); doc.setFontSize(tam);
    const ls = doc.splitTextToSize(t, larg); doc.text(ls, x, y); return y + ls.length * tam * 0.42;
  };

  cabecalhoInstitucional(doc, 6);
  let y = 33.5;
  txt(`CÓDIGO OMPS-E: ${d.params.codigo_omps || '40015'}`, tx, y, 9.5, true); txt(br(d.emissao, true), MR, y, 9.5, true, 'right');
  y = 43; txt('FATURAMENTO PARA SERVIÇOS DE APOIO BASE', W / 2 - 14, y, 9.5, true, 'center');
  y += 4.6; txt(`Nº: ${d.numero}`, tx, y, 9.5, true);
  const xc = 60;
  if (d.comimsup) { txt('COMIMSUP:', xc, y, 9.5, true); txt(d.comimsup, xc + 23, y, 9.5); y += 4.6; }
  txt('OM USUÁRIA:', xc, y, 9.5, true); txt(doc.splitTextToSize(d.omUsuaria, MR - xc - 26)[0], xc + 26, y, 9.5);
  y += 9.5;
  txt('DATA-LIMITE PARA A CERTIFICAÇÃO DESTA FATURA, A SER FEITA VIA SIPLAD:', tx, y, 9); txt(br(d.limite, true), MR - 4, y, 9.5, true, 'right');
  if (d.vencimento) { y += 5; txt('VENCIMENTO (PAGAMENTO):', tx, y, 9, true); txt(br(d.vencimento, true), MR - 4, y, 9.5, true, 'right'); }
  y += 7.5; txt(`REFERÊNCIA: ${mesesDoAno[d.mesCompetencia - 1]}${String(d.anoCompetencia).slice(2)}${d.estimado ? ' (ESTIMADO OUT–DEZ)' : ''}`, tx, y, 9.5, true);
  y += 7; y = par(`EMITIDA DE ACORDO COM ${(d.emitidaDeAcordoCom || 'O DETALHAMENTO NO CAMPO OBSERVAÇÃO').toUpperCase()}`, tx, y, MR - tx - 4, 9.5, true) - 1;
  y += 6; txt('DETALHAMENTO', tx, y, 9.5);

  // Moldura única do detalhamento até o responsável
  const topo = y + 2.5;
  y = topo + 6.2; txt(`SERVIÇO PRESTADO: ${d.servicoOficial.toUpperCase()}`, (ML + MR) / 2, y, 9.5, true, 'center');
  y += 3.3; doc.line(ML, y, MR, y);
  y += 4.5; txt('FR-172', ML + 5, y, 9);
  const final = Math.round((d.valorServico - d.adiantamento + d.acrescimo - d.debito) * 100) / 100;
  const linhasFr: [string, string, number][] = [
    ['01', '(+) TOTAL SERVIÇO PRESTADO', d.valorServico], ['02', '(-) ADIANTAMENTO', d.adiantamento], ['03', '(+) ACERTO ACRÉSCIMO', d.acrescimo], ['04', '(-) ACERTO DÉBITO', d.debito],
  ];
  const xn = 68, xt = 76, xv = 128, xr = 172;
  linhasFr.forEach(([n, t, v]) => { txt(n, xn, y, 9.5); txt(t, xt, y, 9.5); txt('- VALOR:', xv, y, 9.5); txt(brl(v), xr, y, 9.5, false, 'right'); y += 4.7; });
  txt('05', xn, y, 9.5); txt('TOTAL A PAGAR', xt + 6, y, 9.5); txt(':', xv + 10, y, 9.5); txt(brl(Math.max(0, final)), xr, y, 9.5, false, 'right');
  y += 3; doc.line(ML, y, MR, y);
  y += 4.5; txt('06', xn, y, 9.5); txt('TOTAL FATURA (01 – 02 + 03 – 04)', xt, y, 9.5); txt(':', xv + 10, y, 9.5, false); txt(brl(final), xr, y, 9.5, false, 'right');
  y += 3.2; doc.line(ML, y, MR, y);

  // Tabelinha de detalhamento (OBS.)
  const linhasDet = detalhamento(d);
  const largo = linhasDet.some(([k, v]) => k.length + v.length > 52);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
  const maxK = Math.max(...linhasDet.map(([k]) => doc.getTextWidth(k))) + 4;
  const tw = largo ? MR - ML - 8 : Math.max(96, maxK + 40), tx0 = ML + 3, col = largo ? tw - 38 : Math.max(50, maxK), rh = 4.6;
  y += 11;
  linhasDet.forEach(([k, v]) => {
    doc.setLineWidth(0.2); doc.rect(tx0, y, tw, rh); doc.line(tx0 + col, y, tx0 + col, y + rh);
    txt(k, tx0 + 1, y + 3.3, 8.5); txt(v, tx0 + tw - 1, y + 3.3, 8.5, false, 'right'); y += rh;
  });
  doc.setLineWidth(0.25);
  y += 6;
  const larg = MR - ML - 12;
  if (d.setorResponsavel || d.telefoneSetor) {
    y = par(`Dúvidas com relação aos valores apurados deverão ser sanadas com ${d.setorResponsavel || 'a divisão responsável'}${d.telefoneSetor ? ` pelo(s) telefone(s) ${d.telefoneSetor}` : ''}.`, tx + 1, y, larg, 9.5, true) + 1;
  }
  d.altcreds.forEach(a => { y = par(`Baixa na ALTCRED ${a}.`, tx + 1, y + 1.5, larg, 8.5, true); });
  (((d.base as any)?.creditos || []) as { numero: string; valor: number }[]).forEach(c => { y = par(`Compensação do crédito do acerto nº ${c.numero}: ${brl(Number(c.valor))} (linha 04).`, tx + 1, y + 1.5, larg, 8.5, true); });
  if (d.acertoDe) y = par((d.base as any)?.tipo === 'CORRECAO'
    ? `Fatura de correção do valor pago com atraso da fatura nº ${d.acertoDe}, pela taxa diária equivalente à da caderneta de poupança (${citarCorrecao()}).`
    : `Fatura de acerto do faturamento estimado de fim de exercício (OND) nº ${d.acertoDe}: traz o consumo real, com o valor estimado já faturado abatido na linha 04.${Number((d.base as any)?.credito) > 0 ? ' A diferença é crédito da OM, a ser compensado em faturas seguintes ou devolvido.' : ''}`, tx + 1, y + 1.5, larg, 8.5, true);
  if (d.substitui) y = par(`Esta fatura cancela e substitui a de nº ${d.substitui}.`, tx + 1, y + 1.5, larg, 8.5, true);
  y += 9;
  txt('INSTRUÇÕES PARA O PAGAMENTO DA FATURA:', tx + 1, y, 10, true);
  y += 1;
  if (d.params.instrucao_uno) y = par(`UNO) ${d.params.instrucao_uno}`, tx + 1, y + 3.8, larg, 9);
  if (d.params.instrucao_dois) y = par(`DOIS) ${d.params.instrucao_dois}`, tx + 1, y + 1.2, larg, 9);

  // Responsável pela emissão
  y = Math.max(y + 6, 207); doc.line(ML, y, MR, y);
  const cx = (ML + MR) / 2;
  y += 5; txt('RESPONSÁVEL PELA EMISSÃO', cx, y, 9.5, false, 'center');
  if (d.params.telefone_contabilidade) { y += 4.2; txt(d.params.telefone_contabilidade, cx, y, 8.5, false, 'center'); }
  y += 8.5; txt((d.params.encarregado_nome || '______________________________').toUpperCase(), cx, y, 9.5, false, 'center');
  if (d.params.encarregado_posto) { y += 4.4; txt(d.params.encarregado_posto, cx, y, 9.5, false, 'center'); }
  y += 4.4; txt('Encarregado da Divisão de Contabilidade', cx, y, 9.5, false, 'center');
  y += 1.5; doc.rect(cx - 35, y, 70, 4.8); txt('ASSINADO DIGITALMENTE', cx, y + 3.5, 9.5, false, 'center');
  y += 8;
  // laterais e base da moldura
  doc.line(ML, topo, MR, topo); doc.line(ML, topo, ML, y); doc.line(MR, topo, MR, y); doc.line(ML, y, MR, y);
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
