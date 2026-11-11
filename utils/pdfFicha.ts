/** PDF do extrato de situação de uma OM ou de um comando (mesmo padrão dos demais relatórios, com a assinatura do Encarregado). */
import jsPDF from 'jspdf';
import { DadosFicha } from './fichaPainel';
import { FAIXAS_ATRASO } from './painelGerencial';
import { dataBR } from './datas';
import { TEMA, cabecalhoCompacto, fimDaTabela, finalizarPdf, tabelaPdf, tituloCentralizado } from './pdfCabecalho';

const brl = (n: number) => `${n < 0 ? '−' : ''}R$ ${Math.abs(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const vazio = (n: number) => (n > 0.005 ? brl(n) : '—');

export function pdfFicha(d: DadosFicha): jsPDF {
  const doc = new jsPDF(d.modo === 'comando' ? 'l' : 'p');
  const W = doc.internal.pageSize.getWidth(), L = W - 28;
  cabecalhoCompacto(doc);
  let y = tituloCentralizado(doc, d.titulo, d.modo === 'comando' ? 'Extrato de situação do comando' : 'Extrato de situação da OM', 26);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
  const sub = `${d.comando}${d.setor ? ` · setor ${d.setor}` : ''} · posição em ${dataBR(d.hoje)}${d.modo === 'comando' ? ` · ${d.oms.length} OM` : ''}`;
  doc.splitTextToSize(sub, L).forEach((l: string) => { doc.text(l, W / 2, y, { align: 'center' }); y += 4.2; });
  y += 2;
  const k = d.kpis;
  tabelaPdf(doc, {
    startY: y, head: [['Em aberto', 'Vencido', 'Em contestação', 'Variação do vencido em 30 dias', 'Saldo parado (ALTCRED/GRU)']],
    body: [[`${brl(k.emAberto)}\n${k.qtdAberto} fatura(s)`, `${brl(k.vencido)}\n${k.qtdVencidas} fatura(s) · ${k.atrasoMedio} dias em média`, `${brl(k.contestado)}\n${k.qtdContestadas} fatura(s)`,
      `${k.variacao >= 0 ? '+' : '−'}${brl(Math.abs(k.variacao))}${k.variacaoPct === null ? '' : `\n${k.variacaoPct}% do vencido`}`, brl(d.saldoParado)]],
    styles: { fontSize: 8.5, halign: 'center', cellPadding: 2 }, columnStyles: { 1: { textColor: TEMA.faixa } },
  });
  y = fimDaTabela(doc) + 4;
  const faixas = ['A vencer', ...FAIXAS_ATRASO];
  tabelaPdf(doc, { startY: y, head: [faixas], body: [faixas.map(f => vazio(d.porFaixa[f] || 0))], styles: { fontSize: 8, halign: 'center' } });
  y = fimDaTabela(doc) + 6;

  if (d.modo === 'comando') {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.text('OM do comando', 14, y); doc.setFont('helvetica', 'normal');
    tabelaPdf(doc, {
      startY: y + 2, head: [['OM', 'Em aberto', 'Vencido', '% inad.', 'Fat. vencidas', 'Contestado', 'Última movimentação']],
      body: d.oms.map(l => [l.cliente, vazio(l.emAberto), vazio(l.vencido), l.pctInad === null ? '—' : `${l.pctInad.toLocaleString('pt-BR')}%`, l.qtdVencidas || '—', vazio(l.contestado), l.ultimaMov ? dataBR(l.ultimaMov) : '—']),
      foot: [['TOTAL DO COMANDO', brl(k.emAberto), brl(k.vencido), '', String(k.qtdVencidas), vazio(k.contestado), '']],
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } },
    });
    y = fimDaTabela(doc) + 6;
  }

  doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.text(`Faturas com saldo (${d.abertas.length})`, 14, y); doc.setFont('helvetica', 'normal');
  const com = d.modo === 'comando';
  tabelaPdf(doc, {
    startY: y + 2,
    head: [[...(com ? ['OM'] : []), 'Fatura', 'Emissão', 'Vencimento', 'Atraso', 'Valor', 'Saldo', 'Situação']],
    body: d.abertas.map(a => [...(com ? [a.om] : []), a.f.numero, dataBR(a.f.emissao), dataBR(a.f.vencimento), a.atraso ? `${a.atraso} dias` : '—', brl(a.f.total), brl(a.f.saldo), a.situacao]),
    foot: [[...(com ? [''] : []), 'TOTAL', '', '', '', '', brl(d.abertas.reduce((s, a) => s + a.f.saldo, 0)), '']],
    columnStyles: com ? { 2: { halign: 'center' }, 3: { halign: 'center' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' } } : { 1: { halign: 'center' }, 2: { halign: 'center' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } },
    didParseCell: (c: any) => { if (c.section === 'body' && c.cell.raw === 'vencida') c.cell.styles.textColor = [185, 28, 28]; },
  });
  y = fimDaTabela(doc) + 6;
  if (d.contest.length) {
    tabelaPdf(doc, { startY: y, head: [['Contestações', 'Situação', 'Dias abertos', 'Valor']], body: d.contest.map(x => [x.c.numeroFatura, x.c.status.toLowerCase(), x.diasAberta, brl(x.valor)]), columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' } } });
    y = fimDaTabela(doc) + 6;
  }
  if (d.cobr.length) {
    tabelaPdf(doc, { startY: y, head: [['Cobranças enviadas', 'Faturas', 'Valor']], body: d.cobr.slice(0, 10).map(c => [dataBR(c.enviadaEm), c.faturas.length, brl(c.valor)]), columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } } });
  }
  finalizarPdf(doc);
  return doc;
}
