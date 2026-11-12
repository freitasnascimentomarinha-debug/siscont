/**
 * PDF da PRÉVIA do lote de faturas: um único arquivo com a capa-resumo e todas as faturas (FR-172, com os anexos),
 * com marca d'água diagonal em TODAS as páginas e faixa no rodapé, para nunca ser confundido com fatura emitida.
 */
import jsPDF from 'jspdf';
import { DadosFr172, desenharFaturaCompleta } from './fr172';
import { ItemLote, TipoLote, referencia, textoConsumo } from './faturamento';
import { lerFatura } from './cadastroImport';
import { cabecalhoCompacto, tabelaPdf, tituloRelatorio } from './pdfCabecalho';
import type { ServicoCatalogo } from '../types';

const r2 = (n: number) => Math.round(n * 100) / 100;
const brl = (n: number) => `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const br = (iso: string) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '');
export const TEXTO_PREVIA = 'PRÉVIA';

/** Dados do PDF da fatura a partir de um item do lote (antes de existir a fatura gravada). */
export function dadosFr172DaPrevia(i: ItemLote, o: { emissao: string; limite: string; vencimento: string; tipo: TipoLote; servicos: ServicoCatalogo[]; params: Record<string, string> }): DadosFr172 {
  const lido = lerFatura(i.numero || '');
  const sv = o.servicos.find(s => s.acronym.toUpperCase() === i.sigla.toUpperCase());
  const comimsup = (i.om.comando || '').replace(/^\d{4,5}\s*-\s*/, '').trim();
  const venceNaLimite = !!i.estimado || !!i.venceNaLimite || o.tipo === 'OND';
  return {
    numero: i.numero || '(sem número)', emissao: o.emissao, limite: o.limite, vencimento: venceNaLimite ? o.limite : o.vencimento,
    mesCompetencia: lido ? lido.competencia % 100 : 0, anoCompetencia: lido ? Math.floor(lido.competencia / 100) : 0,
    omUsuaria: i.om.nome, comimsup: comimsup && comimsup.toLowerCase() !== i.om.nome.toLowerCase() && !/extra/i.test(comimsup) ? comimsup : null, sigla: i.sigla,
    servicoOficial: sv?.nomeOficial || sv?.name || i.servico, emitidaDeAcordoCom: sv?.emitidaDeAcordoCom, setorResponsavel: sv?.setorResponsavel, telefoneSetor: sv?.telefoneSetor,
    valorServico: i.valor, adiantamento: r2((i.adiantamentos || []).reduce((s, a) => s + a.valor, 0)), acrescimo: i.acrescimo || 0, debito: i.debito || 0,
    consumo: textoConsumo({ ...i, unidade: '' }).replace(/^-$/, ''), unidade: i.unidade, base: i.base as any,
    altcreds: [...new Set((i.adiantamentos || []).map(a => a.numero))], acertoDe: i.acertoDe, estimado: i.estimado, params: o.params,
  };
}

/** Marca d'água diagonal e faixa no rodapé em todas as páginas. */
export function aplicarMarcaDagua(doc: jsPDF, texto = TEXTO_PREVIA, rodape = 'PRÉVIA — SEM VALOR COMO FATURA — NÃO EMITIDA, NÃO ENVIAR À OM') {
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
  for (let p = 1; p <= doc.getNumberOfPages(); p++) {
    doc.setPage(p);
    doc.saveGraphicsState();
    doc.setGState(new (doc as any).GState({ opacity: 0.16 }));
    doc.setTextColor(200, 30, 30); doc.setFont('helvetica', 'bold'); doc.setFontSize(110);
    doc.text(texto, W / 2, H / 2 + 25, { align: 'center', angle: 38 });
    doc.restoreGraphicsState();
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(200, 30, 30);
    doc.text(rodape, W / 2, H - 5, { align: 'center' });
    doc.setTextColor(0);
  }
}

export interface OpcoesPrevia {
  tipo: TipoLote; competencia: string; emissao: string; limite: string; vencimento: string; servicos: ServicoCatalogo[]; params: Record<string, string>;
}
const ROTULO_TIPO: Record<TipoLote, string> = { MENSAL: 'Lote mensal', OND: 'Faturamento estimado de fim de exercício (OND)', ACERTO: 'Acerto do OND', CORRECAO: 'Correção por atraso' };

export function pdfPreviaLote(itens: ItemLote[], o: OpcoesPrevia): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const dados = itens.map(i => dadosFr172DaPrevia(i, o));
  // capa-resumo
  cabecalhoCompacto(doc);
  const y = tituloRelatorio(doc, `PRÉVIA da emissão de faturas — ${referencia(o.competencia)}`, `${ROTULO_TIPO[o.tipo]} · emissão ${br(o.emissao)} · certificação até ${br(o.limite)}`);
  const final = (d: DadosFr172) => r2(d.valorServico - d.adiantamento + d.acrescimo - d.debito);
  tabelaPdf(doc, {
    startY: y, head: [['Nº', 'OM usuária', 'Serviço', 'Vencimento', 'Valor da fatura']],
    body: dados.map(d => [d.numero, d.omUsuaria, d.sigla, br(d.vencimento || ''), brl(final(d))]),
    foot: [[{ content: `${dados.length} fatura(s)`, colSpan: 4 }, brl(r2(dados.reduce((s, d) => s + final(d), 0)))]],
    columnStyles: { 4: { halign: 'right' } },
  });
  // faturas (cada uma com seus anexos)
  dados.forEach(d => { doc.addPage(); desenharFaturaCompleta(doc, d); });
  aplicarMarcaDagua(doc);
  return doc;
}
