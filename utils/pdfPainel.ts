/** PDF "resumo do Painel do Encarregado": uma visão executiva do recorte consultado (somente leitura). */
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { cabecalhoCompacto } from './pdfCabecalho';
import {
  Alerta, BaixaGer, ContestacaoGer, Criterios, FaturaGer, LinhaOM, Periodo, ROTULO_PRIORIDADE, Recebimento, indicadores, ordenarOM, resumoContestacoes,
} from './painelGerencial';

const brl = (n: number) => `R$ ${(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const br = (iso?: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—');
const mes = (ym: string) => `${ym.slice(5)}/${ym.slice(0, 4)}`;
const pct = (v: number | null) => (v === null ? '—' : `${v.toLocaleString('pt-BR')}%`);

export interface EntradaPdf {
  hoje: string; periodo: Periodo; fs: FaturaGer[]; bs: BaixaGer[]; idx: Map<string, BaixaGer[]>; recebimentos: Recebimento[]; linhas: LinhaOM[]; alertas: Alerta[]; contest: ContestacaoGer[];
  criterios: Criterios; parados: { valor: number }[]; adiantamentos: { saldo: number }[]; filtros: string[]; atualizadoEm: string;
}

export function pdfPainel(e: EntradaPdf): jsPDF {
  const doc = new jsPDF('p');
  const ind = indicadores(e.fs, e.bs, e.idx, e.periodo, e.hoje, e.criterios, e.recebimentos);
  const ctn = resumoContestacoes(e.contest, e.periodo, e.criterios);
  const y0 = cabecalhoCompacto(doc);
  doc.setFontSize(14); doc.text('Painel do Encarregado — resumo', 14, y0 + 7);
  doc.setFontSize(8);
  const cab = [`Posição em ${br(e.hoje)} · período ${mes(e.periodo.de)} a ${mes(e.periodo.ate)} · gerado em ${e.atualizadoEm || br(e.hoje)}`, `Recorte: ${e.filtros.length ? e.filtros.join('; ') : 'todos os setores, comandos e públicos'} · ${e.fs.length.toLocaleString('pt-BR')} faturas`];
  let y = y0 + 12; cab.forEach(l => { const p = doc.splitTextToSize(l, 182); doc.text(p, 14, y); y += 4 * p.length; });

  const tabela = (titulo: string, head: string[], body: (string | number)[][], opts: { largura?: number[] } = {}) => {
    autoTable(doc, { startY: y + 1, head: [[{ content: titulo, colSpan: head.length, styles: { fillColor: [15, 23, 42], halign: 'left' } }], head], body,
      styles: { fontSize: 8, cellPadding: 1.5 }, headStyles: { fillColor: [51, 65, 85] }, theme: 'grid',
      columnStyles: Object.fromEntries((opts.largura || []).map((w, i) => [i, { cellWidth: w }])) });
    y = (doc as any).lastAutoTable.finalY + 5;
  };

  tabela('Indicadores', ['Indicador', 'Valor', 'Detalhe'], [
    ['Total faturado no período', brl(ind.faturamento.faturado.valor), `${ind.faturamento.faturado.qtd} fatura(s)`],
    ['Em aberto', brl(ind.faturamento.emAberto.valor), `${ind.faturamento.emAberto.qtd} fatura(s)`],
    ['Canceladas no período', brl(ind.faturamento.canceladas.valor), `${ind.faturamento.canceladas.qtd} fatura(s)`],
    ['Total vencido', brl(ind.cobranca.vencido.valor), `${ind.cobranca.vencido.qtd} fatura(s) · ${ind.cobranca.omInadimplentes} OM`],
    ['Inadimplência (vencido ÷ em aberto)', pct(ind.cobranca.pctInadimplencia), `prazo médio de atraso ${ind.cobranca.prazoMedio} dias`],
    [`Vencido há mais de ${e.criterios.diasAtencao} dias`, brl(ind.cobranca.mais90.valor), `${ind.cobranca.mais90.qtd} fatura(s)`],
    [`Vencido há mais de ${e.criterios.diasCritico} dias`, brl(ind.cobranca.mais365.valor), `${ind.cobranca.mais365.qtd} fatura(s)`],
    ['Recebido no período (ALTCRED/GRU)', brl(ind.recebimentos.recebido.valor), `${ind.recebimentos.recebido.qtd} ALTCRED/GRU · ${pct(ind.recebimentos.pctDoFaturado)} do faturado já quitado`],
    ['Vencido recuperado', brl(ind.recebimentos.recuperacao.recuperado), `${pct(ind.recebimentos.recuperacao.pct)} do vencido no início do período`],
    ['Adiantamentos disponíveis', brl(e.adiantamentos.reduce((s, a) => s + a.saldo, 0)), `${e.adiantamentos.length} lançamento(s)`],
    ['Em contestação', brl(ind.contestadas.valor), `${ctn.abertas.length} contestação(ões) aberta(s) · ${ctn.semMovimento.length} sem movimentação`],
    ['ALTCRED/GRU com saldo parado', brl(e.parados.reduce((s, p) => s + p.valor, 0)), `${e.parados.length} documento(s) há mais de ${e.criterios.diasSaldoParado} dias`],
  ], { largura: [80, 38, 64] });

  tabela('Idade da dívida', ['Faixa', 'Valor', 'Faturas'], ind.cobranca.faixas.map(f => [f.faixa, brl(f.valor), f.qtd]), { largura: [80, 50, 52] });
  if (e.alertas.length) tabela('Pontos que exigem atenção', ['Prioridade', 'Ocorrência', 'OM', 'Valor', 'Qtd'], e.alertas.slice(0, 12).map(a => [ROTULO_PRIORIDADE[a.prioridade], a.tipo, a.om, a.valor === null ? '—' : brl(a.valor), a.qtd]), { largura: [22, 66, 48, 32, 14] });
  const top = ordenarOM(e.linhas.filter(l => l.vencido > 0), 'vencido').slice(0, 10);
  if (top.length) tabela('10 OM com maior valor vencido', ['OM', 'Vencido', '% inad.', `> ${e.criterios.diasAtencao} d`, 'Contestado'], top.map(l => [l.cliente, brl(l.vencido), pct(l.pctInad), l.v90 ? brl(l.v90) : '', l.contestado ? brl(l.contestado) : '']), { largura: [78, 32, 18, 28, 26] });
  doc.setFontSize(7); doc.setTextColor(100);
  doc.text('Em aberto exclui faturas contestadas (mostradas à parte). Recebido = ALTCRED/GRU pela data do documento. Definições completas na tela, em "Como cada indicador é calculado".', 14, Math.min(y + 2, 285), { maxWidth: 182 });
  doc.save(`painel_encarregado_${e.hoje}.pdf`);
  return doc;
}
